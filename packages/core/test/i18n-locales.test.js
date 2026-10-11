/**
 * The four languages added after English, Spanish and Vietnamese (Chinese, Hindi, Telugu,
 * Arabic): registration, detection (only of languages marked ready), CLDR plurals through
 * Intl.PluralRules, plural-aware t() that always returns text, and the bidi isolates that keep
 * values in place in Arabic sentences, nested messages included.
 */
import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import {
  DICTIONARIES,
  FSI,
  LOCALES,
  PDI,
  RLI,
  asSentence,
  detectLocale,
  isLocaleReady,
  joinItems,
  joinRun,
  joinSentences,
  labelValue,
  sentenceGap,
  textAround,
  localeFromTag,
  offeredLocales,
  setI18nWarnings,
  exactPluralCategories,
  htmlLang,
  intlLocale,
  isLocale,
  isPluralForms,
  isRtl,
  joinList,
  localeDir,
  localeInfo,
  pluralCategoriesFor,
  pluralCategory,
  setBidiIsolation,
  setLocale,
  speechLang,
  stripIsolates,
  t,
  tn,
  usesIntlFormats,
} from '../src/i18n/index.js';

afterEach(() => {
  setLocale('en');
  setBidiIsolation(true);
  setI18nWarnings(null);
});

/** Run fn with dictionary values temporarily replaced, then put them back. */
function withEntries(code, entries, fn) {
  const saved = [];
  for (const [path, value] of Object.entries(entries)) {
    const parts = path.split('.');
    const last = parts.pop();
    const parent = parts.reduce((o, k) => o[k], DICTIONARIES[code]);
    saved.push([parent, last, parent[last]]);
    parent[last] = value;
  }
  try {
    return fn();
  } finally {
    for (const [parent, key, value] of saved) parent[key] = value;
  }
}

test('the menu lists seven languages in their own names, in order', () => {
  assert.deepEqual(
    LOCALES.map((l) => [l.code, l.nativeName]),
    [
      ['en', 'English'],
      ['es', 'Español'],
      ['vi', 'Tiếng Việt'],
      ['zh', '中文'],
      ['hi', 'हिन्दी'],
      ['te', 'తెలుగు'],
      ['ar', 'العربية'],
    ],
  );
  assert.equal(htmlLang('zh'), 'zh-Hans', 'Simplified Chinese is tagged zh-Hans');
  assert.equal(localeDir('ar'), 'rtl');
  assert.equal(isRtl('ar'), true);
  for (const code of ['en', 'es', 'vi', 'zh', 'hi', 'te']) assert.equal(localeDir(code), 'ltr', code);
  assert.deepEqual(['zh', 'hi', 'te', 'ar'].map(speechLang), ['zh-CN', 'hi-IN', 'te-IN', 'ar-SA']);
  for (const code of ['zh', 'hi', 'te', 'ar']) {
    assert.match(intlLocale(code), /-u-(?:.*-)?nu-latn$/, `${code} asks Intl for Latin digits`);
    assert.equal(usesIntlFormats(code), true);
    assert.ok(DICTIONARIES[code], `${code} is registered in Node`);
  }
  for (const code of ['en', 'es', 'vi']) assert.equal(usesIntlFormats(code), false);
  assert.equal(localeInfo('xx').code, 'en', 'an unknown code reads as English');
});

test('device and browser tags find the new languages', () => {
  // A tag names its language, ready or not (a choice made on purpose: ?lang=, --lang).
  assert.equal(localeFromTag('zh-TW'), 'zh', 'Traditional Chinese readers get Simplified Chinese');
  assert.equal(localeFromTag('zh-Hant-HK'), 'zh');
  assert.equal(localeFromTag('zh_CN'), 'zh');
  assert.equal(localeFromTag('hi-IN'), 'hi');
  assert.equal(localeFromTag('te_IN.UTF-8'), 'te');
  assert.equal(localeFromTag('ar-EG'), 'ar');
  assert.equal(localeFromTag('AR'), 'ar');
  assert.equal(localeFromTag('de-DE'), undefined);
  assert.equal(isLocale('ar'), true);
  assert.equal(isLocale('zh-Hans'), false, 'codes, not tags');
  // Detection (browser languages, Accept-Language) only lands on a language that is ready, so
  // nobody is sent to placeholder text; until then the next listed language, or English, wins.
  for (const l of LOCALES) {
    assert.equal(detectLocale([l.tag]), l.ready ? l.code : 'en', l.code);
    assert.equal(detectLocale([`${l.code}-XX`, 'es']), l.ready ? l.code : 'es', l.code);
  }
  assert.equal(detectLocale(['de-DE', 'fr']), 'en');
});

