/**
 * Merge translated work files (from node scripts/i18n-todo.mjs <lang>) back into the app:
 *  - ui files      -> packages/core/src/i18n/locales/<lang>/<namespace>.js, rewriting only
 *                     the values that changed (comments, key order, quoting and layout stay);
 *  - data files    -> data/i18n/<lang>.json (existing entries keep their place, new ones are
 *                     added in the order of data/i18n/source-strings.json);
 *  - community     -> i18n.<lang> of each team post in data/community.json, in place.
 *
 * Every value is checked before anything is written, and a file applies as a whole or not at
 * all: unknown keys, missing or extra {params}, missing plural forms, empty values, em or en
 * dashes, and city translations that lose a link or an email address are rejected and listed.
 * A value still identical to English is skipped as not translated yet, unless its key is in
 * the file's "keepEnglish" list (then it is recorded in same-as-english.json). Applying the
 * same file twice changes nothing.
 *
 * Usage: node scripts/i18n-apply.mjs <lang> [work files...] [--dry-run] [--remove]
 *   With no files, every data/i18n/work/<lang>-*.json is applied.
 *   --dry-run  check and report, write nothing
 *   --remove   delete each work file that applied with nothing rejected
 * Then run node scripts/i18n-check.mjs to see what is left.
 */
import { existsSync, readFileSync, readdirSync, renameSync, unlinkSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { DICTIONARIES, LOCALES, PLURAL_CATEGORIES, exactPluralCategories, isPluralForms, pluralCategoriesFor } from '../packages/core/src/i18n/index.js';
import { collectCityStrings } from '../packages/core/src/i18n/data.js';
import { editDictSource } from './lib/dict-source.mjs';
import { COMMUNITY_FILE, DASH, DATA_I18N_DIR, LOCALES_DIR, ROOT, SAME_FILE, WORK_DIR, getPath, isPluralizable, params, parseJsonPositions, pluralSelector, setJsonMember } from './lib/i18n-tools.mjs';

/** Write through a temporary file, so an interrupted run never leaves half a file. */
function writeAtomic(file, text) {
  const tmp = `${file}.tmp-${process.pid}`;
  writeFileSync(tmp, text);
  renameSync(tmp, file);
}

/**
 * Problems with one translated text against its English source, or []. In a plural form that
 * only one number reaches (Arabic zero, one, two), the number that picks the form ({n}, else
 * {count}) may be left out; every other param must stay.
 */
function textProblems(label, text, english, { exact = [], category, selector = null } = {}) {
  if (typeof text !== 'string' || !text.trim()) return [`${label}: empty`];
  const out = [];
  const want = params(english);
  const have = params(text);
  const optional = category && exact.includes(category) && selector ? [selector] : [];
  const lacking = want.filter((p) => !have.includes(p) && !optional.includes(p));
  const unknown = have.filter((p) => !want.includes(p));
  if (lacking.length) out.push(`${label}: missing {${lacking.join('}, {')}}`);
  if (unknown.length) out.push(`${label}: unknown {${unknown.join('}, {')}}`);
  if (DASH.test(text)) out.push(`${label}: contains an em dash or en dash`);
  return out;
}

const same = (a, b) => String(a).trim() === String(b).trim();

/**
 * Check a ui work file's strings for a language. Returns { edits: Map(namespace -> edits),
 * rejected: [], skipped: [], kept: [] } without touching any file.
 */
export function planUi(code, strings, { keepEnglish = [] } = {}) {
  const en = DICTIONARIES.en;
  const forms = pluralCategoriesFor(code);
  const exact = exactPluralCategories(code);
  const edits = new Map();
  const rejected = [];
  const skipped = [];
  const kept = [];
  const keep = new Set(keepEnglish);
  for (const [key, value] of Object.entries(strings || {})) {
    const english = getPath(en, key);
    const ns = key.split(/[.[]/)[0];
    if (english === undefined || (typeof english !== 'string' && !isPluralForms(english))) {
      rejected.push(`${key}: not a translatable key in English`);
      continue;
    }
    const rel = key.slice(ns.length + 1);
    if (!rel) {
      rejected.push(`${key}: a whole namespace cannot be one value`);
      continue;
    }
    let next;
    let problems = [];
    if (typeof value === 'string') {
      if (isPluralForms(english) && forms.length > 1) problems.push(`${key}: needs plural forms ${forms.join(', ')}`);
      else problems = textProblems(key, value, englishOf(english, 'other'));
      next = isPluralForms(english) ? { other: value } : value;
    } else if (value && typeof value === 'object' && !Array.isArray(value)) {
      if (typeof english === 'string' && !isPluralizable(english)) problems.push(`${key}: English is one string without a count, so this cannot have plural forms`);
      const unknown = Object.keys(value).filter((c) => !PLURAL_CATEGORIES.includes(c));
      if (unknown.length) problems.push(`${key}: ${unknown.join(', ')} ${unknown.length === 1 ? 'is not a plural category' : 'are not plural categories'}`);
      const lacking = forms.filter((c) => typeof value[c] !== 'string');
      if (lacking.length) problems.push(`${key}: plural forms missing ${lacking.join(', ')}`);
      // Forms this language never uses are dropped rather than kept as dead text.
      next = Object.fromEntries(forms.filter((c) => typeof value[c] === 'string').map((c) => [c, value[c]]));
      const selector = pluralSelector(english);
      for (const c of Object.keys(next)) problems.push(...textProblems(`${key}.${c}`, next[c], englishOf(english, c), { exact, category: c, selector }));
      if (forms.length === 1 && typeof english === 'string') next = next.other;
    } else {
      problems.push(`${key}: expected text or plural forms`);
    }
    if (problems.length) {
      rejected.push(...problems);
      continue;
    }
    const untouched = typeof next === 'string' ? same(next, englishOf(english, 'other')) : Object.entries(next).every(([c, v]) => same(v, englishOf(english, c)));
    if (untouched && !keep.has(key)) {
      skipped.push(key);
      continue;
    }
    if (untouched) kept.push(key);
    if (!edits.has(ns)) edits.set(ns, []);
    edits.get(ns).push({ path: rel, value: next });
  }
  return { edits, rejected, skipped, kept };
}

function englishOf(english, category) {
  return typeof english === 'string' ? english : english[category] ?? english.other;
}

/** Apply planned ui edits to the language's namespace files. Returns the files changed. */
function writeUi(code, edits, { dryRun }) {
  const changed = [];
  for (const [ns, list] of edits) {
    const file = path.join(LOCALES_DIR, code, `${ns}.js`);
    const src = readFileSync(file, 'utf8');
    const out = editDictSource(src, list);
    if (out !== src) {
      changed.push(path.relative(ROOT, file));
      if (!dryRun) writeAtomic(file, out);
    }
  }
  return changed;
}

/**
 * same-as-english.json in its own layout: one line per language, "*" first, then the
 * languages in menu order, so a diff shows exactly the keys that were added.
 */
export function formatSameAsEnglish(data) {
  const order = ['*', ...LOCALES.map((l) => l.code)];
  const keys = Object.keys(data).sort((a, b) => (order.indexOf(a) === -1 ? 99 : order.indexOf(a)) - (order.indexOf(b) === -1 ? 99 : order.indexOf(b)) || a.localeCompare(b));
  return `{\n${keys.map((k) => `  ${JSON.stringify(k)}: [${(data[k] || []).map((x) => JSON.stringify(x)).join(', ')}]`).join(',\n')}\n}\n`;
}

function recordKeepEnglish(code, keys, { dryRun }) {
  if (!keys.length || dryRun) return;
  const data = existsSync(SAME_FILE) ? JSON.parse(readFileSync(SAME_FILE, 'utf8')) : { '*': [] };
  const list = new Set(data[code] || []);
  for (const k of keys) list.add(k);
  data[code] = [...list].sort();
  writeAtomic(SAME_FILE, formatSameAsEnglish(data));
}

const LINK = /https?:\/\/[^\s)]+|[\w.+-]+@[\w-]+(?:\.[\w-]+)+/g;

/** Check data work strings. Returns { accept: [[english, translation]], rejected, skipped, warnings }. */
export function planData(code, strings, shownSet) {
  const accept = [];
  const rejected = [];
  const skipped = [];
  const warnings = [];
  for (const [english, translation] of Object.entries(strings || {})) {
    const label = english.length > 70 ? `${english.slice(0, 67)}...` : english;
    if (!shownSet.has(english)) {
      rejected.push(`"${label}": not a string the app shows (check the English key was not edited)`);
      continue;
    }
    if (typeof translation !== 'string' || !translation.trim()) {
      rejected.push(`"${label}": empty`);
      continue;
    }
    if (same(translation, english)) {
      skipped.push(english);
      continue;
    }
    if (DASH.test(translation)) {
      rejected.push(`"${label}": contains an em dash or en dash`);
      continue;
    }
    const links = (english.match(LINK) || []).map((l) => l.replace(/[.,;:]+$/, ''));
    const lost = links.filter((l) => !translation.includes(l));
    if (lost.length) {
      rejected.push(`"${label}": lost ${lost.join(', ')}`);
      continue;
    }
    const numbers = english.match(/\d+/g) || [];
    const kept = new Set(translation.match(/\d+/g) || []);
    const missing = [...new Set(numbers)].filter((n) => !kept.has(n));
    if (missing.length) warnings.push(`"${label}": numbers not found in the translation: ${missing.join(', ')}`);
    accept.push([english, translation.trim()]);
  }
  return { accept, rejected, skipped, warnings };
}

function writeData(code, accepted, { dryRun }) {
  const file = path.join(DATA_I18N_DIR, `${code}.json`);
  const raw = existsSync(file) ? readFileSync(file, 'utf8') : JSON.stringify({ lang: code, generatedAt: '', strings: {} });
  const memory = JSON.parse(raw);
  const strings = { ...(memory.strings || {}) };
  let changed = 0;
  const order = JSON.parse(readFileSync(path.join(DATA_I18N_DIR, 'source-strings.json'), 'utf8'));
  const rank = new Map(order.map((s, i) => [s, i]));
  const fresh = [];
  for (const [en, tr] of accepted) {
    if (strings[en] === tr) continue;
    if (!(en in strings)) fresh.push(en);
    strings[en] = tr;
    changed += 1;
  }
  if (!changed) return 0;
  // Existing entries keep their place; new ones follow, in source order.
  const existingKeys = Object.keys(memory.strings || {});
  fresh.sort((a, b) => (rank.get(a) ?? 1e9) - (rank.get(b) ?? 1e9));
  const ordered = Object.fromEntries([...existingKeys, ...fresh].map((k) => [k, strings[k]]));
  const out = { ...memory, lang: code, generatedAt: new Date().toISOString().slice(0, 10), strings: ordered };
  // The memories are written with a one-space indent and no final newline (es.json, vi.json).
  const indent = /^\{\r?\n( +)"/.exec(raw);
  const text = JSON.stringify(out, null, indent ? indent[1].length : 1) + (raw.endsWith('\n') ? '\n' : '');
  if (!dryRun) writeAtomic(file, text);
  return changed;
}

/** Check community work posts. Returns { accept: Map(id -> translation), rejected, skipped }. */
export function planCommunity(code, posts, seed) {
  const byId = new Map((seed.posts || []).filter((p) => p && p.team).map((p) => [p.id, p]));
  const accept = new Map();
  const rejected = [];
  const skipped = [];
  for (const [id, tr] of Object.entries(posts || {})) {
    const post = byId.get(id);
    if (!post) {
      rejected.push(`${id}: no team post with this id`);
      continue;
    }
    if (!tr || typeof tr.title !== 'string' || typeof tr.body !== 'string' || !tr.title.trim() || !tr.body.trim()) {
      rejected.push(`${id}: needs a title and a body`);
      continue;
    }
    if (same(tr.title, post.title) && same(tr.body, post.body)) {
      skipped.push(id);
      continue;
    }
    if (DASH.test(tr.title) || DASH.test(tr.body)) {
      rejected.push(`${id}: contains an em dash or en dash`);
      continue;
    }
    const out = { title: tr.title.trim(), body: tr.body.trim() };
    if (Array.isArray(tr.media) && tr.media.length) out.media = tr.media.map((m) => ({ alt: String((m && m.alt) || ''), caption: String((m && m.caption) || '') }));
    accept.set(id, out);
  }
  return { accept, rejected, skipped };
}

function writeCommunity(code, accept, { dryRun }) {
  if (!accept.size) return 0;
  let text = readFileSync(COMMUNITY_FILE, 'utf8');
  let changed = 0;
  const order = LOCALES.map((l) => l.code);
  for (const [id, tr] of accept) {
    const root = parseJsonPositions(text);
    const postsNode = root.props.find((p) => p.key === 'posts').node;
    const postNode = postsNode.items.find((it) => it.type === 'object' && it.props.some((p) => p.key === 'id' && p.node.value === id));
    const current = JSON.parse(text).posts.find((p) => p.id === id);
    if (current.i18n && JSON.stringify(current.i18n[code]) === JSON.stringify(tr)) continue;
    const i18nProp = postNode.props.find((p) => p.key === 'i18n');
    if (!i18nProp) text = setJsonMember(text, postNode, 'i18n', { [code]: tr });
    else {
      // Languages stay in menu order inside i18n: after the last one listed before this one.
      const before = order.slice(0, order.indexOf(code)).reverse().find((c) => i18nProp.node.props.some((p) => p.key === c));
      text = setJsonMember(text, i18nProp.node, code, tr, { after: before });
    }
    changed += 1;
  }
  JSON.parse(text);
  if (changed && !dryRun) writeAtomic(COMMUNITY_FILE, text);
  return changed;
}

/** Apply one work file. Returns a report; writes nothing when a value is rejected. */
export function applyFile(code, file, { dryRun = false } = {}) {
  const work = JSON.parse(readFileSync(file, 'utf8'));
  const name = path.basename(file);
  if (work.lang && work.lang !== code) return { file: name, rejected: [`made for ${work.lang}, not ${code}`], changed: 0 };
  if (work.kind === 'ui') {
    const plan = planUi(code, work.strings, { keepEnglish: work.keepEnglish });
    if (plan.rejected.length) return { file: name, ...plan, changed: 0 };
    const files = writeUi(code, plan.edits, { dryRun });
    recordKeepEnglish(code, plan.kept, { dryRun });
    const applied = [...plan.edits.values()].reduce((n, l) => n + l.length, 0);
    return { file: name, rejected: [], skipped: plan.skipped, applied, changed: files.length, files };
  }
  if (work.kind === 'data') {
    const cities = JSON.parse(readFileSync(path.join(ROOT, 'data', 'cities.json'), 'utf8')).cities;
    const shown = new Set();
    for (const c of cities) collectCityStrings(c, shown);
    const plan = planData(code, work.strings, shown);
    if (plan.rejected.length) return { file: name, ...plan, changed: 0 };
    const changed = writeData(code, plan.accept, { dryRun });
    return { file: name, rejected: [], skipped: plan.skipped, warnings: plan.warnings, applied: plan.accept.length, changed };
  }
  if (work.kind === 'community') {
    const seed = JSON.parse(readFileSync(COMMUNITY_FILE, 'utf8'));
    const plan = planCommunity(code, work.posts, seed);
    if (plan.rejected.length) return { file: name, ...plan, changed: 0 };
    const changed = writeCommunity(code, plan.accept, { dryRun });
    return { file: name, rejected: [], skipped: plan.skipped, applied: plan.accept.size, changed };
  }
  return { file: name, rejected: [`unknown kind ${JSON.stringify(work.kind)}`], changed: 0 };
}

function main(argv) {
  const dryRun = argv.includes('--dry-run');
  const remove = argv.includes('--remove');
  const [code, ...given] = argv.filter((a) => !a.startsWith('--'));
  if (!code || !LOCALES.some((l) => l.code === code) || code === 'en') {
    console.error('Usage: node scripts/i18n-apply.mjs <lang> [work files...] [--dry-run] [--remove]');
    return 1;
  }
  const files = given.length ? given.map((f) => path.resolve(f)) : existsSync(WORK_DIR) ? readdirSync(WORK_DIR).filter((f) => f.startsWith(`${code}-`) && f.endsWith('.json')).sort().map((f) => path.join(WORK_DIR, f)) : [];
  if (!files.length) {
    console.log(`${code}: no work files (node scripts/i18n-todo.mjs ${code} makes them)`);
    return 0;
  }
  let failed = 0;
  for (const file of files) {
    const r = applyFile(code, file, { dryRun });
    if (r.rejected.length) {
      failed += 1;
      console.log(`${r.file}: not applied, ${r.rejected.length} problem${r.rejected.length === 1 ? '' : 's'}:`);
      for (const p of r.rejected.slice(0, 40)) console.log(`  ${p}`);
      if (r.rejected.length > 40) console.log(`  ... ${r.rejected.length - 40} more`);
      continue;
    }
    console.log(`${r.file}: ${r.applied} applied${r.skipped && r.skipped.length ? `, ${r.skipped.length} still English (skipped)` : ''}${dryRun ? ' (dry run, nothing written)' : ''}`);
    for (const w of (r.warnings || []).slice(0, 20)) console.log(`  warning: ${w}`);
    if (remove && !dryRun && !(r.skipped && r.skipped.length)) unlinkSync(file);
  }
  return failed ? 1 : 0;
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) process.exitCode = main(process.argv.slice(2));
