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
 *
 * Plurals follow CLDR through Intl.PluralRules: a plural value is an object whose keys are
 * plural categories (zero, one, two, few, many, other). English needs one and other, Arabic all
 * six, Chinese only other. Any string that counts something ({n}, or {count}) may be written as
 * a plural object in a language that needs one, even where English is a plain string. So {n}
 * and {count} are always numbers: a value that is already words ("9 posts") goes in a param
 * with another name. A number that changes the noun after it is {n} (or {count}); a sentence
 * with two such numbers takes the second one as a phrase made by its own plural message.
 *
 * Right-to-left languages: every {param} interpolated into an Arabic message is wrapped in
 * Unicode isolates (FSI ... PDI), the way ICU MessageFormat 2 and Fluent do it, so an English
 * city name, a time, a phone number or a count can never reorder the sentence around it. A
 * value that is itself a message with only punctuation between its own isolated parts
 * ("{day}، {time}") is isolated as right to left (RLI), since it was written in the language.
 *
 * Languages are listed before they are translated; `ready` says which ones are complete.
 * Only ready languages are offered (menus, browser and Accept-Language detection); any
 * language can still be chosen on purpose (a saved profile, ?lang=, --lang).
 */
import en from './locales/en/index.js';

/**
 * Every language the app speaks (loaded or not), in the order the language menu lists them.
 *  - tag: the BCP 47 tag for <html lang> and lang attributes ('zh-Hans' is Simplified Chinese);
 *  - dir: writing direction;
 *  - intl: the locale handed to Intl. The four languages added after the first three ask for
 *    Latin digits (-u-nu-latn): addresses, times and phone numbers in Texas sources use them;
 *  - speech: the tag for the browser's speech recognition;
 *  - formats: 'dictionary' when dates and times come from the dictionary's own names and
 *    templates (English, Spanish, Vietnamese, tuned by hand), 'intl' when Intl supplies them;
 *  - aliases: other names someone might type for the language (the CLI setup);
 *  - ready: true once the language is completely translated. A language that is not ready is
 *    never offered: the menus leave it out, and browser or Accept-Language detection skips it,
 *    so nobody lands on English placeholder text (laid out right to left, for Arabic). It
 *    still works when chosen on purpose (a saved profile, ?lang= in the web app, --lang in the
 *    CLI), which is how it is reviewed. node scripts/i18n-check.mjs --strict fails until a
 *    finished language is marked ready, and always fails when a ready one has gaps.
 */
export const LOCALES = Object.freeze(
  [
    { code: 'en', name: 'English', nativeName: 'English', tag: 'en', dir: 'ltr', intl: 'en-US', speech: 'en-US', formats: 'dictionary', aliases: [], ready: true },
    { code: 'es', name: 'Spanish', nativeName: 'Español', tag: 'es', dir: 'ltr', intl: 'es-US', speech: 'es-US', formats: 'dictionary', aliases: ['Espanol', 'Castellano'], ready: true },
    { code: 'vi', name: 'Vietnamese', nativeName: 'Tiếng Việt', tag: 'vi', dir: 'ltr', intl: 'vi-VN', speech: 'vi-VN', formats: 'dictionary', aliases: [], ready: true },
    { code: 'zh', name: 'Chinese', nativeName: '中文', tag: 'zh-Hans', dir: 'ltr', intl: 'zh-Hans-CN-u-nu-latn', speech: 'zh-CN', formats: 'intl', aliases: ['Simplified Chinese', 'Mandarin', '简体中文', '汉语', '普通话'], ready: false },
    { code: 'hi', name: 'Hindi', nativeName: 'हिन्दी', tag: 'hi', dir: 'ltr', intl: 'hi-IN-u-nu-latn', speech: 'hi-IN', formats: 'intl', aliases: ['हिंदी'], ready: false },
    { code: 'te', name: 'Telugu', nativeName: 'తెలుగు', tag: 'te', dir: 'ltr', intl: 'te-IN-u-nu-latn', speech: 'te-IN', formats: 'intl', aliases: [], ready: false },
    { code: 'ar', name: 'Arabic', nativeName: 'العربية', tag: 'ar', dir: 'rtl', intl: 'ar-u-ca-gregory-nu-latn', speech: 'ar-SA', formats: 'intl', aliases: ['عربي'], ready: false },
  ].map((l) => Object.freeze({ ...l, aliases: Object.freeze(l.aliases) })),
);

