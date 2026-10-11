/**
 * Text that works in every script the app speaks: words in languages written without spaces,
 * graphemes for initials, search that keeps the marks Devanagari, Telugu and Arabic need,
 * sorting by each language's own collation, and how fast each language is spoken.
 */
import { getLocale, intlLocale, isLocale } from './i18n/runtime.js';

function langOf(locale) {
  return locale && isLocale(locale) ? String(locale) : getLocale();
}

const segmenters = new Map();

/** A cached Intl.Segmenter, or null where the runtime has none (then callers fall back). */
function segmenter(lang, granularity) {
  const key = `${lang}|${granularity}`;
  if (!segmenters.has(key)) {
    let seg = null;
    try {
      if (typeof Intl.Segmenter === 'function') seg = new Intl.Segmenter(lang === 'zh' ? 'zh' : intlLocale(lang), { granularity });
    } catch {
      seg = null;
    }
    segmenters.set(key, seg);
  }
  return segmenters.get(key);
}

const HAN = /\p{Script=Han}/u;
const HAN_ALL = /\p{Script=Han}/gu;

/**
 * User-perceived characters: 'क्ष' and 'త్రి' are one each (Indic conjuncts), so is '👍🏽'.
 * Without Intl.Segmenter, a base character keeps the marks and joiners that follow it.
 */
export function graphemes(text) {
  const s = String(text ?? '');
  const seg = segmenter('en', 'grapheme');
  if (seg) return [...seg.segment(s)].map((x) => x.segment);
  return s.match(/\P{M}[\p{M}\u200c\u200d]*/gu) || [];
}

/** The first grapheme of a name, for an avatar initial: 'A', 'रा', 'శ్రీ', '李', 'أ'. */
export function firstGrapheme(text) {
  const s = String(text ?? '').trim();
  if (!s) return '';
  return graphemes(s)[0] || '';
}

/**
 * Word-like pieces of text. Intl.Segmenter finds words in Chinese, which has no spaces
 * ("我想请市议会" is 我想 | 请 | 市 | 议会); without it each Han character counts as a word.
 * Devanagari, Telugu and Arabic words keep their vowel signs and marks.
 */
