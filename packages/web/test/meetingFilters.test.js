import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { setLocale, topicList, upcomingMeetings } from '@agora/core';
import {
  DEFAULT_WHEN,
  activeKeys,
  changedKeys,
  clearFilters,
  countyKey,
  dateWindow,
  mileChoices,
  parseQuery,
  passes,
  queryVocab,
  isPastRange,
  readFilters,
  relaxTogether,
  relaxations,
  sortMeetings,
  timeOfDay,
  windowDays,
  withoutKey,
  writeFilters,
} from '../src/lib/meetingFilters.js';

const cities = JSON.parse(readFileSync(new URL('../../../data/cities.json', import.meta.url))).cities;
const byId = new Map(cities.map((c) => [c.cityId, c]));
const cityIds = new Set(byId.keys());
const counties = new Set(cities.map((c) => countyKey(c.county)));
const topics = topicList().filter((tp) => tp.id !== 'other');
const SUNDAY = '2026-10-11';
const defaults = { when: DEFAULT_WHEN, after: true, speak: true, remote: false, miles: 15, near: 'home', sort: 'best' };
const read = (qs, d = defaults, today = SUNDAY) => readFilters(new URLSearchParams(qs), d, { today, cityIds, counties });

test('date presets cover the right days (Sunday Oct 11, 2026)', () => {
  assert.deepEqual(dateWindow({ when: 'today' }, SUNDAY), { from: SUNDAY, to: SUNDAY });
  assert.deepEqual(dateWindow({ when: 'tomorrow' }, SUNDAY), { from: '2026-10-12', to: '2026-10-12' });
  // On a Sunday what is left of the weekend is today; on a Wednesday it is the coming Sat and Sun.
  assert.deepEqual(dateWindow({ when: 'weekend' }, SUNDAY), { from: SUNDAY, to: SUNDAY });
  assert.deepEqual(dateWindow({ when: 'weekend' }, '2026-10-14'), { from: '2026-10-17', to: '2026-10-18' });
  assert.deepEqual(dateWindow({ when: 'weekend' }, '2026-10-17'), { from: '2026-10-17', to: '2026-10-18' });
  // A US week ends on Saturday.
  assert.deepEqual(dateWindow({ when: 'week' }, SUNDAY), { from: SUNDAY, to: '2026-10-17' });
  assert.deepEqual(dateWindow({ when: 'week' }, '2026-10-15'), { from: '2026-10-15', to: '2026-10-17' });
  assert.deepEqual(dateWindow({ when: '2weeks' }, SUNDAY), { from: SUNDAY, to: '2026-10-24' });
  assert.equal(windowDays(dateWindow({ when: '2weeks' }, SUNDAY)), 14);
  assert.deepEqual(dateWindow({ when: 'month' }, SUNDAY), { from: SUNDAY, to: '2026-10-31' });
  assert.deepEqual(dateWindow({ when: 'month' }, '2026-02-10'), { from: '2026-02-10', to: '2026-02-28' });
  assert.equal(windowDays(dateWindow({ when: '3months' }, SUNDAY)), 90);
});

test('custom ranges are clamped to today .. 180 days out and never inverted', () => {
  assert.deepEqual(dateWindow({ when: 'custom', from: '2026-10-20', to: '2026-10-22' }, SUNDAY), { from: '2026-10-20', to: '2026-10-22' });
  assert.deepEqual(dateWindow({ when: 'custom', from: '2026-09-01', to: '2026-10-12' }, SUNDAY), { from: SUNDAY, to: '2026-10-12' });
  assert.deepEqual(dateWindow({ when: 'custom', from: '2026-10-22', to: '2026-10-20' }, SUNDAY), { from: '2026-10-22', to: '2026-10-22' });
  assert.deepEqual(dateWindow({ when: 'custom', from: '', to: '' }, SUNDAY), { from: SUNDAY, to: '2026-10-24' });
  assert.equal(dateWindow({ when: 'custom', from: SUNDAY, to: '2028-01-01' }, SUNDAY).to, '2027-04-09');
});

test('time of day', () => {
  assert.equal(timeOfDay('08:30'), 'morning');
  assert.equal(timeOfDay('11:59'), 'morning');
  assert.equal(timeOfDay('12:00'), 'afternoon');
  assert.equal(timeOfDay('16:30'), 'afternoon');
  assert.equal(timeOfDay('17:00'), 'evening');
  assert.equal(timeOfDay('19:00'), 'evening');
});

