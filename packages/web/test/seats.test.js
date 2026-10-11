import { test } from 'node:test';
import assert from 'node:assert/strict';
import { seatsNear } from '../src/components/home/homeData.js';

const city = (cityId, programs) => ({ cityId, name: cityId, cityHall: { lat: 33, lng: -96.7 }, youthPrograms: programs });

test('"Seats you can apply for" leaves out programs whose application window is closed', () => {
  const cities = [
    city('plano', [
      { name: 'Youth council', applyStatus: 'closed', applyBy: '2026-05-31' },
      { name: 'Teen court', applyStatus: 'rolling' },
      { name: 'Junior board seats', applyStatus: 'open', applyBy: '2026-10-15' },
      { name: 'Summer internship', applyStatus: 'open', applyBy: '2026-10-01' },
      { name: 'Library teen board' },
    ]),
  ];
  const seats = seatsNear(cities, { homeCityId: 'plano' }, 10, '2026-10-11');
  // Closing soon first, then rolling, then the one the city says nothing about.
  assert.deepEqual(
    seats.map((p) => [p.name, p.apply.state]),
    [
      ['Junior board seats', 'closing'],
      ['Teen court', 'rolling'],
      ['Library teen board', 'unknown'],
    ],
  );
  assert.equal(seats[0].apply.applyBy, '2026-10-15');
  assert.equal(seats[0].apply.daysLeft, 4);
});

test('seats within the distance limit come first, and programs you can apply to before unknown ones', () => {
  const at = (cityId, lat, programs) => ({ cityId, name: cityId, cityHall: { lat, lng: -96.7 }, youthPrograms: programs });
  const cities = [
    at('home', 33, [{ name: 'Home board', applyStatus: 'unknown' }]),
    at('near', 33.05, [{ name: 'Near court', applyStatus: 'rolling' }]),
    at('far', 33.6, [{ name: 'Far seats', applyStatus: 'open', applyBy: '2026-10-14' }]),
  ];
  const prefs = { homeCityId: 'home', location: { lat: 33, lng: -96.7 }, maxMiles: 15 };
  assert.deepEqual(
    seatsNear(cities, prefs, 3, '2026-10-11').map((p) => p.name),
    ['Near court', 'Home board', 'Far seats'],
  );
  // With any distance, a window that is closing comes first.
  assert.deepEqual(
    seatsNear(cities, { ...prefs, maxMiles: null }, 3, '2026-10-11').map((p) => p.name),
    ['Far seats', 'Near court', 'Home board'],
  );
});
