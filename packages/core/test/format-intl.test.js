/**
 * Dates, times, numbers, distances, relative days and recurrence text in Chinese, Hindi,
 * Telugu and Arabic: Intl with each language's locale and Latin digits, and the dictionary
 * templates that put the words in each language's order. Expected Intl strings are computed
 * with Intl itself, so the tests follow the runtime's CLDR data instead of freezing one version.
 */
import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { DICTIONARIES, intlLocale, setBidiIsolation, setLocale, tList } from '../src/i18n/index.js';
import {
  describeRecurrence,
  formatDate,
  formatMiles,
  formatMonthDay,
  formatNumber,
  formatTime,
  milesText,
  monthNames,
  ordinalWord,
  monthShortNames,
  relativeDays,
  usesDayPeriods,
  weekdayName,
  weekdayNames,
  weekdayShortNames,
} from '../src/format.js';

const NEW = ['zh', 'hi', 'te', 'ar'];
/** Arabic-Indic, Extended Arabic-Indic, Devanagari and Telugu digits: none may appear. */
const NATIVE_DIGITS = /[\u0660-\u0669\u06f0-\u06f9\u0966-\u096f\u0c66-\u0c6f]/;
const intl = (code, options, date) => new Intl.DateTimeFormat(intlLocale(code), { timeZone: 'UTC', ...options }).format(date);
const noon = (y, m, d) => new Date(Date.UTC(y, m - 1, d, 12));

afterEach(() => {
  setLocale('en');
  setBidiIsolation(true);
});

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

test('times use each language clock and Latin digits', () => {
  for (const code of NEW) {
    const at = (h, m) => new Date(Date.UTC(2026, 0, 5, h, m));
    assert.equal(formatTime('19:00', code), intl(code, { hour: 'numeric', minute: '2-digit' }, at(19, 0)), code);
    assert.equal(formatTime('08:30', code), intl(code, { hour: 'numeric', minute: '2-digit' }, at(8, 30)), code);
    assert.doesNotMatch(formatTime('19:00', code), NATIVE_DIGITS, code);
    assert.equal(formatTime('TBD', code), 'TBD', 'a non-time comes back unchanged');
  }
  // CLDR conventions: Chinese writes a 24-hour clock, Hindi, Telugu and Arabic a 12-hour one.
  assert.equal(formatTime('19:00', 'zh'), '19:00');
  assert.equal(usesDayPeriods('zh'), false);
  for (const code of ['hi', 'te', 'ar']) {
    assert.equal(usesDayPeriods(code), true, code);
    assert.match(formatTime('19:00', code), /^7:00\s?\S+$/, code);
    assert.match(formatTime('19:00', code, { compact: true }), /^7\s?\S+$/, `${code} compact drops :00`);
  }
  assert.match(formatTime('19:00', 'ar'), /م/, 'Arabic PM');
  assert.equal(formatTime('19:00', 'zh', { compact: true }), '19:00', 'a 24-hour time keeps its minutes');
  setLocale('ar');
  assert.equal(formatTime('19:00'), formatTime('19:00', 'ar'), 'the active language is used when none is passed');
});

