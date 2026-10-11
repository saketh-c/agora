import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PREP_STEPS, PREP_MAX_MEETINGS, normalizePrep, prepSummary, withPrepStep } from '../src/lib/prep.js';

test('steps toggle per meeting and summarize as N of 4 with the next step', () => {
  let prep = {};
  prep = withPrepStep(prep, 'plano:2026-10-12:x', 'write', true, '2026-10-09T00:00:00.000Z');
  let s = prepSummary(prep, 'plano:2026-10-12:x');
  assert.equal(s.done, 1);
  assert.equal(s.total, PREP_STEPS.length);
  assert.equal(s.next, 'signup');
  prep = withPrepStep(prep, 'plano:2026-10-12:x', 'signup', true);
  assert.equal(prepSummary(prep, 'plano:2026-10-12:x').next, 'practice');
  prep = withPrepStep(prep, 'plano:2026-10-12:x', 'after', true);
  assert.equal(prepSummary(prep, 'plano:2026-10-12:x').done, 2, 'the after step is tracked but not counted');
  prep = withPrepStep(prep, 'plano:2026-10-12:x', 'write', false);
  assert.equal(prepSummary(prep, 'plano:2026-10-12:x').steps.write, false);
  assert.deepEqual(prepSummary(prep, 'other').done, 0);
});

test('old entries are dropped beyond the cap, newest kept', () => {
  const raw = {};
  for (let i = 0; i < PREP_MAX_MEETINGS + 5; i++) raw[`m${i}`] = { write: true, at: new Date(Date.UTC(2026, 0, 1 + i)).toISOString() };
  const n = normalizePrep(raw);
  assert.equal(Object.keys(n).length, PREP_MAX_MEETINGS);
  assert.ok(n[`m${PREP_MAX_MEETINGS + 4}`]);
  assert.equal(n.m0, undefined);
});

// ---- Round 2: per-meeting checklist, carry-over, one shared meeting, the picker ----
import { readFileSync } from 'node:fs';
import { cityPoint, localizeCities } from '@agora/core';
import { CARRY_STEPS, PRACTICE_ONLY, carryPrep, carryableSteps, checkedItems, withPrepChecklist } from '../src/lib/prep.js';
import { canSpeakAt, pickerMeetings, queryRank, resolvePrepMeeting, PICKER_HOME_DATES } from '../src/components/prepare/prepPick.js';
import { fitsTimes, pickNextMeeting } from '../src/components/home/homeData.js';
import { signupDeadline } from '../src/lib/deadline.js';

const raw = JSON.parse(readFileSync(new URL('../../../data/cities.json', import.meta.url))).cities;
const cities = localizeCities(raw, null);
const cityById = (id) => cities.find((c) => c.cityId === id) || null;
const rawById = (id) => raw.find((c) => c.cityId === id);
const TODAY = '2026-10-10';
const NOW = '2026-10-10T17:00:00.000Z';
const deadlineOf = (m) => signupDeadline((rawById(m.cityId).publicComment || {}).deadline || '', m, NOW);
const place = (cityId, extra = {}) => {
  const c = cityById(cityId);
  return { homeCityId: cityId, location: cityPoint(c), availability: { evenings: true, daytime: false, weekends: true }, maxMiles: 15, ...extra };
};

test('the On the day checklist is kept per meeting and decides the day step', () => {
  let prep = {};
  prep = withPrepChecklist(prep, 'a', [0, 2], 6, '2026-10-09T00:00:00.000Z');
  assert.deepEqual(prepSummary(prep, 'a').checklist, [0, 2]);
  assert.equal(prepSummary(prep, 'a').steps.day, false);
  assert.deepEqual(prepSummary(prep, 'b').checklist, null, 'another meeting starts empty');
  prep = withPrepChecklist(prep, 'a', [0, 1, 2, 3, 4, 5, 5, 99, -1], 6);
  assert.deepEqual(prepSummary(prep, 'a').checklist, [0, 1, 2, 3, 4, 5], 'cleaned: unique, sorted, in range');
  assert.equal(prepSummary(prep, 'a').steps.day, true, 'all items checked marks the day done');
  prep = withPrepChecklist(prep, 'a', [0, 1], 6);
  assert.equal(prepSummary(prep, 'a').steps.day, false, 'unchecking one undoes it');
  prep = withPrepChecklist(prep, 'a', [], 6);
  assert.equal(prep.a, undefined, 'an empty entry is dropped');
  // survives normalizing (as the store does on every write)
  const kept = normalizePrep(withPrepChecklist({}, 'a', [1, 3], 6, '2026-10-09T00:00:00.000Z'));
  assert.deepEqual(kept.a.checklist, [1, 3]);
  // an old day step without a checklist reads as fully checked
  assert.deepEqual(checkedItems(prepSummary({ a: { day: true, at: '' } }, 'a'), 3), [0, 1, 2]);
  assert.deepEqual(checkedItems(prepSummary({}, 'a'), 3), []);
});

