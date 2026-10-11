import { test } from 'node:test';
import assert from 'node:assert/strict';
import { setLocale } from '@agora/core';
import { loadData, engine, localizeOccurrence, matchCity, splitAgenda, calendarEnd, calendarGap, remoteState } from '../src/data.js';

const en = loadData('en');

test('with the current time, meetings that already ended today drop out', () => {
  const plano = en.cities.find((c) => c.cityId === 'plano');
  const day = engine(en).expand(plano, '2026-10-12', '2026-10-12');
  assert.ok(day.length >= 2, 'Plano has a 5 PM briefing and a 7 PM meeting on Oct 12');
  // 7:30 PM: the 5 PM session is over, the 7 PM meeting is still going.
  const evening = engine(en, { now: '2026-10-12T19:30:00-05:00' });
  const left = evening.expand(plano, '2026-10-12', '2026-10-12');
  assert.ok(left.length < day.length);
  assert.ok(left.every((m) => m.time >= '19:00'));
  const next = evening.next(plano, '2026-10-12');
  assert.equal(next.date, '2026-10-12');
  assert.ok(next.time >= '19:00');
  assert.ok(evening.upcoming({ from: '2026-10-12', days: 1 }).every((m) => m.cityId !== 'plano' || m.time >= '19:00'));
});

test('the Spanish and Vietnamese data expand to the same meetings as English', () => {
  const key = (m) => `${m.id}|${m.date}|${m.time}|${m.status}|${m.openToPublicComment}`;
  const base = engine(en)
    .upcoming({ from: '2026-10-01', days: 120, includeCancelled: true })
    .map(key);
  for (const lang of ['es', 'vi']) {
    setLocale(lang);
    const other = engine(loadData(lang))
      .upcoming({ from: '2026-10-01', days: 120, includeCancelled: true })
      .map(key);
    setLocale('en');
    assert.deepEqual(other, base, lang);
  }
});

test('localizeOccurrence translates display text and never leaves a half-English special meeting title', () => {
  const strings = { 'City Council Regular Meeting': 'Reunión regular', 'Moved here from Tuesday.': 'Se movió aquí desde el martes.', 'A long note about a special meeting.': 'Una nota larga.' };
  const occ = { cityId: 'x', type: 'regular', status: 'rescheduled', label: 'City Council Regular Meeting', note: 'Moved here from Tuesday.', agendaItems: [] };
  const out = localizeOccurrence(occ, { strings, cityById: new Map() });
  assert.equal(out.label, 'Reunión regular');
  assert.equal(out.note, 'Se movió aquí desde el martes.');
  assert.equal(occ.label, 'City Council Regular Meeting', 'the input is not changed');

  setLocale('es');
  const special = localizeOccurrence({ cityId: 'x', type: 'other', status: 'special', label: 'A long note about a spec...', note: 'A long note about a special meeting.', agendaItems: [] }, { strings, cityById: new Map() });
  setLocale('en');
  assert.notEqual(special.label, 'A long note about a spec...');
  assert.equal(special.note, 'Una nota larga.');
  assert.equal(localizeOccurrence(occ, { strings: null }), occ, 'English passes through');
});

test('matchCity accepts unique prefixes and initials, and refuses to guess between cities', () => {
  const { cities } = en;
  assert.equal(matchCity(cities, 'fort worth').city.cityId, 'fort-worth');
  assert.equal(matchCity(cities, 'Fort').city.cityId, 'fort-worth');
  assert.equal(matchCity(cities, 'fw').city.cityId, 'fort-worth');
  assert.equal(matchCity(cities, 'nrh').city.cityId, 'north-richland-hills');
  assert.equal(matchCity(cities, 'colony').city.cityId, 'the-colony');
  const park = matchCity(cities, 'park');
  assert.equal(park.city, null);
  assert.deepEqual(park.candidates.map((c) => c.name), ['Highland Park', 'University Park']);
  const typo = matchCity(cities, 'Plno');
  assert.equal(typo.city, null);
  assert.deepEqual(typo.candidates.map((c) => c.name), ['Plano']);
  assert.deepEqual(matchCity(cities, '  '), { city: null, candidates: [] });
  assert.deepEqual(matchCity(cities, 'Atlantis').candidates, []);
});

test('agenda split, calendar coverage and remote comment states', () => {
  const plano = en.cities.find((c) => c.cityId === 'plano');
  const dates = plano.agendaItems.map((a) => a.meetingDate).sort();
  const before = splitAgenda(plano, dates[0]);
  assert.equal(before.upcoming.length, plano.agendaItems.length);
  const after = splitAgenda(plano, '2026-10-10');
  assert.ok(after.upcoming.every((a) => !a.meetingDate || a.meetingDate >= '2026-10-10'));
  assert.ok(after.recent.every((a) => a.meetingDate < '2026-10-10'));

  const fortWorth = en.cities.find((c) => c.cityId === 'fort-worth');
  const end = calendarEnd(fortWorth);
  if (end) {
    assert.equal(calendarGap(fortWorth, end, 90), end, 'a calendar that runs out inside the window is reported');
    assert.equal(calendarGap(fortWorth, '2026-01-01', 30), null);
  }
  assert.equal(calendarEnd(plano), null, 'a repeating rule never runs out');
  assert.equal(remoteState({ publicComment: { virtualAllowed: true } }), 'yes');
  assert.equal(remoteState({ publicComment: { virtualAllowed: false } }), 'no');
  assert.equal(remoteState({ publicComment: {} }), 'unknown');
});
