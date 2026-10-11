/**
 * Pieces of the web app that a finished translation must not break: sentences built from
 * counts (any {n} or {count} may become plural forms), text direction decided from the whole
 * text rather than its first letter, the community feed line, and coaching sentences that
 * count two things at once.
 */
import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { DICTIONARIES, FSI, PDI, isPluralForms, pluralCategoriesFor, setBidiIsolation, setI18nWarnings, setLocale, stripIsolates, t } from '@agora/core';
import { feedCountText, localizePost, normalizePost } from '../src/lib/community.js';
import { englishOriginalProps, inputDir, isEnglishOriginal, majorityDir, postTextProps } from '../src/lib/textDir.js';
import { buildFindings } from '../src/lib/rehearse/coach.js';
import { coachParams } from '../src/lib/rehearse/format.js';
import { topicsSummary } from '../src/lib/setupSummary.js';

const COUNT = /\{(?:n|count)\}/;

/**
 * Run fn with every counting string of a language turned into plural forms (each form the
 * English text with its category in front), the way scripts/i18n-todo.mjs offers them and
 * i18n-apply.mjs writes them back.
 */
function withPluralForms(code, fn) {
  const saved = [];
  const forms = pluralCategoriesFor(code);
  const walk = (en, mine) => {
    for (const [k, v] of Object.entries(en)) {
      // The language's own value may already be plural forms (every finished language has
      // some); it is replaced the same way, so each form is tagged with its category.
      if (typeof v === 'string' && COUNT.test(v) && (typeof mine[k] === 'string' || isPluralForms(mine[k]))) {
        saved.push([mine, k, mine[k]]);
        mine[k] = Object.fromEntries(forms.map((c) => [c, `[${c}] ${v}`]));
      } else if (v && typeof v === 'object' && !Array.isArray(v) && !isPluralForms(v) && mine[k] && typeof mine[k] === 'object') walk(v, mine[k]);
    }
  };
  walk(DICTIONARIES.en, DICTIONARIES[code]);
  try {
    return fn();
  } finally {
    for (const [obj, k, v] of saved.reverse()) obj[k] = v;
  }
}

afterEach(() => {
  setLocale('en');
  setBidiIsolation(true);
  setI18nWarnings(null);
});

test('the community feed line is a sentence in every language, with every count in plural forms', () => {
  const warnings = [];
  setI18nWarnings((m) => warnings.push(m));
  const plano = { name: 'Plano' };
  const dallas = { name: 'Dallas' };
  for (const code of ['ar', 'hi', 'te', 'zh']) {
    withPluralForms(code, () => {
      setLocale(code);
      for (const out of [feedCountText(9, { firstCity: plano }), feedCountText(1, { firstCity: plano }), feedCountText(3, { filterCity: dallas, firstCity: plano }), feedCountText(0)]) {
        // React renders only text: plural forms coming back as an object took the page down.
        assert.equal(typeof out, 'string', code);
        assert.doesNotMatch(out, /\{\w+\}/, `${code}: ${out}`);
      }
      assert.match(stripIsolates(feedCountText(9, { firstCity: plano })), /9/);
    });
  }
  assert.deepEqual(warnings, [], 'no plural message was given words instead of a number');
  setLocale('en');
  assert.equal(feedCountText(9, { firstCity: plano }), '9 posts, Plano first');
  assert.equal(feedCountText(1, { firstCity: plano }), '1 post', 'one post needs no order');
  assert.equal(feedCountText(3, { filterCity: dallas, firstCity: plano }), '3 posts about Dallas');
});