test('only finished languages are offered, plus the one in use', () => {
  const ready = LOCALES.filter((l) => l.ready).map((l) => l.code);
  assert.ok(['en', 'es', 'vi'].every((c) => ready.includes(c)), 'English, Spanish and Vietnamese are complete');
  for (const l of LOCALES) assert.equal(isLocaleReady(l.code), l.ready);
  assert.deepEqual(offeredLocales('en').map((l) => l.code), ready);
  const unready = LOCALES.find((l) => !l.ready);
  if (unready) {
    // Picked on purpose (a saved profile, ?lang=): the menu still shows what is on screen.
    assert.deepEqual(offeredLocales(unready.code).map((l) => l.code), LOCALES.filter((l) => l.ready || l.code === unready.code).map((l) => l.code));
  }
  assert.equal(isLocaleReady('xx'), false);
});

test('plural categories come from Intl.PluralRules for each language', () => {
  assert.deepEqual(pluralCategoriesFor('ar'), ['zero', 'one', 'two', 'few', 'many', 'other']);
  assert.deepEqual(pluralCategoriesFor('hi'), ['one', 'other']);
  assert.deepEqual(pluralCategoriesFor('te'), ['one', 'other']);
  assert.deepEqual(pluralCategoriesFor('zh'), ['other']);
  assert.deepEqual(pluralCategoriesFor('en'), ['one', 'other']);
  const ar = [0, 1, 2, 3, 10, 11, 99, 100, 101, 102, 103].map((n) => pluralCategory(n, 'ar'));
  assert.deepEqual(ar, ['zero', 'one', 'two', 'few', 'few', 'many', 'many', 'other', 'other', 'other', 'few']);
  assert.equal(pluralCategory(1.5, 'ar'), 'other');
  assert.equal(pluralCategory(0, 'hi'), 'one', 'Hindi says 0 in the singular');
  assert.equal(pluralCategory(0, 'te'), 'other');
  assert.equal(pluralCategory(1, 'zh'), 'other');
  assert.equal(pluralCategory('1.0', 'en'), 'other', 'visible decimals count: "1.0 miles"');
  assert.equal(pluralCategory('1', 'en'), 'one');
  assert.deepEqual(exactPluralCategories('ar'), ['zero', 'one', 'two']);
  assert.deepEqual(exactPluralCategories('hi'), [], 'Hindi "one" covers 0 and 1');
});

test('tn() and t() pick Arabic plural forms, falling back to other', () => {
  const forms = { zero: 'لا دقائق', one: 'دقيقة واحدة', two: 'دقيقتان', few: '{n} دقائق', many: '{n} دقيقة', other: '{n} دقيقة' };
  withEntries('ar', { 'common.minutes': forms }, () => {
    setBidiIsolation(false);
    assert.equal(tn('common.minutes', 0, undefined, 'ar'), 'لا دقائق');
    assert.equal(tn('common.minutes', 1, undefined, 'ar'), 'دقيقة واحدة');
    assert.equal(tn('common.minutes', 2, undefined, 'ar'), 'دقيقتان');
    assert.equal(tn('common.minutes', 3, undefined, 'ar'), '3 دقائق');
    assert.equal(tn('common.minutes', 11, undefined, 'ar'), '11 دقيقة');
    assert.equal(tn('common.minutes', 100, undefined, 'ar'), '100 دقيقة');
    // t() with the count in its params picks the same form.
    assert.equal(t('common.minutes', { n: 2 }, 'ar'), 'دقيقتان');
  });
  withEntries('ar', { 'common.minutes': { one: 'x', other: '{n} y' } }, () => {
    setBidiIsolation(false);
    assert.equal(tn('common.minutes', 5, undefined, 'ar'), '5 y', 'a missing category falls back to other');
  });
  // A key missing in Arabic falls back to English forms, chosen by English rules.
  withEntries('ar', { 'common.minutes': undefined }, () => {
    setBidiIsolation(false);
    assert.equal(tn('common.minutes', 1, undefined, 'ar'), '1 minute');
  });
  assert.equal(t('common.minutes', { n: 3 }, 'en'), '3 minutes');
});

