import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { setLocale } from '@agora/core';
import { activeDestination, documentTitle, pageNameFor } from '../src/components/shell/nav.js';
import { cityMatches, countyQuery, fold } from '../src/lib/cityMatch.js';
import { communityFilterCount, readCommunityFilters, writeCommunityFilters } from '../src/lib/communityFilters.js';
import { distanceSummary, profileFileName, profileMeta, timesSummary, topicsSummary } from '../src/lib/setupSummary.js';
import { tidyTimes } from '../src/components/ui/cityText.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const cities = JSON.parse(readFileSync(path.resolve(here, '../../../data/cities.json'), 'utf8')).cities;
const NB = ' ';

test('routes ignore case and a trailing slash: tab and document title', () => {
  setLocale('en');
  assert.equal(activeDestination('/Meetings'), 'meetings');
  assert.equal(activeDestination('/CITY/Plano/'), 'meetings');
  assert.equal(activeDestination('/Prepare/Write'), 'prepare');
  assert.equal(activeDestination('/About'), null);
  assert.equal(pageNameFor('/Meetings'), 'Meetings');
  assert.equal(documentTitle('', '/Meetings/'), 'Meetings | Agora');
  assert.equal(documentTitle('', '/prepare/PRACTICE'), 'Practice out loud | Agora');
  assert.equal(documentTitle('', '/nowhere'), 'Page not found | Agora');
  assert.equal(documentTitle('', '/'), 'Agora: your turn to speak at city hall');
});

test('a county query matches every city in that county, in each language', () => {
  setLocale('en');
  assert.equal(countyQuery('Denton County'), 'denton');
  assert.equal(countyQuery('tarrant co.'), 'tarrant');
  assert.equal(countyQuery('plano'), '');
  const inCounty = (q) => cities.filter((c) => cityMatches(c, q)).map((c) => c.county);
  const denton = inCounty('denton county');
  assert.ok(denton.length > 1);
  assert.ok(denton.every((c) => c === 'Denton'), 'only Denton County cities');
  assert.equal(cities.filter((c) => cityMatches(c, 'Fort Worth')).length, 1);
  assert.equal(cities.filter((c) => cityMatches(c, 'nrh'))[0].cityId, 'north-richland-hills');
  setLocale('es');
  assert.equal(countyQuery('Condado de Collin'), 'collin');
  assert.ok(cities.filter((c) => cityMatches(c, 'condado de collin')).every((c) => c.county === 'Collin'));
  setLocale('vi');
  assert.equal(countyQuery('Quận Dallas'), 'dallas');
  setLocale('en');
  assert.equal(fold('  Fórt   Wörth '), 'fort worth');
});

test('Community filters round-trip through the address, with your city first by default', () => {
  const hasCity = (id) => ['plano', 'dallas'].includes(id);
  const none = readCommunityFilters(new URLSearchParams(''), { homeCityId: 'plano', hasCity });
  assert.deepEqual(none, { kind: '', cityId: '', sort: 'city', defaultSort: 'city' });
  assert.equal(communityFilterCount(none), 0);
  const noHome = readCommunityFilters(new URLSearchParams('sort=city'), { homeCityId: '', hasCity });
  assert.equal(noHome.sort, 'newest', '"your city first" needs a home city');
  const set = readCommunityFilters(new URLSearchParams('kind=tip&city=Dallas&sort=newest'), { homeCityId: 'plano', hasCity });
  assert.deepEqual(set, { kind: 'tip', cityId: 'dallas', sort: 'newest', defaultSort: 'city' });
  assert.equal(communityFilterCount(set), 2);
  const junk = readCommunityFilters(new URLSearchParams('kind=memes&city=atlantis&sort=random'), { homeCityId: 'plano', hasCity });
  assert.deepEqual(junk, { kind: '', cityId: '', sort: 'city', defaultSort: 'city' });
  // Writing drops empty values and the default sort, and keeps other parameters.
  const next = writeCommunityFilters(new URLSearchParams('kind=tip&setup=1'), { kind: '', city: 'dallas', sort: 'city' }, { defaultSort: 'city' });
  assert.equal(next.toString(), 'setup=1&city=dallas');
  assert.equal(writeCommunityFilters(next, { sort: 'newest' }, { defaultSort: 'city' }).get('sort'), 'newest');
});

