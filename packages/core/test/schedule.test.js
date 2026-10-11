import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  nthWeekdayOfMonth,
  occurrencesForRule,
  expandCityMeetings,
  upcomingMeetings,
  nextMeetingFor,
  addDays,
  daysBetween,
  windowEnd,
  weekdayOf,
  isDst,
  toISO,
  isSchoolHours,
  isDateStr,
  hasEnded,
  timesFromNote,
  timeFromNote,
  dateFromNote,
  agendaFor,
  calendarThrough,
  todayStr,
  nowTimeStr,
} from '../src/schedule.js';
import { localizeCity } from '../src/i18n/data.js';
import { setLocale } from '../src/i18n/index.js';

const plano = {
  cityId: 'plano',
  name: 'Plano',
  county: 'Collin',
  cityHall: { address: '1520 K Ave', lat: 33.0198, lng: -96.6989 },
  meetings: [
    { type: 'regular', label: 'City Council meeting', recurrence: { kind: 'nth-weekday', weekday: 1, ordinals: [2, 4], time: '19:00' } },
  ],
  scheduleExceptions: [{ date: '2026-09-28', status: 'cancelled', note: 'Cancelled for a holiday' }],
  agendaItems: [
    { title: 'Zoning case near Legacy', meetingDate: '2026-09-14', topics: ['zoning-development'] },
    { title: 'Youth advisory report', topics: ['youth'] },
  ],
};

test('date primitives', () => {
  assert.equal(weekdayOf('2026-09-10'), 4, 'Sept 10 2026 is a Thursday');
  assert.equal(addDays('2026-09-30', 1), '2026-10-01');
  assert.equal(daysBetween('2026-09-10', '2026-09-14'), 4);
  assert.equal(isDateStr('2026-02-30'), false);
  assert.equal(isDateStr('2028-02-29'), true);
});

test('nth weekday of month', () => {
  assert.equal(nthWeekdayOfMonth(2026, 9, 1, 2), '2026-09-14', 'second Monday of Sept 2026');
  assert.equal(nthWeekdayOfMonth(2026, 9, 1, 4), '2026-09-28');
  assert.equal(nthWeekdayOfMonth(2026, 9, 1, 5), null, 'Sept 2026 has only four Mondays');
  assert.equal(nthWeekdayOfMonth(2026, 9, 3, 1), '2026-09-02', 'first Wednesday');
});

test('recurrence expansion', () => {
  assert.deepEqual(occurrencesForRule({ kind: 'nth-weekday', weekday: 1, ordinals: [2, 4], time: '19:00' }, '2026-09-10', '2026-10-31'), ['2026-09-14', '2026-09-28', '2026-10-12', '2026-10-26']);
  assert.deepEqual(occurrencesForRule({ kind: 'weekly', weekday: 3, time: '09:00' }, '2026-09-10', '2026-09-30'), ['2026-09-16', '2026-09-23', '2026-09-30']);
  assert.deepEqual(occurrencesForRule({ kind: 'biweekly', weekday: 2, time: '10:00', anchorDate: '2026-09-08' }, '2026-09-10', '2026-10-10'), ['2026-09-22', '2026-10-06']);
  assert.deepEqual(occurrencesForRule({ kind: 'custom', weekday: 1, time: '18:00', dates: ['2026-09-01', '2026-09-21', '2026-12-01'] }, '2026-09-10', '2026-10-10'), ['2026-09-21']);
});

test('daylight saving offsets', () => {
  assert.equal(isDst('2026-09-14'), true);
  assert.equal(isDst('2026-11-02'), false);
  assert.equal(toISO('2026-09-14', '19:00'), '2026-09-14T19:00:00-05:00');
  assert.equal(toISO('2026-12-14', '19:00'), '2026-12-14T19:00:00-06:00');
});

