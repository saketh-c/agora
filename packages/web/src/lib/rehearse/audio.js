/**
 * How it was said: pauses, volume consistency, pitch variety, and a syllable estimate
 * for pace when there is no transcript. The summaries are pure functions over frames of
 * {t, rms, pitchHz}; the capture helper at the bottom is the only part that touches the
 * browser, and nothing it hears leaves the device.
 */

const MIN_PAUSE_SEC = 0.7;
/** A pause at least this long counts as a long pause in the report. */
export const LONG_PAUSE_SEC = 1.5;
const PHRASE_GAP_SEC = 0.35;
/** Less speech than this and there is nothing to coach: the mic most likely did not hear you. */
export const MIN_SPEECH_SEC = 2;

function percentile(values, p) {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.floor(p * (sorted.length - 1)))];
}

function mean(values) {
  return values.length ? values.reduce((a, b) => a + b, 0) / values.length : 0;
}

function std(values) {
  if (values.length < 2) return 0;
  const m = mean(values);
  return Math.sqrt(mean(values.map((v) => (v - m) ** 2)));
}

/**
 * Frames on an even grid of dt seconds. The sampler runs on the main thread, so a busy
 * moment (the vision model, a background tab) drops frames; counting frames would then
 * shrink every pause. When the real timestamps say frames went missing, each grid point
 * takes the latest frame at or before it.
 */
export function onGrid(frames, dt) {
  if (frames.length < 2 || typeof frames[0].t !== 'number' || typeof frames[frames.length - 1].t !== 'number') return frames;
  const t0 = frames[0].t;
  const steps = Math.round((frames[frames.length - 1].t - t0) / dt) + 1;
  if (Math.abs(steps - frames.length) <= Math.max(1, frames.length * 0.02)) return frames;
  const out = [];
  let j = 0;
  for (let k = 0; k < steps; k += 1) {
    const tk = t0 + k * dt;
    while (j + 1 < frames.length && frames[j + 1].t <= tk + 1e-9) j += 1;
    out.push({ ...frames[j], t: tk });
  }
  return out;
}

/**
 * Which frames carry speech, judged against the noise floor. The floor is the quietest
 * twentieth of the take (a fluent speaker who starts right away still breathes), or the
 * room as the mic heard it before the take when that is quieter, capped so a noisy room
 * cannot hide a voice.
 */
export function speechMask(frames, { ambient } = {}) {
  const rms = frames.map((f) => f.rms);
  let floor = percentile(rms, 0.05);
  if (typeof ambient === 'number' && ambient > 0) floor = Math.min(floor, ambient);
  floor = Math.min(floor, 0.02);
  const threshold = Math.max(floor * 3, 0.012);
  return { mask: rms.map((v) => v > threshold), floor, threshold };
}

/** Runs of consecutive frames where the mask holds, as [startIndex, endIndex). */
function runs(mask, wanted) {
  const out = [];
  let start = -1;
  for (let i = 0; i <= mask.length; i += 1) {
    const on = i < mask.length && mask[i] === wanted;
    if (on && start < 0) start = i;
    if (!on && start >= 0) {
      out.push([start, i]);
      start = -1;
    }
  }
  return out;
}

const SILENT = Object.freeze({ speakingSec: 0, firstSpeechSec: null, lastSpeechSec: null, pauses: [], longPauses: 0, loudness: { mean: 0, cv: 0, trailOff: 0 }, phrases: 0 });

/**
 * Pauses and volume. A pause only counts once speech has started and before it ends, so
 * the quiet moment before the first word is not held against anyone.
 */
