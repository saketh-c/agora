/**
 * Merge data/cities/*.json into data/cities.json after validating every record.
 *
 * Usage: node scripts/build-data.mjs [--strict]
 *   --strict  fail the build on any validation problem (default: drop unusable cities and
 *             links with a warning)
 *
 * The output is rewritten only when the merged cities change, so running this before every
 * test or dev start does not touch a tracked file or move its generatedAt stamp.
 */
import { readdirSync, readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { validateCity, scheduleWarnings, forEachCityUrl, isUrl } from '../packages/core/src/validate.js';
import { inferTopics, isTopicId } from '../packages/core/src/topics.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..');
const citiesDir = path.join(root, 'data', 'cities');
const outFile = path.join(root, 'data', 'cities.json');
const strict = process.argv.includes('--strict');

if (!existsSync(citiesDir)) mkdirSync(citiesDir, { recursive: true });

const files = readdirSync(citiesDir).filter((f) => f.endsWith('.json')).sort();
const cities = [];
const problems = [];
const warnings = [];
const seen = new Set();

for (const file of files) {
  const full = path.join(citiesDir, file);
  let city;
  try {
    city = JSON.parse(readFileSync(full, 'utf8'));
  } catch (e) {
    problems.push(`${file}: invalid JSON (${e.message})`);
    continue;
  }
  city = normalize(city);
  for (const p of dropBadUrls(city)) problems.push(`${file}: ${p} is not an http(s) URL, so it was left out`);
  const errors = validateCity(city);
  if (errors.length) {
    // Every remaining error leaves the record unusable (bad links were already removed above).
    problems.push(...errors.map((e) => `${file}: ${e}`));
    continue;
  }
  if (seen.has(city.cityId)) {
    problems.push(`${file}: duplicate cityId "${city.cityId}", so this file was skipped`);
    continue;
  }
  seen.add(city.cityId);
  warnings.push(...scheduleWarnings(city).map((w) => `${file}: ${w}`));
  cities.push(city);
}

cities.sort((a, b) => a.name.localeCompare(b.name));

const previous = readPrevious();
if (previous && JSON.stringify(previous.cities) === JSON.stringify(cities)) {
  console.log(`data/cities.json is up to date (${cities.length} of ${files.length} city files)`);
} else {
  const generatedAt = new Date().toISOString();
  writeFileSync(outFile, JSON.stringify({ generatedAt, cityCount: cities.length, cities }, null, 2));
  console.log(`Merged ${cities.length} of ${files.length} city files into data/cities.json`);
}
if (warnings.length) {
  console.log(`${warnings.length} schedule warning${warnings.length === 1 ? '' : 's'}:`);
  for (const w of warnings) console.log(`  - ${w}`);
}
if (problems.length) {
  console.log(`${problems.length} validation problem${problems.length === 1 ? '' : 's'}:`);
  for (const p of problems) console.log(`  - ${p}`);
  if (strict) process.exit(1);
}

function readPrevious() {
  try {
    return JSON.parse(readFileSync(outFile, 'utf8'));
  } catch {
    return null;
  }
}

/**
 * Pages render every URL field as a link, so anything that is not http(s) (a typo, or a
 * javascript: link in a contributed file) is removed instead of shipped. Returns the paths
 * removed. A bad website is left for validation, because a city needs one.
 */
function dropBadUrls(city) {
  const removed = [];
  forEachCityUrl(city, (value, where, owner, key) => {
    if (where === 'website' || isUrl(value)) return;
    removed.push(where);
    if (Array.isArray(owner)) owner[key] = null;
    else delete owner[key];
  });
  if (Array.isArray(city.sources)) city.sources = city.sources.filter((s) => s !== null);
  return removed;
}

/** Light cleanup so that small inconsistencies from research do not break the app. */
function normalize(city) {
  const c = { ...city };
  if (typeof c.cityId === 'string') c.cityId = c.cityId.toLowerCase().trim();
  if (c.cityHall) {
    c.cityHall.lat = Number(c.cityHall.lat);
    c.cityHall.lng = Number(c.cityHall.lng);
  }
  c.meetings = (c.meetings || []).map((m) => {
    const r = { ...(m.recurrence || {}) };
    if (typeof r.time === 'string') r.time = normalizeTime(r.time);
    if (r.ordinals) r.ordinals = r.ordinals.map(Number).filter((n) => Number.isInteger(n));
    if (typeof r.weekday === 'string') r.weekday = Number(r.weekday);
    return { ...m, label: tidyLabel(m.label), recurrence: r, openToPublicComment: m.openToPublicComment !== false };
  });
  // "Notice of possible quorum" postings are not council meetings; drop them so they never show as events.
  c.scheduleExceptions = (c.scheduleExceptions || []).filter((ex) => !(ex.status === 'special' && /possible quorum/i.test(ex.note || '')));
  c.youthPrograms = c.youthPrograms || [];
  c.agendaItems = (c.agendaItems || []).map((a) => {
    const topics = (a.topics || []).filter(isTopicId);
    return { ...a, topics: topics.length ? topics : inferTopics(`${a.title} ${a.summary || ''}`) };
  });
  if (c.publicComment && typeof c.publicComment.timeLimitMinutes === 'string') c.publicComment.timeLimitMinutes = Number(c.publicComment.timeLimitMinutes) || undefined;
  if (!c.confidence) c.confidence = 'medium';
  c.sources = c.sources || [];
  return c;
}

function normalizeTime(t) {
  const s = t.trim().toLowerCase();
  const m = /^(\d{1,2})(?::(\d{2}))?\s*(a\.?m\.?|p\.?m\.?)?$/.exec(s);
  if (!m) return t;
  let h = Number(m[1]);
  const mm = m[2] || '00';
  const ap = m[3] || '';
  if (ap.startsWith('p') && h < 12) h += 12;
  if (ap.startsWith('a') && h === 12) h = 0;
  return `${String(h).padStart(2, '0')}:${mm}`;
}

/** Keep meeting labels short enough for a card: cut parentheticals and trailing clauses. */
function tidyLabel(label) {
  const raw = String(label || '').trim();
  if (raw.length <= 44) return raw;
  const cut = raw.split(/\s\(|,\s|\s-\s|:\s/)[0].trim();
  return cut.length >= 8 ? cut : raw.slice(0, 44).trim();
}