test('school hours detection', () => {
  assert.equal(isSchoolHours('2026-09-16', '09:00'), true, 'Wednesday 9 AM');
  assert.equal(isSchoolHours('2026-09-16', '19:00'), false);
  assert.equal(isSchoolHours('2026-09-12', '09:00'), false, 'Saturday');
});

test('city expansion applies exceptions and attaches agenda items', () => {
  const occ = expandCityMeetings(plano, '2026-09-10', '2026-10-15');
  assert.deepEqual(
    occ.map((o) => [o.date, o.status]),
    [
      ['2026-09-14', 'scheduled'],
      ['2026-09-28', 'cancelled'],
      ['2026-10-12', 'scheduled'],
    ],
  );
  const first = occ[0];
  assert.equal(first.isEvening, true);
  assert.equal(first.startISO, '2026-09-14T19:00:00-05:00');
  assert.equal(first.agendaItems.length, 2, 'dated item plus undated item both land on the first regular meeting');
  assert.equal(occ[2].agendaItems.length, 0);
});

test('upcoming meetings drops cancelled by default and sorts', () => {
  const list = upcomingMeetings([plano], { from: '2026-09-10', days: 40 });
  assert.deepEqual(
    list.map((m) => m.date),
    ['2026-09-14', '2026-10-12'],
  );
  const withCancelled = upcomingMeetings([plano], { from: '2026-09-10', days: 40, includeCancelled: true });
  assert.equal(withCancelled.length, 3);
});

const colleyville = {
  cityId: 'colleyville',
  name: 'Colleyville',
  county: 'Tarrant',
  cityHall: { address: '100 Main St', lat: 32.88, lng: -97.15 },
  meetings: [
    { type: 'work-session', label: 'Council work session', openToPublicComment: false, recurrence: { kind: 'nth-weekday', weekday: 2, ordinals: [1, 3], time: '17:30' } },
    { type: 'regular', label: 'City Council meeting', openToPublicComment: true, recurrence: { kind: 'nth-weekday', weekday: 2, ordinals: [1, 3], time: '19:00' } },
  ],
};

test('holiday shift on the new date moves every same-evening meeting together', () => {
  const city = { ...colleyville, scheduleExceptions: [{ date: '2026-10-07', status: 'rescheduled', note: 'Moved from Tuesday Oct 6 to Wednesday Oct 7 (work session 5:30 p.m., regular meeting 7:00 p.m.)' }] };
  const occ = expandCityMeetings(city, '2026-10-01', '2026-10-10');
  const byKey = Object.fromEntries(occ.map((o) => [`${o.date} ${o.time}`, o]));
  assert.equal(byKey['2026-10-06 17:30'].status, 'cancelled');
  assert.equal(byKey['2026-10-06 19:00'].status, 'cancelled');
  assert.match(byKey['2026-10-06 19:00'].note, /Moved to Wed, Oct 7/);
  assert.equal(byKey['2026-10-07 17:30'].status, 'rescheduled');
  assert.equal(byKey['2026-10-07 19:00'].status, 'rescheduled');
  assert.equal(byKey['2026-10-07 19:00'].openToPublicComment, true);
  assert.equal(byKey['2026-10-07 19:00'].type, 'regular');
});

test('explicit movedFrom and a bare new-date exception behave the same', () => {
  const explicit = { ...colleyville, scheduleExceptions: [{ date: '2026-10-07', status: 'rescheduled', movedFrom: '2026-10-06', note: 'Holiday shift' }] };
  const bare = { ...colleyville, scheduleExceptions: [{ date: '2026-10-07', status: 'rescheduled', note: 'Holiday shift' }] };
  for (const city of [explicit, bare]) {
    const live = expandCityMeetings(city, '2026-10-01', '2026-10-10').filter((o) => o.status !== 'cancelled');
    assert.deepEqual(live.map((o) => `${o.date} ${o.time} ${o.type}`), ['2026-10-07 17:30 work-session', '2026-10-07 19:00 regular']);
  }
});

