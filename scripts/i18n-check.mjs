/**
 * Verify every language in LOCALES (packages/core/src/i18n/runtime.js) against English.
 *
 * Failures (exit code 1):
 *  - a key or list item missing, or one English does not have;
 *  - a list with a different length, or a value of the wrong kind;
 *  - a string whose {parameters} differ from English (a plural form for a category only one
 *    number reaches, such as Arabic "two", may leave its count out);
 *  - a plural object without every category the language's plural rules produce for whole
 *    numbers (Arabic zero, one, two, few, many, other; Hindi and Telugu one, other; Chinese
 *    other). A language may have categories English lacks, and may answer an English string
 *    that counts ({n} or {count}) with a plural object;
 *  - an em dash or en dash anywhere;
 *  - a literal key in code (t('a.b'), tn('a.b') or tList('a.b') in any packages/<name>/src
 *    file) that the English dictionary does not have: comparing dictionaries with each other
 *    cannot catch that, and the app would show the raw key;
 *  - in a language marked ready in LOCALES (Spanish, Vietnamese, and each new language once
 *    it is finished), anything still untranslated: a ready language is offered to everyone
 *    and must stay complete.
 *
 * Counts, which fail only with --strict:
 *  - keys still in English per language (untranslated). In Spanish and Vietnamese that is a
 *    value identical to English that reads like a phrase. In languages written in another
 *    script it is any value without a letter of the language's own script that keeps a Latin
 *    word, identical to today's English or not (an English edit leaves the old copy behind),
 *    plus the punctuation keys each of them confirms (MUST_CONFIRM in
 *    scripts/lib/i18n-tools.mjs). Keys that stay English on purpose are listed in
 *    packages/core/src/i18n/same-as-english.json; keys Intl supplies (weekday and month
 *    names, date templates) and templates with nothing to translate ("{city} ({n})") are not
 *    asked for and are reported apart;
 *  - strings the app shows from data/cities.json with no translation in data/i18n/<lang>.json;
 *  - team posts in data/community.json without a translation in i18n.<lang>;
 *  - a language with nothing left to translate that is not marked ready yet: set ready: true
 *    for it in LOCALES (packages/core/src/i18n/runtime.js), so the app starts offering it.
 *
 * Warnings, which never change the exit code: city-data translations that still carry English
 * month or weekday names, or 12-hour "p.m." times in a 24-hour language, outside quoted
 * literals.
 *
 * Usage: node scripts/i18n-check.mjs [--strict] [--list]
 *   --list prints every untranslated key instead of the first few.
 */
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { DICTIONARIES, LOCALES, pluralCategoriesFor } from '../packages/core/src/i18n/index.js';
import { translationCoverage } from '../packages/core/src/i18n/data.js';
import { ROOT, COMMUNITY_FILE, QUOTED, compareLocale, getPath, looksLikeUntranslatedEnglish } from './lib/i18n-tools.mjs';

export { looksLikeUntranslatedEnglish };

const root = ROOT;
/** Languages marked ready (offered in the app): an untranslated value there is a failure, not a count. */
const COMPLETE = new Set(LOCALES.filter((l) => l.ready && l.code !== 'en').map((l) => l.code));
/** Languages that write times on a 24-hour clock, so "6 p.m." in their city data is residue. */
const TWENTY_FOUR_HOUR = new Set(['vi', 'zh']);

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
  if (TWENTY_FOUR_HOUR.has(code) && AMPM_RESIDUE.test(text)) found.push('12-hour a.m./p.m. time');
  return found;
}

