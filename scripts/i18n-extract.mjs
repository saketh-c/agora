/**
 * Collect every translatable English string the app shows from city data into
 * data/i18n/source-strings.json (sorted, deduplicated), and report what each locale's
 * translation memory still lacks.
 *
 * Strings come from data/cities.json, the file the web app, the server and the CLI load,
 * not from the raw data/cities/*.json files. scripts/build-data.mjs normalizes records on
 * the way: it shortens long meeting labels and drops "possible quorum" notices. Extracting
 * from the raw files therefore counted strings the app never looks up and missed the
 * shortened labels it does, so coverage read 1312/1312 while seven meeting labels still
 * showed in English. The field list is the one ../packages/core/src/i18n/data.js uses to
 * translate cities, so every field the app localizes is counted, meeting labels included.
 *
 * Coverage is reported twice: unique strings (what a translator has to write) and field
 * values (how many places in the app would still show English), with a per-field breakdown.
 *
 * Usage:
 *   node scripts/i18n-extract.mjs              write source-strings.json, print coverage
 *   node scripts/i18n-extract.mjs --check      read-only; exit 1 if anything the app shows is untranslated
 *   node scripts/i18n-extract.mjs --chunks N   also write N chunk files for translators
 *   node scripts/i18n-extract.mjs --json       print the report as JSON (combines with --check)
 *   node scripts/i18n-extract.mjs --lang ar    report one language only (combines with the others)
 * Every language in LOCALES is reported, so a new language shows up here as soon as it is
 * registered; node scripts/i18n-todo.mjs <lang> writes its untranslated strings to work files.
 * Run `npm run build:data` first when data/cities/*.json changed.
 */
import { readdirSync, readFileSync, writeFileSync, existsSync, mkdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { CITY_TEXT_FIELDS, CITY_ARRAY_FIELDS } from '../packages/core/src/i18n/data.js';
import { LOCALES } from '../packages/core/src/i18n/index.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..');

/** Every translatable [field, English value] pair in one city, in the order data.js localizes them. */
export function cityFieldValues(city) {
  const out = [];
  for (const field of CITY_TEXT_FIELDS) {
    const v = field.split('.').reduce((o, k) => (o == null ? undefined : o[k]), city);
    if (typeof v === 'string' && v.trim()) out.push([field, v]);
  }
  for (const [arrayKey, fields] of Object.entries(CITY_ARRAY_FIELDS)) {
    for (const item of city[arrayKey] || []) {
      for (const f of fields) if (item && typeof item[f] === 'string' && item[f].trim()) out.push([`${arrayKey}[].${f}`, item[f]]);
    }
  }
  return out;
}

/**
 * Coverage of each locale's memory against a list of (built) cities.
 * @returns {{strings: string[], words: number, locales: Record<string, {translated: number, total: number, valuesTranslated: number, valuesTotal: number, missing: string[], unused: string[], fields: Record<string, {total: number, missing: number}>}>}}
 */
export function extractReport(cities, memories) {
  const values = cities.flatMap((c) => cityFieldValues(c));
  const strings = [...new Set(values.map(([, v]) => v))].sort((a, b) => a.localeCompare(b));
  const words = strings.reduce((n, s) => n + s.split(/\s+/).length, 0);
  const shown = new Set(strings);
  const locales = {};
  for (const [code, table] of Object.entries(memories)) {
    const has = (s) => Boolean(table && table[s]);
    const fields = {};
    let valuesTranslated = 0;
    for (const [field, v] of values) {
      const f = (fields[field] = fields[field] || { total: 0, missing: 0 });
      f.total += 1;
      if (has(v)) valuesTranslated += 1;
      else f.missing += 1;
    }
    const missing = strings.filter((s) => !has(s));
    locales[code] = {
      translated: strings.length - missing.length,
      total: strings.length,
      valuesTranslated,
      valuesTotal: values.length,
      missing,
      unused: Object.keys(table || {}).filter((s) => !shown.has(s)),
      fields,
    };
  }
  return { strings, words, locales };
}