test('old-date exception with "moved to" creates the meeting on the target date', () => {
  const city = { ...colleyville, scheduleExceptions: [{ date: '2026-11-03', status: 'rescheduled', note: 'Election Day: both meetings moved to Wednesday, Nov. 4.' }] };
  const occ = expandCityMeetings(city, '2026-11-01', '2026-11-10');
  assert.deepEqual(occ.filter((o) => o.status === 'cancelled').map((o) => o.date), ['2026-11-03', '2026-11-03']);
  assert.deepEqual(occ.filter((o) => o.date === '2026-11-04').map((o) => `${o.time} ${o.status}`), ['17:30 rescheduled', '19:00 rescheduled']);
});

test('single moved meeting takes the time named in the note; time-only change keeps the date', () => {
  const single = { ...colleyville, meetings: [colleyville.meetings[1]], scheduleExceptions: [{ date: '2026-10-07', status: 'rescheduled', note: 'Meeting moved to Wednesday at 6:00 p.m.' }] };
  const occ = expandCityMeetings(single, '2026-10-01', '2026-10-10');
  assert.deepEqual(occ.map((o) => `${o.date} ${o.time} ${o.status}`), ['2026-10-06 19:00 cancelled', '2026-10-07 18:00 rescheduled']);
  const retimed = { ...colleyville, meetings: [colleyville.meetings[1]], scheduleExceptions: [{ date: '2026-10-06', status: 'rescheduled', note: 'Starts at 6:00 p.m. instead of 7:00 p.m. because of the budget hearing.' }] };
  const occ2 = expandCityMeetings(retimed, '2026-10-01', '2026-10-10');
  assert.deepEqual(occ2.map((o) => `${o.date} ${o.time} ${o.status}`), ['2026-10-06 18:00 rescheduled']);
});

test('moved meeting onto a date another rule already uses does not vanish', () => {
  const city = {
    ...colleyville,
    meetings: [
      { type: 'work-session', label: 'Council work session', openToPublicComment: false, recurrence: { kind: 'nth-weekday', weekday: 1, ordinals: [1], time: '18:00' } },
      { type: 'regular', label: 'City Council meeting', openToPublicComment: true, recurrence: { kind: 'nth-weekday', weekday: 2, ordinals: [1], time: '19:00' } },
    ],
    scheduleExceptions: [{ date: '2026-11-02', status: 'rescheduled', movedFrom: '2026-11-03', note: 'Election Day: council meeting moved to Monday, Nov. 2' }],
  };
  const live = expandCityMeetings(city, '2026-11-01', '2026-11-10').filter((o) => o.status !== 'cancelled');
  assert.deepEqual(live.map((o) => `${o.date} ${o.time} ${o.type} ${o.status}`), ['2026-11-02 18:00 work-session scheduled', '2026-11-02 19:00 regular rescheduled']);
});

test('note date parsing', async () => {
  const { dateFromNote } = await import('../src/schedule.js');
  assert.equal(dateFromNote('moved to Tuesday, Nov. 10 at 9 a.m.', '2026-11-11'), '2026-11-10');
  assert.equal(dateFromNote('see 2026-12-02 agenda', '2026-11-11'), '2026-12-02');
  assert.equal(dateFromNote('rescheduled to 11/10', '2026-11-11'), '2026-11-10');
  assert.equal(dateFromNote('no date here', '2026-11-11'), null);
});

// ---------------------------------------------------------------------------------------------
// Regression tests for the engine audit (windows, now, parsing, exception semantics, agendas).

const hall = { address: '1 Main St', lat: 32.9, lng: -96.8 };
const base = (meetings, scheduleExceptions = [], extra = {}) => ({ cityId: 'testville', name: 'Testville', county: 'Dallas', cityHall: hall, meetings, scheduleExceptions, ...extra });
const tuesdays = { type: 'regular', label: 'City Council Regular Meeting', openToPublicComment: true, recurrence: { kind: 'nth-weekday', weekday: 2, ordinals: [1, 3], time: '19:00' } };
const brief = (list) => list.map((o) => `${o.date} ${o.time} ${o.status}`);

