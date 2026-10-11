import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { formatTime, formatDate, relativeDays, describeRecurrence, weekdayNames } from '../src/format.js';
import { setLocale, tList } from '../src/i18n/index.js';
import { addDays } from '../src/schedule.js';

afterEach(() => setLocale('en'));

test('times follow each locale clock: 12-hour en and es, 24-hour vi (CLDR)', () => {
  const cases = {
    en: { '19:00': '7:00 PM', '08:30': '8:30 AM', '13:00': '1:00 PM', '12:00': '12:00 PM', '00:15': '12:15 AM' },
    es: { '19:00': '7:00 p.m.', '08:30': '8:30 a.m.', '13:00': '1:00 p.m.', '12:00': '12:00 p.m.', '00:15': '12:15 a.m.' },
    vi: { '19:00': '19:00', '08:30': '8:30', '13:00': '13:00', '12:00': '12:00', '00:15': '0:15' },
  };
  for (const [code, times] of Object.entries(cases)) {
    for (const [input, out] of Object.entries(times)) assert.equal(formatTime(input, code), out, `${code} ${input}`);
  }
  setLocale('vi');
  assert.equal(formatTime('18:30'), '18:30', 'the active locale is used when none is passed');
  assert.equal(formatTime('18:30', 'en'), '6:30 PM', 'an explicit locale wins over the active one');
});

test('compact times drop :00 only where a day period keeps them unambiguous', () => {
  assert.equal(formatTime('19:00', 'en', { compact: true }), '7 PM');
  assert.equal(formatTime('19:30', 'en', { compact: true }), '7:30 PM');
  assert.equal(formatTime('09:00', 'es', { compact: true }), '9 a.m.');
  assert.equal(formatTime('19:00', 'vi', { compact: true }), '19:00', 'a bare 19 would read as a count');
  assert.equal(formatTime('19:00', 'en'), '7:00 PM', 'the default stays the full form');
});

test('formatTime leaves non-times alone instead of printing NaN', () => {
  assert.equal(formatTime('', 'en'), '');
  assert.equal(formatTime(undefined, 'en'), '');
  assert.equal(formatTime('TBD', 'en'), 'TBD');
  assert.equal(formatTime('7', 'en'), '7:00 AM', 'an hour alone is still a time');
});

test('dates use the standard Spanish and Vietnamese forms', () => {
  assert.equal(formatDate('2026-10-12', { locale: 'es' }), 'lun, 12 de oct');
  assert.equal(formatDate('2026-10-12', { long: true, withYear: true, locale: 'es' }), 'lunes, 12 de octubre de 2026');
  assert.equal(formatDate('2026-10-12', { locale: 'vi' }), 'T2, 12 thg 10');
  assert.equal(formatDate('2026-10-12', { long: true, locale: 'vi' }), 'Thứ Hai, 12 tháng 10');
  assert.equal(formatDate('2026-11-01', { long: true, withYear: true, locale: 'vi' }), 'Chủ Nhật, 1 tháng 11, 2026');
  // Month names are lowercase in running Vietnamese text ("tháng 11"), never "Tháng 11" mid-phrase.
  for (const m of tList('format.months', 'vi')) assert.match(m, /^tháng \d{1,2}$/);
  for (const m of tList('format.monthsShort', 'vi')) assert.match(m, /^thg \d{1,2}$/);
});