export function wordsOf(text, locale) {
  const s = String(text ?? '');
  const seg = segmenter(langOf(locale), 'word');
  if (seg) return [...seg.segment(s)].filter((x) => x.isWordLike).map((x) => x.segment);
  return (s.match(/\p{Script=Han}|(?:(?!\p{Script=Han})[\p{L}\p{M}\p{N}\u200c\u200d'’])+/gu) || []).filter((w) => /[\p{L}\p{N}]/u.test(w));
}

/**
 * How each language is paced when spoken aloud, for timing a comment and coaching a take.
 *  - unit: what pace counts. Words, except Chinese, which is counted in characters per
 *    minute (each character is one syllable), the convention Chinese speaking guides use;
 *  - band: the steady range for a speech in a council chamber, in units per minute;
 *  - estimate: the rate used to time a written comment (a little under the middle of the band,
 *    so a comment that fits on paper also fits out loud);
 *  - syllables: syllables per unit, to estimate pace from the voice when there is no transcript;
 *  - longSentence: units after which a sentence is hard to follow when heard.
 * English, Spanish and Vietnamese come from the original coaching research. The others are
 * approximations from published speaking-rate figures: Mandarin speeches run about 180 to 240
 * characters a minute; Hindi, with many short function words, about 110 to 150 words; Telugu
 * and Arabic pack suffixes and clitics into long words, so fewer words carry the same
 * syllables (about 75 to 110 and 100 to 140). Adjust them here if better data turns up.
 */
export const SPEECH_PACE = Object.freeze({
  en: Object.freeze({ unit: 'word', band: Object.freeze([120, 160]), estimate: 130, syllables: 1.4, longSentence: 30 }),
  es: Object.freeze({ unit: 'word', band: Object.freeze([125, 170]), estimate: 140, syllables: 1.9, longSentence: 30 }),
  vi: Object.freeze({ unit: 'word', band: Object.freeze([140, 190]), estimate: 155, syllables: 1, longSentence: 35 }),
  zh: Object.freeze({ unit: 'character', band: Object.freeze([180, 240]), estimate: 200, syllables: 1, longSentence: 50 }),
  hi: Object.freeze({ unit: 'word', band: Object.freeze([110, 150]), estimate: 125, syllables: 1.9, longSentence: 30 }),
  te: Object.freeze({ unit: 'word', band: Object.freeze([75, 110]), estimate: 90, syllables: 3.2, longSentence: 20 }),
  ar: Object.freeze({ unit: 'word', band: Object.freeze([100, 140]), estimate: 115, syllables: 2.5, longSentence: 25 }),
});

/** The pace table entry for a language (English for any other). */
export function speechPace(locale) {
  return SPEECH_PACE[langOf(locale)] || SPEECH_PACE.en;
}

/**
 * Units of speech in a text, as speechPace() counts them: words, or for Chinese, Han
 * characters plus any other words in the text (an English name, a number).
 */
export function speechUnits(text, locale) {
  const lang = langOf(locale);
  const s = String(text ?? '');
  if (speechPace(lang).unit === 'character') {
    const han = (s.match(HAN_ALL) || []).length;
    const other = wordsOf(s.replace(HAN_ALL, ' '), 'en').length;
    return han + other;
  }
  if (lang === 'en' || lang === 'es' || lang === 'vi') return s.trim().split(/\s+/).filter(Boolean).length;
  return wordsOf(s, lang).length;
}

/** True when text contains Chinese characters (so words are not separated by spaces). */
export function hasHan(text) {
  return HAN.test(String(text ?? ''));
}

// ---------- Search ----------

const ARABIC_MARKS = /[\u0610-\u061a\u064b-\u065f\u0670\u06d6-\u06ed\u0640]/g;

/**
 * Fold text for search: case, Latin accents (é, ñ, ơ, đ) and width (Ｐｌａｎｏ) never stop a
 * match. The marks that are letters' vowels in Devanagari and Telugu stay, so "दिल्ली" does
 * not collapse into "दलल"; only the Hindi nukta and the moon-dot (chandrabindu, written both
 * ways) are folded. Arabic loses its optional vowel marks and tatweel, and its alef, hamza and
 * alef maqsura forms are unified (أ إ آ ٱ -> ا, ى -> ي), as Arabic search engines do.
 */
export function searchFold(text) {
  return String(text ?? '')
    .replace(/[\uff01-\uff5e]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0xfee0))
    .replace(/\u3000/g, ' ')
    .normalize('NFD')
    .replace(/([\p{Script=Latin}\p{Script=Greek}\p{Script=Cyrillic}])\p{M}+/gu, '$1')
    .replace(/[đĐ]/g, 'd')
    .replace(/\u093c/g, '')
    .replace(/\u0901/g, '\u0902')
    .replace(ARABIC_MARKS, '')
    .replace(/[\u0671\u0672\u0673\u0675]/g, '\u0627')
    .replace(/\u0649/g, '\u064a')
    .replace(/[\u200b-\u200f\u2066-\u2069]/g, '')
    .normalize('NFC')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

// ---------- Sorting ----------

const collators = new Map();

/** The language's collator (base letters, numbers in numeric order): Intl.Collator per locale. */
export function textCollator(locale) {
  const tag = intlLocale(langOf(locale));
  if (!collators.has(tag)) {
    let collator;
    try {
      collator = new Intl.Collator(tag, { sensitivity: 'base', numeric: true });
    } catch {
      collator = new Intl.Collator('en', { sensitivity: 'base', numeric: true });
    }
    collators.set(tag, collator);
  }
  return collators.get(tag);
}

/** Compare two strings the way the language sorts them. */
export function compareText(a, b, locale) {
  return textCollator(locale).compare(String(a ?? ''), String(b ?? ''));
}