test('a window of N days holds exactly N calendar days', () => {
  assert.equal(windowEnd('2026-10-10', 30), '2026-11-08');
  assert.equal(windowEnd('2026-10-10', 1), '2026-10-10');
  assert.equal(windowEnd('2026-10-10', 0), '2026-10-10', 'never less than one day');
  const saturdays = base([{ type: 'town-hall', label: 'Coffee with council', recurrence: { kind: 'weekly', weekday: 6, time: '10:00' } }]);
  assert.deepEqual(upcomingMeetings([saturdays], { from: '2026-10-10', days: 7 }).map((m) => m.date), ['2026-10-10']);
  assert.deepEqual(upcomingMeetings([saturdays], { from: '2026-10-10', days: 8 }).map((m) => m.date), ['2026-10-10', '2026-10-17']);
  assert.equal(nextMeetingFor(saturdays, '2026-10-11', { horizonDays: 6 }), null, 'Oct 11 to Oct 16 has no Saturday');
  assert.equal(nextMeetingFor(saturdays, '2026-10-11', { horizonDays: 7 }).date, '2026-10-17');
});

test('meetings that already ended today drop out once a now is given', () => {
  const city = base([
    { type: 'regular', label: 'Voting meeting', recurrence: { kind: 'weekly', weekday: 3, time: '09:00' } },
    { type: 'regular', label: 'Evening meeting', recurrence: { kind: 'weekly', weekday: 3, time: '18:00', durationMinutes: 60 } },
  ]);
  const at = (now) => upcomingMeetings([city], { from: '2026-10-14', days: 1, now }).map((m) => m.time);
  assert.deepEqual(at(undefined), ['09:00', '18:00'], 'date-only callers keep the whole day');
  assert.deepEqual(at('2026-10-14T10:59:00-05:00'), ['09:00', '18:00'], 'a meeting with no length runs two hours');
  assert.deepEqual(at('2026-10-14T11:00:00-05:00'), ['18:00']);
  assert.deepEqual(at('2026-10-14T18:30:00-05:00'), ['18:00'], 'a meeting in progress is still listed');
  assert.deepEqual(at('2026-10-15T00:30:00Z'), [], '7:30 PM Central, after the one-hour evening meeting');
  assert.equal(nextMeetingFor(city, '2026-10-14', { now: '2026-10-14T20:00:00-05:00' }).date, '2026-10-21');
  assert.equal(hasEnded({ startISO: '2026-10-14T09:00:00-05:00' }, 'not a time'), false);
});

test('Central-time today and clock do not depend on a locale pattern', () => {
  assert.equal(todayStr('America/Chicago', new Date('2026-10-11T04:30:00Z')), '2026-10-10');
  assert.equal(nowTimeStr('America/Chicago', new Date('2026-10-11T05:05:00Z')), '00:05');
});

test('malformed rules yield no dates instead of NaN dates', () => {
  assert.deepEqual(occurrencesForRule({ kind: 'nth-weekday', ordinals: [1], time: '19:00' }, '2026-10-10', '2026-11-30'), [], 'no weekday');
  assert.deepEqual(occurrencesForRule({ kind: 'monthly', weekday: 2, time: '19:00' }, '2026-10-10', '2026-11-30'), [], 'unknown kind');
  assert.deepEqual(occurrencesForRule({ kind: 'weekly', weekday: 9, time: '19:00' }, '2026-10-10', '2026-11-30'), []);
  const city = base([{ type: 'regular', label: 'No rule' }, { type: 'regular', label: 'No weekday', recurrence: { kind: 'nth-weekday', ordinals: [1], time: '19:00' } }, tuesdays]);
  assert.deepEqual(brief(expandCityMeetings(city, '2026-10-01', '2026-10-31')), ['2026-10-06 19:00 scheduled', '2026-10-20 19:00 scheduled']);
});

