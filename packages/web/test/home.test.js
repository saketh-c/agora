import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { localizeCities } from '@agora/core';
import { signupDeadline } from '../src/lib/deadline.js';
import { comingUp, daysUntil, eveningShare, findMeeting, firstVisitMeetings, fitsTimes, greetingKind, isSpeakable, pickNews, pickNextMeeting, pickPost, withinLimit } from '../src/components/home/homeData.js';

const raw = JSON.parse(readFileSync(new URL('../../../data/cities.json', import.meta.url))).cities;
const cities = localizeCities(raw, null);
const cityById = (id) => cities.find((c) => c.cityId === id) || null;
const rawById = (id) => raw.find((c) => c.cityId === id);
const TODAY = '2026-10-10';
const NOW = '2026-10-10T17:00:00.000Z';
const deadlineAt = (now) => (m) => signupDeadline((rawById(m.cityId).publicComment || {}).deadline || '', m, now);
const ANA = { interests: ['parks-recreation', 'transit'], location: { lat: 33.0208, lng: -96.6988 }, homeCityId: 'plano', maxMiles: 15 };

test('the first-visit list: speakable, after school or weekends, one per council, soonest first', () => {
  const list = firstVisitMeetings(cities, {}, { today: TODAY, now: NOW, deadlineOf: deadlineAt(NOW) });
  assert.equal(list.length, 3);
  assert.equal(new Set(list.map((m) => m.cityId)).size, 3, 'one per council');
  for (const m of list) {
    assert.ok(m.openToPublicComment && m.status !== 'cancelled', m.id);
    assert.ok(fitsTimes(m, {}), `${m.id} fits evenings and weekends`);
  }
  const keys = list.map((m) => `${m.date} ${m.time}`);
  assert.deepEqual(keys, [...keys].sort(), 'soonest first');
});

test('topics move councils that took them up recently to the top of the first-visit list', () => {
  const plain = firstVisitMeetings(cities, {}, { today: TODAY, now: NOW });
  const parks = firstVisitMeetings(cities, { interests: ['parks-recreation'] }, { today: TODAY, now: NOW });
  assert.notDeepEqual(
    parks.map((m) => m.cityId),
    plain.map((m) => m.cityId),
  );
  assert.ok(parks[0].reasons.some((r) => r.kind === 'topic' && r.points > 0), 'the first row is there because of the topic');
});

test('the next meeting is the best one the student can still speak at', () => {
  const next = pickNextMeeting(cities, cityById, ANA, { today: TODAY, now: NOW, deadlineOf: deadlineAt(NOW) });
  assert.equal(next.cityId, 'plano', 'home city first');
  assert.ok(next.openToPublicComment);
  // Monday at 5 PM Central, Plano's sign-up (4 PM that day) has closed: Home moves on.
  const late = '2026-10-12T22:00:00.000Z';
  const after = pickNextMeeting(cities, cityById, ANA, { today: '2026-10-12', now: late, deadlineOf: deadlineAt(late) });
  assert.notEqual(after.id, next.id);
  assert.equal(isSpeakable(next, deadlineAt(late)), false);
});

test('a meeting chosen in Prepare stays the next meeting, even once its sign-up has closed', () => {
  const id = 'plano:2026-10-12:city-council-regular-meeting';
  const late = '2026-10-12T22:00:00.000Z';
  const next = pickNextMeeting(cities, cityById, ANA, { today: '2026-10-12', now: late, prepMeetingId: id, deadlineOf: deadlineAt(late) });
  assert.equal(next.id, id);
  // Once it has ended it no longer counts.
  const ended = pickNextMeeting(cities, cityById, ANA, { today: '2026-10-13', now: '2026-10-13T12:00:00.000Z', prepMeetingId: id });
  assert.notEqual(ended && ended.id, id);
  // "Just practicing" is not a meeting.
  assert.ok(pickNextMeeting(cities, cityById, ANA, { today: TODAY, now: NOW, prepMeetingId: 'practice' }));
});

test('coming up skips the featured council and reads soonest first', () => {
  const next = pickNextMeeting(cities, cityById, ANA, { today: TODAY, now: NOW });
  const rows = comingUp(cities, ANA, { today: TODAY, now: NOW, exclude: next });
  assert.equal(rows.length, 3);
  assert.ok(rows.every((m) => m.cityId !== next.cityId));
  assert.equal(new Set(rows.map((m) => m.cityId)).size, rows.length);
  const keys = rows.map((m) => `${m.date} ${m.time}`);
  assert.deepEqual(keys, [...keys].sort());
});

