import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { isDfwZip, judgeNominatim, matchAgendaItems, matchMeetings, nominatimRequest, normalizePrefs, resolveLocally, scoreMeeting, upcomingMeetings, zipOf } from '../src/index.js';

const cities = JSON.parse(readFileSync(new URL('../../../data/cities.json', import.meta.url))).cities;
const TODAY = '2026-10-10';
const PLANO = { lat: 33.0208, lng: -96.6988 };

test('requests: a ZIP uses the postal-code search, anything else a DFW-ranked free-text search', () => {
  assert.equal(zipOf('75074-1234'), '75074');
  assert.equal(zipOf('7507'), null);
  assert.ok(isDfwZip('76102'));
  assert.ok(!isDfwZip('78701'));
  const zip = nominatimRequest(' 75074 ');
  assert.equal(zip.key, 'zip:75074');
  assert.equal(zip.params.postalcode, '75074');
  assert.equal(zip.params.q, undefined);
  const text = nominatimRequest('Plano  East Senior High');
  assert.equal(text.key, 'q:plano east senior high');
  assert.equal(text.params.countrycodes, 'us');
  assert.ok(text.params.viewbox);
  assert.equal(text.params.bounded, undefined, 'ranked inside DFW, not boxed in');
});

test('covered cities and impossible ZIP codes resolve with no network', () => {
  assert.equal(resolveLocally('Plano, TX', cities).place.cityId, 'plano');
  assert.equal(resolveLocally('77002', cities).status, 'outside');
  assert.equal(resolveLocally('75074', cities), null, 'a DFW ZIP needs a lookup');
  assert.equal(resolveLocally('1520 K Ave', cities), null);
});

test('judging rows: schools are marked, labels carry no house number', () => {
  const row = { lat: '33.04', lon: '-96.645', name: 'Plano East Senior High School', category: 'amenity', type: 'school', addresstype: 'amenity', address: { house_number: '3000', road: 'Los Rios Boulevard', city: 'Plano', 'ISO3166-2-lvl4': 'US-TX' } };
  const r = judgeNominatim([row], 'Plano East Senior High School', cities);
  assert.equal(r.status, 'found');
  assert.equal(r.place.school, true);
  assert.equal(r.place.label, 'Plano East Senior High School, Plano');
  const house = { lat: '32.8905', lon: '-96.804', name: '', type: 'house', addresstype: 'place', address: { house_number: '10600', road: 'Preston Road', city: 'Dallas', 'ISO3166-2-lvl4': 'US-TX' } };
  const h = judgeNominatim([house], '10600 Preston Rd, Dallas', cities);
  assert.equal(h.place.kind, 'address');
  assert.equal(h.place.label, 'Preston Road, Dallas');
  assert.equal(h.place.school, undefined);
});

test('any distance (maxMiles null): kept by normalizePrefs, no penalty, nothing dropped', () => {
  assert.equal(normalizePrefs({ maxMiles: null }).maxMiles, null);
  assert.equal(normalizePrefs({}).maxMiles, 15);
  assert.equal(normalizePrefs({ maxMiles: 0 }).maxMiles, 15);
  assert.equal(normalizePrefs({ maxMiles: undefined }).maxMiles, 15);

  const all = upcomingMeetings(cities, { from: TODAY, days: 30 });
  const any = matchMeetings(cities, { location: PLANO, maxMiles: null }, { today: TODAY, days: 30, limit: 1000 });
  assert.equal(any.length, all.length, 'every meeting is ranked');
  for (const m of any) assert.ok(!m.reasons.some((r) => /past your/.test(r.text)), `${m.id} is never "past your limit"`);
  // Across the region, nearer still counts: past 15 mi, a point for every 5 mi started, at most 5.
  for (const m of any) {
    if (m.distanceMiles <= 15) continue;
    const d = m.reasons.find((r) => r.kind === 'distance' && /away/.test(r.text));
    assert.equal(d.points, -Math.min(5, Math.ceil((m.distanceMiles - 15) / 5)), m.id);
  }
  const fortWorth = all.find((m) => m.cityId === 'fort-worth');
  const s = scoreMeeting(fortWorth, cities.find((c) => c.cityId === 'fort-worth'), normalizePrefs({ location: PLANO, maxMiles: null }), { today: TODAY });
  assert.ok(s.distanceMiles > 25);
  assert.ok(!s.reasons.some((r) => /past your/.test(r.text)));
  assert.ok(s.reasons.some((r) => r.kind === 'distance' && r.points < 0), 'but it ranks lower than a nearer one');
  assert.ok(matchAgendaItems(cities, { location: PLANO, maxMiles: null }, { today: TODAY, recent: true, limit: 1000 }).some((i) => i.distanceMiles > 30));
});

test('keepFar ranks meetings past twice the limit instead of dropping them', () => {
  const near = matchMeetings(cities, { location: PLANO, maxMiles: 5 }, { today: TODAY, days: 30, limit: 1000 });
  assert.ok(near.every((m) => m.distanceMiles <= 10));
  const kept = matchMeetings(cities, { location: PLANO, maxMiles: 5 }, { today: TODAY, days: 30, limit: 1000, keepFar: true });
  assert.ok(kept.length > near.length);
  const firstFar = kept.findIndex((m) => m.distanceMiles > 10);
  assert.ok(firstFar > 0, 'nearer meetings still come first');
  assert.ok(kept.filter((m) => m.distanceMiles > 5).every((m) => m.reasons.some((r) => r.points === -5)));
});

test('a typed street address reads back as the street, even when a business is there', () => {
  const shop = { lat: '33.0392', lon: '-96.7319', name: 'Madness Games & Comics', category: 'shop', type: 'games', addresstype: 'shop', address: { shop: 'Madness Games & Comics', house_number: '3000', road: 'Custer Road', city: 'Plano', 'ISO3166-2-lvl4': 'US-TX' } };
  const r = judgeNominatim([shop], '3000 Custer Rd, Plano', cities);
  assert.equal(r.place.label, 'Custer Road, Plano');
  assert.equal(r.place.kind, 'address');
  const named = judgeNominatim([shop], 'Madness Games and Comics', cities);
  assert.equal(named.place.label, 'Madness Games & Comics, Plano');
  const school = { lat: '33.04', lon: '-96.645', name: 'Plano East Senior High School', category: 'amenity', type: 'school', addresstype: 'amenity', address: { house_number: '3000', road: 'Los Rios Boulevard', city: 'Plano', 'ISO3166-2-lvl4': 'US-TX' } };
  const typed = judgeNominatim([school], '3000 Los Rios Blvd', cities);
  assert.equal(typed.place.label, 'Los Rios Boulevard, Plano');
  assert.equal(typed.place.school, undefined, 'an address you typed is not called a school');
});
