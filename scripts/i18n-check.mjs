/**
 * Verify that every locale dictionary mirrors the English one: same keys, same array
 * lengths, the same {parameters} in each string (array items included), and no em or en
 * dash. Those are failures and make the script exit non-zero.
 *
 * It also prints warnings, which never change the exit code:
 *  - es/vi dictionary values that are identical to English and read like an English phrase
 *    (a translator skipped them). Proper nouns, brand names, short codes and one-word
 *    cognates such as "Video" are expected to match English and are not reported.
 *  - city-data translations (data/i18n/<lang>.json) that still carry English month or
 *    weekday names, or 12-hour "p.m." times in Vietnamese, outside quoted literals.
 *  - strings the app shows from data/cities.json that have no translation yet
 *    (run `node scripts/i18n-extract.mjs --check` for the full list).
 *
 * Usage: node scripts/i18n-check.mjs
 */
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { DICTIONARIES, dictionaryKeys, LOCALES } from '../packages/core/src/i18n/index.js';
import { translationCoverage } from '../packages/core/src/i18n/data.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
/** Em dash (U+2014) and en dash (U+2013), built from code points so this file never contains them. */
const DASH = new RegExp(`[${String.fromCharCode(0x2014, 0x2013)}]`);

function get(dict, key) {
  return key.split('.').reduce((o, k) => (o == null ? undefined : o[k]), dict);
}

function params(s) {
  return [...String(s).matchAll(/\{(\w+)\}/g)]
    .map((m) => m[1])
    .sort()
    .join(',');
}

/** Compare one English string with its translation; returns problem descriptions. */
function compareString(label, a, b) {
  if (typeof b !== 'string' || !b.trim()) return a.trim() ? [`${label}: empty`] : [];
  if (params(a) !== params(b)) return [`${label}: params {${params(b)}} vs {${params(a)}}`];
  if (DASH.test(b)) return [`${label}: contains an em dash or en dash`];
  return [];
}

/** A quoted literal; an apostrophe inside a word ("Citizens' Input", "city's") never opens one. */
const QUOTED = /(?<!\p{L})'[^']*'(?!\p{L})|"[^"]*"/gu;

/**
 * True when a value that matches English reads like a phrase someone forgot to translate,
 * rather than something that legitimately stays the same in every language:
 *  - one word: a cognate ("Video"), a short code ("id", "PPM") or a name;
 *  - only capitalized words: a place, program or brand ("Dallas-Fort Worth",
 *    "Plano East Senior High", "{city} Senior High");
 *  - parameters, URLs, email addresses, quoted literals and one-letter abbreviations
 *    ("a.m.") are ignored before counting.
 * Anything left with two or more words and at least one lowercase word ("Show all {n}",
 * "Remote comment") is reported.
 */