test('Write and Practice carry over to another meeting; nothing else does, nothing is unchecked', () => {
  let prep = {};
  for (const s of ['signup', 'write', 'practice']) prep = withPrepStep(prep, 'a', s, true);
  prep = withPrepChecklist(prep, 'a', [0, 1, 2], 3);
  assert.deepEqual(carryableSteps(prep, 'a', 'b'), [...CARRY_STEPS]);
  const next = carryPrep(prep, 'a', 'b');
  const b = prepSummary(next, 'b');
  assert.equal(b.steps.write && b.steps.practice, true);
  assert.equal(b.steps.signup || b.steps.day, false, 'sign up and the day are per meeting');
  assert.equal(b.checklist, null);
  assert.deepEqual(carryableSteps(next, 'a', 'b'), [], 'nothing left to carry');
  assert.equal(carryPrep(prep, 'a', 'a'), prep);
  assert.deepEqual(carryableSteps(prep, PRACTICE_ONLY, 'b'), [], 'nothing done while just practicing');
});

test('Prepare defaults to the meeting Home shows, for students with evening-only times too', () => {
  for (const id of ['plano', 'irving', 'mckinney', 'highland-park', 'garland', 'dallas', 'fort-worth']) {
    const prefs = place(id);
    const home = pickNextMeeting(cities, cityById, prefs, { today: TODAY, now: NOW, deadlineOf });
    const r = resolvePrepMeeting({ cities, cityById, prefs, today: TODAY, now: NOW, deadlineOf });
    assert.equal(r.source, 'default');
    assert.equal(r.meeting && r.meeting.id, home && home.id, id);
  }
});

test('the address, then the saved meeting, then the default; an unknown id says so', () => {
  const prefs = place('plano');
  const home = pickNextMeeting(cities, cityById, prefs, { today: TODAY, now: NOW, deadlineOf });
  const other = pickerMeetings({ cities, cityById, prefs, today: TODAY, now: NOW, deadlineOf }).others[0];
  assert.ok(other && other.id !== home.id);
  let r = resolvePrepMeeting({ cities, cityById, prefs, today: TODAY, now: NOW, savedId: other.id, deadlineOf });
  assert.equal(r.meeting.id, other.id);
  assert.equal(r.source, 'saved');
  r = resolvePrepMeeting({ cities, cityById, prefs, today: TODAY, now: NOW, urlId: home.id, savedId: other.id, deadlineOf });
  assert.equal(r.meeting.id, home.id, 'the address wins');
  assert.equal(r.askedId, home.id);
  r = resolvePrepMeeting({ cities, cityById, prefs, today: TODAY, now: NOW, urlId: 'plano:2020-01-01:nope', deadlineOf });
  assert.equal(r.problem, 'notFound');
  assert.equal(r.meeting.id, home.id, 'falls back to the default');
  r = resolvePrepMeeting({ cities, cityById, prefs, today: TODAY, now: NOW, savedId: PRACTICE_ONLY, deadlineOf });
  assert.equal(r.practicing, true);
  assert.equal(r.meeting, null);
  r = resolvePrepMeeting({ cities, cityById, prefs: {}, today: TODAY, now: NOW, deadlineOf });
  assert.equal(r.practicing, true, 'no place set: just practicing');
  r = resolvePrepMeeting({ cities, cityById, prefs: {}, today: TODAY, now: NOW, cityParam: 'richardson', deadlineOf });
  assert.equal(r.meeting.cityId, 'richardson', 'an old ?city= link uses that council');
});