test('meetings resolve from their ids; junk ids resolve to nothing', () => {
  const m = findMeeting(cityById, 'plano:2026-10-12:city-council-regular-meeting');
  assert.equal(m && m.time, '19:00');
  assert.equal(findMeeting(cityById, 'nowhere:2026-10-12:x'), null);
  assert.equal(findMeeting(cityById, 'plano:not-a-date:x'), null);
  assert.equal(findMeeting(cityById, ''), null);
});

test('greeting kinds follow the days until the meeting', () => {
  const m = (date) => ({ date });
  assert.equal(greetingKind(null, TODAY), 'hi');
  assert.equal(greetingKind(m('2026-10-10'), TODAY), 'today');
  assert.equal(greetingKind(m('2026-10-11'), TODAY), 'tomorrow');
  assert.equal(greetingKind(m('2026-10-16'), TODAY), 'day');
  assert.equal(greetingKind(m('2026-10-17'), TODAY), 'date');
  assert.equal(daysUntil(m('2026-10-12'), TODAY), 2);
});

test('the evening share counts real meetings in the window', () => {
  const share = eveningShare(cities, { today: TODAY, now: NOW });
  assert.ok(share.total > 100);
  assert.ok(share.inTen >= 0 && share.inTen <= 10);
});

test('headlines on your topics and city come first; otherwise the newest', () => {
  const items = [
    { title: 'A', link: 'a', publishedAt: '2026-10-09', topics: ['housing'], places: [] },
    { title: 'B', link: 'b', publishedAt: '2026-10-01', topics: ['transit'], places: ['plano'] },
    { title: 'C', link: 'c', publishedAt: '2026-10-08', topics: ['parks-recreation'], places: [] },
    { title: 'D', link: 'd', publishedAt: '2026-10-10', topics: [], places: [] },
  ];
  assert.deepEqual(
    pickNews(items, { interests: ['transit', 'parks-recreation'], homeCityId: 'plano' }).map((i) => i.title),
    ['B', 'C'],
  );
  assert.deepEqual(
    pickNews(items, {}).map((i) => i.title),
    ['D', 'A', 'C'],
  );
});

test('the featured post is from your city when there is one', () => {
  const posts = [
    { title: 'Dallas', cityId: 'dallas', postedAt: '2026-10-10' },
    { title: 'Plano', cityId: 'plano', postedAt: '2026-10-01' },
  ];
  assert.equal(pickPost(posts, { homeCityId: 'plano' }).title, 'Plano');
  assert.equal(pickPost(posts, {}).title, 'Dallas');
  assert.equal(pickPost([], {}), null);
});

test('a tight distance limit: near meetings first, then the nearest farther ones, never quietly empty', () => {
  const garland = { location: { lat: 32.9126, lng: -96.6389 }, homeCityId: 'garland', maxMiles: 5 };
  const next = pickNextMeeting(cities, cityById, garland, { today: TODAY, now: NOW });
  assert.ok(withinLimit(next, garland), 'the featured meeting is within the limit when one exists');
  const rows = comingUp(cities, garland, { today: TODAY, now: NOW, exclude: next });
  assert.equal(rows.length, 3, 'filled with farther meetings instead of dropping them');
  const firstFar = rows.findIndex((m) => !withinLimit(m, garland));
  assert.ok(firstFar >= 0);
  assert.ok(rows.slice(firstFar).every((m) => !withinLimit(m, garland)), 'near rows come before far ones');
  // The far rows are the nearest of the far ones.
  const farIds = new Set(rows.filter((m) => !withinLimit(m, garland)).map((m) => m.cityId));
  const allFar = comingUp(cities, { ...garland, maxMiles: null }, { today: TODAY, now: NOW, exclude: next, limit: 40 }).filter((m) => m.distanceMiles > 5 && !farIds.has(m.cityId));
  const maxShown = Math.max(...rows.filter((m) => !withinLimit(m, garland)).map((m) => m.distanceMiles));
  assert.ok(allFar.filter((m) => m.distanceMiles < maxShown - 0.01).length <= 2, 'no much nearer council was skipped');
  // With any distance nothing counts as farther.
  const any = comingUp(cities, { ...garland, maxMiles: null }, { today: TODAY, now: NOW, exclude: next });
  assert.ok(any.every((m) => withinLimit(m, { ...garland, maxMiles: null })));
});