test('note times: several times, ranges, noon, and no guessing at bare times', () => {
  assert.deepEqual(timesFromNote('Work Session 6 p.m., Regular Meeting 7 p.m.'), ['18:00', '19:00']);
  assert.deepEqual(timesFromNote('District 1 Town Hall, 6:00 to 8:00 p.m., Council Chambers.'), ['18:00']);
  assert.deepEqual(timesFromNote('Open house 11 to 1 p.m.'), ['11:00']);
  assert.equal(timeFromNote('Coffee with the mayor at noon.'), '12:00');
  assert.equal(timeFromNote('starts at 18:30'), '18:30');
  assert.equal(timeFromNote('lúc 6:30 tối'), null, 'a bare 6:30 could be morning or evening');
  assert.equal(timeFromNote('call 817-952-2100'), null);
});

test('note dates: month abbreviations and the year boundary', () => {
  assert.equal(dateFromNote('moved to Tuesday, Jan 12 because of the holidays', '2026-12-15'), '2027-01-12');
  assert.equal(dateFromNote('moved from Dec. 29', '2027-01-05'), '2026-12-29');
  assert.equal(dateFromNote('Sept. 14: workshop 6:15 p.m.', '2026-09-10'), '2026-09-14');
  assert.equal(dateFromNote('a decision 12 months ago', '2026-11-11'), null, '"decision" is not "Dec"');
  assert.equal(dateFromNote('see 12/29', '2027-01-05'), '2026-12-29');
});

test('a December move into January lands in the next year', () => {
  const city = base([tuesdays], [{ date: '2026-12-15', status: 'rescheduled', note: 'Third-Tuesday meeting moved to Tuesday, Jan 12 because of the holidays.' }]);
  const occ = expandCityMeetings(city, '2026-12-01', '2027-01-31');
  const dec15 = occ.find((o) => o.date === '2026-12-15');
  assert.equal(dec15.status, 'cancelled');
  assert.equal(dec15.movedTo, '2027-01-12');
  assert.match(dec15.note, /Jan 12/);
  assert.equal(occ.find((o) => o.date === '2027-01-12').status, 'rescheduled');
});

test('"Nov." in a note keeps its day', () => {
  const city = base([tuesdays], [{ date: '2026-11-17', status: 'rescheduled', note: 'Meeting moved to Nov. 19.' }]);
  assert.deepEqual(brief(expandCityMeetings(city, '2026-11-15', '2026-11-20')), ['2026-11-17 19:00 cancelled', '2026-11-19 19:00 rescheduled']);
});

test('a reschedule the engine cannot place never leaves a live meeting on the old date', () => {
  const unplaced = base([tuesdays], [{ date: '2026-11-03', status: 'rescheduled', note: 'Not held on the first Tuesday; check the city calendar.' }]);
  const nov3 = expandCityMeetings(unplaced, '2026-11-01', '2026-11-10').find((o) => o.date === '2026-11-03');
  assert.equal(nov3.status, 'cancelled');
  assert.match(nov3.note, /check the city calendar/);
  // A note that names the new date in passing (no "moved to") still places the meeting.
  const named = base([tuesdays], [{ date: '2026-11-03', status: 'rescheduled', note: 'No first-Tuesday meeting in November; the calendar shows a single meeting on Tuesday Nov. 10, 2026 at 7 p.m.' }]);
  assert.deepEqual(brief(expandCityMeetings(named, '2026-11-01', '2026-11-12')), ['2026-11-03 19:00 cancelled', '2026-11-10 19:00 rescheduled']);
});

