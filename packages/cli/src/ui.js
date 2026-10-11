import { t } from '@agora/core';

/**
 * Terminal styling and layout helpers.
 *
 * Colors honor NO_COLOR, FORCE_COLOR and whether stdout is a terminal. The --no-color flag
 * can also turn them off for one run, so the switch is a mutable module value read at call
 * time instead of a constant fixed at import.
 */
const ESC = '\x1b';
const SGR = /\x1b\[[0-9;]*m/g;

function detectColor() {
  if (process.env.NO_COLOR) return false;
  const force = process.env.FORCE_COLOR;
  if (force === '0' || force === 'false') return false;
  return Boolean(process.stdout.isTTY || force !== undefined);
}

let enabled = detectColor();

export function colorEnabled() {
  return enabled;
}

/** Turn colors on or off for everything printed after this call. Returns the new state. */
export function setColorEnabled(on) {
  enabled = Boolean(on);
  return enabled;
}

const wrap = (open, close) => (s) => (enabled ? `${ESC}[${open}m${s}${ESC}[${close}m` : String(s));

export const c = {
  bold: wrap(1, 22),
  dim: wrap(2, 22),
  red: wrap(31, 39),
  green: wrap(32, 39),
  yellow: wrap(33, 39),
  blue: wrap(34, 39),
  magenta: wrap(35, 39),
  cyan: wrap(36, 39),
  gray: wrap(90, 39),
  bgBlue: wrap(44, 49),
};

/**
 * Remove terminal control sequences from text that came from the network (RSS feeds, the
 * geocoder, the AI) before printing it. Feed parsing decodes entities such as &#27;, so a
 * hostile or broken feed could otherwise clear the screen, recolor the output, or hide a
 * link's real target behind an OSC 8 hyperlink. Bidirectional overrides go too, because
 * they can make printed text read differently from what it says.
 * Newlines and tabs become spaces unless `multiline` is set.
 */
export function safe(text, { multiline = false } = {}) {
  let s = String(text ?? '')
    .replace(/\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)?/g, '')
    .replace(/\x1b[PX^_][^\x07\x1b]*(?:\x07|\x1b\\)?/g, '')
    .replace(/\x1b\[[0-?]*[ -/]*[@-~]?/g, '')
    .replace(/\x1b[\s\S]?/g, '')
    .replace(/[\u202a-\u202e\u2066-\u2069]/g, '');
  s = multiline ? s.replace(/\r\n?/g, '\n') : s.replace(/[\t\r\n]+/g, ' ');
  return s.replace(/[\x00-\x08\x0b-\x1f\x7f-\x9f]/g, '');
}

/**
 * East Asian Wide and Fullwidth characters (Unicode EastAsianWidth W and F), which take two
 * columns in a terminal: Han, kana, Hangul, full-width forms, CJK punctuation and wide emoji.
 */
const WIDE = [
  [0x1100, 0x115f], [0x231a, 0x231b], [0x2329, 0x232a], [0x23e9, 0x23ec], [0x23f0, 0x23f0], [0x23f3, 0x23f3],
  [0x25fd, 0x25fe], [0x2614, 0x2615], [0x2648, 0x2653], [0x267f, 0x267f], [0x2693, 0x2693], [0x26a1, 0x26a1],
  [0x26aa, 0x26ab], [0x26bd, 0x26be], [0x26c4, 0x26c5], [0x26ce, 0x26ce], [0x26d4, 0x26d4], [0x26ea, 0x26ea],
  [0x26f2, 0x26f3], [0x26f5, 0x26f5], [0x26fa, 0x26fa], [0x26fd, 0x26fd], [0x2705, 0x2705], [0x270a, 0x270b],
  [0x2728, 0x2728], [0x274c, 0x274c], [0x274e, 0x274e], [0x2753, 0x2755], [0x2757, 0x2757], [0x2795, 0x2797],
  [0x27b0, 0x27b0], [0x27bf, 0x27bf], [0x2b1b, 0x2b1c], [0x2b50, 0x2b50], [0x2b55, 0x2b55], [0x2e80, 0x303e],
  [0x3041, 0x33ff], [0x3400, 0x4dbf], [0x4e00, 0x9fff], [0xa000, 0xa4cf], [0xa960, 0xa97f], [0xac00, 0xd7a3],
  [0xf900, 0xfaff], [0xfe10, 0xfe19], [0xfe30, 0xfe6f], [0xff00, 0xff60], [0xffe0, 0xffe6], [0x16fe0, 0x16fe4],
  [0x17000, 0x18cff], [0x1b000, 0x1b2ff], [0x1f004, 0x1f004], [0x1f0cf, 0x1f0cf], [0x1f18e, 0x1f18e],
  [0x1f191, 0x1f19a], [0x1f200, 0x1f202], [0x1f210, 0x1f23b], [0x1f240, 0x1f248], [0x1f250, 0x1f251],
  [0x1f260, 0x1f265], [0x1f300, 0x1f320], [0x1f32d, 0x1f335], [0x1f337, 0x1f37c], [0x1f37e, 0x1f393],
  [0x1f3a0, 0x1f3ca], [0x1f3cf, 0x1f3d3], [0x1f3e0, 0x1f3f0], [0x1f3f4, 0x1f3f4], [0x1f3f8, 0x1f43e],
  [0x1f440, 0x1f440], [0x1f442, 0x1f4fc], [0x1f4ff, 0x1f53d], [0x1f54b, 0x1f54e], [0x1f550, 0x1f567],
  [0x1f57a, 0x1f57a], [0x1f595, 0x1f596], [0x1f5a4, 0x1f5a4], [0x1f5fb, 0x1f64f], [0x1f680, 0x1f6c5],
  [0x1f6cc, 0x1f6cc], [0x1f6d0, 0x1f6d2], [0x1f6d5, 0x1f6d7], [0x1f6eb, 0x1f6ec], [0x1f6f4, 0x1f6fc],
  [0x1f7e0, 0x1f7eb], [0x1f90c, 0x1f93a], [0x1f93c, 0x1f945], [0x1f947, 0x1f9ff], [0x1fa70, 0x1faff],
  [0x20000, 0x2fffd], [0x30000, 0x3fffd],
];

function isWide(cp) {
  let lo = 0;
  let hi = WIDE.length - 1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (cp < WIDE[mid][0]) hi = mid - 1;
    else if (cp > WIDE[mid][1]) lo = mid + 1;
    else return true;
  }
  return false;
}