export function summarizeEnvelope(input, dt, opts = {}) {
  const frames = onGrid(input, dt);
  if (!frames.length) return { ...SILENT };
  const { mask } = speechMask(frames, opts);
  const speech = runs(mask, true);
  if (!speech.length) return { ...SILENT };

  const firstSpeech = speech[0][0];
  const lastSpeech = speech[speech.length - 1][1];
  const pauses = runs(mask, false)
    .filter(([s, e]) => s >= firstSpeech && e <= lastSpeech && (e - s) * dt >= MIN_PAUSE_SEC)
    .map(([s, e]) => ({ start: s * dt, end: e * dt, dur: (e - s) * dt }));

  // Phrases: speech runs merged across gaps too short to be a real pause.
  const phrases = [];
  for (const [s, e] of speech) {
    const last = phrases[phrases.length - 1];
    if (last && (s - last[1]) * dt < PHRASE_GAP_SEC) last[1] = e;
    else phrases.push([s, e]);
  }
  const levels = [];
  let trail = 0;
  let judged = 0;
  for (const [s, e] of phrases) {
    const seg = frames.slice(s, e).map((f) => f.rms);
    if (seg.length < 8) continue;
    const m = mean(seg);
    levels.push(m);
    const tail = seg.slice(Math.floor(seg.length * 0.8));
    // Quieter by more than 6 dB at the end of a phrase reads as trailing off.
    if (mean(tail) < m * 0.5) trail += 1;
    judged += 1;
  }
  const loudMean = mean(levels);
  return {
    speakingSec: speech.reduce((n, [s, e]) => n + (e - s), 0) * dt,
    firstSpeechSec: firstSpeech * dt,
    lastSpeechSec: lastSpeech * dt,
    pauses,
    longPauses: pauses.filter((p) => p.dur >= LONG_PAUSE_SEC).length,
    loudness: { mean: loudMean, cv: loudMean ? std(levels) / loudMean : 0, trailOff: judged ? trail / judged : 0 },
    phrases: phrases.length,
  };
}

/** Pitch variety in semitones. Under about a semitone and a half reads as monotone. */
export function pitchStats(frames) {
  const voiced = frames.filter((f) => f.pitchHz > 60 && f.pitchHz < 450).map((f) => f.pitchHz);
  if (voiced.length < 10) return { stdSemitones: 0, monotone: false, enough: false };
  const semis = voiced.map((hz) => 12 * Math.log2(hz / 100));
  const s = std(semis);
  return { stdSemitones: Math.round(s * 10) / 10, monotone: s < 1.5, enough: true };
}

/**
 * Rough syllable count from the loudness envelope: each local peak that clears the speech
 * threshold, at least 120 ms apart. Good enough to estimate pace when there is no transcript.
 */
export function estimateSyllables(input, dt, opts = {}) {
  const frames = onGrid(input, dt);
  const { mask, threshold } = speechMask(frames, opts);
  const minGap = Math.max(1, Math.round(0.12 / dt));
  let count = 0;
  let last = -minGap;
  for (let i = 1; i < frames.length - 1; i += 1) {
    if (!mask[i]) continue;
    const v = frames[i].rms;
    if (v >= frames[i - 1].rms && v > frames[i + 1].rms && v > threshold * 1.3 && i - last >= minGap) {
      count += 1;
      last = i;
    }
  }
  return count;
}

/**
 * Mean loudness per bucket, scaled so the loudest bucket is 100. A take with no speech in
 * it returns nothing: scaling room noise up to 100% would draw a healthy-looking line.
 */
export function loudnessSeries(input, dt, bucketSec = 5, opts = {}) {
  const frames = onGrid(input, dt);
  const { threshold } = speechMask(frames, opts);
  const out = [];
  const per = Math.max(1, Math.round(bucketSec / dt));
  for (let i = 0; i < frames.length; i += per) {
    const seg = frames.slice(i, i + per);
    out.push({ t: (i + seg.length / 2) * dt, v: mean(seg.map((f) => f.rms)) });
  }
  const max = Math.max(...out.map((p) => p.v), 0);
  if (!(max > threshold)) return [];
  return out.map((p) => ({ t: p.t, v: Math.round((p.v / max) * 100) }));
}

/**
 * Syllables in a spoken word, on average: English about 1.4, Spanish about 1.9, and
 * Vietnamese 1, since its words (what the pace band counts) are single syllables.
 */
export const SYLLABLES_PER_WORD = Object.freeze({ en: 1.4, es: 1.9, vi: 1 });

/** Estimated words per minute per bucket from syllables. */
export function paceEstimateSeries(input, dt, bucketSec = 15, opts = {}) {
  const perWord = opts.perWord || SYLLABLES_PER_WORD.en;
  const frames = onGrid(input, dt);
  const { threshold, floor } = speechMask(frames, opts);
  const out = [];
  const per = Math.max(1, Math.round(bucketSec / dt));
  for (let i = 0; i < frames.length; i += per) {
    const seg = frames.slice(i, i + per);
    if (seg.length * dt < 3) break;
    // Judge every bucket against the whole take's floor, not its own.
    const syl = estimateSyllables(seg, dt, { ambient: floor || threshold / 3 });
    out.push({ t: (i + seg.length / 2) * dt, v: Math.round((syl / perWord / (seg.length * dt)) * 60) });
  }
  return out;
}

