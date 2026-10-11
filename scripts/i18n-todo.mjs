/**
 * Write everything a language still needs translated into JSON work files, in chunks, so
 * translators (people or agents) can each take one. node scripts/i18n-apply.mjs <lang> merges
 * the translated files back. Files go to data/i18n/work/ (not committed):
 *
 *   <lang>-ui-<k>.json         app text: { "strings": { "<key>": <English> } }
 *   <lang>-data-<k>.json       city data: { "strings": { "<English>": <English> } }
 *   <lang>-community.json      team posts: { "posts": { "<id>": { "title", "body" } } }
 *
 * The translator replaces each English value with the translation and leaves keys alone.
 * In a ui file a plural value is an object with the language's plural forms (Arabic: zero,
 * one, two, few, many, other), each starting as the English text; strings that count
 * something ({n} or {count}) also come as plural objects in languages with more than one
 * form, since the noun usually changes with the number. Every value still in English is
 * listed, including an old English copy that no longer matches today's English, and the
 * punctuation keys each language confirms (MUST_CONFIRM in lib/i18n-tools.mjs). Each file
 * carries the language's instructions, so it stands on its own.
 *
 * Usage: node scripts/i18n-todo.mjs <lang> [--chunks N] [--data-chunks N] [--only ui|data|community] [--out DIR]
 *   defaults: --chunks 4 (ui), --data-chunks 8, every kind, --out data/i18n/work
 */
