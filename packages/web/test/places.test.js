import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { cityPoint, haversineMiles, localizeCities, normalizePrefs } from '@agora/core';
import { PlaceError, activeOrigin, cleanPlace, createBrowserGeocoder, lookupPlace, placeFromCity, placeFromDevice, placeFromLookup, placesOf, withHomeCity, withPlaces } from '../src/lib/places.js';

const raw = JSON.parse(readFileSync(new URL('../../../data/cities.json', import.meta.url))).cities;
const cities = localizeCities(raw, null);
const byId = (id) => cities.find((c) => c.cityId === id) || null;
const plano = byId('plano');
const garland = byId('garland');

const PESH = { label: 'Plano East Senior High School, Plano', lat: 33.04, lng: -96.645, kind: 'place', cityId: 'plano', school: true };
const PRESTON = { label: 'Preston Road, Dallas', lat: 32.8905, lng: -96.804, kind: 'address', cityId: 'dallas' };

test('places are repaired: DFW only, rounded to about a block, known kinds', () => {
  assert.equal(cleanPlace({ label: 'Houston', lat: 29.76, lng: -95.37, kind: 'city' }), null, 'outside DFW');
  assert.equal(cleanPlace({ label: 'x', lat: 'abc', lng: 1 }), null);
  assert.deepEqual(cleanPlace({ label: '  Somewhere  ', lat: 33.012345, lng: -96.698765, kind: 'weird', cityId: 'Bad Id!' }), { label: 'Somewhere', lat: 33.012, lng: -96.699, kind: 'address' });
  assert.equal(placeFromLookup({ ...PESH }).kind, 'address');
  assert.equal(placeFromLookup({ label: 'Plano, TX 75074', lat: 33.025, lng: -96.687, kind: 'postcode' }).kind, 'zip');
  assert.equal(placeFromCity(plano).kind, 'city');
  const here = placeFromDevice({ lat: 33.01987, lng: -96.69891 }, '2026-10-11T15:00:00.000Z');
  assert.deepEqual(here, { label: '', lat: 33.02, lng: -96.699, kind: 'current', at: '2026-10-11T15:00:00.000Z' });
});

test('an older setup reads as a Home place', () => {
  const hall = placesOf({ location: cityPoint(plano), locationLabel: 'Plano', homeCityId: 'plano' }, byId);
  assert.equal(hall.home.kind, 'city');
  assert.equal(hall.home.cityId, 'plano');
  assert.equal(hall.origin, 'home');
  // Without the city list, a bare name still reads as a city; a looked-up label does not.
  assert.equal(placesOf({ location: { lat: 33.0208, lng: -96.6988 }, locationLabel: 'Plano', homeCityId: 'plano' }).home.kind, 'city');
  assert.equal(placesOf({ location: PRESTON, locationLabel: 'Preston Road, Dallas', locationSource: 'search' }).home.kind, 'address');
  assert.equal(placesOf({ location: { lat: 33, lng: -96.7 }, locationSource: 'device', locationLabel: '' }).home.kind, 'current');
  assert.deepEqual(placesOf({}), { home: null, school: null, here: null, origin: 'home' });
});

