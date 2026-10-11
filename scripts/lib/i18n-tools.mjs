/**
 * Shared pieces of the translation tools (i18n-check, i18n-scaffold, i18n-todo, i18n-apply):
 * where the files are, how a dictionary breaks into translatable units, and the rules that
 * decide whether a unit is complete, consistent with English, and actually translated.
 *
 * A unit is one thing a translator writes:
 *  - a string ('nav.home', 'civics.glossary[3].definition');
 *  - a plural object ('common.minutes'), whose forms are the language's CLDR categories
 *    (Arabic: zero, one, two, few, many, other; Hindi and Telugu: one, other; Chinese: other).
 * An English string that counts something ({n} or {count}) is "pluralizable": a language may
 * answer it with a plural object instead of a string.
 */
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { DICTIONARIES, LOCALES, INTL_SUPPLIED_KEYS, PLURAL_CATEGORIES, exactPluralCategories, isPluralForms, pluralCategoriesFor, usesIntlFormats } from '../../packages/core/src/i18n/runtime.js';

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
export const LOCALES_DIR = path.join(ROOT, 'packages', 'core', 'src', 'i18n', 'locales');
export const DATA_I18N_DIR = path.join(ROOT, 'data', 'i18n');
export const WORK_DIR = path.join(DATA_I18N_DIR, 'work');
export const COMMUNITY_FILE = path.join(ROOT, 'data', 'community.json');
export const SAME_FILE = path.join(ROOT, 'packages', 'core', 'src', 'i18n', 'same-as-english.json');

/** Em dash (U+2014) and en dash (U+2013), built from code points so this file never contains them. */
export const DASH = new RegExp(`[${String.fromCharCode(0x2014, 0x2013)}]`);

/** The namespaces in dictionary order, read from the English index.js imports. */
export function namespaces() {
  const src = readFileSync(path.join(LOCALES_DIR, 'en', 'index.js'), 'utf8');
  return [...src.matchAll(/^import (\w+) from '\.\/([\w-]+)\.js';/gm)].map((m) => m[2]);
}

export function params(s) {
  return [...String(s).matchAll(/\{(\w+)\}/g)]
    .map((m) => m[1])
    .sort()
    .filter((p, i, all) => all.indexOf(p) === i);
}

export const COUNT_PARAMS = ['n', 'count'];

/** True when an English string counts something and so may become a plural object. */
export function isPluralizable(english) {
  return typeof english === 'string' && params(english).some((p) => COUNT_PARAMS.includes(p));
}

/**
 * The param whose number picks a plural form ({n}, else {count}), or null. Only this one may
 * be left out of a form that a single number reaches (Arabic "two": "يومان"); any other
 * number in the sentence ({total}, {done}) must stay.
 */
export function pluralSelector(english) {
  const all = typeof english === 'string' ? params(english) : [...new Set(Object.values(english || {}).flatMap((s) => params(s)))];
  return COUNT_PARAMS.find((p) => all.includes(p)) || null;
}

/**
 * Every translatable unit of a dictionary, in file order: [{ path, ns, value }] where value is
 * a string or a plural object. Arrays and ordinary objects are walked into.
 */