/**
 * Fundamental frequency by normalized autocorrelation over 70 to 400 Hz. Zero when the
 * frame is not clearly voiced.
 */
export function detectPitch(buf, sampleRate) {
  const n = buf.length;
  let energy = 0;
  for (let i = 0; i < n; i += 1) energy += buf[i] * buf[i];
  if (energy < 1e-4) return 0;
  const minLag = Math.floor(sampleRate / 400);
  const maxLag = Math.min(n - 1, Math.floor(sampleRate / 70));
  let best = 0;
  let bestLag = 0;
  for (let lag = minLag; lag <= maxLag; lag += 1) {
    let c = 0;
    for (let i = 0; i < n - lag; i += 1) c += buf[i] * buf[i + lag];
    c /= energy;
    if (c > best) {
      best = c;
      bestLag = lag;
    }
  }
  return best > 0.5 && bestLag ? sampleRate / bestLag : 0;
}

/** Microphone level (rms) as 0..1 on a decibel scale, for meters: -60 dB is empty, -10 dB full. */
export function levelShare(rms) {
  if (!(rms > 0)) return 0;
  return Math.max(0, Math.min(1, (20 * Math.log10(rms) + 60) / 50));
}

/**
 * Sample loudness and pitch from a microphone stream. Browser only. Nothing here is
 * recorded or sent: it keeps a few numbers per tick and throws the audio away.
 *
 * One capture serves a whole session: it meters the mic during the device check, then
 * `restart()` begins the take and hands back what the room sounded like before it, which
 * is the best noise floor there is. `stop()` closes the AudioContext.
 */
export function startAudioCapture(stream, { intervalMs = 50, idleFrames = 400 } = {}) {
  const Ctx = window.AudioContext || window.webkitAudioContext;
  const ctx = new Ctx();
  // Some browsers start a context suspended when it is not created inside the click.
  if (ctx.state === 'suspended' && ctx.resume) ctx.resume().catch(() => {});
  const source = ctx.createMediaStreamSource(stream);
  const analyser = ctx.createAnalyser();
  analyser.fftSize = 2048;
  source.connect(analyser);
  const buf = new Float32Array(analyser.fftSize);
  const half = new Float32Array(analyser.fftSize / 2);
  let frames = [];
  let recording = false;
  let level = 0;
  let started = performance.now();
  let closed = false;
  const timer = setInterval(() => {
    analyser.getFloatTimeDomainData(buf);
    let sum = 0;
    for (let i = 0; i < buf.length; i += 1) sum += buf[i] * buf[i];
    const rms = Math.sqrt(sum / buf.length);
    level = rms;
    // Pitch on a half-rate copy: plenty for voice, and a quarter of the work.
    let pitchHz = 0;
    if (recording && rms > 0.015) {
      for (let i = 0; i < half.length; i += 1) half[i] = buf[i * 2];
      pitchHz = detectPitch(half, ctx.sampleRate / 2);
    }
    frames.push({ t: (performance.now() - started) / 1000, rms, pitchHz });
    if (!recording && frames.length > idleFrames) frames = frames.slice(-idleFrames);
  }, intervalMs);
  return {
    dt: intervalMs / 1000,
    level: () => level,
    state: () => ctx.state,
    /** Start the take: returns the ambient frames heard so far and starts a fresh clock. */
    restart() {
      const before = frames;
      frames = [];
      recording = true;
      started = performance.now();
      if (ctx.state === 'suspended' && ctx.resume) ctx.resume().catch(() => {});
      return before;
    },
    /** End the take and keep metering: returns the take's frames. */
    take() {
      const out = frames;
      frames = [];
      recording = false;
      return out;
    },
    stop() {
      clearInterval(timer);
      const out = frames;
      frames = [];
      if (!closed) {
        closed = true;
        try {
          source.disconnect();
          ctx.close().catch(() => {});
        } catch {
          /* already closed */
        }
      }
      return out;
    },
  };
}

/** The room's noise level from frames heard before a take (the quiet fifth of them). */
export function ambientFloor(frames) {
  const rms = (frames || []).map((f) => f.rms).filter((v) => v > 0);
  return rms.length >= 10 ? percentile(rms, 0.2) : undefined;
}
