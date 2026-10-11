/**
 * How it looked: where the eyes went, whether the head dropped to the notes, sway, and
 * hands. Landmarks come from MediaPipe models served from this app's
 * own origin and run entirely in the browser; frames are never stored or sent anywhere.
 * The summaries are pure functions over per-frame samples so they run in tests.
 */

export const THRESHOLDS = Object.freeze({
  yawDeg: 18,
  pitchUpDeg: 16,
  pitchDownDeg: -14,
  handNearFace: 0.9,
});

/**
 * Head orientation from face landmarks, in degrees. Yaw from where the nose sits between
 * the cheeks; pitch from where it sits between forehead and chin; roll from the eye line.
 * These are geometric approximations, tuned for "is this person facing the camera", not
 * for precision.
 */
export function headPoseFromLandmarks(lm) {
  const nose = lm[1];
  const chin = lm[152];
  const forehead = lm[10];
  const left = lm[234];
  const right = lm[454];
  const leftEye = lm[33];
  const rightEye = lm[263];
  const faceW = right.x - left.x || 1e-6;
  const faceH = chin.y - forehead.y || 1e-6;
  const midX = (left.x + right.x) / 2;
  const yaw = ((nose.x - midX) / (faceW / 2)) * 45;
  const ratio = (nose.y - forehead.y) / faceH;
  const pitch = (0.55 - ratio) * 90;
  const roll = (Math.atan2(rightEye.y - leftEye.y, rightEye.x - leftEye.x) * 180) / Math.PI;
  return { yaw, pitch, roll };
}

export function isEyeContact({ yaw, pitch }) {
  return Math.abs(yaw) < THRESHOLDS.yawDeg && pitch > THRESHOLDS.pitchDownDeg && pitch < THRESHOLDS.pitchUpDeg;
}

/**
 * Load both models. Tries the GPU first and falls back to the CPU on machines without it.
 * A half-built pair (the face model loaded, the pose model failed) is closed before the
 * fallback, so a failed attempt never leaves a WebGL context or a graph behind.
 */
export async function loadVision(modelBase) {
  const mp = await import('@mediapipe/tasks-vision');
  const fileset = await mp.FilesetResolver.forVisionTasks(`${modelBase}/wasm`);
  const make = async (delegate) => {
    let face = null;
    try {
      face = await mp.FaceLandmarker.createFromOptions(fileset, {
        baseOptions: { modelAssetPath: `${modelBase}/face_landmarker.task`, delegate },
        runningMode: 'VIDEO',
        numFaces: 1,
        outputFaceBlendshapes: false,
        outputFacialTransformationMatrixes: false,
      });
      const pose = await mp.PoseLandmarker.createFromOptions(fileset, {
        baseOptions: { modelAssetPath: `${modelBase}/pose_landmarker_lite.task`, delegate },
        runningMode: 'VIDEO',
        numPoses: 1,
      });
      return {
        face,
        pose,
        close: () => {
          face.close();
          pose.close();
        },
      };
    } catch (err) {
      if (face) {
        try {
          face.close();
        } catch {
          /* already gone */
        }
      }
      throw err;
    }
  };
  try {
    return await make('GPU');
  } catch {
    return make('CPU');
  }
}

let shared = null;

/**
 * The models for this session: loaded and warmed up once, then reused by every take, so a
 * second practice run opens straight into "ready". A failure is remembered too, so a build
 * without the model files does not ask for them again on every run.
 */
export function getVision(modelBase) {
  if (!shared) {
    shared = loadVision(modelBase).then((models) => {
      try {
        warmUp(models, null);
      } catch {
        /* the first real frame absorbs the setup instead */
      }
      return models;
    });
  }
  return shared;
}

/**
 * Run one inference on a blank frame so the expensive one-time setup (delegate creation,
 * graph initialization) happens while the person is still reading the framing tip, not
 * on the first frame of their take. Detection timestamps must only ever increase, so
 * every call, here and in the loop, uses performance.now().
 */
export function warmUp(models, source) {
  let canvas = source;
  if (!canvas) {
    canvas = document.createElement('canvas');
    canvas.width = 320;
    canvas.height = 180;
  }
  models.face.detectForVideo(canvas, performance.now());
  models.pose.detectForVideo(canvas, performance.now());
}

