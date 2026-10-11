/**
 * Stylesheet rules the right-to-left and script work depends on: no left or right that does
 * not mirror (unless marked as meant to stay physical), and script fonts that download only
 * for their own script.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const STYLES = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'src', 'styles');

function* cssFiles(dir) {
  for (const name of readdirSync(dir)) {
    const file = path.join(dir, name);
    if (statSync(file).isDirectory()) yield* cssFiles(file);
    else if (name.endsWith('.css')) yield file;
  }
}

/** Space-separated values at the top level ("calc(a + b) 4px" is two). */
function values(text) {
  const out = [];
  let depth = 0;
  let cur = '';
  for (const ch of text.trim()) {
    if (ch === '(') depth += 1;
    if (ch === ')') depth -= 1;
    if (/\s/.test(ch) && depth === 0) {
      if (cur) out.push(cur);
      cur = '';
    } else cur += ch;
  }
  if (cur) out.push(cur);
  return out;
}

test('every left and right in the stylesheets mirrors in Arabic, or says why it stays', () => {
  const problems = [];
  for (const file of cssFiles(STYLES)) {
    const lines = readFileSync(file, 'utf8').split('\n');
    lines.forEach((line, i) => {
      // Marked on purpose (a centered label, a play triangle), or the device's own safe areas.
      if (/physical/.test(line) || /safe-area-inset/.test(line)) return;
      const where = `${path.relative(STYLES, file)}:${i + 1}`;
      for (const m of line.matchAll(/(?:^|[;{\s])((?:margin|padding|border)-(?:left|right)[\w-]*|left|right)\s*:/g)) problems.push(`${where}: ${m[1]}`);
      for (const m of line.matchAll(/(?:^|[;{\s])(float|clear|text-align)\s*:\s*(left|right)\b/g)) problems.push(`${where}: ${m[1]}: ${m[2]}`);
      for (const m of line.matchAll(/(?:^|[;{\s])(padding|margin|inset|border-width|border-style|border-color|scroll-padding|scroll-margin)\s*:\s*([^;}]+)/g)) {
        const v = values(m[2].replace(/!important/, ''));
        if (v.length === 4 && v[1] !== v[3]) problems.push(`${where}: ${m[1]}: ${m[2].trim()} (left and right differ)`);
      }
      for (const m of line.matchAll(/(?:^|[;{\s])border-radius\s*:\s*([^;}/]+)/g)) {
        const [tl, tr = tl, br = tl, bl = tr] = values(m[1].replace(/!important/, ''));
        if (tl !== tr || br !== bl) problems.push(`${where}: border-radius: ${m[1].trim()} (corners differ by side)`);
      }
    });
  }
  assert.deepEqual(problems, []);
});

test('the script fonts are declared for their own scripts only', () => {
  const css = readFileSync(path.join(STYLES, 'fonts.css'), 'utf8');
  const faces = [...css.matchAll(/font-family:\s*'([^']+)'[\s\S]*?unicode-range:\s*([^;]+);/g)].map((m) => ({ family: m[1], ranges: m[2].split(',').map((r) => r.trim()) }));
  assert.deepEqual(faces.map((f) => f.family), ['Noto Sans Arabic Variable', 'Noto Sans Devanagari Variable', 'Noto Sans Telugu Variable']);
  const covers = (ranges, cp) =>
    ranges.some((r) => {
      const [a, b = a] = r.replace(/^U\+/i, '').split('-');
      return cp >= parseInt(a, 16) && cp <= parseInt(b, 16);
    });
  // Characters any page can have (emoji written with a zero-width joiner, a hyphen, the
  // dotted circle): if a script font listed them, every page would download all three.
  const shared = [0x200c, 0x200d, 0x200e, 0x2010, 0x2011, 0x204f, 0x2e41, 0x25cc, 0x20a8, 0x20b9, 0x20f0, 0x2019, 0x00a0];
  for (const { family, ranges } of faces) {
    for (const cp of shared) assert.equal(covers(ranges, cp), false, `${family} lists U+${cp.toString(16).toUpperCase().padStart(4, '0')}`);
  }
  assert.ok(covers(faces[0].ranges, 0x0627), 'Arabic alef');
  assert.ok(covers(faces[1].ranges, 0x0915), 'Devanagari ka');
  assert.ok(covers(faces[2].ranges, 0x0c15), 'Telugu ka');
});
