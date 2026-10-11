/**
 * Put the on-device vision models where the web app can serve them from its own origin.
 *
 * Practice (/prepare/practice) tracks eye contact, posture, and hands with two MediaPipe
 * models (Apache 2.0). They are large binaries, so they are not committed: this script
 * downloads them into packages/web/public/models/ (gitignored), checks each against a
 * pinned SHA-256, and copies the matching WebAssembly runtime out of node_modules. The
 * deploy runs it before the build; locally run `npm run models` once, then restart the dev
 * server. Without the files the app still works, and Practice says up front that eye
 * contact is not measured (it decides at build time, so it never requests missing files).
 *
 * Size: the two models are about 9.5 MB. Two runtimes are copied (about 22 MB on disk) but
 * a browser downloads only one of them, SIMD or not, so a visitor fetches about 20 MB once.
 *
 * Usage: node scripts/fetch-models.mjs
 */
import { createHash } from 'node:crypto';
import { mkdirSync, existsSync, readFileSync, copyFileSync, readdirSync, unlinkSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..');
const outDir = path.join(root, 'packages', 'web', 'public', 'models');
const wasmSrc = path.join(root, 'node_modules', '@mediapipe', 'tasks-vision', 'wasm');
const wasmDir = path.join(outDir, 'wasm');

// The URLs are versioned (".../float16/1/..."), so the bytes behind them never change.
const MODELS = [
  {
    file: 'face_landmarker.task',
    url: 'https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task',
    sha256: '64184e229b263107bc2b804c6625db1341ff2bb731874b0bcc2fe6544e0bc9ff',
  },
  {
    file: 'pose_landmarker_lite.task',
    url: 'https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_lite/float16/1/pose_landmarker_lite.task',
    sha256: '59929e1d1ee95287735ddd833b19cf4ac46d29bc7afddbbf6753c459690d574a',
  },
];

// FilesetResolver.forVisionTasks loads vision_wasm_internal (SIMD) or, on browsers without
// SIMD, vision_wasm_nosimd_internal. The vision_wasm_module_internal pair is never used.
const RUNTIME = /^vision_wasm_(nosimd_)?internal\.(js|wasm)$/;

const sha256 = (buf) => createHash('sha256').update(buf).digest('hex');

if (!existsSync(wasmSrc)) throw new Error(`WebAssembly runtime not found at ${wasmSrc}. Run npm install first.`);
const runtime = readdirSync(wasmSrc).filter((f) => RUNTIME.test(f));
if (runtime.length < 4) throw new Error(`Expected 4 runtime files in ${wasmSrc}, found: ${runtime.join(', ') || 'none'}.`);

mkdirSync(wasmDir, { recursive: true });

for (const m of MODELS) {
  const dest = path.join(outDir, m.file);
  if (existsSync(dest) && sha256(readFileSync(dest)) === m.sha256) {
    console.log(`${m.file}: already present and verified`);
    continue;
  }
  const res = await fetch(m.url);
  if (!res.ok) throw new Error(`${m.file}: HTTP ${res.status} from ${m.url}`);
  const buf = Buffer.from(await res.arrayBuffer());
  const got = sha256(buf);
  if (got !== m.sha256) throw new Error(`${m.file}: checksum mismatch (got ${got}, expected ${m.sha256}). Nothing was written.`);
  writeFileSync(dest, buf);
  console.log(`${m.file}: downloaded and verified (${Math.round(buf.length / 1024)} KB)`);
}

// Remove the unused runtime pair an older version of this script copied (about 12 MB).
for (const f of readdirSync(wasmDir)) {
  if (/\.(js|wasm)$/.test(f) && !RUNTIME.test(f)) unlinkSync(path.join(wasmDir, f));
}
for (const f of runtime) copyFileSync(path.join(wasmSrc, f), path.join(wasmDir, f));
console.log(`runtime: copied ${runtime.join(', ')} to ${path.relative(root, wasmDir)}`);
writeFileSync(path.join(outDir, 'LICENSE.txt'), 'The model files and WebAssembly runtime in this folder are from MediaPipe, Copyright Google LLC, distributed under the Apache License 2.0.\nhttps://github.com/google-ai-edge/mediapipe\n');