test('coaching sentences that count two things agree with both numbers', () => {
  // Each entry as the coach makes it (lib/rehearse/coach.js), plus everything it makes for one run.
  const entries = [
    { id: 'long_pauses', params: { n: 4, sec: 1.5 } },
    { id: 'long_sentences', params: { n: 3, max: 30 } },
    { id: 'pace_fast', params: { n: 200, hi: 160 } },
    { id: 'pace_slow', params: { n: 90, lo: 110 } },
    { id: 'repeats', params: { word: 'um', count: 7 } },
    { id: 'few_fillers', params: { total: 2, words: 120 }, strength: true },
    { id: 'pace_good', params: { n: 140 }, strength: true },
  ];
  const envelope = { speakingSec: 60, firstSpeechSec: 0, lastSpeechSec: 60, pauses: [], longPauses: 4, loudness: { mean: 0.1, cv: 0.1, trailOff: 0 }, phrases: 10 };
  const speech = { words: 120, wpm: 200, fillerRate: 1, fillers: [{ word: 'um', count: 2 }], fillerTotal: 2, repeats: [], longSentences: 3, longSentenceAt: 30, script: null, elements: {} };
  const coach = buildFindings({ speech, envelope, pitch: { enough: true, monotone: true, stdSemitones: 1.2 }, body: null, seconds: 60, limitSec: 180, wpm: 200, lang: 'en' });
  entries.push(...coach.findings, ...coach.strengths.map((x) => ({ ...x, strength: true })));
  const render = (code) =>
    entries.flatMap((f) => {
      const p = coachParams(f.params, code);
      return f.strength ? [t(`rehearse.strengths.${f.id}`, p, code)] : ['title', 'detail', 'drill'].map((part) => t(`rehearse.findings.${f.id}.${part}`, p, code));
    });
  const english = render('en').join('\n');
  assert.match(english, /4 pauses longer than 1\.5 seconds/);
  assert.match(english, /3 sentences ran past 30 words/);
  assert.match(english, /You spoke at 200 words a minute/);
  assert.match(english, /Few filler words: 2 in 120 words\./);
  assert.match(english, /Steady pace: 140 words a minute\./);
  // Each language writes the decimal its own way inside the phrase (Vietnamese "1,5").
  assert.match(t('rehearse.findings.long_pauses.title', coachParams({ n: 4, sec: 1.5 }, 'vi'), 'vi'), /^4 lần ngừng lâu hơn 1,5 giây$/);
  assert.match(t('rehearse.findings.long_pauses.title', coachParams({ n: 4, sec: 1.5 }, 'es'), 'es'), /^4 pausas de más de 1\.5 segundos$/);
  const warnings = [];
  setI18nWarnings((m) => warnings.push(m));
  for (const code of ['ar', 'hi', 'te']) {
    withPluralForms(code, () => {
      for (const s of render(code)) {
        assert.equal(typeof s, 'string');
        assert.doesNotMatch(s, /\{\w+\}/, `${code}: ${s}`);
      }
    });
  }
  assert.deepEqual(warnings, []);
  // The second number is its own phrase with its own plural entry, so its noun agrees with it:
  // in Arabic the sentence takes "few" from 3 sentences and the phrase "many" from 30 words.
  withPluralForms('ar', () => {
    const shipped = DICTIONARIES.ar.rehearse.wordsN;
    DICTIONARIES.ar.rehearse.wordsN = { zero: 'z', one: 'o', two: 't', few: 'f', many: '[many] {n} words', other: 'x' };
    try {
      assert.equal(stripIsolates(t('rehearse.findings.long_sentences.title', coachParams({ n: 3, max: 30 }, 'ar'), 'ar')), '[few] 3 sentences ran past [many] 30 words');
    } finally {
      DICTIONARIES.ar.rehearse.wordsN = shipped;
    }
  });
  // The shipped Arabic does the same: "3 جمل" (few) and "30 كلمة" (many).
  assert.equal(stripIsolates(t('rehearse.findings.long_sentences.title', coachParams({ n: 3, max: 30 }, 'ar'), 'ar')), '3 جمل تجاوز طولها 30 كلمة');
});

