import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createGeocoder, GeocodeError, DFW_ZIP_PREFIXES } from '../src/geocode.js';

const cities = [
  { cityId: 'plano', name: 'Plano', county: 'Collin', cityHall: { lat: 33.0198, lng: -96.6989 } },
  { cityId: 'dallas', name: 'Dallas', county: 'Dallas', cityHall: { lat: 32.77627, lng: -96.79694 } },
  { cityId: 'arlington', name: 'Arlington', county: 'Tarrant', cityHall: { lat: 32.7357, lng: -97.1073 } },
  { cityId: 'highland-park', name: 'Highland Park', county: 'Dallas', cityHall: { lat: 32.83, lng: -96.79 } },
];

// Rows shaped like Nominatim's jsonv2 answers with addressdetails=1 (taken from real responses).
const ROWS = {
  zip75075: { lat: '33.0162', lon: '-96.7359', name: '75075', type: 'postcode', addresstype: 'postcode', display_name: '75075, Plano, Collin County, Texas, United States', address: { postcode: '75075', city: 'Plano', county: 'Collin County', state: 'Texas', 'ISO3166-2-lvl4': 'US-TX' } },
  zip75090: { lat: '33.6443', lon: '-96.5942', name: '75090', type: 'postcode', addresstype: 'postcode', display_name: '75090, Sherman, Grayson County, Texas, United States', address: { postcode: '75090', town: 'Sherman', county: 'Grayson County', state: 'Texas', 'ISO3166-2-lvl4': 'US-TX' } },
  samHouston: { lat: '32.7027', lon: '-97.0757', name: 'Sam Houston High School', type: 'school', addresstype: 'amenity', display_name: 'Sam Houston High School, 2000, Sam Houston Drive, Arlington, Tarrant County, Texas, 76014, United States', address: { amenity: 'Sam Houston High School', house_number: '2000', road: 'Sam Houston Drive', city: 'Arlington', state: 'Texas', 'ISO3166-2-lvl4': 'US-TX', postcode: '76014' } },
  houston: { lat: '29.7589', lon: '-95.3676', name: 'Houston', type: 'administrative', addresstype: 'city', display_name: 'Houston, Harris County, Texas, United States', address: { city: 'Houston', county: 'Harris County', state: 'Texas', 'ISO3166-2-lvl4': 'US-TX' } },
  klyde: { lat: '32.7897', lon: '-96.8011', name: 'Klyde Warren Park', type: 'park', addresstype: 'park', display_name: 'Klyde Warren Park, 2012, Downtown PID, Dallas, Dallas County, Texas, 75201, United States', address: { park: 'Klyde Warren Park', house_number: '2012', quarter: 'Downtown PID', city: 'Dallas', state: 'Texas', 'ISO3166-2-lvl4': 'US-TX', postcode: '75201' } },
  parkRoad: { lat: '32.6391', lon: '-96.7050', name: 'Park', type: 'unclassified', addresstype: 'road', display_name: 'Park, Hutchins, Dallas County, Texas, 75141, United States', address: { road: 'Park', village: 'Hutchins', county: 'Dallas County', state: 'Texas', 'ISO3166-2-lvl4': 'US-TX', postcode: '75141' } },
  house: { lat: '32.8905', lon: '-96.8040', name: '', type: 'house', addresstype: 'place', display_name: '10600, Preston Road, Meaders, Dallas, Dallas County, Texas, 75230, United States', address: { house_number: '10600', road: 'Preston Road', hamlet: 'Meaders', city: 'Dallas', state: 'Texas', 'ISO3166-2-lvl4': 'US-TX', postcode: '75230' } },
  timesSquare: { lat: '40.7570', lon: '-73.9859', name: 'Times Square', type: 'pedestrian', addresstype: 'road', display_name: 'Times Square, Manhattan, New York County, New York, 10036, United States', address: { road: 'Times Square', suburb: 'Manhattan', city: 'New York', state: 'New York', 'ISO3166-2-lvl4': 'US-NY', postcode: '10036' } },
};

