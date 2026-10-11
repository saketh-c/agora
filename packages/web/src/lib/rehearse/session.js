/**
 * The live part of Practice: camera and mic, the level meter, the countdown, the recorder,
 * the live transcript and the vision loop, behind one React hook with one way to let go of
 * everything. Browser only.
 *
 * Every device request carries an attempt number. Pressing Back, leaving the page, or a
 * newer request makes the attempt stale, and a stream that arrives for a stale attempt is
 * stopped on arrival, so the camera light never stays on with nothing on screen to turn
 * it off. The vision models are the exception: they are loaded once per session and kept,
 * so a second run opens straight into the device check.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { startAudioCapture, levelShare } from './audio.js';
import { getVision, analyzeFrame } from './vision.js';

const SR = typeof window !== 'undefined' ? window.SpeechRecognition || window.webkitSpeechRecognition : null;
/** This browser can give a live transcript (Chrome, Edge, Safari). */
export const SPEECH_SUPPORTED = Boolean(SR);
const SR_LANG = { en: 'en-US', es: 'es-US', vi: 'vi-VN' };
const SR_FATAL = new Set(['not-allowed', 'service-not-allowed', 'network', 'audio-capture', 'language-not-supported', 'bad-grammar']);
/** No words from the speech service after this long means it is probably not coming. */
const SR_STALL_MS = 6000;
const VISION_FPS = 8;
/** Recording stops by itself after 15 minutes. */
export const MAX_TAKE_SEC = 15 * 60;
const QUIET_LEVEL = 0.12;
const QUIET_MS = 5000;

const SR_OFF = Object.freeze({ state: 'off', words: 0, final: '', interim: '' });

function countWords(text) {
  return String(text || '').split(/\s+/).filter(Boolean).length;
}

/** Why the camera and mic cannot be requested at all, before trying: a key of rehearse.errors, or null. */
export function deviceProblem() {
  if (typeof window === 'undefined') return 'generic';
  if (!window.isSecureContext || !navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) return 'insecure';
  const policy = document.permissionsPolicy || document.featurePolicy;
  try {
    if (policy && typeof policy.allowsFeature === 'function' && policy.allowsFeature('microphone') === false) return 'blocked';
  } catch {
    /* no policy API */
  }
  return null;
}

/** A getUserMedia failure as a key of rehearse.errors, never the browser's own English text. */
function errorKey(e) {
  const name = e && e.name;
  if (name === 'NotAllowedError' || name === 'PermissionDeniedError' || name === 'SecurityError') return deviceProblem() === 'blocked' ? 'blocked' : 'denied';
  if (name === 'NotFoundError' || name === 'DevicesNotFoundError' || name === 'OverconstrainedError') return 'noMic';
  if (name === 'NotReadableError' || name === 'TrackStartError' || name === 'AbortError') return 'busy';
  return 'generic';
}

/** A recording type this browser can make for this stream: audio types for a mic-only take. */
function pickMime(stream) {
  if (typeof window === 'undefined' || !window.MediaRecorder) return null;
  const video = stream.getVideoTracks().length > 0;
  const list = video
    ? ['video/webm;codecs=vp9,opus', 'video/webm;codecs=vp8,opus', 'video/webm', 'video/mp4']
    : ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4', 'audio/ogg;codecs=opus'];
  const can = (m) => {
    try {
      return MediaRecorder.isTypeSupported(m);
    } catch {
      return false;
    }
  };
  return list.find(can) || '';
}

/** The file extension that matches what the recorder actually made. */
export function extensionFor(type, video) {
  const t = String(type || '');
  if (t.includes('mp4')) return video ? 'mp4' : 'm4a';
  if (t.includes('ogg')) return 'ogg';
  return 'webm';
}

/**
 * @param {object} opts
 * @param {string} opts.lang  app language, for the speech service
 * @param {boolean} opts.visionAvailable  the models are part of this build
 * @param {string} opts.modelBase
 * @param {(take: object) => void} opts.onTake  called once per finished take, before the report shows
 */
