/**
 * Which way a piece of text runs, for the places where the page's own direction is not
 * enough: an English original on a right-to-left page, a post someone typed in another
 * script, a field while it is still empty.
 *
 * HTML's dir="auto" (and <bdi>) go by the first strong letter. That is wrong for the text
 * this app shows most: an Arabic sentence that starts with a city name kept in English
 * ("Plano: سجّل ...") would be laid out left to right, and an empty field is always left to
 * right in Chromium, so an Arabic placeholder hugs the wrong edge. These helpers decide
 * from the whole text instead. Pure, so the Node tests run them.
 */
import { localeDir } from '@agora/core';

/** Letters of the right-to-left scripts (Arabic, Hebrew, Syriac, Thaana, N'Ko, Adlam...). */
const RTL_LETTER = /[\p{Script=Arabic}\p{Script=Hebrew}\p{Script=Syriac}\p{Script=Thaana}\p{Script=Nko}\p{Script=Adlam}\p{Script=Samaritan}\p{Script=Mandaic}]/u;
const LETTER = /\p{L}/u;

/** Letters of each language's own script, for the languages not written in Latin letters. */
const OWN_SCRIPT = { zh: /\p{Script=Han}/u, hi: /\p{Script=Devanagari}/u, te: /\p{Script=Telugu}/u, ar: /\p{Script=Arabic}/u };

/**
 * The direction most of a text's letters take: 'rtl', 'ltr', or undefined when it has no
 * letters (digits and punctuation follow whatever is around them). A tie goes to 'rtl', since
 * a right-to-left text keeps more English names than the other way round.
 */
export function majorityDir(text) {
  let rtl = 0;
  let ltr = 0;
  for (const ch of String(text || '')) {
    if (RTL_LETTER.test(ch)) rtl += 1;
    else if (LETTER.test(ch)) ltr += 1;
  }
  if (!rtl && !ltr) return undefined;
  return rtl >= ltr ? 'rtl' : 'ltr';
}

/**
 * dir for a text field: nothing while it is empty or holds only digits, so the field, its
 * caret and its placeholder follow the page (an empty dir="auto" field is left to right in
 * Chromium, which put Arabic placeholders on the wrong edge); then the direction most of its
 * letters take, so English typed on an Arabic page runs left to right, and an Arabic comment
 * that starts with "Plano" still runs right to left (dir="auto" would have kept it left to
 * right for good).
 */
export function inputDir(value) {
  return majorityDir(value);
}

/**
 * True when text shown on a page in `lang` is still its English original: the language is
 * written in another script and the text has none of its letters but some Latin ones. City
 * data and team posts fall back to English until they are translated. In Spanish and
 * Vietnamese this cannot be told from the letters, and their translations are complete.
 */
export function isEnglishOriginal(text, lang) {
  const own = OWN_SCRIPT[lang];
  if (!own) return false;
  const s = String(text || '');
  return !own.test(s) && /\p{Script=Latin}/u.test(s);
}

/**
 * Attributes for text that came from elsewhere, shown on a page in `lang`: nothing when it is
 * in the page's language (it reads in the page's direction, even when it starts with an
 * English name); lang="en" and dir="ltr" for an English original on a page in another
 * language, so it reads, aligns and is pronounced as English.
 */
export function englishOriginalProps(english, lang) {
  if (!english || lang === 'en') return {};
  return localeDir(lang) === 'rtl' ? { lang: 'en', dir: 'ltr' } : { lang: 'en' };
}

/**
 * Attributes for a community post's title and body. A team post translated into the page's
 * language reads in the page's direction; a team post still in English is an English island;
 * a post someone wrote here, in a language the app cannot know, runs the way most of its
 * letters do, as one block, so a title that starts with "Plano:" and a body in Arabic stay
 * together on the right.
 */
export function postTextProps(post, lang) {
  if (!post) return {};
  if (post.team) return englishOriginalProps(post.textLang !== lang, lang);
  const dir = majorityDir(`${post.title || ''}\n${post.body || ''}`);
  return dir && dir !== localeDir(lang) ? { dir } : {};
}