export function units(dict) {
  const out = [];
  const walk = (node, at) => {
    if (typeof node === 'string' || isPluralForms(node)) out.push({ path: at, ns: at.split(/[.[]/)[0], value: node });
    else if (Array.isArray(node)) node.forEach((v, i) => walk(v, `${at}[${i}]`));
    else if (node && typeof node === 'object') for (const [k, v] of Object.entries(node)) walk(v, at ? `${at}.${k}` : k);
  };
  walk(dict, '');
  return out;
}

export function getPath(obj, p) {
  let node = obj;
  for (const part of p.split('.')) {
    const m = /^([^[\]]+)((?:\[\d+\])*)$/.exec(part);
    if (!m) return undefined;
    node = node == null ? undefined : node[m[1]];
    for (const idx of m[2].matchAll(/\[(\d+)\]/g)) node = node == null ? undefined : node[Number(idx[1])];
  }
  return node;
}

/** The English text a form of a unit is compared with: the same category, else 'other'. */
export function englishForm(english, category) {
  if (typeof english === 'string') return english;
  return english[category] ?? english.other;
}

/** Keys a language keeps identical to English on purpose (proper names, sample school names). */
export function sameAsEnglish(code) {
  if (!existsSync(SAME_FILE)) return new Set();
  const data = JSON.parse(readFileSync(SAME_FILE, 'utf8'));
  return new Set([...(data['*'] || []), ...(data[code] || [])]);
}

/** Keys a language does not read (Intl supplies them), so translators are never asked for them. */
export function skippedKeys(code) {
  return new Set(usesIntlFormats(code) ? INTL_SUPPLIED_KEYS : []);
}

export function isSkipped(unitPath, skipped) {
  for (const key of skipped) if (unitPath === key || unitPath.startsWith(`${key}.`) || unitPath.startsWith(`${key}[`)) return true;
  return false;
}

/** A quoted literal; an apostrophe inside a word ("Citizens' Input", "city's") never opens one. */
export const QUOTED = /(?<!\p{L})'[^']*'(?!\p{L})|"[^"]*"/gu;

/** Text with the parts that are never translated taken out: {params}, URLs, emails, quotes. */
function translatablePart(value) {
  return String(value)
    .replace(/\{\w+\}/g, ' ')
    .replace(/https?:\/\/\S+|[\w.+-]+@[\w-]+(?:\.[\w-]+)+/g, ' ')
    .replace(QUOTED, ' ');
}

/**
 * True when a value that matches English reads like a phrase someone forgot to translate,
 * rather than something that legitimately stays the same in a Latin-script language:
 *  - one word: a cognate ("Video"), a short code ("id", "PPM") or a name;
 *  - only capitalized words: a place, program or brand ("Dallas-Fort Worth",
 *    "Plano East Senior High", "{city} Senior High");
 *  - parameters, URLs, email addresses, quoted literals and one-letter abbreviations
 *    ("a.m.") are ignored before counting.
 * Anything left with two or more words and at least one lowercase word ("Show all {n}",
 * "Remote comment") is reported.
 */