export function useRehearsalSession({ lang, visionAvailable, modelBase, onTake }) {
  const [phase, setPhase] = useState('setup');
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [camera, setCamera] = useState(false);
  const [models, setModels] = useState('off');
  const [level, setLevel] = useState(0);
  const [micQuiet, setMicQuiet] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const [countdown, setCountdown] = useState(3);
  const [sr, setSr] = useState(SR_OFF);
  const [faceFound, setFaceFound] = useState(null);
  const [playback, setPlayback] = useState(null);

  const videoRef = useRef(null);
  const streamRef = useRef(null);
  const captureRef = useRef(null);
  const recorderRef = useRef(null);
  const chunksRef = useRef([]);
  const srRef = useRef(null);
  const srTimerRef = useRef(null);
  const visionRef = useRef(null);
  const loopRef = useRef(null);
  const tickRef = useRef(null);
  const countRef = useRef(null);
  const samplesRef = useRef([]);
  const wordsRef = useRef([]);
  const finalRef = useRef('');
  const interimRef = useRef('');
  const srStateRef = useRef('off');
  const ambientRef = useRef([]);
  const startRef = useRef(0);
  const recordingRef = useRef(false);
  const attemptRef = useRef(0);
  const busyRef = useRef(false);
  const mountedRef = useRef(false);
  const cameraRef = useRef(false);
  const transcriptRef = useRef(false);
  const quietSinceRef = useRef(0);
  const playbackUrlRef = useRef(null);
  const langRef = useRef(lang);
  const onTakeRef = useRef(onTake);
  langRef.current = lang;
  onTakeRef.current = onTake;

  const setSrState = useCallback((patch) => {
    setSr((s) => {
      const next = { ...s, ...patch };
      srStateRef.current = next.state;
      return next;
    });
  }, []);

  const dropRecognizer = useCallback(() => {
    clearTimeout(srTimerRef.current);
    const rec = srRef.current;
    srRef.current = null;
    if (!rec) return;
    rec.onstart = null;
    rec.onresult = null;
    rec.onerror = null;
    rec.onend = null;
    try {
      rec.abort();
    } catch {
      /* not running */
    }
  }, []);

  const revokePlayback = useCallback(() => {
    if (playbackUrlRef.current) URL.revokeObjectURL(playbackUrlRef.current);
    playbackUrlRef.current = null;
  }, []);

  /** Let go of every device and timer. The shared vision models stay loaded. */
  const releaseDevices = useCallback(() => {
    recordingRef.current = false;
    clearTimeout(loopRef.current);
    clearInterval(tickRef.current);
    clearInterval(countRef.current);
    loopRef.current = null;
    tickRef.current = null;
    countRef.current = null;
    dropRecognizer();
    if (captureRef.current) captureRef.current.stop();
    captureRef.current = null;
    const rec = recorderRef.current;
    recorderRef.current = null;
    if (rec && rec.state !== 'inactive') {
      rec.ondataavailable = null;
      rec.onstop = null;
      try {
        rec.stop();
      } catch {
        /* already stopped */
      }
    }
    if (streamRef.current) streamRef.current.getTracks().forEach((tr) => tr.stop());
    streamRef.current = null;
    if (videoRef.current) videoRef.current.srcObject = null;
    visionRef.current = null;
  }, [dropRecognizer]);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      attemptRef.current += 1;
      busyRef.current = false;
      releaseDevices();
      revokePlayback();
    };
  }, [releaseDevices, revokePlayback]);

  // The preview only exists once the device check shows, so attach the stream after it mounts.
  useEffect(() => {
    const v = videoRef.current;
    if (!v || !streamRef.current || !['ready', 'countdown', 'recording'].includes(phase)) return;
    if (v.srcObject !== streamRef.current) {
      v.srcObject = streamRef.current;
      v.play().catch(() => {});
    }
  }, [phase, camera]);

  const stopRecorder = useCallback(
    () =>
      new Promise((resolve) => {
        const rec = recorderRef.current;
        recorderRef.current = null;
        const done = () => {
          const chunks = chunksRef.current;
          chunksRef.current = [];
          resolve(chunks.length ? new Blob(chunks, { type: (rec && rec.mimeType) || chunks[0].type || '' }) : null);
        };
        if (!rec || rec.state === 'inactive') return done();
        let settled = false;
        const once = () => {
          if (!settled) {
            settled = true;
            done();
          }
        };
        rec.onstop = once;
        setTimeout(once, 3000);
        try {
          rec.stop();
        } catch {
          once();
        }
      }),
    [],
  );

  /** Ask the speech service to finish what it heard, and wait (briefly) for the last words. */
  const finishRecognizer = useCallback(
    () =>
      new Promise((resolve) => {
        clearTimeout(srTimerRef.current);
        const rec = srRef.current;
        if (!rec) return resolve();
        let settled = false;
        const once = () => {
          if (settled) return;
          settled = true;
          if (srRef.current === rec) {
            srRef.current = null;
            rec.onresult = null;
            rec.onerror = null;
            rec.onend = null;
            rec.onstart = null;
          }
          resolve();
        };
        rec.onend = once;
        setTimeout(once, 1500);
        try {
          rec.stop();
        } catch {
          once();
        }
      }),
    [],
  );

  const stop = useCallback(async () => {
    if (!recordingRef.current) return;
    recordingRef.current = false;
    const attempt = attemptRef.current;
    const durationSec = (performance.now() - startRef.current) / 1000;
    clearTimeout(loopRef.current);
    const capture = captureRef.current;
    const frames = capture ? capture.take() : [];
    const dt = capture ? capture.dt : 0.05;
    setPhase('processing');
    const [blob] = await Promise.all([stopRecorder(), finishRecognizer()]);
    if (attempt !== attemptRef.current || !mountedRef.current) return;

    // Words still on screen as grey interim text when Stop was pressed are usually the ask.
    let transcript = finalRef.current.trim();
    const tail = interimRef.current.trim();
    if (tail) {
      transcript = `${transcript} ${tail}`.trim();
      wordsRef.current.push({ t: durationSec, words: countWords(transcript) });
    }
    const usedCamera = cameraRef.current;
    const srState = srStateRef.current;
    releaseDevices();

    revokePlayback();
    let media = null;
    if (blob && blob.size) {
      const url = URL.createObjectURL(blob);
      playbackUrlRef.current = url;
      media = { url, video: usedCamera, size: blob.size, type: blob.type, ext: extensionFor(blob.type, usedCamera) };
    }
    setPlayback(media);
    if (onTakeRef.current) {
      onTakeRef.current({
        durationSec,
        frames,
        dt,
        ambient: ambientRef.current,
        transcript,
        wordsTimeline: wordsRef.current,
        samples: samplesRef.current,
        camera: usedCamera,
        transcriptOn: transcriptRef.current,
        srState,
      });
    }
    setPhase('report');
  }, [finishRecognizer, releaseDevices, revokePlayback, stopRecorder]);

  const stopRef = useRef(stop);
  stopRef.current = stop;

  const startRecognizer = useCallback(() => {
    const rec = new SR();
    rec.lang = SR_LANG[langRef.current] || 'en-US';
    rec.continuous = true;
    rec.interimResults = true;
    let fatal = false;
    let heardAny = false;
    setSrState({ state: 'starting', words: 0, final: '', interim: '' });
    rec.onstart = () => {
      if (srStateRef.current === 'starting') setSrState({ state: 'listening' });
    };
    rec.onresult = (e) => {
      heardAny = true;
      let interim = '';
      for (let i = e.resultIndex; i < e.results.length; i += 1) {
        const text = e.results[i][0].transcript;
        if (e.results[i].isFinal) {
          finalRef.current = `${finalRef.current} ${text}`.trim();
          wordsRef.current.push({ t: (performance.now() - startRef.current) / 1000, words: countWords(finalRef.current) });
        } else interim += text;
      }
      interimRef.current = interim;
      setSrState({ state: 'listening', words: countWords(finalRef.current), final: finalRef.current, interim });
    };
    rec.onerror = (e) => {
      if (e && SR_FATAL.has(e.error)) {
        fatal = true;
        setSrState({ state: 'failed' });
      }
    };
    // The service stops after a silence; keep it going until Stop. A fatal error means it
    // will never work in this session, so it is not restarted in a tight loop.
    rec.onend = () => {
      if (!recordingRef.current || fatal || srRef.current !== rec) return;
      setTimeout(() => {
        if (!recordingRef.current || fatal || srRef.current !== rec) return;
        try {
          rec.start();
        } catch {
          /* already restarting */
        }
      }, 300);
    };
    srTimerRef.current = setTimeout(() => {
      if (!heardAny && !fatal && recordingRef.current) setSrState({ state: 'stalled' });
    }, SR_STALL_MS);
    try {
      rec.start();
      srRef.current = rec;
    } catch {
      srRef.current = null;
      setSrState({ state: 'failed' });
    }
  }, [setSrState]);

  const startVisionLoop = useCallback(() => {
    let prev = null;
    let reported = false;
    // Inference runs on a 320 pixel copy of the frame: the landmarks only need to say where
    // the head and hands are, and a small frame costs a fraction of the work on a CPU.
    const small = document.createElement('canvas');
    const sctx = small.getContext('2d', { willReadFrequently: true });
    const tick = () => {
      if (!recordingRef.current) return;
      const started = performance.now();
      const v = videoRef.current;
      const m = visionRef.current;
      let took = 0;
      if (m && v && v.readyState >= 2 && v.videoWidth) {
        try {
          const w = 320;
          const h = Math.max(1, Math.round((v.videoHeight / v.videoWidth) * w));
          if (small.width !== w || small.height !== h) {
            small.width = w;
            small.height = h;
          }
          sctx.drawImage(v, 0, 0, w, h);
          const now = performance.now();
          const s = analyzeFrame(m, small, now, prev, (now - startRef.current) / 1000);
          prev = s;
          samplesRef.current.push(s);
          setFaceFound((f) => (f === s.faceFound ? f : s.faceFound));
        } catch (err) {
          // A dropped frame is not worth stopping for, but a loop that fails every frame
          // must say why, once.
          if (!reported) {
            reported = true;
            console.warn('Agora vision frame error:', err);
          }
        }
        took = performance.now() - started;
      }
      // Rest at least three times as long as the inference took, so the loop never holds
      // more than a quarter of the main thread. Models still loading: check again soon.
      const wait = m ? Math.max(20, 1000 / VISION_FPS - took, took * 3) : 250;
      loopRef.current = setTimeout(tick, wait);
    };
    loopRef.current = setTimeout(tick, 200);
  }, []);

  const startRecording = useCallback(() => {
    const stream = streamRef.current;
    const capture = captureRef.current;
    if (!stream || !capture) return;
    ambientRef.current = capture.restart();
    samplesRef.current = [];
    wordsRef.current = [{ t: 0, words: 0 }];
    finalRef.current = '';
    interimRef.current = '';
    chunksRef.current = [];
    startRef.current = performance.now();
    recordingRef.current = true;
    setElapsed(0);
    setFaceFound(null);

    const mime = pickMime(stream);
    if (mime !== null) {
      try {
        const rec = new MediaRecorder(stream, mime ? { mimeType: mime } : undefined);
        rec.ondataavailable = (e) => {
          if (e.data && e.data.size) chunksRef.current.push(e.data);
        };
        rec.start(1000);
        recorderRef.current = rec;
      } catch {
        recorderRef.current = null;
      }
    }

    if (transcriptRef.current && SR) startRecognizer();
    else setSrState({ ...SR_OFF });
    if (cameraRef.current && visionAvailable) startVisionLoop();
    setPhase('recording');
  }, [setSrState, startRecognizer, startVisionLoop, visionAvailable]);

  /**
   * Ask for the camera (optional) and the mic. With the camera on and no camera found, or
   * the camera busy in another app, it falls back to the mic alone and says so.
   */
  const prepare = useCallback(
    async ({ camera: wantCamera, transcript }) => {
      if (busyRef.current) return;
      const problem = deviceProblem();
      if (problem) {
        setError(problem);
        return;
      }
      busyRef.current = true;
      attemptRef.current += 1;
      const attempt = attemptRef.current;
      releaseDevices();
      revokePlayback();
      setPlayback(null);
      setError('');
      setNotice('');
      setMicQuiet(false);
      setPhase('starting');
      transcriptRef.current = Boolean(transcript && SR);
      const audio = { echoCancellation: true, noiseSuppression: true };
      const video = { facingMode: 'user', width: { ideal: 1280 }, height: { ideal: 720 } };
      const stale = () => attempt !== attemptRef.current || !mountedRef.current;

      let stream = null;
      let usedCamera = Boolean(wantCamera);
      let fallback = '';
      let failure = null;
      try {
        stream = await navigator.mediaDevices.getUserMedia({ audio, video: usedCamera ? video : false });
      } catch (e) {
        failure = e;
        const key = errorKey(e);
        if (usedCamera && (key === 'noMic' || key === 'busy') && !stale()) {
          try {
            stream = await navigator.mediaDevices.getUserMedia({ audio, video: false });
            usedCamera = false;
            fallback = key === 'noMic' ? 'noCamera' : 'cameraBusy';
          } catch (e2) {
            failure = e2;
          }
        }
      }
      if (stale()) {
        if (stream) stream.getTracks().forEach((tr) => tr.stop());
        return;
      }
      busyRef.current = false;
      if (!stream) {
        setError(errorKey(failure));
        setPhase('setup');
        return;
      }

      streamRef.current = stream;
      cameraRef.current = usedCamera;
      setCamera(usedCamera);
      setNotice(fallback);
      captureRef.current = startAudioCapture(stream, { intervalMs: 50 });
      quietSinceRef.current = performance.now();
      let lastTick = performance.now();
      tickRef.current = setInterval(() => {
        const cap = captureRef.current;
        const share = cap ? levelShare(cap.level()) : 0;
        setLevel(share);
        const now = performance.now();
        // A long gap between ticks means the page was busy (the vision models compiling)
        // and the mic was not being read, which is not the same as hearing nothing.
        if (share > QUIET_LEVEL || now - lastTick > 1000) quietSinceRef.current = now;
        lastTick = now;
        setMicQuiet(now - quietSinceRef.current > QUIET_MS);
        if (recordingRef.current) {
          const sec = (now - startRef.current) / 1000;
          setElapsed(sec);
          if (sec >= MAX_TAKE_SEC) stopRef.current();
        }
      }, 100);
      setPhase('ready');

      if (usedCamera && visionAvailable) {
        setModels('loading');
        getVision(modelBase)
          .then((m) => {
            if (stale()) return;
            visionRef.current = m;
            setModels('ready');
          })
          .catch(() => {
            if (!stale()) setModels('unavailable');
          });
      } else setModels(usedCamera ? 'unavailable' : 'off');
    },
    [modelBase, releaseDevices, revokePlayback, visionAvailable],
  );

  /** 3, 2, 1, then record. */
  const begin = useCallback(() => {
    if (!streamRef.current) return;
    let n = 3;
    setCountdown(n);
    setPhase('countdown');
    clearInterval(countRef.current);
    countRef.current = setInterval(() => {
      n -= 1;
      if (n <= 0) {
        clearInterval(countRef.current);
        countRef.current = null;
        startRecording();
      } else setCountdown(n);
    }, 1000);
  }, [startRecording]);

  /** Stop the countdown and go back to the device check. */
  const cancel = useCallback(() => {
    clearInterval(countRef.current);
    countRef.current = null;
    setPhase('ready');
  }, []);

  /** Turn everything off and go back to setup. */
  const reset = useCallback(() => {
    attemptRef.current += 1;
    busyRef.current = false;
    releaseDevices();
    revokePlayback();
    setPlayback(null);
    setError('');
    setNotice('');
    setModels('off');
    setSrState({ ...SR_OFF });
    setElapsed(0);
    setLevel(0);
    setPhase('setup');
  }, [releaseDevices, revokePlayback, setSrState]);

  return { phase, error, notice, camera, models, level, micQuiet, elapsed, countdown, sr, faceFound, playback, videoRef, prepare, begin, cancel, stop, reset };
}