test('withPlaces keeps the engine origin, its label and the home council in step', () => {
  let prefs = withPlaces({ maxMiles: 15 }, { home: placeFromLookup(PRESTON) }, cities);
  assert.deepEqual(prefs.location, { lat: 32.891, lng: -96.804 });
  assert.equal(prefs.locationLabel, 'Preston Road, Dallas');
  assert.equal(prefs.locationSource, 'search');
  assert.equal(prefs.homeCityId, 'dallas');
  assert.equal(prefs.origin, 'home');

  // Adding a school does not move the origin or the council; choosing it moves the origin only.
  prefs = withPlaces(prefs, { school: placeFromLookup(PESH) }, cities);
  assert.equal(prefs.origin, 'home');
  prefs = withPlaces(prefs, { origin: 'school' }, cities);
  assert.equal(prefs.locationLabel, PESH.label);
  assert.deepEqual(prefs.location, { lat: 33.04, lng: -96.645 });
  assert.equal(prefs.homeCityId, 'dallas', 'the council follows Home, not the origin');

  // Where I am now is a one-off origin: kept while chosen, dropped when you switch back.
  prefs = withPlaces(prefs, { here: placeFromDevice({ lat: 32.95, lng: -96.73 }), origin: 'here' }, cities);
  assert.equal(prefs.locationSource, 'device');
  assert.ok(prefs.places.here);
  prefs = withPlaces(prefs, { origin: 'home' }, cities);
  assert.equal(prefs.places.here, null);
  assert.equal(prefs.locationLabel, 'Preston Road, Dallas');

  // Removing the school while it is the origin falls back to Home.
  prefs = withPlaces(withPlaces(prefs, { origin: 'school' }, cities), { school: null }, cities);
  assert.equal(prefs.origin, 'home');
  assert.equal(activeOrigin(prefs).id, 'home');

  // A Home with no covered city named takes the nearest council.
  const near = withPlaces({}, { home: { label: 'Somewhere, Texas', lat: 33.03, lng: -96.71, kind: 'address' } }, cities);
  assert.equal(near.homeCityId, 'plano');
  // The engine accepts what withPlaces writes.
  assert.deepEqual(normalizePrefs(prefs).location, prefs.location);
});

test('Set as my city keeps a precise Home and changes only the council', () => {
  const precise = withPlaces({}, { home: placeFromDevice({ lat: 32.814, lng: -96.949 }) }, cities);
  const set = withHomeCity(precise, garland, cities);
  assert.equal(set.homeCityId, 'garland');
  assert.deepEqual(set.location, precise.location, 'distances still from your position');
  assert.equal(set.locationSource, 'device');

  const hallHome = withPlaces({}, { home: placeFromCity(plano) }, cities);
  const moved = withHomeCity(hallHome, garland, cities);
  assert.equal(moved.homeCityId, 'garland');
  assert.ok(haversineMiles(moved.location, cityPoint(garland)) < 0.1, 'a city Home moves to the new city hall');
  assert.equal(moved.locationSource, 'hall');
  assert.equal(moved.places.home.label, 'Garland');
  // Also without the city list (the store has none).
  assert.equal(withHomeCity(hallHome, garland).homeCityId, 'garland');
});

function nominatim(table, { status = 200 } = {}) {
  const calls = [];
  const fetch = async (url, init) => {
    const u = new URL(url);
    calls.push({ u, init });
    const key = u.searchParams.get('postalcode') || u.searchParams.get('q');
    return new Response(JSON.stringify(table[key] || []), { status, headers: { 'Content-Type': 'application/json' } });
  };
  return { fetch, calls };
}

function memoryStorage() {
  const m = new Map();
  return { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), m };
}

const ROW_PESH = { lat: '33.0400', lon: '-96.6450', name: 'Plano East Senior High School', category: 'amenity', type: 'school', addresstype: 'amenity', address: { amenity: 'Plano East Senior High School', house_number: '3000', road: 'Los Rios Boulevard', city: 'Plano', state: 'Texas', 'ISO3166-2-lvl4': 'US-TX', postcode: '75074' } };
const ROW_ZIP = { lat: '33.025', lon: '-96.687', name: '75074', type: 'postcode', addresstype: 'postcode', address: { postcode: '75074', city: 'Plano', state: 'Texas', 'ISO3166-2-lvl4': 'US-TX' } };

