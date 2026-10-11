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
    .replace(/[‪-‮⁦-⁩]/g, '');
  s = multiline ? s.replace(/\r\n?/g, '\n') : s.replace(/[\t\r\n]+/g, ' ');
  return s.replace(/[\x00-\x08\x0b-\x1f\x7f-\x9f]/g, '');
}

/**
 * Columns a string takes on screen: color codes take none, and neither do combining marks,
 * so accented Spanish and Vietnamese text lines up the same whether or not it is precomposed.
 */
export function visibleLength(s) {
  let n = 0;
  for (const ch of String(s).replace(SGR, '')) if (!/\p{M}/u.test(ch)) n += 1;
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
  const chars = [...String(s).replace(SGR, '')];
  return `${chars.slice(0, Math.max(0, width - 1)).join('')}…`;
}

/** Simple horizontal bar for text charts. */
export function bar(value, max, width = 24) {
  const n = max > 0 ? Math.round((value / max) * width) : 0;
  return c.blue('█'.repeat(n)) + c.gray('░'.repeat(Math.max(0, width - n)));
}

/** Word-wrap one paragraph to `width` columns, indenting every line by `indent` spaces. */
export function wrapText(text, width = 76, indent = 0) {
  const pad = ' '.repeat(indent);
  const words = String(text).split(/\s+/).filter(Boolean);
  const lines = [];
  let line = '';
  for (const w of words) {
    if (line && visibleLength(`${line} ${w}`) > width) {
      lines.push(pad + line);
      line = w;
    } else line = line ? `${line} ${w}` : w;
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