/**
 * One sample from one video frame. Missing detections come back as false, not as zeros.
 * detectMs is the monotonic clock the models see; elapsedSec is the take's own clock.
 */
export function analyzeFrame(models, video, detectMs, prev, elapsedSec) {
  const sample = { t: elapsedSec === undefined ? detectMs / 1000 : elapsedSec, faceFound: false, poseFound: false };
  const tMs = detectMs;
  const f = models.face.detectForVideo(video, tMs);
  if (f && f.faceLandmarks && f.faceLandmarks[0]) {
    Object.assign(sample, headPoseFromLandmarks(f.faceLandmarks[0]), { faceFound: true });
  }
  const p = models.pose.detectForVideo(video, tMs);
  if (p && p.landmarks && p.landmarks[0]) {
    const lm = p.landmarks[0];
    const ls = lm[11];
    const rs = lm[12];
    const nose = lm[0];
    const shoulderW = Math.hypot(rs.x - ls.x, rs.y - ls.y) || 1e-6;
    sample.poseFound = true;
    sample.shoulderMidX = (ls.x + rs.x) / 2;
    const wrists = [lm[15], lm[16]].filter((w) => w && (w.visibility === undefined || w.visibility > 0.5) && w.x > 0 && w.x < 1 && w.y > 0 && w.y < 1);
    sample.handsVisible = wrists.length > 0;
    sample.handNearFace = wrists.some((w) => Math.hypot(w.x - nose.x, w.y - nose.y) < shoulderW * THRESHOLDS.handNearFace);
    sample.wristMove = 0;
    if (prev && prev.wrists) {
      let moved = 0;
      let n = 0;
      for (let i = 0; i < 2; i += 1) {
        const a = [lm[15], lm[16]][i];
        const b = prev.wrists[i];
        if (a && b) {
          moved += Math.hypot(a.x - b.x, a.y - b.y);
          n += 1;
        }
      }
      sample.wristMove = n ? moved / n : 0;
    }
    sample.wrists = [lm[15], lm[16]];
  }
  return sample;
}

function mean(v) {
  return v.length ? v.reduce((a, b) => a + b, 0) / v.length : 0;
}

function std(v) {
  if (v.length < 2) return 0;
  const m = mean(v);
  return Math.sqrt(mean(v.map((x) => (x - m) ** 2)));
}

/** Everything the coach needs from a rehearsal's worth of samples. */
export function summarizeBody(samples, { fps = 10, durationSec = 0 } = {}) {
  const n = samples.length;
  const face = samples.filter((s) => s.faceFound);
  const pose = samples.filter((s) => s.poseFound);
  const eye = face.map((s) => isEyeContact(s));
  let headMove = 0;
  for (let i = 1; i < face.length; i += 1) headMove += Math.abs(face[i].yaw - face[i - 1].yaw) + Math.abs(face[i].pitch - face[i - 1].pitch);
  const seconds = Math.max(1, Math.ceil(durationSec || (n ? samples[n - 1].t : 0)));
  const timeline = Array.from({ length: seconds }, (_, sec) => {
    const inSec = samples.filter((s) => s.t >= sec && s.t < sec + 1 && s.faceFound);
    if (!inSec.length) return null;
    return inSec.filter((s) => isEyeContact(s)).length * 2 >= inSec.length;
  });
  const visibleWrist = pose.filter((s) => s.handsVisible);
  return {
    frames: n,
    faceShare: n ? face.length / n : 0,
    eyeContactShare: face.length ? eye.filter(Boolean).length / face.length : 0,
    lookingDownShare: face.length ? face.filter((s) => s.pitch <= THRESHOLDS.pitchDownDeg).length / face.length : 0,
    headMovement: face.length > 1 ? (headMove / (face.length - 1)) * fps : 0,
    poseShare: n ? pose.length / n : 0,
    swayStd: std(pose.map((s) => s.shoulderMidX)),
    handsVisibleShare: pose.length ? visibleWrist.length / pose.length : 0,
    handsNearFaceShare: pose.length ? pose.filter((s) => s.handNearFace).length / pose.length : 0,
    gestureActivity: visibleWrist.length ? mean(visibleWrist.map((s) => s.wristMove || 0)) * fps : 0,
    timeline,
  };
}