/** Columns one code point takes, as terminals count them (wcwidth). */
function charWidth(ch) {
  const cp = ch.codePointAt(0);
  if (cp < 0x20 || (cp >= 0x7f && cp < 0xa0)) return 0;
  // Nonspacing and enclosing marks, format controls (joiners, bidi isolates), variation selectors.
  // Skin-tone modifiers join the emoji before them.
  if (/[\p{Mn}\p{Me}\p{Cf}]/u.test(ch) || (cp >= 0xfe00 && cp <= 0xfe0f) || (cp >= 0xe0100 && cp <= 0xe01ef) || (cp >= 0x1f3fb && cp <= 0x1f3ff)) return 0;
  return isWide(cp) ? 2 : 1;
}

const graphemeSegmenter = typeof Intl.Segmenter === 'function' ? new Intl.Segmenter('en', { granularity: 'grapheme' }) : null;

/** User-perceived characters, so a cut never splits a conjunct, an accent or an emoji. */
function graphemes(s) {
  if (graphemeSegmenter) return [...graphemeSegmenter.segment(s)].map((x) => x.segment);
  return s.match(/\P{M}\p{M}*/gu) || [];
}

/**
 * Columns a string takes on screen: color codes take none, and neither do combining marks
 * or format controls, so accented Spanish and Vietnamese text lines up the same whether or not
 * it is precomposed. Chinese characters and other East Asian wide characters take two.
 */