/** A fetch stand-in that answers from a table keyed by the q or postalcode parameter. */
function fakeNominatim(table, { delayMs = 0, status = 200 } = {}) {
  const calls = [];
  const fetch = async (url) => {
    const u = new URL(url);
    calls.push(u);
    if (delayMs) await new Promise((resolve) => setTimeout(resolve, delayMs));
    const key = u.searchParams.get('postalcode') || u.searchParams.get('q');
    return new Response(JSON.stringify(table[key] || []), { status, headers: { 'Content-Type': 'application/json' } });
  };
  return { fetch, calls };
}

test('city names resolve locally, and out-of-area ZIP codes are refused without a lookup', async () => {
  const nominatim = fakeNominatim({});
  const g = createGeocoder({ fetch: nominatim.fetch, minGapMs: 0 });

  const plano = await g.resolvePlace('plano, tx', cities);
  assert.equal(plano.status, 'found');
  assert.equal(plano.place.cityId, 'plano');
  assert.equal(plano.place.source, 'local');

  for (const zip of ['77002', '78701', '10001', '99999']) {
    const r = await g.resolvePlace(zip, cities);
    assert.equal(r.status, 'outside', zip);
    assert.equal(r.zip, zip);
  }
  assert.equal(nominatim.calls.length, 0, 'no request for a ZIP that cannot be in DFW');
  assert.deepEqual([...DFW_ZIP_PREFIXES], ['750', '751', '752', '753', '760', '761', '762']);
});

test('a DFW ZIP uses the structured postal-code search and gets a coarse label', async () => {
  const nominatim = fakeNominatim({ 75075: [ROWS.zip75075], 75090: [ROWS.zip75090] });
  const g = createGeocoder({ fetch: nominatim.fetch, minGapMs: 0 });

  const found = await g.resolvePlace('75075', cities);
  assert.equal(found.status, 'found');
  assert.deepEqual(found.place, { query: '75075', label: 'Plano, TX 75075', lat: 33.016, lng: -96.736, cityId: 'plano', source: 'nominatim', kind: 'postcode' });
  const call = nominatim.calls[0];
  assert.equal(call.searchParams.get('postalcode'), '75075');
  assert.equal(call.searchParams.get('q'), null);
  assert.equal(call.searchParams.get('bounded'), null);

  // Sherman's ZIP starts with 750 but the place is outside the area.
  const sherman = await g.resolvePlace('75090', cities);
  assert.equal(sherman.status, 'outside');
  assert.equal(sherman.label, 'Sherman, TX 75090');
});

test('a place name means the place: "Houston" is outside the area, not Sam Houston High School', async () => {
  const nominatim = fakeNominatim({ Houston: [ROWS.samHouston, ROWS.houston], 'Times Square': [ROWS.timesSquare] });
  const g = createGeocoder({ fetch: nominatim.fetch, minGapMs: 0 });

  const houston = await g.resolvePlace('Houston', cities);
  assert.equal(houston.status, 'outside');
  assert.equal(houston.label, 'Houston, TX');
  assert.equal(nominatim.calls[0].searchParams.get('bounded'), null, 'the search is not boxed into DFW');
  assert.ok(nominatim.calls[0].searchParams.get('viewbox'), 'but DFW results rank first');

  const elsewhere = await g.resolvePlace('Times Square', cities);
  assert.equal(elsewhere.status, 'outside');
  assert.equal(elsewhere.label, 'Times Square, New York');

  assert.equal(await g.geocode('Houston', cities), null, 'the CLI helper treats outside as no match');
});