test('t() never returns plural forms: without a number it shows "other" and says so', () => {
  const warnings = [];
  setI18nWarnings((m) => warnings.push(m));
  // What a translator may do to any string with {count}: make it plural forms. A call that
  // passes words there ("9 posts") must still get a sentence a page can render.
  const forms = { zero: '{count} z', one: '{count} o', two: '{count} t', few: '{count} f', many: '{count} m', other: '{count}، {city} أولًا' };
  withEntries('ar', { 'community.countFirst': forms }, () => {
    setBidiIsolation(false);
    const out = t('community.countFirst', { count: '9 posts', city: 'Plano' }, 'ar');
    assert.equal(typeof out, 'string');
    assert.equal(out, '9 posts، Plano أولًا');
  });
  assert.equal(t('common.minutes', undefined, 'en'), '{n} minutes', 'no params: the other form, uninterpolated');
  assert.equal(isPluralForms(t('common.minutes', undefined, 'en')), false);
  assert.equal(warnings.length, 3);
  assert.match(warnings[0], /community\.countFirst/);
  // A count written as text still picks its form (isolated digits, "1,234"), with no warning.
  assert.equal(t('common.minutes', { n: `${FSI}1${PDI}` }, 'en'), `${FSI}1${PDI} minute`);
  assert.equal(t('common.minutes', { n: '1,234' }, 'en'), '1,234 minutes');
  assert.equal(warnings.length, 3);
});

test('a string that counts can become plural forms in a language that needs them', () => {
  withEntries('ar', { 'common.showAll': { zero: 'لا شيء', one: 'عرض العنصر', two: 'عرض العنصرين', few: 'عرض ال\u0640{n}', many: 'عرض ال\u0640{n}', other: 'عرض ال\u0640{n}' } }, () => {
    setBidiIsolation(false);
    assert.equal(t('common.showAll', { n: 2 }, 'ar'), 'عرض العنصرين');
    assert.equal(t('common.showAll', { n: 7 }, 'ar'), 'عرض ال\u06407');
    assert.equal(tn('common.showAll', 1, undefined, 'ar'), 'عرض العنصر');
  });
  assert.equal(t('common.showAll', { n: 7 }, 'en'), 'Show all 7', 'English stays a plain string');
  // {count} drives the form when there is no {n}.
  withEntries('ar', { 'rehearse.findings.repeats.title': { zero: 'z', one: 'o', two: 't', few: 'قلت "{word}" {count} مرات', many: 'قلت "{word}" {count} مرة', other: 'x' } }, () => {
    setBidiIsolation(false);
    assert.equal(t('rehearse.findings.repeats.title', { word: 'يعني', count: 4 }, 'ar'), 'قلت "يعني" 4 مرات');
  });
});

test('Arabic sentences isolate every value; other languages do not', () => {
  assert.equal(t('city.councilTitle', { city: 'Plano' }, 'ar'), `مجلس مدينة ${FSI}Plano${PDI}`);
  assert.equal(t('city.councilTitle', { city: 'Plano' }, 'en'), 'Plano City Council');
  assert.equal(t('city.councilTitle', { city: 'Plano' }, 'hi'), 'Plano सिटी काउंसिल', 'left to right languages get no isolates');
  assert.equal(stripIsolates(t('city.councilTitle', { city: 'Plano' }, 'ar')), 'مجلس مدينة Plano');
  setBidiIsolation(false);
  assert.equal(t('city.councilTitle', { city: 'Plano' }, 'ar'), 'مجلس مدينة Plano', 'the CLI turns isolates off');
});

test('lists join the way each new language does (Intl.ListFormat)', () => {
  assert.equal(joinList(['A', 'B'], 'zh'), 'A和B');
  assert.equal(joinList(['A', 'B', 'C'], 'zh'), 'A、B和C');
  assert.equal(stripIsolates(joinList(['A', 'B'], 'ar')), 'A وB', 'the Arabic "and" joins the next word');
  assert.equal(joinList(['A', 'B'], 'hi'), 'A और B');
  assert.equal(joinList(['A', 'B'], 'te'), 'A మరియు B');
  assert.equal(joinList(['a', 'b', 'c'], 'en'), 'a, b and c', 'English keeps its dictionary wording');
  assert.equal(stripIsolates(joinList(['solo'], 'ar')), 'solo');
  // In Arabic each item is isolated, so English names keep the list's right-to-left order.
  assert.equal(joinList(['Plano', 'Dallas'], 'ar'), `${FSI}Plano${PDI} و${FSI}Dallas${PDI}`);
  setBidiIsolation(false);
  assert.equal(joinList(['Plano', 'Dallas'], 'ar'), 'Plano وDallas', 'not in the CLI');
});