test('dates come from Intl in the new languages, with Latin digits', () => {
  for (const code of NEW) {
    const d = noon(2026, 10, 12);
    assert.equal(formatDate('2026-10-12', { locale: code }), intl(code, { weekday: 'short', month: 'short', day: 'numeric' }, d), code);
    assert.equal(formatDate('2026-10-12', { long: true, withYear: true, locale: code }), intl(code, { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' }, d), code);
    assert.equal(formatDate('2026-10-12', { weekday: 'long', month: 'short', locale: code }), intl(code, { weekday: 'long', month: 'short', day: 'numeric' }, d), code);
    assert.equal(formatMonthDay('2026-10-12', { locale: code }), intl(code, { month: 'short', day: 'numeric' }, d), code);
    assert.equal(formatMonthDay('2026-10-12', { withYear: true, locale: code }), intl(code, { month: 'short', day: 'numeric', year: 'numeric' }, d), code);
    for (const s of [formatDate('2026-10-12', { locale: code }), formatMonthDay('2026-10-12', { withYear: true, locale: code })]) {
      assert.doesNotMatch(s, NATIVE_DIGITS, `${code}: ${s}`);
      assert.match(s, /12/, `${code}: the day is a Latin number`);
    }
  }
  assert.equal(formatDate('2026-10-12', { locale: 'zh' }), '10月12日周一');
  assert.equal(formatMonthDay('2026-10-12', { locale: 'zh' }), '10月12日');
  assert.match(formatDate('2026-10-12', { locale: 'ar' }), /^الاثنين، 12 /);
  // The three original languages keep their dictionary forms.
  assert.equal(formatDate('2026-10-12', { locale: 'es' }), 'lun, 12 de oct');
  assert.equal(formatMonthDay('2026-10-12', { locale: 'en' }), 'Oct 12');
});

test('weekday and month names come from Intl in the new languages', () => {
  for (const code of NEW) {
    const days = weekdayNames(code);
    const short = weekdayShortNames(code);
    assert.equal(days.length, 7);
    assert.equal(short.length, 7);
    assert.equal(days[1], intl(code, { weekday: 'long' }, noon(2026, 10, 12)), `${code} Monday`);
    assert.equal(days[0], intl(code, { weekday: 'long' }, noon(2026, 10, 11)), `${code} Sunday first`);
    assert.equal(short[1], intl(code, { weekday: 'short' }, noon(2026, 10, 12)));
    assert.equal(monthNames(code).length, 12);
    assert.equal(monthShortNames(code)[9], intl(code, { month: 'short' }, noon(2026, 10, 15)), `${code} October`);
    assert.equal(weekdayName('2026-10-12', { locale: code }), days[1]);
    assert.equal(weekdayName('2026-10-12', { short: true, locale: code }), short[1]);
    // The dictionary still holds the English copies; Intl, not the copies, is what shows.
    assert.notDeepEqual(days, tList('format.weekdays', code), `${code} does not read the dictionary names`);
  }
  assert.deepEqual(weekdayShortNames('zh'), ['周日', '周一', '周二', '周三', '周四', '周五', '周六']);
  assert.deepEqual(weekdayNames('vi'), ['Chủ Nhật', 'Thứ Hai', 'Thứ Ba', 'Thứ Tư', 'Thứ Năm', 'Thứ Sáu', 'Thứ Bảy'], 'Vietnamese keeps its own');
});

test('numbers and distances use Latin digits in every new language', () => {
  for (const code of NEW) {
    assert.equal(formatNumber(1234.5, code, { maximumFractionDigits: 1 }), new Intl.NumberFormat(intlLocale(code), { maximumFractionDigits: 1 }).format(1234.5));
    assert.doesNotMatch(formatNumber(1234.5, code), NATIVE_DIGITS, code);
    assert.equal(formatMiles(2.66, code), '2.7', code);
    assert.equal(formatMiles(12.4, code), '12', code);
    assert.equal(formatMiles(1, code), '1.0', `${code}: one decimal under 10`);
    setBidiIsolation(false);
    assert.match(milesText(2.66, code), /2\.7/, code);
    assert.equal(milesText(0.5, code), DICTIONARIES[code].common.under1Mile);
  }
  assert.equal(formatNumber(1234.5, 'ar'), '1,234.5', 'Arabic with Latin digits');
  assert.equal(formatMiles(2.66, 'en'), '2.7');
});

test('relative days are dictionary templates with each language plural forms', () => {
  const sat = '2026-10-10';
  for (const code of NEW) {
    assert.equal(relativeDays(sat, sat, code), DICTIONARIES[code].common.today);
    assert.equal(relativeDays('2026-10-11', sat, code), DICTIONARIES[code].common.tomorrow);
    assert.equal(relativeDays('2026-10-17', sat, code), DICTIONARIES[code].common.nextWeek);
  }
  // Arabic picks a form by number: two days, a few days, many days, weeks.
  const inDays = { zero: 'z', one: 'بعد يوم', two: 'بعد يومين', few: 'بعد {n} أيام', many: 'بعد {n} يومًا', other: 'بعد {n} يوم' };
  const inWeeks = { zero: 'z', one: 'بعد أسبوع', two: 'بعد أسبوعين', few: 'بعد {n} أسابيع', many: 'بعد {n} أسبوعًا', other: 'بعد {n} أسبوع' };
  const daysAgo = { zero: 'z', one: 'منذ يوم', two: 'منذ يومين', few: 'منذ {n} أيام', many: 'منذ {n} يومًا', other: 'منذ {n} يوم' };
  withEntries('ar', { 'common.inDays': inDays, 'common.inWeeks': inWeeks, 'common.daysAgo': daysAgo }, () => {
    setBidiIsolation(false);
    assert.equal(relativeDays('2026-10-12', sat, 'ar'), 'بعد يومين');
    assert.equal(relativeDays('2026-10-15', sat, 'ar'), 'بعد 5 أيام');
    assert.equal(relativeDays('2026-10-21', sat, 'ar'), 'بعد 11 يومًا');
    assert.equal(relativeDays('2026-10-24', sat, 'ar'), 'بعد أسبوعين');
    assert.equal(relativeDays('2026-11-07', sat, 'ar'), 'بعد 4 أسابيع');
    assert.equal(relativeDays('2026-10-08', sat, 'ar'), 'منذ يومين');
  });
  // Hindi has one and other; Chinese only other.
  withEntries('hi', { 'common.inDays': { one: '{n} दिन में', other: '{n} दिनों में' } }, () => {
    assert.equal(relativeDays('2026-10-13', sat, 'hi'), '3 दिनों में');
  });
  withEntries('zh', { 'common.inDays': { other: '{n}天后' } }, () => {
    assert.equal(relativeDays('2026-10-13', sat, 'zh'), '3天后');
  });
  assert.equal(relativeDays('2026-10-20', sat, 'en'), 'In 10 days', 'English is unchanged');
});

test('recurrence text uses Intl weekday names, each language list words, and its own templates', () => {
  const rule = { kind: 'nth-weekday', weekday: 1, ordinals: [2, 4], time: '19:00' };
  for (const code of NEW) {
    setBidiIsolation(false);
    const text = describeRecurrence(rule, code);
    assert.ok(text.includes(weekdayNames(code)[1]), `${code}: ${text}`);
    assert.ok(text.includes(formatTime('19:00', code)), `${code}: the time is the language's own`);
    assert.doesNotMatch(text, NATIVE_DIGITS);
    for (const kind of ['weekly', 'biweekly', 'custom']) assert.ok(describeRecurrence({ kind, weekday: 2, time: '18:00' }, code).includes(weekdayNames(code)[2]), `${code} ${kind}`);
  }
  // A translator reorders the template; ordinals join with the language's own "and".
  withEntries('zh', { 'format.nthDays': '每月{ordinals}个{day}{at}', 'format.ordinals': ['', '第一', '第二', '第三', '第四', '第五'], 'format.at': ' {time}' }, () => {
    assert.equal(describeRecurrence(rule, 'zh'), '每月第二和第四个星期一 19:00');
  });
  withEntries('ar', { 'format.nthDays': '{day} {ordinals} من كل شهر{at}', 'format.ordinals': ['', 'الأول', 'الثاني', 'الثالث', 'الرابع', 'الخامس'], 'format.at': ' الساعة {time}' }, () => {
    setBidiIsolation(false);
    assert.equal(describeRecurrence(rule, 'ar'), `الاثنين الثاني والرابع من كل شهر الساعة ${formatTime('19:00', 'ar')}`);
  });
  setBidiIsolation(true);
  assert.match(describeRecurrence(rule, 'en'), /2nd and 4th Mondays at 7:00 PM/, 'English is unchanged');
});

test('ordinals come from each language dictionary, with a number as the fallback', () => {
  for (const code of NEW) {
    assert.equal(ordinalWord(2, code), DICTIONARIES[code].format.ordinals[2], code);
    assert.equal(ordinalWord(9, code), '9', `${code}: past the list, the number`);
  }
  withEntries('hi', { 'format.ordinals': ['', 'पहला', 'दूसरा', 'तीसरा', 'चौथा', 'पाँचवाँ'] }, () => {
    assert.equal(ordinalWord(4, 'hi'), 'चौथा');
  });
});
