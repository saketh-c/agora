/**
 * Health checks on the real merged data (data/cities.json, built by `npm run build:data`) as of
 * Saturday 2026-10-10. They pin down the schedule defects found in the engine audit so a data
 * edit cannot bring them back.
 */
import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { loadCities, loadTranslations } from '../src/load-node.js';
import { expandCityMeetings, upcomingMeetings, nextMeetingFor, calendarThrough, agendaFor } from '../src/schedule.js';
import { localizeCities } from '../src/i18n/data.js';
import { setLocale } from '../src/i18n/index.js';
import { scheduleWarnings, validateCities } from '../src/validate.js';

const TODAY = '2026-10-10';
const cities = loadCities();
const byId = Object.fromEntries(cities.map((c) => [c.cityId, c]));
const row = (o) => `${o.date} ${o.time} ${o.type} ${o.status} ${o.openToPublicComment ? 'speak' : 'watch'}`;

afterEach(() => setLocale('en'));

test('the merged data validates, with no schedule warnings', () => {
  assert.deepEqual(validateCities(cities), []);
  assert.deepEqual(cities.flatMap((c) => scheduleWarnings(c)), []);
});

test('the schedule is the same in English, Spanish and Vietnamese (Oct 2026 to Jan 2027)', () => {
  const key = (o) => `${o.id} ${o.date} ${o.time} ${o.status} ${o.type} ${o.openToPublicComment} ${o.agendaItems.length}`;
  const expand = (list) => list.flatMap((c) => expandCityMeetings(c, '2026-10-01', '2027-01-31')).map(key);
  const english = expand(cities);
  assert.ok(english.length > 500);
  for (const lang of ['es', 'vi']) {
    const strings = loadTranslations(lang);
    assert.ok(strings, `${lang} translation memory is present`);
    setLocale(lang);
    const localized = localizeCities(cities, strings);
    assert.deepEqual(expand(localized), english, `${lang} schedule differs from English`);
    const garland = expandCityMeetings(localized.find((c) => c.cityId === 'garland'), '2026-11-02', '2026-11-02').find((o) => o.type === 'regular');
    assert.notEqual(garland.label, 'City Council Regular Meeting', `${lang} labels are still translated`);
  }
});

test('Bedford: the single November meeting is Nov 17, not a phantom Nov 10', () => {
  const nov = expandCityMeetings(byId.bedford, '2026-11-01', '2026-11-30');
  assert.deepEqual(nov.map(row), ['2026-11-10 18:00 regular cancelled speak', '2026-11-17 18:00 regular rescheduled speak', '2026-11-24 18:00 regular cancelled speak']);
  assert.equal(nextMeetingFor(byId.bedford, '2026-11-11').date, '2026-11-17');
});

test('Garland: the moved Nov 2 regular meeting keeps 7 PM, and the canvass has a real title', () => {
  const occ = expandCityMeetings(byId.garland, '2026-11-01', '2026-11-12');
  assert.deepEqual(occ.map(row), ['2026-11-02 18:00 work-session scheduled speak', '2026-11-02 19:00 regular rescheduled speak', '2026-11-03 19:00 regular cancelled speak', '2026-11-10 18:00 other special watch']);
  assert.equal(occ[3].label, 'Special council meeting');
});

test('Denton: one 2 PM session on each special-called Tuesday', () => {
  const twoPm = expandCityMeetings(byId.denton, '2026-10-10', '2026-11-30').filter((o) => o.time === '14:00');
  assert.deepEqual(twoPm.map(row), ['2026-10-13 14:00 other special speak', '2026-10-27 14:00 other special speak', '2026-11-17 14:00 other special speak']);
});

test('Carrollton: the meeting moved to Oct 13 keeps its regular session where students can speak', () => {
  const occ = expandCityMeetings(byId.carrollton, '2026-10-01', '2026-10-21');
  assert.deepEqual(occ.map(row), [
    '2026-10-06 17:45 work-session cancelled watch',
    '2026-10-06 19:00 regular cancelled speak',
    '2026-10-13 17:45 work-session rescheduled watch',
    '2026-10-13 19:00 regular rescheduled speak',
    '2026-10-20 17:45 work-session scheduled watch',
    '2026-10-20 19:00 regular scheduled speak',
  ]);
});

test('McKinney: the as-needed fourth-Tuesday work session only appears on its listed dates', () => {
  const fourth = expandCityMeetings(byId.mckinney, '2026-09-01', '2027-01-31').filter((o) => o.label.startsWith('Fourth-Tuesday'));
  assert.deepEqual(fourth.map((o) => o.date), ['2026-09-22', '2026-10-27']);
});

test('ordinary meetings are not tagged special, and no title is a cut-off sentence', () => {
  const upcoming = upcomingMeetings(cities, { from: TODAY, days: 113 });
  for (const id of ['frisco', 'mckinney', 'rowlett', 'fort-worth', 'arlington', 'flower-mound', 'grand-prairie']) {
    assert.ok(!upcoming.some((m) => m.cityId === id && m.status === 'special'), `${id} has a special tag on an ordinary meeting`);
  }
  assert.ok(upcoming.every((m) => !m.label.endsWith('...')));
  assert.ok(upcoming.filter((m) => m.status === 'special').length <= 6);
});

test('meeting ids are unique and never depend on wording', () => {
  for (const city of cities) {
    const ids = expandCityMeetings(city, '2026-09-01', '2027-01-31').map((o) => o.id);
    assert.equal(new Set(ids).size, ids.length, `${city.cityId} repeats an id`);
  }
});

test('every council either has a meeting in the next 45 days or says when its published calendar ends', () => {
  for (const city of cities) {
    const next = nextMeetingFor(city, TODAY, { horizonDays: 45 });
    assert.ok(next || calendarThrough(city), `${city.cityId} has no meeting and no calendar end`);
  }
  assert.deepEqual(
    ['fort-worth', 'arlington', 'irving', 'denton'].map((id) => [id, calendarThrough(byId[id]), nextMeetingFor(byId[id], '2026-12-16')]),
    [
      ['fort-worth', '2026-12-08', null],
      ['arlington', '2026-12-15', null],
      ['irving', '2026-12-10', null],
      ['denton', '2026-12-15', null],
    ],
  );
  assert.equal(calendarThrough(byId.plano), null);
});

test('as of Oct 10 every agenda item is recent: none rides on an upcoming meeting', () => {
  const upcoming = upcomingMeetings(cities, { from: TODAY, days: 60 });
  assert.ok(upcoming.every((m) => m.agendaItems.every((a) => !a.meetingDate || a.meetingDate >= TODAY)));
  const recent = cities.reduce((n, c) => n + agendaFor(c, TODAY).recent.length, 0);
  const total = cities.reduce((n, c) => n + (c.agendaItems || []).length, 0);
  assert.equal(recent, total, 'all items are from Sept 10 to 17, inside the 60-day window');
});