test('a note listing the whole evening keeps each moved meeting at its own time, whatever the exception order', () => {
  const workSessions = { type: 'work-session', label: 'City Council Work Session', openToPublicComment: true, recurrence: { kind: 'custom', weekday: 1, time: '18:00', dates: ['2026-11-02'] } };
  const moved = { date: '2026-11-02', status: 'rescheduled', note: 'First November meeting moved from Tuesday Nov. 3 (Election Day) to Monday Nov. 2: Work Session 6 p.m., Regular Meeting 7 p.m.' };
  const cancelled = { date: '2026-11-03', status: 'cancelled', note: 'Election Day; no council meeting.' };
  for (const order of [
    [moved, cancelled],
    [cancelled, moved],
  ]) {
    const occ = expandCityMeetings(base([tuesdays, workSessions], order), '2026-11-01', '2026-11-04');
    assert.deepEqual(
      occ.map((o) => `${o.date} ${o.time} ${o.type} ${o.status}`),
      ['2026-11-02 18:00 work-session scheduled', '2026-11-02 19:00 regular rescheduled', '2026-11-03 19:00 regular cancelled'],
    );
    assert.equal(occ[1].movedFrom, '2026-11-03');
    assert.match(occ[2].note, /Moved to Mon, Nov 2/, 'the old date says where the meeting went');
  }
});

test('a time change takes an explicit time, or the one other time a note names', () => {
  const note = 'Start time moved to 5:30 p.m. for National Night Out; the calendar still showed 7:00 p.m.';
  for (const ex of [
    { date: '2026-10-06', status: 'rescheduled', time: '17:30', note },
    { date: '2026-10-06', status: 'rescheduled', note },
  ]) {
    assert.deepEqual(brief(expandCityMeetings(base([tuesdays], [ex]), '2026-10-01', '2026-10-10')), ['2026-10-06 17:30 rescheduled']);
  }
});

test('an exception just outside the window still moves a meeting into it', () => {
  const secondFourth = { ...tuesdays, recurrence: { ...tuesdays.recurrence, ordinals: [2, 4] } };
  const city = base([secondFourth], [{ date: '2026-11-10', status: 'rescheduled', movedTo: '2026-11-17', note: 'Single November meeting on Nov. 17.' }]);
  assert.deepEqual(brief(expandCityMeetings(city, '2026-11-11', '2026-11-30')), ['2026-11-17 19:00 rescheduled', '2026-11-24 19:00 scheduled']);
  assert.equal(nextMeetingFor(city, '2026-11-11').date, '2026-11-17');
});

test('special exceptions: a titled meeting of its own, never a truncated note, never a revived cancellation', () => {
  const longNote = 'Special City Council Meeting at 6 p.m. in the Council Chambers to canvass election results.';
  const added = expandCityMeetings(base([tuesdays], [{ date: '2026-11-10', status: 'special', note: longNote }]), '2026-11-10', '2026-11-10')[0];
  assert.equal(added.label, 'Special council meeting');
  assert.equal(added.time, '18:00');
  assert.equal(added.type, 'other');
  assert.equal(added.openToPublicComment, false, 'nothing says the public may speak');
  assert.equal(added.note, longNote);
  assert.equal(added.id, 'testville:2026-11-10:special-council-meeting');

  const described = expandCityMeetings(base([tuesdays], [{ date: '2026-11-10', status: 'special', label: 'Joint meeting with the school board', type: 'other', openToPublicComment: true, time: '17:30', note: 'Joint meeting.' }]), '2026-11-10', '2026-11-10')[0];
  assert.deepEqual([described.label, described.time, described.openToPublicComment], ['Joint meeting with the school board', '17:30', true]);

  const onCancelled = expandCityMeetings(
    base([tuesdays], [
      { date: '2026-11-03', status: 'cancelled', note: 'Election Day.' },
      { date: '2026-11-03', status: 'special', note: 'Canvass at 6 p.m.' },
    ]),
    '2026-11-03',
    '2026-11-03',
  );
  assert.deepEqual(onCancelled.map((o) => `${o.time} ${o.status} ${o.type}`), ['18:00 special other', '19:00 cancelled regular']);

  const beside = expandCityMeetings(base([tuesdays], [{ date: '2026-11-03', status: 'special', time: '17:00', note: 'Budget workshop before the regular meeting.' }]), '2026-11-03', '2026-11-03');
  assert.deepEqual(beside.map((o) => `${o.time} ${o.status}`), ['17:00 special', '19:00 scheduled'], 'an explicit time that matches no meeting adds one');
});