test('both pickers offer times that work and councils within the limit; any past it say so', () => {
  // An Irving student with a 5 mile limit who can only make evenings and weekends.
  const prefs = place('irving', { maxMiles: 5 });
  const lists = pickerMeetings({ cities, cityById, prefs, today: TODAY, now: NOW, deadlineOf, limit: 30 });
  assert.ok(lists.home.every((m) => m.cityId === 'irving'), 'the home council first');
  assert.ok(lists.others.length > 0);
  assert.ok(lists.others.every((m) => fitsTimes(m, prefs)), 'no meeting during school for an evenings-only student');
  const firstFar = lists.others.findIndex((m) => m.pastLimit);
  const near = firstFar < 0 ? lists.others : lists.others.slice(0, firstFar);
  assert.ok(near.every((m) => m.distanceMiles <= 5 && !m.pastLimit));
  const far = firstFar < 0 ? [] : lists.others.slice(firstFar);
  assert.ok(far.length > 0 && far.every((m) => m.pastLimit && m.distanceMiles > 5), 'past the limit is labelled');
  const miles = far.map((m) => m.distanceMiles);
  assert.deepEqual(miles, [...miles].sort((a, b) => a - b), 'the nearest councils past the limit first');
  // With any distance, nothing is past a limit and the list is soonest first.
  const any = pickerMeetings({ cities, cityById, prefs: { ...prefs, maxMiles: null }, today: TODAY, now: NOW, deadlineOf });
  assert.ok(any.others.every((m) => !m.pastLimit));
  const keys = any.others.map((m) => `${m.date} ${m.time}`);
  assert.deepEqual(keys, [...keys].sort());
});

test('a meeting in the address that only the live agendas know is looked for, not called gone, until they load', () => {
  const prefs = place('plano');
  const liveOnly = 'denton:2026-10-13:joint-special-called-meeting-with-denton-isd-board-of-directors';
  const waiting = resolvePrepMeeting({ cities, cityById, prefs, today: TODAY, now: NOW, urlId: liveOnly, deadlineOf, liveReady: false });
  assert.equal(waiting.pending, true);
  assert.equal(waiting.problem, null, 'no "that meeting is over" while the agendas load');
  const answered = resolvePrepMeeting({ cities, cityById, prefs, today: TODAY, now: NOW, urlId: liveOnly, deadlineOf, liveReady: true });
  assert.equal(answered.pending, false);
  assert.equal(answered.problem, 'notFound', 'once they have answered, an unknown id says so');
  // A meeting the curated data has is found at once.
  const home = pickNextMeeting(cities, cityById, prefs, { today: TODAY, now: NOW, deadlineOf });
  const known = resolvePrepMeeting({ cities, cityById, prefs, today: TODAY, now: NOW, urlId: home.id, deadlineOf, liveReady: false });
  assert.equal(known.meeting.id, home.id);
  assert.equal(known.pending, false);
});

test('the picker: home dates, ten more nearby, pages, and a search across every council', () => {
  const prefs = place('plano');
  const lists = pickerMeetings({ cities, cityById, prefs, today: TODAY, now: NOW, deadlineOf });
  assert.equal(lists.home.length, PICKER_HOME_DATES);
  assert.ok(lists.home.every((m) => m.cityId === 'plano'));
  assert.equal(lists.others.length, 10);
  assert.ok(lists.others.every((m) => m.cityId !== 'plano' && canSpeakAt(m, deadlineOf)));
  const keys = lists.others.map((m) => `${m.date} ${m.time}`);
  assert.deepEqual(keys, [...keys].sort(), 'soonest first');
  assert.equal(lists.more, true);
  const page2 = pickerMeetings({ cities, cityById, prefs, today: TODAY, now: NOW, deadlineOf, limit: 20 });
  assert.equal(page2.others.length, 20);
  const fw = pickerMeetings({ cities, cityById, prefs, today: TODAY, now: NOW, deadlineOf, query: 'fw' });
  assert.ok(fw.others.length > 0 && fw.others.every((m) => m.cityId === 'fort-worth'), 'initials');
  const dallas = pickerMeetings({ cities, cityById, prefs, today: TODAY, now: NOW, deadlineOf, query: 'Dallas' });
  assert.equal(dallas.others[0].cityId, 'dallas', 'the city before the rest of its county');
  const collin = pickerMeetings({ cities, cityById, prefs, today: TODAY, now: NOW, deadlineOf, query: 'collin county', limit: 50 });
  assert.ok(collin.others.length > 0 && collin.others.every((m) => cityById(m.cityId).county.startsWith('Collin')));
  assert.equal(pickerMeetings({ cities, cityById, prefs, today: TODAY, now: NOW, deadlineOf, query: 'zzzz' }).others.length, 0);
  assert.equal(queryRank({ cityName: 'Plano' }, cityById('plano'), 'pla'), 0);
  assert.equal(queryRank({ cityName: 'Plano' }, cityById('plano'), 'collin'), 1);
  assert.equal(queryRank({ cityName: 'Plano' }, cityById('plano'), 'tarrant'), -1);
  // No place: every council, soonest first
  const anywhere = pickerMeetings({ cities, cityById, prefs: {}, today: TODAY, now: NOW, deadlineOf });
  assert.equal(anywhere.home.length, 0);
  assert.equal(anywhere.others.length, 10);
});
