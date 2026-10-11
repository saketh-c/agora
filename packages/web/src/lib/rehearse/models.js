/**
 * Are the on-device vision models part of this build? `npm run models` (scripts/fetch-models.mjs)
 * puts them in packages/web/public/models; they are large and not committed. The answer is
 * decided when the app is built (or when the dev server transforms this file), so a build
 * without them never requests a file it does not have: no 404s in the console, no wait,
 * and Practice says up front that eye contact is not measured.
 *
 * Browser only (import.meta.glob is a Vite feature); vision.js stays importable in Node tests.
 */
const FILES = import.meta.glob(['../../../public/models/*.task', '../../../public/models/wasm/vision_wasm_internal.wasm'], {
  eager: true,
  query: '?url',
  import: 'default',
});

const present = new Set(Object.keys(FILES).map((k) => k.split('/').pop()));

export const VISION_AVAILABLE = ['face_landmarker.task', 'pose_landmarker_lite.task', 'vision_wasm_internal.wasm'].every((f) => present.has(f));

/** Where the models are served from, under the app's base path. */
export const MODEL_BASE = `${import.meta.env.BASE_URL}models`;