test('the browser geocoder follows the usage policy: one request a second, cached, identified', async () => {
  const net = nominatim({ 'Plano East Senior High School': [ROW_PESH], 75074: [ROW_ZIP] });
  let clock = 0;
  const storage = memoryStorage();
  const g = createBrowserGeocoder({ fetch: net.fetch, storage, minGapMs: 40, now: () => (clock = Date.now()) });

  const started = Date.now();
  const [a, b] = await Promise.all([g.lookup('Plano East Senior High School', cities), g.lookup('75074', cities)]);
  assert.ok(Date.now() - started >= 40, 'the second request waited its turn');
  assert.equal(a.status, 'found');
  assert.equal(a.place.school, true);
  assert.equal(a.place.cityId, 'plano');
  assert.equal(b.place.kind, 'postcode');
  assert.equal(net.calls.length, 2);
  const first = net.calls[0];
  assert.equal(first.u.searchParams.get('countrycodes'), 'us');
  assert.ok(first.u.searchParams.get('viewbox'));
  assert.equal(first.u.searchParams.get('accept-language'), 'en');
  assert.equal(first.init.referrerPolicy, 'strict-origin-when-cross-origin');
  assert.equal(first.init.credentials, 'omit');
  assert.equal(first.init.headers['User-Agent'], undefined);

  // Asked again: from the cache, also in a fresh geocoder in the same session.
  await g.lookup('plano east senior high school', cities);
  const again = createBrowserGeocoder({ fetch: net.fetch, storage, minGapMs: 0 });
  assert.equal((await again.lookup('75074', cities)).status, 'found');
  assert.equal(net.calls.length, 2);
  // Covered city names never leave the device.
  assert.equal((await g.lookup('Garland, TX', cities)).place.cityId, 'garland');
  assert.equal(net.calls.length, 2);
  assert.ok(clock > 0);
});

test('lookupPlace: the API first, the browser when there is no server, clear errors', async () => {
  const net = nominatim({ 'Plano East Senior High School': [ROW_PESH] });
  const geocoder = createBrowserGeocoder({ fetch: net.fetch, storage: memoryStorage(), minGapMs: 0 });
  const offline = { geocode: async () => Promise.reject(Object.assign(new Error('x'), { code: 'offline' })) };

  // Static deploy: straight to the browser geocoder.
  const viaBrowser = await lookupPlace('Plano East Senior High School', { cities, apiAvailable: false, geocoder });
  assert.equal(viaBrowser.label, 'Plano East Senior High School, Plano');
  // An API that cannot be reached falls back to the browser too.
  assert.equal((await lookupPlace('Plano East Senior High School', { cities, apiAvailable: true, api: offline, geocoder })).cityId, 'plano');
  // An API answer is used as is.
  const api = { geocode: async (q) => ({ ...PRESTON, query: q }) };
  assert.equal((await lookupPlace('10600 Preston Rd', { cities, apiAvailable: true, api, geocoder })).label, 'Preston Road, Dallas');

  // Errors.
  await assert.rejects(lookupPlace(' ', { cities, apiAvailable: false, geocoder }), (e) => e instanceof PlaceError && e.code === 'empty');
  await assert.rejects(lookupPlace('77002', { cities, apiAvailable: false, geocoder }), (e) => e.code === 'outside_area');
  await assert.rejects(lookupPlace('zzqqzz street', { cities, apiAvailable: false, geocoder }), (e) => e.code === 'not_found');
  const outside = { geocode: async () => Promise.reject(Object.assign(new Error('x'), { code: 'outside_area', data: { label: 'Houston, TX' } })) };
  await assert.rejects(lookupPlace('Houston', { cities, apiAvailable: true, api: outside, geocoder }), (e) => e.code === 'outside_area' && e.label === 'Houston, TX');
  const busy = createBrowserGeocoder({ fetch: nominatim({}, { status: 429 }).fetch, storage: memoryStorage(), minGapMs: 0 });
  await assert.rejects(lookupPlace('Main Street', { cities, apiAvailable: false, geocoder: busy }), (e) => e.code === 'busy');
  const down = createBrowserGeocoder({ fetch: async () => Promise.reject(new TypeError('fetch failed')), storage: memoryStorage(), minGapMs: 0 });
  await assert.rejects(lookupPlace('Main Street', { cities, apiAvailable: false, geocoder: down }), (e) => e.code === 'offline');
  const controller = new AbortController();
  controller.abort();
  await assert.rejects(lookupPlace('Main Street', { cities, apiAvailable: false, geocoder, signal: controller.signal }), (e) => e.code === 'aborted');
});