/** Dictionary parity for every language: { problems, untranslated: { code: [paths] } }. */
export function checkDictionaries(log, { list = false } = {}) {
  let problems = 0;
  const untranslated = {};
  for (const { code } of LOCALES) {
    if (code === 'en') continue;
    const r = compareLocale(code);
    const issues = [...r.missing.map((k) => `missing ${k}`), ...r.extra.map((k) => `extra ${k}`), ...r.problems];
    const complete = COMPLETE.has(code);
    if (complete) issues.push(...r.untranslated.map((k) => `identical to English, untranslated: ${k} "${getPath(DICTIONARIES.en, k)}"`));
    problems += issues.length;
    untranslated[code] = complete ? [] : r.untranslated;
    const status = issues.length ? `${issues.length} problem${issues.length === 1 ? '' : 's'}` : 'OK';
    const counts = complete ? '' : `, ${r.translated}/${r.total} translated (${r.untranslated.length} still English; ${r.fixed.length} with nothing to translate)`;
    log(`${code}: ${r.units.length - r.missing.length}/${r.units.length} keys ${status}${counts}; plural forms ${pluralCategoriesFor(code).join(', ')}`);
    for (const i of issues.slice(0, 25)) log(`  ${i}`);
    if (issues.length > 25) log(`  ... ${issues.length - 25} more problems`);
    if (!complete && r.untranslated.length) {
      const shown = list ? r.untranslated : r.untranslated.slice(0, 5);
      for (const k of shown) log(`  untranslated ${k}`);
      if (shown.length < r.untranslated.length) log(`  ... ${r.untranslated.length - shown.length} more (--list prints them all; node scripts/i18n-todo.mjs ${code} writes them to work files)`);
    }
  }
  return { problems, untranslated };
}

/** Source files under packages/<name>/src (no build output, no dependencies). */
function* sourceFiles(dir) {
  for (const name of readdirSync(dir)) {
    const file = path.join(dir, name);
    if (statSync(file).isDirectory()) {
      if (name !== 'node_modules' && name !== 'dist') yield* sourceFiles(file);
    } else if (/\.(?:m?js|jsx)$/.test(name)) {
      yield file;
    }
  }
}

