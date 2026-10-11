/**
 * The translation runtime: `t()` and friends over a registry of dictionaries. English is
 * always here; other languages are registered when they load.
 *
 * Dictionaries live in ./locales/<code>/, one file per namespace, assembled by that folder's
 * index.js. `t()` looks a dotted key up in the current locale and falls back to English, so a
 * missing translation never breaks the app.
 *  - Node (the CLI, the server, scripts, tests) imports ./index.js, which registers every
 *    language up front.
 *  - The web app's build (the package's "browser" entry) registers only English and calls
 *    loadLocale(code) before it shows another language, so each language is its own small
 *    download instead of all of them sitting in the first one.
 * Core modules import this file, never ./index.js, so they do not pull every dictionary into
 * the browser build. City data (public comment rules, agenda items, and so on) is translated
 * separately with a translation memory; see ./data.js.
 */
import en from './locales/en/index.js';

/** Every language the app speaks (loaded or not). */
export const LOCALES = Object.freeze([
  { code: 'en', name: 'English', nativeName: 'English' },
  { code: 'es', name: 'Spanish', nativeName: 'Español' },
  { code: 'vi', name: 'Vietnamese', nativeName: 'Tiếng Việt' },
]);

/** How to load each language other than English (a separate chunk in the browser build). */
const LOADERS = {
  es: () => import('./locales/es/index.js'),
  vi: () => import('./locales/vi/index.js'),
};

const DICTS = { en };
let current = 'en';
const listeners = new Set();
const loading = new Map();

/** True for a language the app speaks, whether or not its dictionary has loaded yet. */
export function isLocale(code) {
  return LOCALES.some((l) => l.code === String(code));
}

/** True once a language's dictionary is registered (English always is). */
export function hasLocale(code) {
  return Object.prototype.hasOwnProperty.call(DICTS, String(code));
}

/** Add a language's dictionary (what loadLocale does once the chunk arrives). */
export function registerLocale(code, dict) {
  if (isLocale(code) && dict && typeof dict === 'object') DICTS[code] = dict;
}

/**
 * Load a language's dictionary if it is not registered yet. Resolves to true when it is
 * ready, false when it could not load (offline on a first visit): t() then stays in English.
 */
export function loadLocale(code) {
  const lang = String(code);
  if (hasLocale(lang)) return Promise.resolve(true);
  if (!LOADERS[lang]) return Promise.resolve(false);
  if (!loading.has(lang)) {
    loading.set(
      lang,
      LOADERS[lang]()
        .then((mod) => {
          registerLocale(lang, mod.default || mod);
          return true;
        })
        .catch(() => {
          loading.delete(lang);
          return false;
        }),
    );
  }
  return loading.get(lang);
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