/** How to load each language other than English (a separate chunk in the browser build). */
const LOADERS = {
  es: () => import('./locales/es/index.js'),
  vi: () => import('./locales/vi/index.js'),
  zh: () => import('./locales/zh/index.js'),
  hi: () => import('./locales/hi/index.js'),
  te: () => import('./locales/te/index.js'),
  ar: () => import('./locales/ar/index.js'),
};

/**
 * Dictionary keys that Intl supplies for languages with formats: 'intl' (weekday and month
 * names, date templates, AM and PM, "and" in lists). Those languages never read these keys, so
 * the coverage tools do not ask translators for them.
 */
export const INTL_SUPPLIED_KEYS = Object.freeze(['format.weekdays', 'format.weekdaysShort', 'format.months', 'format.monthsShort', 'format.date', 'format.dateWithYear', 'format.am', 'format.pm', 'format.and', 'ui.monthDay', 'ui.monthDayYear', 'cli.mapDate']);

const DICTS = { en };
let current = 'en';
const listeners = new Set();
const loading = new Map();

/** True for a language the app speaks, whether or not its dictionary has loaded yet. */
export function isLocale(code) {
  return LOCALES.some((l) => l.code === String(code));
}

/** The LOCALES entry for a code (English for anything the app does not speak). */
export function localeInfo(code) {
  return LOCALES.find((l) => l.code === String(code)) || LOCALES[0];
}

/** True for a language that is completely translated, and so offered in menus and detection. */
export function isLocaleReady(code) {
  return LOCALES.some((l) => l.code === String(code) && l.ready);
}

/**
 * The languages to offer: every ready one in menu order, plus `current` when it is in use
 * without being ready (someone picked it on purpose), so the menu still shows what is on.
 */
export function offeredLocales(current) {
  return LOCALES.filter((l) => l.ready || l.code === current);
}

/** The language a call means: the one given when the app speaks it, else the active one. */
function langOf(locale) {
  return locale && isLocale(locale) ? String(locale) : current;
}

/** 'rtl' or 'ltr' for a language (the active one when none is given). */
export function localeDir(code) {
  return localeInfo(langOf(code)).dir;
}

/** True for a right-to-left language (the active one when none is given). */
export function isRtl(code) {
  return localeDir(code) === 'rtl';
}

/** The BCP 47 tag for <html lang> and lang attributes: 'zh-Hans' for Chinese. */
export function htmlLang(code) {
  return localeInfo(langOf(code)).tag;
}

/** The locale to hand to Intl (Latin digits for the languages that ask for them). */
export function intlLocale(code) {
  return localeInfo(langOf(code)).intl;
}

/** The speech recognition tag: 'zh-CN', 'hi-IN', 'te-IN', 'ar-SA'. */
export function speechLang(code) {
  return localeInfo(langOf(code)).speech;
}

