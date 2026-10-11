import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { placesOf } from '../src/lib/places.js';
import { resolveOrigin } from '../src/components/meetings/origin.js';

const cities = JSON.parse(readFileSync(new URL('../../../data/cities.json', import.meta.url))).cities;
const cityById = (id) => cities.find((c) => c.cityId === id) || null;

test('Meetings measures distance from Home, School, here, a city or a looked-up point', () => {
  const prefs = {
    homeCityId: 'plano',
    places: { home: { label: 'K Avenue, Plano', lat: 33.021, lng: -96.699, kind: 'address', cityId: 'plano' }, school: { label: 'Plano East Senior High', lat: 33.04, lng: -96.645, kind: 'address' } },
    origin: 'home',
  };
  const saved = placesOf(prefs, cityById);
  const home = resolveOrigin('home', { saved, cityById });
  assert.equal(home.id, 'home');
  assert.equal(home.label, 'home', 'reads inside a sentence: "Within 15 mi of home"');
  assert.equal(home.name, 'Home');
  assert.equal(home.detail, 'K Avenue, Plano');
  assert.equal(resolveOrigin('school', { saved, cityById }).detail, 'Plano East Senior High');
  // Where you are: only with a position.
  assert.equal(resolveOrigin('here', { saved, here: null, cityById }), null);
  assert.deepEqual(
    (({ lat, lng, label }) => ({ lat, lng, label }))(resolveOrigin('here', { saved, here: { lat: 32.78, lng: -96.8 }, cityById })),
    { lat: 32.78, lng: -96.8, label: 'where you are' },
  );
  // A covered city measures from its city hall.
  const denton = resolveOrigin('denton', { saved, cityById });
  assert.equal(denton.label, 'Denton');
  assert.equal(denton.detail, 'Denton City Hall');
  assert.equal(denton.lat, cityById('denton').cityHall.lat);
  // A looked-up point from the address.
  assert.equal(resolveOrigin('pt', { saved, pt: { lat: 33, lng: -96.7, label: 'Preston Rd, Plano' }, cityById }).label, 'Preston Rd, Plano');
  assert.equal(resolveOrigin('pt', { saved, pt: null, cityById }), null);
  assert.equal(resolveOrigin('atlantis', { saved, cityById }), null);
  // No School saved: nothing to measure from.
  assert.equal(resolveOrigin('school', { saved: placesOf({ location: { lat: 33.02, lng: -96.7 }, homeCityId: 'plano' }, cityById), cityById }), null);
});

test('an older setup (location only) still measures from its city hall as Home', () => {
  const saved = placesOf({ location: { lat: 33.0208, lng: -96.6988 }, locationLabel: 'Plano', homeCityId: 'plano' }, cityById);
  const home = resolveOrigin('home', { saved, cityById });
  assert.equal(home.detail, 'Plano City Hall');
});