import { existsSync, mkdirSync, readFileSync, readdirSync, unlinkSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { DICTIONARIES, LOCALES, pluralCategoriesFor } from '../packages/core/src/i18n/index.js';
import { translationCoverage } from '../packages/core/src/i18n/data.js';
import { COMMUNITY_FILE, DATA_I18N_DIR, ROOT, WORK_DIR, compareLocale, getPath, isPluralizable, needsTranslation } from './lib/i18n-tools.mjs';

const REGISTER = {
  zh: 'Simplified Chinese (mainland usage, simplified characters only). Address the reader as 你, friendly and plain, for high school students. Full-width Chinese punctuation (，。：；？！（）) in Chinese sentences.',
  hi: 'Hindi in Devanagari script, everyday standard Hindi a high school student uses (not Sanskritized). Address the reader as आप. Use the danda (।) to end full sentences.',
  te: 'Telugu in Telugu script, everyday standard Telugu a high school student uses. Address the reader as మీరు.',
  ar: 'Modern Standard Arabic, plain and friendly for high school students. Address the reader directly in the second person (masculine plural or gender-neutral phrasing where natural). Use Arabic punctuation (، ؛ ؟).',
};

/** Instructions every work file carries for a language. */
export function instructions(code, kind) {
  const info = LOCALES.find((l) => l.code === code);
  const common = [
    `Translate from English into ${info.name} (${info.nativeName}). ${REGISTER[code] || ''}`.trim(),
    'Replace each English value with its translation. Never change, add or remove keys.',
    'Keep every {parameter} exactly as written, including its braces; move it wherever the sentence needs it.',
    'Never use the em dash or the en dash characters; use a comma, a colon or parentheses instead.',
    'Keep Latin digits (0-9) for every number, time, date and phone number.',
    'Keep in English: URLs, email addresses, phone numbers, the app name Agora, the names of cities, people, schools, councils, forms and programs, and anything inside quotation marks that a city requires word for word.',
  ];
  if (kind === 'ui') {
    const forms = pluralCategoriesFor(code);
    common.push(
      `Plural values are objects with the forms ${info.name} uses: ${forms.join(', ')}. Fill every form, even when two read the same. The number that picks the form is {n}, or {count} when there is no {n}; a form that only one number reaches (Arabic zero, one and two) may leave that number out, but never any other {parameter}.`,
      'A sentence counts one thing with {n}. A second counted thing arrives already written as a phrase with its own plural entry ({days} is "30 days", {duration} "2 seconds", {length} and {words} "30 words", {minutes} "3 minutes"), so only {n} has to agree with a noun in the sentence.',
      'format.sep (between list items), format.labelValue (a label and its value), format.fullStop (the end of a sentence) and rehearse.quoted (a quoted word) are this language\'s punctuation: write its own, or keep the English one and list the key in "keepEnglish".',
      'Strings that are lists (format.ordinals[3]) or parts of lists keep their position.',
      'If a value must stay exactly as in English on purpose (a brand or a sample school name), copy it unchanged and add its key to "keepEnglish".',
    );
  }
  if (kind === 'data') common.push('These are rules from city websites: keep every time, date, deadline, address, phone number and link exactly as precise as the English.');
  if (kind === 'community') common.push('These are posts from the Agora team. Keep paragraph breaks (\\n\\n) where the English has them.');
  return common;
}

/** Split [key, value, size] entries into n chunks of similar size, keeping their order. */
function chunk(entries, n) {
  const total = entries.reduce((a, e) => a + e.size, 0);
  const target = Math.max(1, total / Math.max(1, n));
  const out = [];
  let cur = [];
  let size = 0;
  for (const e of entries) {
    if (cur.length && size + e.size > target && out.length < n - 1) {
      out.push(cur);
      cur = [];
      size = 0;
    }
    cur.push(e);
    size += e.size;
  }
  if (cur.length) out.push(cur);
  return out;
}

const sizeOf = (v) => (typeof v === 'string' ? v.length : Object.values(v).reduce((a, s) => a + s.length, 0));

/** The UI units a language still needs, as { key: English value or plural template }. */
export function uiTodo(code) {
  const r = compareLocale(code);
  const forms = pluralCategoriesFor(code);
  const out = {};
  const englishForm = (english, c) => (typeof english === 'string' ? english : english[c] ?? english.other);
  for (const p of r.untranslated) {
    const english = getPath(DICTIONARIES.en, p);
    const current = getPath(DICTIONARIES[code], p);
    // Always today's English: an old copy left behind by an English edit is not offered.
    if (typeof english === 'string' && !(isPluralizable(english) && forms.length > 1)) out[p] = english;
    else {
      // Forms already written in the language stay; the rest start as today's English.
      const mine = (c) => (current && typeof current === 'object' && typeof current[c] === 'string' && !needsTranslation(current[c], code) ? current[c] : null);
      out[p] = Object.fromEntries(forms.map((c) => [c, mine(c) ?? englishForm(english, c)]));
    }
  }
  return out;
}

/** City-data strings the app shows with no translation in data/i18n/<code>.json. */
export function dataTodo(code) {
  const cities = JSON.parse(readFileSync(path.join(ROOT, 'data', 'cities.json'), 'utf8')).cities;
  const file = path.join(DATA_I18N_DIR, `${code}.json`);
  const table = existsSync(file) ? JSON.parse(readFileSync(file, 'utf8')).strings || {} : {};
  return translationCoverage(cities, table).missing;
}

/** Team posts without a translation in this language. */
export function communityTodo(code) {
  if (!existsSync(COMMUNITY_FILE)) return {};
  const posts = (JSON.parse(readFileSync(COMMUNITY_FILE, 'utf8')).posts || []).filter((p) => p && p.team);
  const out = {};
  for (const p of posts) {
    const tr = p.i18n && p.i18n[code];
    if (tr && tr.title && tr.body) continue;
    out[p.id] = { title: p.title, body: p.body, ...(Array.isArray(p.media) && p.media.length ? { media: p.media.map((m) => ({ alt: m.alt || '', caption: m.caption || '' })) } : {}) };
  }
  return out;
}

function arg(argv, name, fallback) {
  const i = argv.indexOf(`--${name}`);
  return i === -1 ? fallback : argv[i + 1];
}

export function writeTodo(code, { chunks = 4, dataChunks = 8, only = null, out = WORK_DIR, log = console.log } = {}) {
  if (!LOCALES.some((l) => l.code === code) || code === 'en') throw new Error(`${code} is not a language in LOCALES`);
  mkdirSync(out, { recursive: true });
  // Old work files for this language would mix with the new ones.
  for (const f of readdirSync(out)) if (new RegExp(`^${code}-(ui|data)-\\d+\\.json$|^${code}-community\\.json$`).test(f) && (!only || f.startsWith(`${code}-${only}`))) unlinkSync(path.join(out, f));
  const written = [];
  const today = new Date().toISOString().slice(0, 10);
  const shown = (file) => (file.startsWith(`${ROOT}${path.sep}`) ? path.relative(ROOT, file) : file);
  if (!only || only === 'ui') {
    const todo = uiTodo(code);
    const entries = Object.entries(todo).map(([key, value]) => ({ key, value, size: sizeOf(value) }));
    // Whole namespaces stay together where they can, so a translator sees related strings.
    const parts = entries.length ? chunk(entries, chunks) : [];
    parts.forEach((part, i) => {
      const file = path.join(out, `${code}-ui-${i + 1}.json`);
      const keys = part.map((e) => e.key);
      writeFileSync(file, `${JSON.stringify({ lang: code, kind: 'ui', made: today, pluralForms: pluralCategoriesFor(code), instructions: instructions(code, 'ui'), keepEnglish: [], strings: Object.fromEntries(part.map((e) => [e.key, e.value])) }, null, 2)}\n`);
      written.push(`${shown(file)}: ${keys.length} keys`);
    });
  }
  if (!only || only === 'data') {
    const missing = dataTodo(code);
    const entries = missing.map((s) => ({ key: s, value: s, size: s.length }));
    const parts = entries.length ? chunk(entries, dataChunks) : [];
    parts.forEach((part, i) => {
      const file = path.join(out, `${code}-data-${i + 1}.json`);
      writeFileSync(file, `${JSON.stringify({ lang: code, kind: 'data', made: today, instructions: instructions(code, 'data'), strings: Object.fromEntries(part.map((e) => [e.key, e.value])) }, null, 2)}\n`);
      written.push(`${shown(file)}: ${part.length} strings`);
    });
  }
  if (!only || only === 'community') {
    const posts = communityTodo(code);
    if (Object.keys(posts).length) {
      const file = path.join(out, `${code}-community.json`);
      writeFileSync(file, `${JSON.stringify({ lang: code, kind: 'community', made: today, instructions: instructions(code, 'community'), posts }, null, 2)}\n`);
      written.push(`${shown(file)}: ${Object.keys(posts).length} posts`);
    }
  }
  if (!written.length) log(`${code}: nothing left to translate`);
  for (const w of written) log(w);
  return written;
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  const argv = process.argv.slice(2);
  const code = argv.find((a) => !a.startsWith('--') && !/^\d+$/.test(a) && !['ui', 'data', 'community'].includes(a) && a !== arg(argv, 'out'));
  if (!code) {
    console.error('Usage: node scripts/i18n-todo.mjs <lang> [--chunks N] [--data-chunks N] [--only ui|data|community] [--out DIR]');
    process.exit(1);
  }
  writeTodo(code, {
    chunks: Math.max(1, Number(arg(argv, 'chunks', 4)) || 4),
    dataChunks: Math.max(1, Number(arg(argv, 'data-chunks', 8)) || 8),
    only: arg(argv, 'only', null),
    out: path.resolve(arg(argv, 'out', WORK_DIR)),
  });
}