/** True when Intl writes this language's dates, times and lists (rather than the dictionary). */
export function usesIntlFormats(code) {
  return localeInfo(langOf(code)).formats === 'intl';
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

/**
 * The language a code or tag names, ready or not, or undefined: 'zh-CN', 'zh-Hant-HK',
 * 'hi-IN', 'te_IN', 'ar_EG.UTF-8' and 'ES' all find theirs. Only the language subtag counts.
 * For a choice made on purpose (?lang=, --lang, a saved profile).
 */
export function localeFromTag(tag) {
  const base = String(tag ?? '')
    .trim()
    .toLowerCase()
    .split(/[-_.@]/)[0];
  return isLocale(base) ? base : undefined;
}

/**
 * Pick the first ready language out of browser or OS language tags (navigator.languages,
 * Accept-Language), else English. A language that is still being translated is skipped, so a
 * browser set to it opens the app in a complete language instead of placeholder text.
 */
export function detectLocale(candidates) {
  for (const c of candidates || []) {
    const code = localeFromTag(c);
    if (code && isLocaleReady(code)) return code;
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

// ---------- Plurals ----------

/** The CLDR plural categories, in CLDR order. */
export const PLURAL_CATEGORIES = Object.freeze(['zero', 'one', 'two', 'few', 'many', 'other']);

const pluralRules = new Map();

function rulesFor(lang, minimumFractionDigits = 0) {
  const key = `${lang}|${minimumFractionDigits}`;
  if (!pluralRules.has(key)) {
    let rules = null;
    try {
      rules = new Intl.PluralRules(lang, { minimumFractionDigits });
    } catch {
      rules = null;
    }
    pluralRules.set(key, rules);
  }
  return pluralRules.get(key);
}

/** A count as a number, and how many decimals it was written with ('1.0' has one). */
function readCount(n) {
  if (typeof n === 'number') return { value: n, decimals: 0 };
  const text = String(n ?? '')
    .trim()
    .replace(/[\s,\u00a0\u202f\u2066-\u2069]/g, '');
  const m = /^[+-]?\d+(?:\.(\d+))?$/.exec(text);
  if (!m) return { value: NaN, decimals: 0 };
  return { value: Number(text), decimals: m[1] ? m[1].length : 0 };
}

/**
 * The plural category of a count in a language: pluralCategory(3, 'ar') is 'few'. A count
 * given as text keeps its visible decimals ('1.0' is 'other' in English).
 */
export function pluralCategory(n, locale) {
  const lang = langOf(locale);
  const { value, decimals } = readCount(n);
  if (!Number.isFinite(value)) return 'other';
  const rules = rulesFor(lang, Math.min(decimals, 20));
  if (rules) return rules.select(Math.abs(value));
  return Math.abs(value) === 1 && !decimals ? 'one' : 'other';
}

const categoryCache = new Map();

/**
 * The categories a language's plural rules produce for whole numbers (0 to 1000), in CLDR
 * order: Arabic zero, one, two, few, many, other; Hindi and Telugu one, other; Chinese other.
 * A plural object in that language must have each of these.
 */
export function pluralCategoriesFor(code) {
  const lang = isLocale(code) ? String(code) : 'en';
  if (!categoryCache.has(lang)) {
    const rules = rulesFor(lang);
    const seen = new Set(['other']);
    if (rules) for (let i = 0; i <= 1000; i += 1) seen.add(rules.select(i));
    else seen.add('one');
    categoryCache.set(lang, Object.freeze(PLURAL_CATEGORIES.filter((c) => seen.has(c))));
  }
  return categoryCache.get(lang);
}

/**
 * Categories that only one whole number reaches in a language (Arabic zero, one and two;
 * English one). A form for one of these may leave the number out ("يومان" is "two days").
 */
export function exactPluralCategories(code) {
  const lang = isLocale(code) ? String(code) : 'en';
  const rules = rulesFor(lang);
  if (!rules) return ['one'];
  const counts = new Map();
  for (let i = 0; i <= 1000; i += 1) {
    const c = rules.select(i);
    counts.set(c, (counts.get(c) || 0) + 1);
  }
  return PLURAL_CATEGORIES.filter((c) => counts.get(c) === 1);
}

/** True for a plural value: an object of strings keyed by plural categories, with `other`. */
export function isPluralForms(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const keys = Object.keys(value);
  return keys.length > 0 && typeof value.other === 'string' && keys.every((k) => PLURAL_CATEGORIES.includes(k) && typeof value[k] === 'string');
}

function chooseForm(forms, n, lang) {
  return forms[pluralCategory(n, lang)] ?? forms.other ?? '';
}

/** The count a plural message is about: params.n, else params.count. */
function countParam(params) {
  if (!params) return undefined;
  for (const k of ['n', 'count']) {
    const v = params[k];
    if (v !== undefined && v !== null && Number.isFinite(readCount(v).value)) return v;
  }
  return undefined;
}

let warn = null;

/**
 * Report misuse that t() survives but should not happen: a plural message given no number
 * to choose its form by. The web app logs these in development; tests collect them. Pass
 * null to stop.
 */
export function setI18nWarnings(fn) {
  warn = typeof fn === 'function' ? fn : null;
}

// ---------- Interpolation ----------

/** First strong isolate, right-to-left isolate, and pop directional isolate (Unicode bidi controls). */
export const FSI = '\u2068';
export const RLI = '\u2067';
export const PDI = '\u2069';
let isolating = true;

/**
 * Turn the isolates around {params} in right-to-left messages on or off. The CLI turns them
 * off: terminals print text in logical order and would show the controls as gaps.
 */
export function setBidiIsolation(on) {
  isolating = Boolean(on);
  return isolating;
}

/** Remove the isolates t() adds, for text that leaves the screen (a copied comment, a file). */
export function stripIsolates(text) {
  return String(text ?? '').replace(/[\u2066-\u2069]/g, '');
}

function lookup(dict, key) {
  let node = dict;
  for (const part of String(key).split('.')) {
    if (node == null || typeof node !== 'object' || !(part in node)) return undefined;
    node = node[part];
  }
  return node;
}

const ISOLATE_CONTROL = /[\u2066-\u2069]/;
const INNERMOST_ISOLATE = /[\u2066-\u2068][^\u2066-\u2069]*\u2069/g;

/** A value's text outside the isolates nested in it. */
function outsideIsolates(s) {
  let out = s;
  let prev;
  do {
    prev = out;
    out = out.replace(INNERMOST_ISOLATE, '');
  } while (out !== prev);
  return out;
}

/**
 * The isolate a value gets in a right-to-left message. Usually FSI: it takes its direction
 * from its first letter, so "Plano" or "7:00 PM" stays left to right and an Arabic phrase
 * right to left. A value that is itself a message made here, with nothing but punctuation
 * between its isolated parts (ui.dayTime's "{day}، {time}", day and time each isolated) gives FSI no letter
 * to go by (it skips nested isolates) and come out left to right, time first. It was written
 * in this right-to-left language, so it is isolated as right to left (RLI).
 */
function isolateFor(s) {
  return ISOLATE_CONTROL.test(s) && !/\p{L}/u.test(outsideIsolates(s)) ? RLI : FSI;
}

function interpolate(template, params, lang) {
  if (!params) return template;
  const isolate = isolating && localeInfo(lang).dir === 'rtl';
  return template.replace(/\{(\w+)\}/g, (m, k) => {
    const v = params[k];
    if (v === undefined || v === null) return m;
    const s = String(v);
    return isolate && s ? `${isolateFor(s)}${s}${PDI}` : s;
  });
}

/** Wrap one value in an isolate, in right-to-left languages only (list items, label and value). */
function isolated(s, lang) {
  return isolating && s && localeInfo(lang).dir === 'rtl' ? `${isolateFor(s)}${s}${PDI}` : s;
}

/** The value for a key in a language, falling back to English: { value, from }. */
function resolve(key, lang) {
  let value = lookup(DICTS[lang], key);
  if (value !== undefined) return { value, from: lang };
  value = lookup(en, key);
  return { value, from: 'en' };
}

/**
 * Translate a key. Strings are interpolated with {name} params; arrays and objects come back
 * as-is. A plural object always comes back as text: the form for the count in the params
 * ({n}, else {count}), or its `other` form when they carry no number. A translator may turn
 * any string that has {n} or {count} into plural forms, so a call that passes words there
 * ("9 posts") must still get a sentence back, never an object a page cannot render; it is
 * reported through setI18nWarnings so the call can be fixed.
 */
export function t(key, params, locale) {
  const lang = langOf(locale);
  const { value, from } = resolve(key, lang);
  if (value === undefined) return key;
  if (typeof value === 'string') return interpolate(value, params, lang);
  if (isPluralForms(value)) {
    const count = countParam(params);
    if (count !== undefined) return interpolate(chooseForm(value, count, from), params, lang);
    if (warn) warn(`t('${key}'): plural forms in ${from} need a number in {n} or {count}; showing the "other" form`);
    return interpolate(value.other, params, lang);
  }
  return value;
}

/** Plural-aware translate: the key resolves to a string with {n} or to plural forms. */
export function tn(key, n, params, locale) {
  const lang = langOf(locale);
  const { value, from } = resolve(key, lang);
  const merged = { n, ...(params || {}) };
  if (typeof value === 'string') return interpolate(value, merged, lang);
  if (isPluralForms(value)) return interpolate(chooseForm(value, n, from), merged, lang);
  if (value && typeof value === 'object' && typeof value.other === 'string') return interpolate(value.other, merged, lang);
  return String(key);
}

/** Translate a key that holds a list. */
export function tList(key, locale) {
  const v = t(key, undefined, locale);
  return Array.isArray(v) ? v : [];
}

const listFormats = new Map();

/**
 * Join a list the way the language does: "a, b, and c" from the dictionary in English,
 * Spanish and Vietnamese; Intl.ListFormat for the others ("A和B", "A وB"). In a right-to-left
 * language each item is isolated, so English names keep the list's order ("Plano، Dallas"
 * would otherwise run together left to right and read backwards).
 */
export function joinList(items, locale) {
  const lang = langOf(locale);
  const list = items
    .filter(Boolean)
    .map(String)
    .map((s) => isolated(s, lang));
  if (list.length <= 1) return list.join('');
  if (usesIntlFormats(lang) && typeof Intl.ListFormat === 'function') {
    const tag = intlLocale(lang);
    if (!listFormats.has(tag)) {
      try {
        listFormats.set(tag, new Intl.ListFormat(tag, { type: 'conjunction', style: 'long' }));
      } catch {
        listFormats.set(tag, null);
      }
    }
    const format = listFormats.get(tag);
    if (format) return format.format(list);
  }
  const and = t('format.and', undefined, lang);
  if (list.length === 2) return `${list[0]} ${and} ${list[1]}`;
  return `${list.slice(0, -1).join(t('format.sep', undefined, lang))} ${and} ${list[list.length - 1]}`;
}

/**
 * Items side by side without a conjunction ("Mon, Wed", "Plano, Dallas"), with the language's
 * separator (format.sep: ", " in English, "、" in Chinese, "، " in Arabic). Items are
 * isolated in right-to-left languages, as in joinList.
 */
export function joinItems(items, locale) {
  const lang = langOf(locale);
  return items
    .filter((x) => x !== undefined && x !== null && x !== '')
    .map((s) => isolated(String(s), lang))
    .join(t('format.sep', undefined, lang));
}

/** "When: Next 2 weeks", with the language's colon (format.labelValue: "{label}：{value}" in Chinese). */
export function labelValue(label, value, locale) {
  return t('format.labelValue', { label, value }, langOf(locale));
}

/** Marks that end a sentence in the languages the app speaks, Latin and otherwise. */
const SENTENCE_END = /[.!?\u2026\u3002\uff01\uff1f\u0964\u0965\u061f\u06d4][)"'\u201d\u2019\u00bb\uff09\u300d\u2069]*$/u;

/**
 * A phrase as a sentence: one closing mark, in the language's own (format.fullStop: "." in
 * English, "。" in Chinese, "।" in Hindi). Text that already ends a sentence, in any of those
 * scripts (even "4:00 p.m." or a closing quote), is left alone.
 */
export function asSentence(text, locale) {
  const s = String(text ?? '').trim();
  if (!s || SENTENCE_END.test(s)) return s;
  return `${s}${t('format.fullStop', undefined, langOf(locale))}`;
}

/**
 * Sentences one after another, each closed with asSentence. A space goes between them,
 * except after a full-width mark (。！？), which carries its own spacing. In a right-to-left
 * language each sentence is isolated, so an English one (a city's note not translated yet)
 * keeps its period at its own end.
 */
export function joinSentences(parts, locale) {
  const lang = langOf(locale);
  const sentences = parts.map((p) => asSentence(p, lang)).filter(Boolean);
  return sentences.reduce((out, s, i) => `${out}${i && !/[\u3002\uff01\uff1f]$/u.test(sentences[i - 1]) ? ' ' : ''}${isolated(s, lang)}`, '');
}

/**
 * Lowercase the first letter so a phrase can continue a sentence ("Rent, first apartments"
 * becomes "rent, first apartments"), unless the first word is an acronym or a mixed-case name
 * such as "DART" or "Wi-Fi", which must keep its capitals in every language. Scripts without
 * case (Chinese, Devanagari, Telugu, Arabic) are left as they are.
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
