/**
 * Internationalization for every string the engine, the web app, and the CLI produce.
 *
 * Dictionaries live in ./locales/<code>/, one file per namespace, assembled by that
 * folder's index.js. `t()` looks a dotted key up in the current locale and falls back to
 * English, so a missing translation never breaks the app.
 * City data (public comment rules, agenda items, and so on) is translated separately
 * with a translation memory; see ./data.js.
 */
import en from './locales/en/index.js';
import es from './locales/es/index.js';
import vi from './locales/vi/index.js';

export const LOCALES = Object.freeze([
  { code: 'en', name: 'English', nativeName: 'English' },
  { code: 'es', name: 'Spanish', nativeName: 'Español' },
  { code: 'vi', name: 'Vietnamese', nativeName: 'Tiếng Việt' },
]);

const DICTS = { en, es, vi };
let current = 'en';
const listeners = new Set();

export function isLocale(code) {
  return Object.prototype.hasOwnProperty.call(DICTS, String(code));
}

/** Pick the first supported language out of browser or OS language tags. */
export function detectLocale(candidates) {
  for (const c of candidates || []) {
    const base = String(c || '')
      .toLowerCase()
      .split(/[-_]/)[0];
    if (isLocale(base)) return base;
  }
  return 'en';
}

export function getLocale() {
  return current;
}

export function setLocale(code) {
  const next = isLocale(code) ? code : 'en';
  if (next !== current) {
    current = next;
    for (const fn of listeners) fn(current);
  }
  return current;
}

export function onLocaleChange(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

function lookup(dict, key) {
  let node = dict;
  for (const part of String(key).split('.')) {
    if (node == null || typeof node !== 'object' || !(part in node)) return undefined;
    node = node[part];
  }
  return node;
}

function interpolate(template, params) {
  if (!params) return template;
  return template.replace(/\{(\w+)\}/g, (m, k) => (params[k] !== undefined && params[k] !== null ? String(params[k]) : m));
}

/** Translate a key. Strings are interpolated with {name} params; arrays and objects come back as-is. */
export function t(key, params, locale) {
  const lang = locale && isLocale(locale) ? locale : current;
  let value = lookup(DICTS[lang], key);
  if (value === undefined) value = lookup(en, key);
  if (value === undefined) return key;
  return typeof value === 'string' ? interpolate(value, params) : value;
}

/** Plural-aware translate: the key resolves to a string with {n} or to {one, other}. */
export function tn(key, n, params, locale) {
  const forms = t(key, undefined, locale);
  const merged = { n, ...(params || {}) };
  if (typeof forms === 'string') return interpolate(forms, merged);
  if (forms && typeof forms === 'object') return interpolate((n === 1 ? forms.one : forms.other) || forms.other || '', merged);
  return String(key);
}

/** Translate a key that holds a list. */
export function tList(key, locale) {
  const v = t(key, undefined, locale);
  return Array.isArray(v) ? v : [];
}

/** Join a list the way the language does: "a, b, and c". */
export function joinList(items, locale) {
  const list = items.filter(Boolean);
  if (list.length <= 1) return list.join('');
  const and = t('format.and', undefined, locale);
  if (list.length === 2) return `${list[0]} ${and} ${list[1]}`;
  return `${list.slice(0, -1).join(', ')} ${and} ${list[list.length - 1]}`;
}

/**
 * Lowercase the first letter so a phrase can continue a sentence ("Rent, first apartments"
 * becomes "rent, first apartments"), unless the first word is an acronym or a mixed-case name
 * such as "DART" or "Wi-Fi", which must keep its capitals in every language.
 */
export function lowerFirst(text) {
  const s = String(text || '');
  const firstWord = s.split(/[\s,.;:!?()]/)[0];
  if (/\p{Lu}/u.test(firstWord.slice(1))) return s;
  return s.charAt(0).toLowerCase() + s.slice(1);
}

/** Every dotted key in a dictionary, used by the coverage check script. */
export function dictionaryKeys(dict, prefix = '') {
  const out = [];
  for (const [k, v] of Object.entries(dict || {})) {
    const key = prefix ? `${prefix}.${k}` : k;
    if (v && typeof v === 'object' && !Array.isArray(v)) out.push(...dictionaryKeys(v, key));
    else out.push(key);
  }
  return out;
}

export const DICTIONARIES = DICTS;