test('URL round trip keeps only what differs from the defaults', () => {
  const f = read('');
  assert.equal(f.when, '2weeks');
  assert.equal(f.after, true);
  assert.equal(f.miles, 15);
  assert.equal(String(writeFilters(new URLSearchParams(), f, defaults)), '');

  const g = { ...f, when: 'custom', from: '2026-10-13', to: '2026-10-20', dow: [2, 4], time: ['evening'], after: false, miles: 40, near: 'school', topics: ['transit'], counties: ['dallas'], cities: ['plano'], sort: 'nearest' };
  const qs = writeFilters(new URLSearchParams('view=map&meeting=x'), g, defaults);
  assert.equal(qs.get('view'), 'map');
  assert.equal(qs.get('meeting'), 'x');
  assert.equal(qs.get('dow'), 'tue,thu');
  assert.equal(qs.get('after'), '0');
  assert.equal(qs.get('speak'), null);
  const back = read(qs.toString());
  for (const k of ['when', 'from', 'to', 'dow', 'time', 'after', 'speak', 'miles', 'near', 'topics', 'counties', 'cities', 'sort']) assert.deepEqual(back[k], g[k], k);

  // Any distance is written as miles=any; a point origin carries its coordinates and label.
  const h = writeFilters(new URLSearchParams(), { ...f, miles: null, near: 'pt', pt: { lat: 33.02084, lng: -96.69881, label: 'K Ave, Plano' } }, defaults);
  assert.equal(h.get('miles'), 'any');
  assert.equal(h.get('at'), '33.021,-96.699');
  const pt = read(h.toString());
  assert.equal(pt.miles, null);
  assert.deepEqual(pt.pt, { lat: 33.021, lng: -96.699, label: 'K Ave, Plano' });
});

test('bad or old URL values fall back sensibly', () => {
  assert.equal(read('when=nope').when, '2weeks');
  assert.equal(read('days=14').when, '2weeks');
  const old = read('days=30');
  assert.equal(old.when, 'custom');
  assert.deepEqual(dateWindow(old, SUNDAY), { from: SUNDAY, to: '2026-11-09' });
  assert.equal(read('miles=50').miles, 50, 'any linked distance is kept');
  assert.equal(read('miles=-3').miles, 15);
  assert.equal(read('near=atlantis').near, 'home');
  assert.equal(read('near=dallas').near, 'dallas');
  assert.equal(read('near=pt').near, 'home', 'a point origin without coordinates is dropped');
  assert.deepEqual(read('topics=transit,bogus,transit').topics, ['transit']);
  assert.deepEqual(read('county=Dallas,Nowhere').counties, ['dallas']);
  assert.deepEqual(read('dow=sun,mon,xyz').dow, [1, 0], 'Monday first, Sunday last');
  assert.equal(read('from=2026-10-20').when, 'custom');
  assert.equal(read('sort=random').sort, 'best');
});

test('mile choices include 40, 60 and any value in play', () => {
  assert.deepEqual(mileChoices(), [5, 10, 15, 25, 40, 60]);
  assert.deepEqual(mileChoices(50, null, 15), [5, 10, 15, 25, 40, 50, 60]);
});

test('active filters, removing one, and clearing all', () => {
  const f = read('when=week&dow=tue&time=evening&remote=1&topics=transit,housing&county=dallas&cities=plano');
  const keys = activeKeys(f);
  assert.deepEqual(keys, ['when', 'dow', 'time', 'after', 'speak', 'remote', 'miles', 'topic:transit', 'topic:housing', 'county:dallas', 'city:plano']);
  assert.equal(activeKeys(f, { hasOrigin: false }).includes('miles'), false, 'distance needs an origin');
  assert.deepEqual(withoutKey(f, 'topic:transit').topics, ['housing']);
  assert.equal(withoutKey(f, 'when').when, DEFAULT_WHEN);
  assert.equal(withoutKey({ ...f, when: DEFAULT_WHEN }, 'when').when, '3months', 'removing the default window widens it');
  assert.equal(withoutKey(f, 'miles').miles, null);
  const cleared = clearFilters({ ...f, q: 'plano', near: 'school', sort: 'nearest' });
  assert.deepEqual(activeKeys(cleared), []);
  assert.equal(cleared.q, 'plano', 'search stays');
  assert.equal(cleared.near, 'school', 'where distance is measured from stays');
  // Cleared filters are written explicitly, so the profile defaults do not come back.
  const qs = writeFilters(new URLSearchParams(), cleared, defaults);
  assert.equal(qs.get('after'), '0');
  assert.equal(qs.get('speak'), '0');
  assert.equal(qs.get('miles'), 'any');
  assert.deepEqual(activeKeys(read(qs.toString())), []);
});