test('text direction comes from the whole text, not its first letter', () => {
  assert.equal(majorityDir('Plano: سجّل عبر الإنترنت قبل الساعة 4 م يوم الاجتماع'), 'rtl', 'Arabic that starts with a city name');
  assert.equal(majorityDir('Plano City Council approves a budget, يعني'), 'ltr');
  assert.equal(majorityDir('4:00 — 12'), undefined, 'no letters, no opinion');
  assert.equal(majorityDir('中文'), 'ltr');
  // An empty field follows the page (its placeholder and caret on the right in Arabic); typed
  // text runs the way most of its letters do.
  assert.equal(inputDir(''), undefined);
  assert.equal(inputDir('  42 '), undefined);
  assert.equal(inputDir('أحمد'), 'rtl');
  assert.equal(inputDir('Ana'), 'ltr');
  assert.equal(inputDir('Plano: الحدائق مهمة لنا'), 'rtl', 'an Arabic comment that starts with a city name');
  // An English original on a page in another script; translations are not.
  assert.equal(isEnglishOriginal('Sign up online by 4 p.m.', 'ar'), true);
  assert.equal(isEnglishOriginal('eComment سجّل قبل الاجتماع', 'ar'), false, 'translated text that starts with a form name');
  assert.equal(isEnglishOriginal('Sign up online by 4 p.m.', 'es'), false, 'Latin-script languages are complete');
  assert.equal(isEnglishOriginal('12:00', 'zh'), false);
  assert.deepEqual(englishOriginalProps(true, 'ar'), { lang: 'en', dir: 'ltr' });
  assert.deepEqual(englishOriginalProps(true, 'zh'), { lang: 'en' });
  assert.deepEqual(englishOriginalProps(true, 'en'), {});
  assert.deepEqual(englishOriginalProps(false, 'ar'), {});
});

test('a community post reads as one block in its own language', () => {
  const team = normalizePost({ id: 'team-x', team: true, kind: 'tip', title: 'Plano: sign up online', body: 'Plano does not take sign-ups at the door.', cityId: 'plano', postedAt: '2026-10-10', i18n: { ar: { title: 'Plano: سجّل عبر الإنترنت', body: 'Plano لا تسمح بالتسجيل عند الباب.' } } });
  const ar = localizePost(team, 'ar');
  assert.equal(ar.textLang, 'ar');
  assert.deepEqual(postTextProps(ar, 'ar'), {}, 'translated: the page direction, though it starts with "Plano:"');
  const hi = localizePost(team, 'hi');
  assert.equal(hi.textLang, 'en');
  assert.deepEqual(postTextProps(hi, 'hi'), { lang: 'en' }, 'not translated yet: an English island');
  assert.deepEqual(postTextProps(localizePost(team, 'ar'), 'en'), {}, 'English page');
  assert.deepEqual(postTextProps({ ...localizePost(team, 'zh') }, 'ar'), { lang: 'en', dir: 'ltr' });
  // A post someone wrote here goes by most of its letters.
  const mine = normalizePost({ id: 'local-1', local: true, kind: 'tip', title: 'Plano: نصيحة', body: 'سجّل قبل الاجتماع بيوم.', postedAt: '2026-10-10' });
  assert.deepEqual(postTextProps(mine, 'en'), { dir: 'rtl' });
  assert.deepEqual(postTextProps(mine, 'ar'), {});
  const english = normalizePost({ id: 'local-2', local: true, kind: 'tip', title: 'A tip', body: 'Sign up early.', postedAt: '2026-10-10' });
  assert.deepEqual(postTextProps(english, 'ar'), { dir: 'ltr' });
});

test('lists inside Arabic sentences keep their order', () => {
  setLocale('ar');
  const out = topicsSummary({ interests: ['parks-recreation', 'transit', 'youth', 'environment', 'housing'] });
  assert.ok(out.includes(FSI) && out.includes(PDI), 'each item isolated');
  setLocale('en');
  assert.doesNotMatch(topicsSummary({ interests: ['parks-recreation', 'transit', 'youth', 'environment', 'housing'] }), /[\u2066-\u2069]/);
});
