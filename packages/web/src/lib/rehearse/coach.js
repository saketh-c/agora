import { PACE_TARGET } from './speech.js';
import { LONG_PAUSE_SEC, MIN_SPEECH_SEC } from './audio.js';

/**
 * Turn the measurements into a short, ranked list of things to work on, each with the
 * evidence and one thing to try, plus what went well. Every entry is an id and parameters;
 * the words live in the dictionaries under rehearse.findings.<id> and rehearse.strengths,
 * so the coaching translates. Parameters stay raw numbers and keys; the page formats them.
 */

const LIMITS = Object.freeze({
  fillerRate: 3,
  longPauses: 3,
  trailOff: 0.3,
  loudnessCv: 0.55,
  scriptCoverage: 0.7,
  eyeContact: 0.5,
  lookingDown: 0.3,
  sway: 0.035,
  handsNearFace: 0.2,
  handsHidden: 0.3,
  faceVisible: 0.5,
});

/** Shorter than this, a take is a sound check, not a comment: no verdicts on pace or style. */
export const MIN_TAKE_SEC = 15;
/** Everyone acts on three things at most. */
export const MAX_FINDINGS = 3;

// Severity only orders the list; it is never shown, so it is not capped.
function add(list, id, severity, params = {}) {
  if (severity > 0) list.push({ id, severity, params });
}

/**
 * The seconds that count against the limit: from "go" to the end of the last word, plus a
 * breath, rounded to whole seconds once. The second it takes to reach the Stop button is
 * not part of the comment, and every screen shows this same number.
 */
export function timedSeconds(durationSec, envelope) {
  const end = envelope && typeof envelope.lastSpeechSec === 'number' ? Math.min(durationSec, envelope.lastSpeechSec + 0.5) : durationSec;
  return Math.max(0, Math.round(end));
}

/** True when the mic picked up enough voice (or the transcript enough words) to coach. */
export function wasHeard({ envelope, speech }) {
  if (speech && speech.words >= 5) return true;
  return Boolean(envelope && envelope.speakingSec >= MIN_SPEECH_SEC);
}

/**
 * Whether a take counts as practice: saved to the history and marking the Practice step done.
 * A take where nothing was heard, or one too short to coach (a sound check), does not.
 */
export function countsAsPractice(coach) {
  return Boolean(coach && coach.heard && !(coach.findings || []).some((f) => f.id === 'too_short' || f.id === 'not_heard'));
}

/**
 * @param {object} input
 * @param {object|null} input.speech  analyzeTranscript() result, or null when there was no transcript
 * @param {object} input.envelope summarizeEnvelope() result
 * @param {object} input.pitch  pitchStats() result
 * @param {object|null} input.body summarizeBody() result, or null when the camera was off
 * @param {number} input.seconds  timedSeconds(): whole seconds that count against the limit
 * @param {number} input.limitSec
 * @param {number} input.wpm  spoken or estimated words per minute
 * @param {boolean} input.wpmEstimated  wpm came from syllables in the voice, not a transcript
 * @param {string} input.lang
 * @param {boolean} input.hasScript  a script was given, so coverage can be judged
 * @returns {{ heard: boolean, findings: Array, strengths: Array }}
 */