test("items, labels and sentences use the language's own punctuation", () => {
  assert.equal(joinItems(['Mon', '', 'Wed', null], 'en'), 'Mon, Wed');
  assert.equal(labelValue('When', 'Next 2 weeks', 'en'), 'When: Next 2 weeks');
  withEntries('zh', { 'format.sep': '、', 'format.labelValue': '{label}：{value}', 'format.fullStop': '。' }, () => {
    assert.equal(joinItems(['周一', '周三'], 'zh'), '周一、周三');
    assert.equal(labelValue('时间', '两周内', 'zh'), '时间：两周内');
    assert.equal(asSentence('报名截止', 'zh'), '报名截止。');
    assert.equal(joinSentences(['公园', '不在议程上', '支持'], 'zh'), '公园。不在议程上。支持。', 'no space after a full-width mark');
  });
  withEntries('hi', { 'format.fullStop': '।' }, () => {
    assert.equal(asSentence('पंजीकरण बंद', 'hi'), 'पंजीकरण बंद।');
    assert.equal(asSentence('पंजीकरण बंद।', 'hi'), 'पंजीकरण बंद।', 'never a second mark');
  });
  assert.equal(asSentence('4:00 p.m.', 'es'), '4:00 p.m.');
  assert.equal(asSentence('¿Por qué?', 'es'), '¿Por qué?');
  assert.equal(asSentence('هل يمكنني التحدث؟', 'ar'), 'هل يمكنني التحدث؟');
  assert.equal(asSentence('Yes, for 3 minutes', 'en'), 'Yes, for 3 minutes.');
  assert.equal(asSentence(`Sign up by ${FSI}4:00 p.m.${PDI}`, 'en'), `Sign up by ${FSI}4:00 p.m.${PDI}`, 'a closing isolate after the mark');
  assert.equal(joinSentences(['One', 'Two.'], 'en'), 'One. Two.');
  // Arabic isolates list items, label and value, and each sentence: an English note keeps
  // its period at its own end inside an Arabic paragraph.
  assert.equal(joinSentences(['ألغي الاجتماع', 'Moved to Tuesday'], 'ar'), `${FSI}ألغي الاجتماع.${PDI} ${FSI}Moved to Tuesday.${PDI}`);
  assert.equal(joinItems(['Plano', 'Dallas'], 'ar'), `${FSI}Plano${PDI}، ${FSI}Dallas${PDI}`, 'the Arabic comma');
  assert.equal(labelValue('Sort', 'Soonest', 'ar'), `${FSI}Sort${PDI}: ${FSI}Soonest${PDI}`);
  // The shipped dictionaries carry each language's own marks.
  assert.equal(joinItems(['周一', '周三'], 'zh'), '周一、周三');
  assert.equal(labelValue('时间', '两周内', 'zh'), '时间：两周内');
  assert.equal(asSentence('पंजीकरण बंद', 'hi'), 'पंजीकरण बंद।');
  assert.equal(joinSentences(['报名截止', '现场不接受报名'], 'zh'), '报名截止。现场不接受报名。');
});