test('note exceptions annotate without changing status, and time narrows a cancellation', () => {
  const work = { type: 'work-session', label: 'Work Session', openToPublicComment: false, recurrence: { kind: 'nth-weekday', weekday: 2, ordinals: [1, 3], time: '17:00' } };
  const occ = expandCityMeetings(
    base([tuesdays, work], [
      { date: '2026-11-03', status: 'note', note: 'Held as scheduled on Election Day.' },
      { date: '2026-11-17', status: 'cancelled', time: '17:00', note: 'No work session this week.' },
    ]),
    '2026-11-01',
    '2026-11-30',
  );
  assert.deepEqual(
    occ.map((o) => `${o.date} ${o.time} ${o.status}`),
    ['2026-11-03 17:00 scheduled', '2026-11-03 19:00 scheduled', '2026-11-17 17:00 cancelled', '2026-11-17 19:00 scheduled'],
  );
  assert.equal(occ[1].note, 'Held as scheduled on Election Day.');
});

test('agenda items stay on the session their meetingLabel names, and only on their own date', () => {
  const work = { type: 'work-session', label: 'City Council Work Session', openToPublicComment: true, recurrence: { kind: 'nth-weekday', weekday: 2, ordinals: [1, 3], time: '14:00' } };
  const city = base([tuesdays, work], [], {
    agendaItems: [
      { title: 'Parking study', meetingDate: '2026-09-15', meetingLabel: 'City Council Work Session (2 p.m.)', topics: ['roads-traffic'] },
      { title: 'Budget adoption', meetingDate: '2026-09-15', meetingLabel: 'City Council Regular Meeting', topics: ['budget-taxes'] },
      { title: 'Zoning case', meetingDate: '2026-09-15', topics: ['zoning-development'] },
      { title: 'Old item', meetingDate: '2026-09-01', topics: ['housing'] },
      { title: 'Undated item', topics: ['youth'] },
    ],
  });
  const occ = expandCityMeetings(city, '2026-09-10', '2026-10-10');
  const titles = (date, time) => occ.find((o) => o.date === date && o.time === time).agendaItems.map((a) => a.title);
  assert.deepEqual(titles('2026-09-15', '14:00'), ['Parking study']);
  assert.deepEqual(titles('2026-09-15', '19:00'), ['Budget adoption', 'Zoning case', 'Undated item'], 'no label means the regular meeting; undated goes to the first regular meeting in the window');
  assert.ok(occ.every((o) => o.agendaItems.every((a) => !a.meetingDate || a.meetingDate === o.date)), 'never on another day');
  const later = expandCityMeetings(city, '2026-10-10', '2026-11-30');
  assert.deepEqual(later.flatMap((o) => o.agendaItems.map((a) => a.title)), ['Undated item'], 'upcoming meetings carry no past items');
});