test('the Profile page says the setup in words', () => {
  setLocale('en');
  assert.equal(distanceSummary({ maxMiles: 15 }), 'Within 15 mi');
  assert.equal(distanceSummary({ maxMiles: null }), 'Any distance');
  assert.equal(timesSummary({ availability: { evenings: true, daytime: false, weekends: true } }), 'Weekday evenings and weekends');
  assert.equal(timesSummary({ availability: {} }), 'No times picked');
  assert.equal(topicsSummary({ interests: [] }), 'No topics yet');
  assert.equal(topicsSummary({ interests: ['transit', 'housing'] }), 'Transit and housing');
  assert.equal(topicsSummary({ interests: ['transit', 'housing', 'parks-recreation', 'youth', 'environment'] }), 'Transit, housing, parks and 2 more');
  const plano = { name: 'Plano' };
  assert.equal(profileMeta({ onboarded: true, prefs: { interests: ['transit'] } }, plano), 'Plano, 1 topic');
  assert.equal(profileMeta({ onboarded: true, prefs: { interests: [] } }, plano), 'Plano, no topics yet');
  assert.equal(profileMeta({ onboarded: false, prefs: {} }, null), 'Setup not finished');
  setLocale('vi');
  assert.equal(profileMeta({ onboarded: true, prefs: { interests: [] } }, { name: 'Garland' }), 'Garland, chưa có chủ đề');
  setLocale('en');
});

test('export file names keep any script and never collide on an empty name', () => {
  assert.equal(profileFileName('Nguyễn Văn An', 'p_1'), 'agora-profile-nguyen-van-an.json');
  assert.equal(profileFileName('王小明', 'p_2'), 'agora-profile-王小明.json');
  assert.equal(profileFileName('राम', 'p_3'), 'agora-profile-राम.json');
  assert.equal(profileFileName('', 'p_abc'), 'agora-profile-p_abc.json');
  assert.equal(profileFileName('Ana (2)', 'p_4'), 'agora-profile-ana-2.json');
});

test('a time before a date or weekday does not end the sentence', () => {
  assert.equal(tidyTimes('Applications were due 11:59 p.m. May 31, 2026.', 'en'), `Applications were due 11:59${NB}PM May 31, 2026.`);
  assert.equal(tidyTimes('Sign up by 5 p.m. Monday before the meeting', 'en'), `Sign up by 5:00${NB}PM Monday before the meeting`);
  assert.equal(tidyTimes('Closes 5 p.m. Sept. 30', 'en'), `Closes 5:00${NB}PM Sept. 30`);
  assert.equal(tidyTimes('Cards until 7 p.m. The council then votes.', 'en'), `Cards until 7:00${NB}PM. The council then votes.`);
});

test('every app route gets its own page in the static build, so shared links answer 200', async () => {
  const { ROUTES, cityRoutes } = await import('../../../scripts/spa-routes.mjs');
  const app = readFileSync(path.resolve(here, '../src/App.jsx'), 'utf8');
  const paths = [...app.matchAll(/<Route path="\/([^"]*)"/g)].map((m) => m[1]).filter((p) => p && p !== '*' && !p.includes(':') && !p.startsWith('__'));
  assert.ok(paths.length >= 10);
  for (const p of paths) assert.ok(ROUTES.includes(p), `${p} is missing from scripts/spa-routes.mjs`);
  const city = cityRoutes();
  assert.equal(city.length, cities.length);
  assert.ok(city.includes('city/plano'));
});
