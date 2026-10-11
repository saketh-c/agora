import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createApp } from '../src/app.js';

// Plano's regular meetings: 2nd and 4th Mondays at 7 PM.
const cities = [
  {
    cityId: 'plano',
    name: 'Plano',
    county: 'Collin',
    website: 'https://www.plano.gov',
    cityHall: { address: '1520 K Ave, Plano, TX 75074', lat: 33.0198, lng: -96.6989 },
    meetings: [{ type: 'regular', label: 'City Council meeting', openToPublicComment: true, recurrence: { kind: 'nth-weekday', weekday: 1, ordinals: [2, 4], time: '19:00' } }],
    publicComment: { summary: 'Fill out a card.', howToRegister: 'Speaker card at the door.', virtualAllowed: false, timeLimitMinutes: 3 },
    youthPrograms: [],
    agendaItems: [],
    confidence: 'high',
    sources: [],
  },
];

const snapshot = (meetings, generatedAt = '2026-10-11T12:00:00Z') => ({
  schema: 1,
  parserVersion: 1,
  generatedAt,
  cities: { plano: { status: 'ok', fetchedAt: generatedAt, lastSuccessAt: generatedAt, sourceUrl: 'https://plano.legistar.com/Calendar.aspx', meetings } },
});

const agendas = {
  version: 1,
  current: snapshot([
    { key: 'l:1', date: '2026-10-12', time: '19:00', label: 'City Council', type: 'regular', agendaUrl: 'https://plano.legistar.com/a.pdf', agendaPostedOn: '2026-10-06', items: [{ title: 'Approve the bike lane plan for Legacy Drive', topics: ['transit'] }] },
    { key: 'l:2', date: '2026-10-26', time: '19:00', label: 'City Council', type: 'regular', cancelled: true },
  ]),
  snapshot() {
    return this.current;
  },
};

let server;
let base;
let bare;
let bareBase;

before(async () => {
  const opts = { cities, news: { sources: [], topicLinks: [] }, webDist: '/definitely/not/here', now: () => new Date('2026-10-11T15:00:00Z'), translations: () => null };
  const app = createApp({ ...opts, agendas });
  await new Promise((resolve) => {
    server = app.listen(0, resolve);
  });
  base = `http://127.0.0.1:${server.address().port}`;
  const plain = createApp(opts);
  await new Promise((resolve) => {
    bare = plain.listen(0, resolve);
  });
  bareBase = `http://127.0.0.1:${bare.address().port}`;
});

after(() => {
  if (server) server.close();
  if (bare) bare.close();
});

test('GET /api/agendas returns the live snapshot, or a clear 404 without one', async () => {
  const res = await fetch(`${base}/api/agendas`);
  assert.equal(res.status, 200);
  assert.equal(res.headers.get('cache-control'), 'no-store');
  const body = await res.json();
  assert.equal(body.generatedAt, '2026-10-11T12:00:00Z');
  const none = await fetch(`${bareBase}/api/agendas`);
  assert.equal(none.status, 404);
  assert.equal((await none.json()).code, 'no_snapshot');
});

test('meetings from the API carry the posted agenda items and the source’s cancellations', async () => {
  const list = await (await fetch(`${base}/api/meetings?days=30&includeCancelled=1`)).json();
  const oct12 = list.meetings.find((m) => m.date === '2026-10-12');
  assert.deepEqual(
    oct12.agendaItems.map((i) => i.title),
    ['Approve the bike lane plan for Legacy Drive'],
  );
  const oct26 = list.meetings.find((m) => m.date === '2026-10-26');
  assert.equal(oct26.status, 'cancelled');
  // Without a snapshot the curated schedule stands alone.
  const plain = await (await fetch(`${bareBase}/api/meetings?days=30&includeCancelled=1`)).json();
  assert.equal(plain.meetings.find((m) => m.date === '2026-10-26').status, 'scheduled');
});

test('a refreshed snapshot (new version) replaces the merged data in every language', async () => {
  const before = await (await fetch(`${base}/api/meetings?days=30&lang=es`)).json();
  assert.equal(before.meetings.find((m) => m.date === '2026-10-12').agendaItems.length, 1);
  agendas.current = snapshot([{ key: 'l:3', date: '2026-10-12', time: '19:00', label: 'City Council', type: 'regular', items: [] }], '2026-10-11T18:00:00Z');
  agendas.version += 1;
  const after = await (await fetch(`${base}/api/meetings?days=30&lang=es&includeCancelled=1`)).json();
  assert.equal(after.meetings.find((m) => m.date === '2026-10-12').agendaItems.length, 0);
  assert.equal(after.meetings.find((m) => m.date === '2026-10-26').status, 'scheduled');
  const snap = await (await fetch(`${base}/api/agendas`)).json();
  assert.equal(snap.generatedAt, '2026-10-11T18:00:00Z');
});