export function buildFindings({ speech, envelope, pitch, body, seconds, limitSec, wpm, wpmEstimated = false, lang = 'en', hasScript = false }) {
  const findings = [];
  const strengths = [];
  const [lo, hi] = PACE_TARGET[lang] || PACE_TARGET.en;
  const used = Math.round(seconds || 0);

  // Nothing to judge: say so plainly instead of grading room noise as "steady".
  if (!wasHeard({ envelope, speech })) return { heard: false, findings: [{ id: 'not_heard', severity: 10, params: {} }], strengths: [] };
  if (used < MIN_TAKE_SEC) return { heard: true, findings: [{ id: 'too_short', severity: 5, params: { used } }], strengths: [] };

  // Time against the city's limit is the one rule the chamber enforces for you, so
  // running over outranks everything else that could be on this list.
  if (limitSec && used > limitSec) add(findings, 'over_time', 2 + (used - limitSec) / limitSec, { over: used - limitSec });
  else if (limitSec && used < limitSec * 0.4) add(findings, 'under_time', 0.3, { used, limit: limitSec });
  else if (limitSec) strengths.push({ id: 'on_time', params: { left: limitSec - used } });

  if (wpm > 0) {
    // A pace counted from syllables in the voice is rough: only call it off when it is
    // clearly outside the band.
    const slack = wpmEstimated ? 0.1 : 0;
    if (wpm > hi * (1 + slack)) add(findings, 'pace_fast', 0.4 + (wpm - hi) / hi, { wpm, hi });
    else if (wpm < lo * (1 - slack)) add(findings, 'pace_slow', 0.3 + (lo - wpm) / lo, { wpm, lo });
    else if (wpm >= lo && wpm <= hi) strengths.push({ id: 'pace_good', params: { wpm } });
  }

  if (speech && speech.words >= 20) {
    if (speech.fillerRate >= LIMITS.fillerRate) add(findings, 'fillers', 0.4 + speech.fillerRate / 10, { rate: speech.fillerRate, list: speech.fillers.slice(0, 3).map((f) => f.word), total: speech.fillerTotal });
    else if (speech.fillerTotal === 0) strengths.push({ id: 'no_fillers', params: {} });
    else strengths.push({ id: 'few_fillers', params: { total: speech.fillerTotal, words: speech.words } });
    if (speech.longSentences >= 2) add(findings, 'long_sentences', 0.3, { n: speech.longSentences });
    if (speech.repeats.length && speech.repeats[0].count >= 6) add(findings, 'repeats', 0.25, { word: speech.repeats[0].word, count: speech.repeats[0].count });
    if (hasScript && speech.script) {
      const skipped = typeof speech.script.skippedCount === 'number' ? speech.script.skippedCount : speech.script.skipped.length;
      if (speech.script.coverage < LIMITS.scriptCoverage) add(findings, 'script_skipped', 0.5 + (LIMITS.scriptCoverage - speech.script.coverage), { pct: Math.round(speech.script.coverage * 100), skipped });
      else strengths.push({ id: 'script_covered', params: { pct: Math.round(speech.script.coverage * 100) } });
    }
    // Name, school, item, ask: only judged against a script the builder wrote, never a
    // leftover draft about something else.
    const checked = hasScript ? Object.entries(speech.elements || {}) : [];
    const missing = checked.filter(([, ok]) => !ok).map(([k]) => k);
    if (missing.length) add(findings, 'missing_elements', 0.55, { missing, n: missing.length });
    else if (checked.length >= 2) strengths.push({ id: 'elements_landed', params: { landed: checked.map(([k]) => k) } });
  }

  if (envelope && envelope.phrases >= 3) {
    if (envelope.longPauses >= LIMITS.longPauses) add(findings, 'long_pauses', 0.35 + envelope.longPauses / 20, { n: envelope.longPauses, sec: LONG_PAUSE_SEC });
    if (envelope.loudness.trailOff >= LIMITS.trailOff) add(findings, 'trail_off', 0.4, { pct: Math.round(envelope.loudness.trailOff * 100) });
    if (envelope.loudness.cv >= LIMITS.loudnessCv) add(findings, 'uneven_volume', 0.3, {});
    if (envelope.loudness.trailOff < LIMITS.trailOff && envelope.loudness.cv < LIMITS.loudnessCv) strengths.push({ id: 'steady_volume', params: {} });
  }

  if (pitch && pitch.enough) {
    if (pitch.monotone) add(findings, 'monotone', 0.45, { semis: pitch.stdSemitones });
    else strengths.push({ id: 'varied_pitch', params: { semis: pitch.stdSemitones } });
  }

  if (body && body.frames >= 20) {
    if (body.faceShare < LIMITS.faceVisible) add(findings, 'face_not_visible', 0.5, { pct: Math.round(body.faceShare * 100) });
    else {
      if (body.eyeContactShare < LIMITS.eyeContact) add(findings, 'eye_contact_low', 0.5 + (LIMITS.eyeContact - body.eyeContactShare), { pct: Math.round(body.eyeContactShare * 100) });
      else strengths.push({ id: 'eye_contact_good', params: { pct: Math.round(body.eyeContactShare * 100) } });
      if (body.lookingDownShare >= LIMITS.lookingDown) add(findings, 'looking_down', 0.45 + body.lookingDownShare / 2, { pct: Math.round(body.lookingDownShare * 100) });
    }
    if (body.poseShare >= 0.5) {
      if (body.swayStd >= LIMITS.sway) add(findings, 'sway', 0.35 + body.swayStd, {});
      if (body.handsNearFaceShare >= LIMITS.handsNearFace) add(findings, 'hands_near_face', 0.4, { pct: Math.round(body.handsNearFaceShare * 100) });
      if (body.handsVisibleShare < LIMITS.handsHidden) add(findings, 'hands_hidden', 0.2, { pct: Math.round(body.handsVisibleShare * 100) });
      else if (body.gestureActivity > 0 && body.gestureActivity < 0.02 && body.headMovement < 4) add(findings, 'very_still', 0.15, {});
      if (body.swayStd < LIMITS.sway && body.handsNearFaceShare < LIMITS.handsNearFace) strengths.push({ id: 'settled_body', params: {} });
    }
  }

  findings.sort((a, b) => b.severity - a.severity);
  return { heard: true, findings: findings.slice(0, MAX_FINDINGS), strengths };
}