test('"Next week" means the following calendar week, not 7 to 13 days out', () => {
  const sat = '2026-10-10'; // Saturday: next week is Sun Oct 11 to Sat Oct 17
  assert.equal(relativeDays('2026-10-11', sat, 'en'), 'Tomorrow');
  assert.equal(relativeDays('2026-10-16', sat, 'en'), 'In 6 days');
  assert.equal(relativeDays('2026-10-17', sat, 'en'), 'Next week');
  assert.equal(relativeDays('2026-10-18', sat, 'en'), 'In 8 days', 'Sunday Oct 18 starts the week after next');
  assert.equal(relativeDays('2026-10-20', sat, 'en'), 'In 10 days', 'the audit case: Tue Oct 20 is not next week');
  assert.equal(relativeDays('2026-10-23', sat, 'en'), 'In 13 days');
  assert.equal(relativeDays('2026-10-24', sat, 'en'), 'In 2 weeks');

  const sun = '2026-10-11'; // Sunday: every date 7 to 13 days out is next week
  for (let n = 7; n <= 13; n += 1) assert.equal(relativeDays(addDays(sun, n), sun, 'en'), 'Next week', `Sunday +${n}`);

  const wed = '2026-10-14'; // Wednesday: next week is Oct 18 to Oct 24
  assert.equal(relativeDays('2026-10-20', wed, 'en'), 'In 6 days', 'under a week keeps the exact count');
  assert.equal(relativeDays('2026-10-24', wed, 'en'), 'Next week');
  assert.equal(relativeDays('2026-10-25', wed, 'en'), 'In 11 days');

  assert.equal(relativeDays('2026-10-17', sat, 'es'), 'La próxima semana');
  assert.equal(relativeDays('2026-10-20', sat, 'es'), 'En 10 días');
  assert.equal(relativeDays('2026-10-20', sat, 'vi'), 'Còn 10 ngày');
  assert.equal(relativeDays('2026-10-08', sat, 'en'), '2 days ago');
});

test('Vietnamese recurrence text cannot read as a list of weekdays', () => {
  // Weekday names are ordinals in Vietnamese (Thứ Hai = Monday, thứ hai = second), so every
  // ordinal must be tied to "tuần" (week) and no weekday name may sit next to a bare ordinal.
  const weekdays = weekdayNames('vi');
  assert.deepEqual(weekdays, ['Chủ Nhật', 'Thứ Hai', 'Thứ Ba', 'Thứ Tư', 'Thứ Năm', 'Thứ Sáu', 'Thứ Bảy']);
  for (const ordinals of [[1], [2], [4], [1, 3], [2, 4], [1, 2, 3, 4, 5]]) {
    for (let weekday = 0; weekday < 7; weekday += 1) {
      const text = describeRecurrence({ kind: 'nth-weekday', weekday, ordinals, time: '19:00' }, 'vi');
      assert.ok(text.startsWith(weekdays[weekday]), text);
      const rest = text.slice(weekdays[weekday].length);
      // After the weekday, every "thứ <number word>" must be preceded by "tuần" ("tuần thứ hai").
      for (const m of rest.matchAll(/(\S+) thứ (nhất|hai|ba|tư|năm|sáu|bảy)/gi)) assert.equal(m[1], 'tuần', `${text}: "${m[0]}" reads like a weekday`);
      assert.equal((text.match(/tuần thứ/g) || []).length, ordinals.length, text);
    }
  }
  assert.equal(
    describeRecurrence({ kind: 'nth-weekday', weekday: 1, ordinals: [2, 4], time: '19:00' }, 'vi'),
    'Thứ Hai tuần thứ hai và tuần thứ tư hằng tháng lúc 19:00',
  );
});

test('Spanish recurrence text agrees for every hour and every weekday', () => {
  // "a las 1:00" is wrong Spanish (it is "a la una"), and Fort Worth and Irving meet at 1 PM.
  const oneOClock = describeRecurrence({ kind: 'custom', weekday: 2, time: '13:00' }, 'es');
  assert.doesNotMatch(oneOClock, /\blas 1:/, oneOClock);
  assert.equal(oneOClock, 'Fechas del calendario publicado (normalmente en martes), 1:00 p.m.');
  // "los sábado" is wrong (sábado and domingo change in the plural), so the phrasing avoids the article.
  const saturday = describeRecurrence({ kind: 'custom', weekday: 6, time: '10:00' }, 'es');
  assert.doesNotMatch(saturday, /\blos (sábado|domingo)\b/, saturday);
  assert.equal(describeRecurrence({ kind: 'nth-weekday', weekday: 1, ordinals: [2, 4], time: '19:00' }, 'es'), '2.º y 4.º lunes de cada mes, 7:00 p.m.');
});