test('agendaFor splits upcoming and recent items around today', () => {
  const city = base([tuesdays], [], {
    agendaItems: [
      { title: 'A', meetingDate: '2026-09-14', topics: ['housing'] },
      { title: 'B', meetingDate: '2026-09-15', topics: ['parks-recreation'] },
      { title: 'C', meetingDate: '2026-06-01', topics: ['housing'] },
      { title: 'D', meetingDate: '2026-10-20', topics: ['housing'] },
      { title: 'E', topics: ['youth'] },
      { title: 'F', meetingDate: '2026-10-10', topics: ['youth'] },
    ],
  });
  const { upcoming, recent } = agendaFor(city, '2026-10-10');
  assert.deepEqual(upcoming.map((a) => a.title), ['F', 'D', 'E'], 'soonest first, undated last, today counts as upcoming');
  assert.deepEqual(recent.map((a) => a.title), ['B', 'A'], 'newest first, older than 60 days left out');
  assert.deepEqual(agendaFor(city, '2026-10-10', { recentDays: 200 }).recent.map((a) => a.title), ['B', 'A', 'C']);
});

test('calendarThrough tells a finished published calendar from a recurring one', () => {
  const listed = base([
    { type: 'regular', label: 'Evening Meeting', recurrence: { kind: 'custom', weekday: 2, time: '18:00', dates: ['2026-11-10', '2026-12-08'] } },
    { type: 'work-session', label: 'Work Session', recurrence: { kind: 'custom', weekday: 2, time: '14:00', dates: ['2026-12-01'] } },
  ]);
  assert.equal(calendarThrough(listed), '2026-12-08');
  assert.equal(calendarThrough({ ...listed, scheduleExceptions: [{ date: '2026-12-15', status: 'special', note: 'Extra meeting.' }] }), '2026-12-15');
  assert.equal(calendarThrough({ ...listed, scheduleExceptions: [{ date: '2026-12-22', status: 'recess', note: 'Break.' }] }), '2026-12-08', 'a recess adds no meeting');
  assert.equal(calendarThrough(base([tuesdays, listed.meetings[1]])), null, 'a recurring rule never runs out');
  assert.equal(nextMeetingFor(listed, '2026-12-09'), null);
});

test('a localized city expands to the same meetings and ids, with display text in its language', () => {
  const workSessions = { type: 'work-session', label: 'City Council Work Session', openToPublicComment: true, recurrence: { kind: 'custom', weekday: 1, time: '18:00', dates: ['2026-11-02'] } };
  const city = base([tuesdays, workSessions], [
    { date: '2026-11-02', status: 'rescheduled', note: 'First November meeting moved from Tuesday Nov. 3 (Election Day) to Monday Nov. 2: Work Session 6 p.m., Regular Meeting 7 p.m.' },
    { date: '2026-11-03', status: 'cancelled', note: 'Election Day; no council meeting.' },
    { date: '2026-11-10', status: 'special', note: 'Special City Council Meeting at 6 p.m. to canvass election results.' },
  ]);
  const strings = {
    'City Council Regular Meeting': 'Reunión regular del concejo municipal',
    'City Council Work Session': 'Sesión de trabajo del concejo municipal',
    'First November meeting moved from Tuesday Nov. 3 (Election Day) to Monday Nov. 2: Work Session 6 p.m., Regular Meeting 7 p.m.': 'La primera reunión de noviembre se cambia del martes 3 de nov. (día de elecciones) al lunes 2 de nov.: sesión de trabajo 6 p.m., reunión regular 7 p.m.',
    'Special City Council Meeting at 6 p.m. to canvass election results.': 'Reunión especial del concejo municipal a las 6 de la tarde para el escrutinio.',
  };
  const key = (o) => `${o.id} ${o.date} ${o.time} ${o.status} ${o.type} ${o.openToPublicComment}`;
  const en = expandCityMeetings(city, '2026-11-01', '2026-11-12');
  try {
    setLocale('es');
    const es = expandCityMeetings(localizeCity(city, strings), '2026-11-01', '2026-11-12');
    assert.deepEqual(es.map(key), en.map(key));
    assert.equal(es.find((o) => o.type === 'regular' && o.status === 'rescheduled').label, 'Reunión regular del concejo municipal');
    assert.equal(es.find((o) => o.status === 'special').label, 'Reunión especial del concejo');
  } finally {
    setLocale('en');
  }
});