test('labels never carry a house number, and cityId comes from the result, not a fuzzy name match', async () => {
  const nominatim = fakeNominatim({ 'Klyde Warren Park': [ROWS.klyde], park: [ROWS.parkRoad], '10600 Preston Rd, Dallas': [ROWS.house] });
  const g = createGeocoder({ fetch: nominatim.fetch, minGapMs: 0 });

  const klyde = await g.resolvePlace('Klyde Warren Park', cities);
  assert.equal(klyde.place.label, 'Klyde Warren Park, Dallas');
  assert.equal(klyde.place.cityId, 'dallas');

  const address = await g.resolvePlace('10600 Preston Rd, Dallas', cities);
  assert.equal(address.place.label, 'Preston Road, Dallas');
  assert.equal(address.place.kind, 'address');
  assert.ok(!/\d/.test(address.place.label));

  // "park" used to come back as Highland Park because the city finder matched part of the name.
  const park = await g.resolvePlace('park', cities);
  assert.equal(park.status, 'found');
  assert.equal(park.place.cityId, null);
  assert.equal(park.place.label, 'Park, Hutchins');
});

test('nothing found is "none", and results are cached', async () => {
  const nominatim = fakeNominatim({});
  const g = createGeocoder({ fetch: nominatim.fetch, minGapMs: 0 });
  assert.equal((await g.resolvePlace('zzzzqqq', cities)).status, 'none');
  assert.equal((await g.resolvePlace('ZZZZQQQ', cities)).status, 'none');
  assert.equal(nominatim.calls.length, 1);
});

test('the queue is bounded and each lookup has a deadline measured from when it was queued', async () => {
  const nominatim = fakeNominatim({}, { delayMs: 40 });
  const g = createGeocoder({ fetch: nominatim.fetch, minGapMs: 200, maxWaiting: 2, deadlineMs: 5000 });
  const settled = await Promise.allSettled(['a st', 'b st', 'c st', 'd st', 'e st'].map((q) => g.resolvePlace(q, cities)));
  const busy = settled.filter((s) => s.status === 'rejected');
  assert.ok(busy.length >= 2, 'lookups beyond the waiting room are refused at once');
  for (const s of busy) {
    assert.ok(s.reason instanceof GeocodeError);
    assert.equal(s.reason.code, 'busy');
  }

  const slow = createGeocoder({ fetch: fakeNominatim({}).fetch, minGapMs: 400, maxWaiting: 5, deadlineMs: 300 });
  const results = await Promise.allSettled(['f st', 'g st', 'h st'].map((q) => slow.resolvePlace(q, cities)));
  assert.equal(results[0].status, 'fulfilled');
  assert.ok(
    results.slice(1).every((r) => r.status === 'rejected' && r.reason.code === 'busy'),
    'a lookup that could not start before its deadline gives up instead of waiting',
  );
});

test('Nominatim errors become busy or unavailable, never a result', async () => {
  const limited = createGeocoder({ fetch: fakeNominatim({}, { status: 429 }).fetch, minGapMs: 0 });
  await assert.rejects(limited.resolvePlace('Main Street', cities), (e) => e instanceof GeocodeError && e.code === 'busy');

  const down = createGeocoder({
    fetch: async () => {
      throw new TypeError('fetch failed');
    },
    minGapMs: 0,
  });
  await assert.rejects(down.resolvePlace('Main Street', cities), (e) => e instanceof GeocodeError && e.code === 'unavailable');
});

test('a school is marked as one, so the app can save it as School', async () => {
  const nominatim = fakeNominatim({ 'Sam Houston High School': [ROWS.samHouston], 'Klyde Warren Park': [ROWS.klyde] });
  const g = createGeocoder({ fetch: nominatim.fetch, minGapMs: 0 });
  const school = await g.resolvePlace('Sam Houston High School', cities);
  assert.equal(school.status, 'found');
  assert.equal(school.place.school, true);
  assert.equal(school.place.label, 'Sam Houston High School, Arlington');
  assert.equal(school.place.cityId, 'arlington');
  const park = await g.resolvePlace('Klyde Warren Park', cities);
  assert.equal(park.place.school, undefined);
});