export function visibleLength(s) {
  let n = 0;
  for (const ch of String(s).replace(SGR, '')) n += charWidth(ch);
  return n;
}

/** Pad to a visible width (padEnd counts color codes and accents, so it misaligns). */
export function padVisible(s, width) {
  const len = visibleLength(s);
  return len >= width ? String(s) : String(s) + ' '.repeat(width - len);
}

export function heading(text) {
  return `\n${c.bold(c.cyan(text))}\n${c.gray('-'.repeat(Math.min(72, visibleLength(text))))}`;
}

/** One "Label  value" row. Pass the width shared by a block of rows so the values line up. */
export function label(k, v, width = 14) {
  return `${c.gray(padVisible(k, width))} ${v}`;
}

/**
 * A block of label/value rows that line up. The label column is as wide as the longest
 * label, so Spanish and Vietnamese labels (often longer than English) never push their
 * value out of line. A label longer than `max` gets its value on the next line instead of
 * widening every row, and long values wrap with a hanging indent.
 * @param {Array<[string, string] | null | false>} rows falsy rows are skipped
 */
export function labelBlock(rows, { max = 24, width = 78, indent = 0 } = {}) {
  const list = rows.filter(Boolean);
  if (!list.length) return '';
  const pad = ' '.repeat(indent);
  const col = Math.min(max, Math.max(...list.map(([k]) => visibleLength(k))));
  const out = [];
  for (const [k, v] of list) {
    if (visibleLength(k) > col) {
      out.push(`${pad}${c.gray(k)}`);
      out.push(wrapText(v, width - indent - col - 1, indent + col + 1));
    } else {
      const body = wrapText(v, width - indent - col - 1, indent + col + 1).replace(/^ +/, '');
      out.push(`${pad}${c.gray(padVisible(k, col))} ${body}`);
    }
  }
  return out.join('\n');
}

export function bullet(text, indent = 2) {
  return `${' '.repeat(indent)}${c.cyan('•')} ${text}`;
}

/** The widest output may be: the terminal width when printing to one, otherwise unlimited. */
export function outputWidth() {
  return process.stdout.isTTY && process.stdout.columns ? process.stdout.columns : Infinity;
}

/**
 * Render rows as an aligned table. `columns` is [{key, title, width?, flex?, optional?}].
 * When the table is wider than `maxWidth`, it makes room in this order: drop `optional`
 * columns (the last one first), shorten `flex` column titles that are wider than their cells,
 * then shrink `flex` columns (widest first) and cut their cells with an ellipsis. So a row
 * never wraps onto the next line in a narrow terminal. Trailing spaces are trimmed from every
 * line. With no rows it prints `empty`.
 */
export function table(rows, columns, { empty, maxWidth = outputWidth() } = {}) {
  if (!rows.length) return c.dim(wrapText(empty || t('cli.nothingToShow'), 76, 2));
  const cellWidth = (col) => Math.max(0, ...rows.map((r) => visibleLength(String(r[col.key] ?? ''))));
  let cols = columns.map((col) => {
    const cells = cellWidth(col);
    const natural = Math.max(visibleLength(col.title), cells);
    return { ...col, cells, w: Math.min(col.width || natural, natural) };
  });
  const total = () => 2 + cols.reduce((a, col) => a + col.w, 0) + 2 * (cols.length - 1);
  while (total() > maxWidth && cols.some((col) => col.optional)) {
    const last = cols.map((col) => col.optional).lastIndexOf(true);
    cols = cols.filter((_, i) => i !== last);
  }
  for (const col of cols) {
    if (total() <= maxWidth) break;
    if (col.flex && col.w > col.cells) col.w = Math.max(col.cells, Math.min(col.w, 8), col.w - (total() - maxWidth));
  }
  while (total() > maxWidth) {
    let pick = null;
    for (const col of cols) if (col.flex && col.w > Math.min(col.cells, 8) && (!pick || col.w > pick.w)) pick = col;
    if (!pick) break;
    pick.w = Math.max(Math.min(pick.cells, 8), pick.w - (total() - maxWidth));
  }
  const line = (cells) =>
    `  ${cells.map((cell, i) => padVisible(truncate(String(cell ?? ''), cols[i].w), cols[i].w)).join('  ')}`.replace(/\s+$/, '');
  const out = [c.bold(line(cols.map((col) => col.title))), c.gray(line(cols.map((col) => '-'.repeat(col.w))))];
  for (const r of rows) out.push(line(cols.map((col) => r[col.key])));
  return out.join('\n');
}