test('search understands counties, weekdays, dates and words in Spanish and Vietnamese', () => {
  const ctx = { cities, topics, today: SUNDAY };
  const dc = parseQuery('Dallas County', ctx);
  assert.deepEqual([...dc.counties], ['dallas']);
  assert.equal(dc.terms.length, 0);
  assert.deepEqual([...parseQuery('denton co', ctx).counties], ['denton']);
  const tue = parseQuery('tuesday', ctx);
  assert.deepEqual([...tue.weekdays], [2]);
  assert.deepEqual([...parseQuery('Tuesdays and thu', { ...ctx }).weekdays].sort(), [2, 4]);
  const mix = parseQuery('plano tuesday', ctx);
  assert.deepEqual([...mix.weekdays], [2]);
  assert.deepEqual([...mix.terms[0].cityIds], ['plano']);
  assert.deepEqual([...parseQuery('oct 20', ctx).dates], ['2026-10-20']);
  assert.deepEqual([...parseQuery('10/20', ctx).dates], ['2026-10-20']);
  assert.deepEqual([...parseQuery('sep 1', ctx).dates], ['2027-09-01'], 'a past date means next year');
  assert.equal(parseQuery('tomorrow', ctx).dateWord, 'tomorrow');
  assert.equal(parseQuery('this weekend', ctx).dateWord, 'weekend');
  // A city that shares its county's name offers the county too.
  assert.equal(parseQuery('dallas', ctx).countyHint, 'dallas');
  assert.deepEqual([...parseQuery('dallas', ctx).terms[0].cityIds], ['dallas']);
  // Bare county names still find the county's cities.
  assert.ok(parseQuery('tarrant', ctx).terms[0].cityIds.has('fort-worth'));
  // Two words that are a city and a topic.
  const pp = parseQuery('plano parks', ctx);
  assert.equal(pp.terms.length, 2);
  assert.ok(pp.terms[1].topicIds.includes('parks-recreation'));

  setLocale('es');
  try {
    const es = parseQuery('martes condado de Collin', { ...ctx, vocab: queryVocab('es') });
    assert.deepEqual([...es.weekdays], [2]);
    assert.deepEqual([...es.counties], ['collin']);
    assert.deepEqual([...parseQuery('20 de octubre', { ...ctx, vocab: queryVocab('es') }).dates], ['2026-10-20']);
    assert.equal(parseQuery('mañana', { ...ctx, vocab: queryVocab('es') }).dateWord, 'tomorrow');
  } finally {
    setLocale('en');
  }
  setLocale('vi');
  try {
    const vi = parseQuery('Thứ Ba', { ...ctx, vocab: queryVocab('vi') });
    assert.deepEqual([...vi.weekdays], [2]);
    assert.deepEqual([...parseQuery('Thứ Năm quận Dallas', { ...ctx, vocab: queryVocab('vi') }).counties], ['dallas']);
  } finally {
    setLocale('en');
  }
});

const meetings = upcomingMeetings(cities, { from: SUNDAY, days: 30 });
const topicsAt = () => new Set();
const ctxFor = (f, extra = {}) => ({
  cityById: (id) => byId.get(id),
  topicsAt,
  countyOf: (id) => countyKey(byId.get(id).county),
  milesTo: () => 3,
  hasOrigin: true,
  query: f.q ? parseQuery(f.q, { cities, topics, today: SUNDAY }) : null,
  ...extra,
});
const run = (f, extra) => meetings.filter((m) => passes(m, f, ctxFor(f, extra)));

test('filters combine with AND, places with OR', () => {
  const none = clearFilters(read(''));
  const all = run(none);
  assert.equal(all.length, meetings.length);
  const tueEve = run({ ...none, dow: [2], time: ['evening'] });
  assert.ok(tueEve.length > 0);
  assert.ok(tueEve.every((m) => m.weekday === 2 && m.time >= '17:00'));
  const places = run({ ...none, counties: ['collin'], cities: ['dallas'] });
  assert.ok(places.some((m) => m.cityId === 'dallas'));
  assert.ok(places.some((m) => m.cityId === 'plano'));
  assert.ok(places.every((m) => m.cityId === 'dallas' || byId.get(m.cityId).county === 'Collin'));
  const far = run({ ...none, miles: 2 });
  assert.equal(far.length, 0, 'everything is 3 mi away in this test');
  assert.equal(run({ ...none, miles: 2 }, { hasOrigin: false }).length, meetings.length, 'no origin, no distance filter');
  const search = run({ ...none, q: 'dallas county tuesday' });
  assert.ok(search.every((m) => byId.get(m.cityId).county === 'Dallas' && m.weekday === 2));
});