/** Raw city files newer than the built file, which means data/cities.json is stale. */
function staleSources(builtFile, citiesDir) {
  if (!existsSync(citiesDir)) return [];
  const builtTime = statSync(builtFile).mtimeMs;
  return readdirSync(citiesDir).filter((f) => f.endsWith('.json') && statSync(path.join(citiesDir, f)).mtimeMs > builtTime);
}

function main(argv) {
  const check = argv.includes('--check');
  const asJson = argv.includes('--json');
  const langArg = argv.indexOf('--lang');
  const only = langArg !== -1 ? argv[langArg + 1] : null;
  if (only && !LOCALES.some((l) => l.code === only && l.code !== 'en')) {
    console.error(`--lang ${only}: not a language in LOCALES other than English`);
    return 1;
  }
  const wanted = ({ code }) => code !== 'en' && (!only || code === only);
  const builtFile = path.join(root, 'data', 'cities.json');
  const citiesDir = path.join(root, 'data', 'cities');
  const outDir = path.join(root, 'data', 'i18n');
  if (!existsSync(builtFile)) {
    console.error('data/cities.json is missing. Run npm run build:data first.');
    return 1;
  }
  const stale = staleSources(builtFile, citiesDir);
  const cities = JSON.parse(readFileSync(builtFile, 'utf8')).cities;
  const memories = {};
  for (const { code } of LOCALES.filter(wanted)) {
    const file = path.join(outDir, `${code}.json`);
    if (existsSync(file)) {
      const memory = JSON.parse(readFileSync(file, 'utf8'));
      memories[code] = memory.strings || memory;
    }
  }
  const report = extractReport(cities, memories);
  const incomplete = Object.values(report.locales).some((l) => l.missing.length);

  if (!check) {
    mkdirSync(outDir, { recursive: true });
    writeFileSync(path.join(outDir, 'source-strings.json'), JSON.stringify(report.strings, null, 2));
    const chunkArg = argv.indexOf('--chunks');
    if (chunkArg !== -1) {
      const n = Math.max(1, Number(argv[chunkArg + 1]) || 1);
      const per = Math.ceil(report.strings.length / n);
      for (let i = 0; i < n; i += 1) writeFileSync(path.join(outDir, `chunk-${i + 1}.json`), JSON.stringify(report.strings.slice(i * per, (i + 1) * per), null, 2));
      if (!asJson) console.log(`Wrote ${n} chunk files (about ${per} strings each) to data/i18n/`);
    }
  }

  if (asJson) {
    console.log(JSON.stringify({ source: 'data/cities.json', stale, ...report, strings: report.strings.length }, null, 2));
    return check && incomplete ? 1 : 0;
  }

  if (stale.length) console.log(`warning: data/cities.json is older than ${stale.slice(0, 3).join(', ')}${stale.length > 3 ? ` and ${stale.length - 3} more` : ''}; run npm run build:data for an exact count`);
  console.log(`${report.strings.length} unique strings the app shows, about ${report.words} words, from data/cities.json (${cities.length} cities)${check ? '' : '; written to data/i18n/source-strings.json'}`);
  for (const { code } of LOCALES.filter(wanted)) {
    const l = report.locales[code];
    if (!l) {
      console.log(`${code}: no translation memory yet (data/i18n/${code}.json)`);
      continue;
    }
    console.log(`${code}: ${l.translated}/${l.total} strings translated; ${l.valuesTranslated}/${l.valuesTotal} field values${l.missing.length ? `, ${l.missing.length} strings missing` : ''}`);
    const gaps = Object.entries(l.fields).filter(([, f]) => f.missing);
    for (const [field, f] of gaps) console.log(`  ${field}: ${f.missing} of ${f.total} values untranslated`);
    for (const s of l.missing.slice(0, 20)) console.log(`  missing: ${s.length > 120 ? `${s.slice(0, 117)}...` : s}`);
    if (l.missing.length > 20) console.log(`  ... ${l.missing.length - 20} more`);
    if (l.unused.length) console.log(`  ${l.unused.length} memory entries are never looked up (their English source is not in data/cities.json)`);
  }
  if (check && incomplete) console.log('Untranslated strings found. Add them to data/i18n/<lang>.json.');
  return check && incomplete ? 1 : 0;
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) process.exitCode = main(process.argv.slice(2));