/** t('a.b'), tn("a.b") or tList(`a.b`): a call to the translator with a literal dotted key. */
const KEY_CALL = /(?<![\w.$])(t|tn|tList)\(\s*(['"`])([A-Za-z][\w-]*(?:\.[\w-]+)+)\2/g;

/**
 * Literal keys used in code that the English dictionary does not have, as
 * "packages/web/src/pages/Practice.jsx: rehearse.setup.x". Keys built at run time
 * (template literals with ${...}) are not checked.
 */
export function missingUsedKeys(dict = DICTIONARIES.en, packagesDir = path.join(root, 'packages')) {
  const missing = [];
  for (const pkg of readdirSync(packagesDir)) {
    const src = path.join(packagesDir, pkg, 'src');
    if (!existsSync(src)) continue;
    for (const file of sourceFiles(src)) {
      const code = readFileSync(file, 'utf8');
      for (const m of code.matchAll(KEY_CALL)) {
        if (getPath(dict, m[3]) === undefined) missing.push(`${path.relative(root, file)}: ${m[3]}`);
      }
    }
  }
  return missing;
}

/** City-data translation memories: residue (warnings) and coverage (counts). */
export function checkDataMemories(log) {
  let warnings = 0;
  const missing = {};
  const builtFile = path.join(root, 'data', 'cities.json');
  const builtCities = existsSync(builtFile) ? JSON.parse(readFileSync(builtFile, 'utf8')).cities : null;
  for (const { code } of LOCALES) {
    if (code === 'en') continue;
    const file = path.join(root, 'data', 'i18n', `${code}.json`);
    if (!existsSync(file)) {
      log(`${code} data: no translation memory (data/i18n/${code}.json); run node scripts/i18n-scaffold.mjs ${code}`);
      missing[code] = builtCities ? translationCoverage(builtCities, {}).missing.length : 1;
      continue;
    }
    const memory = JSON.parse(readFileSync(file, 'utf8'));
    const table = memory.strings || memory;
    const residue = [];
    for (const [source, translation] of Object.entries(table)) {
      const found = dataResidue(translation, code);
      if (found.length) residue.push(`${found.join(', ')}: ${String(source).slice(0, 70)}`);
    }
    warnings += residue.length;
    let line = `${code} data: ${Object.keys(table).length} translations${residue.length ? `, ${residue.length} with English dates or times` : ', no English dates or times'}`;
    if (builtCities) {
      const coverage = translationCoverage(builtCities, table);
      missing[code] = coverage.missing.length;
      line += `; ${coverage.translated}/${coverage.total} strings the app shows`;
    }
    log(line);
    for (const r of residue.slice(0, 15)) log(`  warning: ${r}`);
    if (residue.length > 15) log(`  ... ${residue.length - 15} more`);
  }
  return { warnings, missing };
}

/** Team posts in data/community.json without a translation, per language. */
export function checkCommunity(log) {
  const missing = {};
  if (!existsSync(COMMUNITY_FILE)) return missing;
  const posts = (JSON.parse(readFileSync(COMMUNITY_FILE, 'utf8')).posts || []).filter((p) => p && p.team);
  for (const { code } of LOCALES) {
    if (code === 'en') continue;
    const lacking = posts.filter((p) => !(p.i18n && p.i18n[code] && p.i18n[code].title && p.i18n[code].body));
    missing[code] = lacking.length;
    if (lacking.length) log(`${code} community: ${posts.length - lacking.length}/${posts.length} team posts translated`);
  }
  return missing;
}

/**
 * What the ready flags in LOCALES say against what is translated. counts: [{ code, ready, ui,
 * data, posts }] with the untranslated numbers. Returns { brokenReady, unoffered }: ready
 * languages with city strings or posts missing (always a failure; their UI gaps already are),
 * and finished languages not marked ready (a failure with --strict).
 */
export function readiness(counts) {
  return {
    brokenReady: counts.filter((p) => p.ready && (p.data || p.posts)),
    unoffered: counts.filter((p) => !p.ready && !p.ui && !p.data && !p.posts),
  };
}

function main(argv) {
  const strict = argv.includes('--strict');
  const list = argv.includes('--list');
  const log = (line) => console.log(line);
  const dicts = checkDictionaries(log, { list });
  const unknown = missingUsedKeys();
  log(`code: ${unknown.length ? `${unknown.length} keys missing from the English dictionary` : 'every literal key exists in English'}`);
  for (const u of unknown) log(`  missing ${u}`);
  const data = checkDataMemories(log);
  const community = checkCommunity(log);
  if (data.warnings) log(`${data.warnings} warning${data.warnings === 1 ? '' : 's'} (not failures)`);

  const counts = LOCALES.filter((l) => l.code !== 'en').map(({ code, ready }) => ({ code, ready, ui: (dicts.untranslated[code] || []).length, data: data.missing[code] || 0, posts: community[code] || 0 }));
  const pending = counts.filter((p) => p.ui || p.data || p.posts);
  // A ready language is offered to everyone: city strings or posts missing there fail too.
  const { brokenReady, unoffered } = readiness(counts);
  for (const p of brokenReady) log(`${p.code} is marked ready but ${p.data} city strings and ${p.posts} community posts are untranslated`);
  if (pending.length) {
    log(`untranslated${strict ? ' (failures with --strict)' : ' (run with --strict to fail on these)'}:`);
    for (const p of pending) log(`  ${p.code}: ${p.ui} UI keys, ${p.data} city strings, ${p.posts} community posts`);
  }
  // A finished language the app does not offer yet.
  for (const p of unoffered) log(`${p.code} is completely translated but not offered: set ready: true for it in LOCALES (packages/core/src/i18n/runtime.js)${strict ? '' : ' (a failure with --strict)'}`);
  const notReady = LOCALES.filter((l) => !l.ready).map((l) => l.code);
  if (notReady.length) log(`not offered in the app yet (ready: false): ${notReady.join(', ')}`);
  const failed = dicts.problems || unknown.length || brokenReady.length || (strict && (pending.length || unoffered.length));
  return failed ? 1 : 0;
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) process.exitCode = main(process.argv.slice(2));