export function truncate(s, width) {
  if (visibleLength(s) <= width) return s;
  let out = '';
  let used = 0;
  for (const g of graphemes(String(s).replace(SGR, ''))) {
    const w = visibleLength(g);
    if (used + w > Math.max(0, width - 1)) break;
    out += g;
    used += w;
  }
  return `${out}…`;
}

/** Simple horizontal bar for text charts. */
export function bar(value, max, width = 24) {
  const n = max > 0 ? Math.round((value / max) * width) : 0;
  return c.blue('█'.repeat(n)) + c.gray('░'.repeat(Math.max(0, width - n)));
}

/** Closing punctuation never starts a line, and opening punctuation never ends one (CJK rules). */
const CLOSING = /^[，。、；：？！）」』】》〉,.;:?!)\]}%]$/u;
const OPENING = /^[（「『【《〈(\[{]$/u;

/**
 * Break a whitespace-free run into the pieces a line may end between. Chinese has no spaces,
 * so a line may break between any two characters, except before closing punctuation or after
 * opening punctuation; a Latin word or a number inside stays whole.
 */
function breakUnits(word) {
  if (![...word].some((ch) => isWide(ch.codePointAt(0)))) return [word];
  const units = [];
  let run = '';
  let pendingOpen = '';
  for (const g of graphemes(word)) {
    const wide = isWide(g.codePointAt(0));
    if (OPENING.test(g)) {
      if (run) units.push(run);
      run = '';
      pendingOpen += g;
      continue;
    }
    if (CLOSING.test(g)) {
      if (run) run += g;
      else if (units.length) units[units.length - 1] += g;
      else run = pendingOpen + g;
      continue;
    }
    if (wide) {
      if (run) units.push(run);
      run = pendingOpen + g;
      pendingOpen = '';
      units.push(run);
      run = '';
    } else {
      run += pendingOpen + g;
      pendingOpen = '';
    }
  }
  if (run || pendingOpen) units.push(run + pendingOpen);
  // A closing mark pushed onto a unit that was already emitted stays attached to it.
  return units.filter(Boolean);
}

/**
 * Word-wrap one paragraph to `width` columns, indenting every line by `indent` spaces. Lines
 * break at spaces, and in Chinese between characters, measured in terminal columns.
 */
export function wrapText(text, width = 76, indent = 0) {
  const pad = ' '.repeat(indent);
  const pieces = [];
  for (const word of String(text).split(/\s+/).filter(Boolean)) {
    breakUnits(word).forEach((unit, i) => pieces.push({ text: unit, space: i === 0 }));
  }
  const lines = [];
  let line = '';
  for (const p of pieces) {
    const next = line ? `${line}${p.space ? ' ' : ''}${p.text}` : p.text;
    if (line && visibleLength(next) > width) {
      lines.push(pad + line);
      line = p.text;
    } else line = next;
  }
  if (line) lines.push(pad + line);
  return lines.join('\n');
}

/** Wrap text that has paragraphs: each block separated by a blank line wraps on its own. */
export function wrapParagraphs(text, width = 76, indent = 0) {
  return String(text)
    .split(/\n\s*\n/)
    .map((p) => wrapText(p, width, indent))
    .filter(Boolean)
    .join('\n\n');
}