test('one-tap fixes say which filter hides meetings', () => {
  const count = (g) => run(g, { milesTo: (id) => (id === 'dallas' ? 20 : 3) }).length;
  const f = { ...read('q=dallas&after=0&speak=0'), miles: 5 };
  assert.equal(count(f), 0);
  const fixes = relaxations(f, activeKeys(f), count);
  assert.deepEqual(fixes.map((x) => x.key), ['miles'], 'only the distance limit hides Dallas');
  assert.ok(fixes[0].count > 0);
  // Dallas meets during school hours: with After school on too, no single filter is enough.
  const both = { ...read('q=dallas&speak=0'), miles: 5 };
  assert.equal(count(both), 0);
  assert.deepEqual(relaxations(both, activeKeys(both), count), []);
  assert.ok(count(clearFilters(both)) > 0, 'clearing all is the way out');
});

test('sorting: soonest, nearest and best with a per-council cap', () => {
  const list = meetings.slice(0, 20);
  const soon = sortMeetings(list, 'soonest');
  for (let i = 1; i < soon.length; i += 1) assert.ok(`${soon[i - 1].date}${soon[i - 1].time}` <= `${soon[i].date}${soon[i].time}`);
  const miles = (id) => (id === 'plano' ? 1 : id === 'allen' ? 2 : 9);
  const near = sortMeetings(list, 'nearest', { milesTo: miles });
  assert.ok(miles(near[0].cityId) <= miles(near[near.length - 1].cityId));
  const best = sortMeetings(list, 'best', { scoreOf: (m) => (m.cityId === list[0].cityId ? 10 : 0), perCity: 1 });
  assert.equal(best[0].cityId, list[0].cityId);
  assert.notEqual(best[1].cityId, list[0].cityId, 'a council places one meeting before the others');
});

test('the Filters count is what differs from the profile, not what is on by default', () => {
  assert.deepEqual(changedKeys(read(''), defaults), [], 'a returning student who changed nothing');
  assert.deepEqual(activeKeys(read('')), ['after', 'speak', 'miles'], 'the removable chips still know what is on');
  assert.deepEqual(changedKeys(read('speak=0'), defaults), ['speak'], 'turning a default off counts');
  assert.deepEqual(changedKeys(read('miles=any'), defaults), ['miles']);
  assert.deepEqual(changedKeys(read('near=school'), defaults), ['miles'], 'the same limit from another place is a change');
  assert.deepEqual(changedKeys(read('near=school&miles=any'), defaults), ['miles']);
  assert.deepEqual(changedKeys(read('when=week&dow=tue&topics=transit,housing'), defaults), ['when', 'dow', 'topic:transit', 'topic:housing']);
  // No place: distance does not count either way.
  const noPlace = { ...defaults, miles: null, near: null, sort: 'soonest' };
  assert.deepEqual(changedKeys(read('', noPlace), noPlace, { hasOrigin: false }), []);
});

test('a date range that is over falls back to the default window', () => {
  assert.equal(isPastRange('2026-09-14', '2026-09-30', SUNDAY), true);
  assert.equal(isPastRange('2026-09-14', '2026-10-11', SUNDAY), false, 'one that ends today still counts');
  assert.equal(isPastRange('2026-09-20', '', SUNDAY), true, 'no end: two weeks from the start');
  assert.equal(isPastRange('', '', SUNDAY), false);
  const old = read('when=custom&from=2026-09-14&to=2026-09-30');
  assert.equal(old.when, DEFAULT_WHEN);
  assert.deepEqual(dateWindow(old, SUNDAY), { from: SUNDAY, to: '2026-10-24' });
  const current = read('when=custom&from=2026-10-01&to=2026-10-20');
  assert.equal(current.when, 'custom', 'a range still running is kept');
  assert.deepEqual(dateWindow(current, SUNDAY), { from: SUNDAY, to: '2026-10-20' });
});

test('when no single filter is enough, the fewest to give up together, keeping the student’s own', () => {
  // A council 20 mi away (past the 15 mi limit) that meets in three weeks, after school.
  const later = { date: '2026-11-02', time: '19:00', cityId: 'irving', weekday: 1, isSchoolHours: false, openToPublicComment: true, agendaItems: [], label: 'City Council' };
  const pool = [later];
  const countFor = (g) => {
    const w = dateWindow(g, SUNDAY);
    return pool.filter((m) => m.date >= w.from && m.date <= w.to && passes(m, g, ctxFor(g, { milesTo: () => 20 }))).length;
  };
  const f = read('');
  assert.equal(countFor(f), 0);
  const keys = [...activeKeys(f), 'when'];
  assert.deepEqual(relaxations(f, keys, countFor), [], 'neither the window nor the distance alone shows it');
  const together = relaxTogether(f, keys, countFor);
  assert.deepEqual(together, { keys: ['miles', 'when'], count: 1 }, 'Can speak and After school stay on');
  assert.equal(relaxTogether(f, keys, () => 0), null, 'nothing to offer when nothing would show');
});