test('pieces of running text take no space after a full-width mark, and templates split around a value', () => {
  assert.equal(sentenceGap("Can't go?"), ' ');
  assert.equal(sentenceGap('去不了？'), '', 'a full-width question mark carries its own space');
  assert.equal(sentenceGap('报名：'), '');
  assert.equal(sentenceGap(`请在${FSI}16:00${PDI}前报名。${PDI}`), '', 'isolates after the mark do not count');
  assert.equal(sentenceGap('主题', '（选填）'), '', 'nor before a full-width bracket');
  assert.equal(sentenceGap('Topics', '(optional)'), ' ');
  assert.equal(sentenceGap('पंजीकरण बंद।'), ' ', 'Hindi puts a space after its danda');
  assert.equal(sentenceGap('He said “yes”'), ' ', 'curly quotes are not full width');
  assert.equal(joinRun('去不了？', '改用邮件发给 Plano'), '去不了？改用邮件发给 Plano');
  assert.equal(joinRun('One.', 'Two.'), 'One. Two.');
  assert.equal(joinRun('', 'Two.'), 'Two.');
  assert.equal(joinRun('One.', undefined), 'One.');
  assert.equal(joinSentences(['请在会议当天16:00前报名', '现场不接受报名'], 'zh'), '请在会议当天16:00前报名。现场不接受报名。');
  // A template split around the value a page renders itself (a date in bold, a visible time).
  assert.deepEqual(textAround('ui.dateTime', 'time', { date: 'Mon, Oct 12' }, 'en'), ['Mon, Oct 12, ', '']);
  assert.deepEqual(textAround('ui.dateTime', 'date', { time: '7:00 PM' }, 'en'), ['', ', 7:00 PM']);
  assert.deepEqual(textAround('ui.dateTime', 'date', { time: '19:00' }, 'zh'), ['', ' 19:00']);
  assert.deepEqual(textAround('ui.dateTime', 'time', { date: 'الاثنين' }, 'ar'), [`${FSI}الاثنين${PDI}، `, ''], 'no isolate left open at the split');
  assert.deepEqual(textAround('nav.home', 'x', {}, 'en'), ['Home', ''], 'a template without the param stays whole');
});

test('a message inside an Arabic message keeps its right-to-left order', () => {
  // ui.dayTime only joins two isolated values with punctuation ("{day}، {time}"). FSI would
  // skip both nested isolates, find no letter, and lay the pair out left to right, time first
  // (checked in Chrome). Such a value is isolated as right to left instead.
  withEntries('ar', { 'ui.dayTime': '{day}، {time}', 'ui.signupCloses': 'يغلق التسجيل {when}' }, () => {
    const when = t('ui.dayTime', { day: 'الاثنين', time: '4:00 م' }, 'ar');
    assert.equal(when, `${FSI}الاثنين${PDI}، ${FSI}4:00 م${PDI}`);
    assert.equal(t('ui.signupCloses', { when }, 'ar'), `يغلق التسجيل ${RLI}${when}${PDI}`);
  });
  // The shipped Arabic dictionary does the same.
  const shipped = t('ui.dayTime', { day: 'الاثنين', time: '4:00 م' }, 'ar');
  assert.equal(shipped, `${FSI}الاثنين${PDI}، ${FSI}4:00 م${PDI}`);
  assert.ok(t('ui.signupCloses', { when: shipped }, 'ar').includes(`${RLI}${shipped}${PDI}`));
  // The same with a Latin-comma template, as an untranslated placeholder would have it.
  withEntries('ar', { 'ui.dayTime': '{day}, {time}' }, () => {
    const placeholder = t('ui.dayTime', { day: 'Mon', time: '4:00 PM' }, 'ar');
    assert.ok(t('ui.signupCloses', { when: placeholder }, 'ar').includes(`${RLI}${placeholder}${PDI}`));
  });
  // A nested message with words of its own goes by its first letter, as before: an English
  // placeholder sentence stays left to right, an Arabic one right to left.
  withEntries('ar', { 'city.councilTitle': '{city} City Council' }, () => {
    const english = t('city.councilTitle', { city: 'Plano' }, 'ar');
    assert.ok(t('prepare.meetingLine', { council: english, when: 'x' }, 'ar').startsWith(`${FSI}${english}${PDI}`));
  });
  const arabic = t('city.councilTitle', { city: 'Plano' }, 'ar');
  assert.ok(t('prepare.meetingLine', { council: arabic, when: 'x' }, 'ar').startsWith(`${FSI}${arabic}${PDI}`));
  // Plain values keep FSI; other languages get nothing.
  assert.equal(t('city.councilTitle', { city: '7:00' }, 'ar'), `مجلس مدينة ${FSI}7:00${PDI}`);
  assert.equal(t('ui.signupCloses', { when: 'Mon, 4:00 PM' }, 'en'), 'Sign-up closes Mon, 4:00 PM');
  assert.equal(stripIsolates(`${RLI}a${PDI}`), 'a', 'every isolate comes out of text that leaves the screen');
});
