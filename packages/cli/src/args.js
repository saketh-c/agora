import { isDateStr, isLocale, t } from '@agora/core';

/** Flags that never take a value, so `--evening Plano` leaves "Plano" as a positional. */
export const BOOLEAN_FLAGS = new Set(['evening', 'daytime', 'weekends', 'speak', 'json', 'all', 'recent', 'help', 'version', 'no-color']);

/** Options every command understands. */
export const GLOBAL_FLAGS = ['json', 'today', 'lang', 'no-color', 'help', 'version'];

/** `--evening=false` and friends switch a boolean flag off instead of on. */
const FALSE_WORDS = new Set(['false', '0', 'no', 'off']);

/**
 * Parse `cmd --flag value --bool positional` into {cmd, flags, args}.
 * `-h` is short for --help, and a bare `--` ends the options so a value can start with dashes.
 */
export function parseArgs(argv) {
  const flags = {};
  const args = [];
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (a === '--') {
      args.push(...argv.slice(i + 1));
      break;
    }
    if (a === '-h') {
      flags.help = true;
    } else if (a.startsWith('--') && a.length > 2) {
      const eq = a.indexOf('=');
      const k = eq === -1 ? a.slice(2) : a.slice(2, eq);
      const inline = eq === -1 ? undefined : a.slice(eq + 1);
      const next = argv[i + 1];
      if (BOOLEAN_FLAGS.has(k)) flags[k] = inline === undefined ? true : !FALSE_WORDS.has(inline.trim().toLowerCase());
      else if (inline !== undefined) flags[k] = inline;
      else if (next !== undefined && !next.startsWith('--')) {
        flags[k] = next;
        i += 1;
      } else flags[k] = true;
    } else args.push(a);
  }
  const cmd = args.shift() || 'help';
  return { cmd, flags, args };
}

/** A mistake in how the command was typed. The message is translated and safe to print as is. */
export class UsageError extends Error {
  constructor(message) {
    super(message);
    this.name = 'UsageError';
    this.exitCode = 1;
  }
}

/** A flag that needs a value was given without one (`--city` at the end of the line). */
function requireValue(flags, name) {
  if (flags[name] === true) throw new UsageError(t('cli.errors.needsValue', { flag: `--${name}` }));
}

/** The text of a flag, or undefined when it is absent. A bare flag with no value is an error. */
export function textFlag(flags, name) {
  if (flags[name] === undefined || flags[name] === false) return undefined;
  requireValue(flags, name);
  const v = String(flags[name]).trim();
  return v || undefined;
}

/** --today: a real calendar date (2026-02-30 is rejected, not silently ignored). */
export function dateFlag(flags, name) {
  const v = textFlag(flags, name);
  if (v === undefined) return undefined;
  if (!isDateStr(v)) throw new UsageError(t('cli.errors.badDate', { flag: `--${name}`, value: v }));
  return v;
}

/** A whole number between min and max, or `fallback` when the flag is absent. */
export function intFlag(flags, name, { min = 1, max, fallback }) {
  const v = textFlag(flags, name);
  if (v === undefined) return fallback;
  const n = Number(v);
  if (!/^[+]?\d+$/.test(v) || !Number.isSafeInteger(n) || n < min || n > max) throw new UsageError(t('cli.errors.badInt', { flag: `--${name}`, value: v, min, max }));
  return n;
}

/** A number greater than zero and at most max (fractions allowed), or `fallback`. */
export function numberFlag(flags, name, { max, fallback }) {
  const v = textFlag(flags, name);
  if (v === undefined) return fallback;
  const n = Number(v);
  if (!/^[+]?(\d+\.?\d*|\.\d+)$/.test(v) || !Number.isFinite(n) || n <= 0 || n > max) throw new UsageError(t('cli.errors.badNumber', { flag: `--${name}`, value: v, max }));
  return n;
}

/**
 * Normalize a language code or tag ("ES" -> "es", "zh-CN" -> "zh", "ar_EG.UTF-8" -> "ar"), as
 * --lang and AGORA_LANG may carry either; undefined when it is not a language we support.
 */
export function langCode(value) {
  const code = String(value ?? '')
    .trim()
    .toLowerCase()
    .split(/[-_.@]/)[0];
  return isLocale(code) ? code : undefined;
}

/**
 * Smallest number of single-letter edits between two strings, used for "did you mean"
 * suggestions on mistyped commands, cities and topics.
 */
export function editDistance(a, b) {
  const s = String(a);
  const u = String(b);
  let prev = Array.from({ length: u.length + 1 }, (_, j) => j);
  for (let i = 1; i <= s.length; i += 1) {
    const cur = [i];
    for (let j = 1; j <= u.length; j += 1) cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (s[i - 1] === u[j - 1] ? 0 : 1));
    prev = cur;
  }
  return prev[u.length];
}

/** The closest candidate to `input` when it is near enough to be a typo, otherwise null. */
export function suggest(input, candidates) {
  const q = String(input || '').toLowerCase();
  if (!q) return null;
  let best = null;
  for (const cand of candidates) {
    const d = editDistance(q, String(cand).toLowerCase());
    if (best === null || d < best.d) best = { cand, d };
  }
  return best && best.d <= Math.max(1, Math.floor(q.length / 3)) ? best.cand : null;
}