export function looksLikeUntranslatedEnglish(value) {
  const words = (translatablePart(value).match(/\p{L}[\p{L}'’-]*/gu) || []).filter((w) => w.length > 1);
  if (words.length < 2) return false;
  return words.some((w) => w[0] === w[0].toLowerCase() && w[0] !== w[0].toUpperCase());
}

/** Languages written in Latin letters, where many English words are also correct ("Video"). */
const LATIN_SCRIPT = new Set(['en', 'es', 'vi']);

/** True for a language written in Latin letters (English, Spanish, Vietnamese). */
export function isLatinScript(code) {
  return LATIN_SCRIPT.has(code);
}

/**
 * Letters of each other language's own script. A value with any of them has been written in
 * that language (city, form and program names stay in English inside it, so Latin letters
 * next to them mean nothing); a value with none is still English, whether or not it matches
 * today's English: an English edit during translation leaves the old copy behind, and it must
 * not count as done.
 */
const OWN_SCRIPT = { zh: /\p{Script=Han}/u, hi: /\p{Script=Devanagari}/u, te: /\p{Script=Telugu}/u, ar: /\p{Script=Arabic}/u };

/**
 * Punctuation a language writes its own way, so a template that only joins params with
 * English punctuation ("{date}, {time}") still needs a translator: Chinese uses full-width
 * marks (，。：；？！（）“”) and Arabic its own comma, semicolon and question mark (، ؛ ؟).
 */
const OWN_PUNCTUATION = { zh: /[,.;:?!()"]/, ar: /[,;?]/ };

/**
 * Keys every language not written in Latin letters must answer, though their English has no
 * word in it: how the language quotes a word, separates list items, joins a label and its
 * value, and ends a sentence. A translator writes the language's own (“{word}”, "、", "।") or,
 * when English punctuation is right, lists the key in keepEnglish (Hindi keeps ", ").
 */
export const MUST_CONFIRM = Object.freeze(['rehearse.quoted', 'format.sep', 'format.labelValue', 'format.fullStop']);

/**
 * True when a value still needs a translator. In a language written in another script that is
 * any value without a letter of its own script that keeps a Latin lowercase letter outside
 * {params}, URLs, emails and quotes ("Video", "Google Calendar", "{day}s", "{n} s"), or
 * punctuation the language writes differently. Acronyms such as "MB" or "ZIP", and templates
 * that only join params ("{page} | {app}"), do not count. In Spanish and Vietnamese the
 * stricter phrase test above applies (to values identical to English).
 */
export function needsTranslation(value, code) {
  if (LATIN_SCRIPT.has(code)) return looksLikeUntranslatedEnglish(value);
  const rest = translatablePart(value);
  if (OWN_SCRIPT[code] && OWN_SCRIPT[code].test(rest)) return false;
  return /\p{Ll}/u.test(rest) || Boolean(OWN_PUNCTUATION[code] && OWN_PUNCTUATION[code].test(rest));
}

/**
 * Compare one language with English. Returns
 *  { units, missing, extra, problems, untranslated, translated, total, fixed }
 * where problems are failures (shape, categories, params, dashes), untranslated lists the
 * units a translator still has to write (in another script: any value still in English, even
 * one that no longer matches today's English), and fixed lists the units that need no
 * translator in this language (templates that only join params, "{city} ({n})"). `total`
 * counts the units a translator writes, so fixed ones are in neither number.
 */
export function compareLocale(code, { dicts = DICTIONARIES } = {}) {
  const en = dicts.en;
  const dict = dicts[code] || {};
  const required = pluralCategoriesFor(code);
  const exact = new Set(exactPluralCategories(code));
  const skipped = skippedKeys(code);
  const same = sameAsEnglish(code);
  const latin = LATIN_SCRIPT.has(code);
  const enUnits = units(en);
  const problems = [];
  const missing = [];
  const untranslated = [];
  const fixed = [];
  let total = 0;

  const checkText = (label, text, englishText, category, selector) => {
    if (typeof text !== 'string' || !text.trim()) {
      if (String(englishText).trim()) problems.push(`${label}: empty`);
      return;
    }
    const want = params(englishText);
    const have = params(text);
    // A form for a category that only one number reaches may leave that number out.
    const optional = category && exact.has(category) && selector ? [selector] : [];
    const lacking = want.filter((p) => !have.includes(p) && !optional.includes(p));
    const unknown = have.filter((p) => !want.includes(p));
    if (lacking.length || unknown.length) problems.push(`${label}: params {${have.join(',')}} vs {${want.join(',')}}`);
    if (DASH.test(text)) problems.push(`${label}: contains an em dash or en dash`);
  };
  // Still English: in a Latin-script language only a value identical to English that reads as
  // a phrase; in another script any value without its own letters, plus the keys every such
  // language confirms, while they are identical to English.
  const isEnglish = (text, englishText, unitPath) => {
    if (typeof text !== 'string') return false;
    if (latin) return text.trim() === String(englishText).trim() && needsTranslation(text, code);
    if (needsTranslation(text, code)) return true;
    return MUST_CONFIRM.includes(unitPath) && text.trim() === String(englishText).trim();
  };
  // A unit whose English has nothing a translator writes in this language: no word outside
  // {params}, URLs, emails and quotes, and (in another script) no punctuation of its own.
  const nothingToWrite = (englishValue, unitPath) => {
    if (!latin && MUST_CONFIRM.includes(unitPath)) return false;
    const forms = typeof englishValue === 'string' ? [englishValue] : Object.values(englishValue);
    return !forms.some((s) => (latin ? /\p{Ll}/u.test(translatablePart(s)) : needsTranslation(s, code)));
  };

  for (const unit of enUnits) {
    const value = getPath(dict, unit.path);
    const englishValue = unit.value;
    if (value === undefined) {
      missing.push(unit.path);
      continue;
    }
    if (code === 'en') continue;
    const skip = isSkipped(unit.path, skipped);
    const none = !skip && nothingToWrite(englishValue, unit.path);
    if (none) fixed.push(unit.path);
    else if (!skip) total += 1;
    let stillEnglish = false;
    if (typeof englishValue === 'string' && typeof value === 'string') {
      checkText(unit.path, value, englishValue, null, null);
      stillEnglish = isEnglish(value, englishValue, unit.path);
    } else if (isPluralForms(value) && (isPluralForms(englishValue) || isPluralizable(englishValue))) {
      for (const c of Object.keys(value)) if (!PLURAL_CATEGORIES.includes(c)) problems.push(`${unit.path}.${c}: not a plural category`);
      const lacking = required.filter((c) => typeof value[c] !== 'string');
      if (lacking.length) problems.push(`${unit.path}: plural forms missing ${lacking.join(', ')} (${code} needs ${required.join(', ')})`);
      const selector = pluralSelector(englishValue);
      for (const c of Object.keys(value)) checkText(`${unit.path}.${c}`, value[c], englishForm(englishValue, c), c, selector);
      stillEnglish = required.some((c) => isEnglish(value[c], englishForm(englishValue, c), unit.path));
    } else if (isPluralForms(englishValue) && typeof value === 'string') {
      problems.push(`${unit.path}: English has plural forms; ${code} needs ${required.join(', ')}`);
    } else {
      problems.push(`${unit.path}: ${Array.isArray(value) ? 'a list' : typeof value} where English has ${typeof englishValue === 'string' ? 'a string' : 'plural forms'}`);
    }
    if (stillEnglish && !skip && !none && !same.has(unit.path)) untranslated.push(unit.path);
  }

  // Keys or list items English does not have.
  const extra = [];
  const enShape = (p) => getPath(en, p);
  for (const unit of units(dict)) {
    if (enShape(unit.path) !== undefined) continue;
    const parent = unit.path.replace(/\.(zero|one|two|few|many|other)$/, '');
    if (parent !== unit.path && enShape(parent) !== undefined) continue;
    extra.push(unit.path);
  }
  // Arrays must keep English's length (glossary entries, weekday names).
  const walkArrays = (a, b, at) => {
    if (Array.isArray(a)) {
      if (!Array.isArray(b)) return;
      if (a.length !== b.length) problems.push(`${at}: list length ${b.length} vs ${a.length}`);
      a.forEach((v, i) => walkArrays(v, b[i], `${at}[${i}]`));
    } else if (a && typeof a === 'object' && !isPluralForms(a) && b && typeof b === 'object') {
      for (const k of Object.keys(a)) walkArrays(a[k], b[k], at ? `${at}.${k}` : k);
    }
  };
  if (code !== 'en') walkArrays(en, dict, '');

  return { units: enUnits, missing, extra, problems, untranslated, translated: total - untranslated.length, total, fixed };
}

/** All LOCALES codes other than English. */
export function targetCodes() {
  return LOCALES.map((l) => l.code).filter((c) => c !== 'en');
}

/** Read a JSON file written with JSON.stringify(data, null, n), keeping its indent and final newline. */
export function readJsonFile(file) {
  const raw = readFileSync(file, 'utf8');
  const indentMatch = /^[{[]\r?\n([ \t]+)/.exec(raw);
  return { data: JSON.parse(raw), indent: indentMatch ? indentMatch[1] : 2, newline: raw.endsWith('\n') };
}

export function formatJson(data, { indent = 2, newline = true } = {}) {
  return JSON.stringify(data, null, indent) + (newline ? '\n' : '');
}

// ---------- JSON files edited in place ----------

/**
 * Parse JSON text into nodes that remember where they are, so a member can be replaced or
 * added without reformatting the rest of a hand-formatted file (data/community.json keeps
 * short arrays on one line). Nodes: { type: 'object', start, end, closeStart, props: [{ key,
 * keyStart, node }] } | { type: 'array', start, end, items: [node] } | { type: 'value', start,
 * end, value }.
 */
export function parseJsonPositions(text) {
  let i = 0;
  const ws = () => {
    while (i < text.length && /\s/.test(text[i])) i += 1;
  };
  const fail = (msg) => {
    throw new Error(`${msg} at offset ${i}`);
  };
  function str() {
    const start = i;
    i += 1;
    while (i < text.length && text[i] !== '"') i += text[i] === '\\' ? 2 : 1;
    if (i >= text.length) fail('Unclosed string');
    i += 1;
    return { type: 'value', start, end: i, value: JSON.parse(text.slice(start, i)) };
  }
  function value() {
    ws();
    const ch = text[i];
    if (ch === '{') {
      const start = i;
      i += 1;
      const props = [];
      ws();
      while (text[i] !== '}') {
        ws();
        if (text[i] !== '"') fail('Expected a key');
        const keyStart = i;
        const key = str().value;
        ws();
        if (text[i] !== ':') fail('Expected :');
        i += 1;
        const node = value();
        props.push({ key, keyStart, node });
        ws();
        if (text[i] === ',') i += 1;
        else if (text[i] !== '}') fail('Expected , or }');
        ws();
      }
      const closeStart = i;
      i += 1;
      return { type: 'object', start, end: i, closeStart, props };
    }
    if (ch === '[') {
      const start = i;
      i += 1;
      const items = [];
      ws();
      while (text[i] !== ']') {
        items.push(value());
        ws();
        if (text[i] === ',') i += 1;
        else if (text[i] !== ']') fail('Expected , or ]');
        ws();
      }
      i += 1;
      return { type: 'array', start, end: i, items };
    }
    if (ch === '"') return str();
    const m = /^(?:-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?|true|false|null)/.exec(text.slice(i));
    if (!m) fail('Unexpected character');
    const start = i;
    i += m[0].length;
    return { type: 'value', start, end: i, value: JSON.parse(m[0]) };
  }
  const root = value();
  return root;
}

function indentBefore(text, pos) {
  const lineStart = text.lastIndexOf('\n', pos - 1) + 1;
  return /^[ \t]*/.exec(text.slice(lineStart))[0];
}

/** A JSON value pretty-printed as one block at an indentation (two spaces a level). */
export function jsonBlock(value, indent) {
  return JSON.stringify(value, null, 2).replace(/\n/g, `\n${indent}`);
}

/**
 * Set object[key] = value inside JSON text at an object node, keeping everything else as it
 * was: an existing member's value is replaced in place; a new member goes after the last one
 * (or after `after`, a key, when given), on its own line with its siblings' indentation.
 * Returns the new text.
 */
export function setJsonMember(text, objectNode, key, value, { after } = {}) {
  const existing = objectNode.props.find((p) => p.key === key);
  if (existing) {
    const indent = indentBefore(text, existing.keyStart);
    return text.slice(0, existing.node.start) + jsonBlock(value, indent) + text.slice(existing.node.end);
  }
  const anchor = (after && objectNode.props.find((p) => p.key === after)) || objectNode.props[objectNode.props.length - 1];
  if (!anchor) {
    const indent = `${indentBefore(text, objectNode.start)}  `;
    const member = `\n${indent}${JSON.stringify(key)}: ${jsonBlock(value, indent)}\n${indentBefore(text, objectNode.start)}`;
    return text.slice(0, objectNode.start + 1) + member + text.slice(objectNode.closeStart);
  }
  const indent = indentBefore(text, anchor.keyStart);
  const member = `,\n${indent}${JSON.stringify(key)}: ${jsonBlock(value, indent)}`;
  // After the anchor's value; its comma (if any) now belongs to the new member's line.
  let end = anchor.node.end;
  const hasComma = /^\s*,/.test(text.slice(end));
  if (hasComma) {
    const comma = text.indexOf(',', end);
    return `${text.slice(0, comma)}${member},${text.slice(comma + 1)}`;
  }
  return text.slice(0, end) + member + text.slice(end);
}