export function looksLikeUntranslatedEnglish(value) {
  const text = String(value)
    .replace(/\{\w+\}/g, ' ')
    .replace(/https?:\/\/\S+|[\w.+-]+@[\w-]+(?:\.[\w-]+)+/g, ' ')
    .replace(QUOTED, ' ');
  const words = (text.match(/\p{L}[\p{L}'’-]*/gu) || []).filter((w) => w.length > 1);
  if (words.length < 2) return false;
  return words.some((w) => w[0] === w[0].toLowerCase() && w[0] !== w[0].toUpperCase());
}

const MONTH_RESIDUE = /\b(?:January|February|March|April|June|July|August|September|October|November|December)\b|\b(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sept?|Oct|Nov|Dec)\.?\s+\d{1,2}\b/;
const WEEKDAY_RESIDUE = /\b(?:Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Sunday)s?\b/;
const AMPM_RESIDUE = /\b\d{1,2}(?::\d{2})?\s*[ap]\.m\./i;

/**
 * English date or time residue in one translated city-data string. Quoted literals are
 * skipped on purpose: some cities require an exact English email subject such as
 * 'Public Comment - Tuesday, [date]', and form names stay in English.
 */
export function dataResidue(translation, code) {
  const text = String(translation).replace(QUOTED, ' ');
  const found = [];
  if (MONTH_RESIDUE.test(text)) found.push('English month');
  if (WEEKDAY_RESIDUE.test(text)) found.push('English weekday');
  if (code === 'vi' && AMPM_RESIDUE.test(text)) found.push('12-hour a.m./p.m. time');
  return found;
}

/** Walk English and a translation in parallel, yielding [label, english, translated] for every string leaf. */
function* leaves(a, b, label) {
  if (typeof a === 'string') {
    yield [label, a, b];
  } else if (Array.isArray(a)) {
    for (let i = 0; i < a.length; i += 1) yield* leaves(a[i], Array.isArray(b) ? b[i] : undefined, `${label}[${i}]`);
  } else if (a && typeof a === 'object') {
    for (const k of Object.keys(a)) yield* leaves(a[k], b && typeof b === 'object' ? b[k] : undefined, `${label}.${k}`);
  }
}

/** Dictionary parity: returns the number of problems; prints problems and warnings. */
function checkDictionaries(log) {
  const en = DICTIONARIES.en;
  const enKeys = dictionaryKeys(en);
  let problems = 0;
  let warnings = 0;
  for (const { code } of LOCALES) {
    if (code === 'en') continue;
    const dict = DICTIONARIES[code];
    const keys = new Set(dictionaryKeys(dict));
    const missing = enKeys.filter((k) => !keys.has(k));
    const extra = [...keys].filter((k) => !enKeys.includes(k));
    const issues = [];
    const sameAsEnglish = [];
    for (const key of enKeys) {
      if (!keys.has(key)) continue;
      const a = get(en, key);
      const b = get(dict, key);
      if (Array.isArray(a) && (!Array.isArray(b) || a.length !== b.length)) {
        issues.push(`${key}: array length ${Array.isArray(b) ? b.length : 'n/a'} vs ${a.length}`);
        continue;
      }
      for (const [label, x, y] of leaves(a, b, key)) {
        issues.push(...compareString(label, x, y));
        if (typeof y === 'string' && y.trim() === x.trim() && looksLikeUntranslatedEnglish(x)) sameAsEnglish.push(`${label}: "${x}"`);
      }
    }
    const total = missing.length + extra.length + issues.length;
    problems += total;
    warnings += sameAsEnglish.length;
    log(`${code}: ${enKeys.length - missing.length}/${enKeys.length} keys${total ? `, ${total} problems` : ' OK'}`);
    for (const m of missing.slice(0, 15)) log(`  missing ${m}`);
    if (missing.length > 15) log(`  ... ${missing.length - 15} more missing`);
    for (const e of extra.slice(0, 10)) log(`  extra ${e}`);
    for (const i of issues.slice(0, 25)) log(`  ${i}`);
    if (issues.length > 25) log(`  ... ${issues.length - 25} more issues`);
    for (const w of sameAsEnglish) log(`  warning: identical to English, probably untranslated: ${w}`);
  }
  return { problems, warnings };
}

/** City-data translation memories: residue and coverage. Warnings only. */
function checkDataMemories(log) {
  let warnings = 0;
  const builtFile = path.join(root, 'data', 'cities.json');
  const builtCities = existsSync(builtFile) ? JSON.parse(readFileSync(builtFile, 'utf8')).cities : null;
  for (const { code } of LOCALES) {
    if (code === 'en') continue;
    const file = path.join(root, 'data', 'i18n', `${code}.json`);
    if (!existsSync(file)) continue;
    const memory = JSON.parse(readFileSync(file, 'utf8'));
    const table = memory.strings || memory;
    const residue = [];
    for (const [source, translation] of Object.entries(table)) {
      const found = dataResidue(translation, code);
      if (found.length) residue.push(`${found.join(', ')}: ${String(source).slice(0, 70)}`);
    }
    warnings += residue.length;
    log(`${code} data: ${Object.keys(table).length} translations${residue.length ? `, ${residue.length} with English dates or times` : ', no English dates or times'}`);
    for (const r of residue.slice(0, 15)) log(`  warning: ${r}`);
    if (residue.length > 15) log(`  ... ${residue.length - 15} more`);
    if (builtCities) {
      const coverage = translationCoverage(builtCities, table);
      if (coverage.missing.length) {
        warnings += coverage.missing.length;
        log(`  warning: ${coverage.missing.length} of ${coverage.total} strings the app shows are untranslated (node scripts/i18n-extract.mjs --check lists them)`);
      }
    }
  }
  return warnings;
}

function main() {
  const log = (line) => console.log(line);
  const dicts = checkDictionaries(log);
  const warnings = dicts.warnings + checkDataMemories(log);
  if (warnings) log(`${warnings} warning${warnings === 1 ? '' : 's'} (not failures)`);
  process.exit(dicts.problems ? 1 : 0);
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) main();
