// The web app's API client (packages/web/src/lib/api.js) is the other half of this server's
// contract: it sends the app's language, types failures, and knows when no server exists.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createApi, filterSnapshot, ApiError } from '../../web/src/lib/api.js';

const NOW = Date.parse('2026-10-10T17:00:00Z');
const daysAgo = (d) => new Date(NOW - d * 86400000).toISOString();

/** A fetch stand-in: route(url, init) returns { status, body, headers } or throws. */
function fakeFetch(route) {
  const calls = [];
  const fetch = async (url, init = {}) => {
    calls.push({ url: String(url), init });
    const r = await route(String(url), init);
    const headers = new Headers(r.headers || (r.body !== undefined && typeof r.body !== 'string' ? { 'Content-Type': 'application/json' } : { 'Content-Type': 'text/html' }));
    return new Response(typeof r.body === 'string' ? r.body : JSON.stringify(r.body), { status: r.status || 200, headers });
  };
  return { fetch, calls };
}

const snapshot = {
  generatedAt: daysAgo(1),
  maxAgeDays: 30,
  fetchedFeeds: 30,
  totalFeeds: 35,
  items: [
    { title: 'Plano council hears legal challenge to rental ordinance', description: '', publishedAt: daysAgo(2), topics: ['governance-elections'], places: ['plano'], counties: [] },
    { title: 'Allen council approves trail bond projects', description: '', publishedAt: daysAgo(3), topics: ['parks-recreation'], places: ['allen'], counties: [] },
    { title: 'Fort Worth City Council delays zoning vote', description: '', publishedAt: daysAgo(5), topics: ['zoning-development'], places: ['fort-worth'], counties: [] },
    { title: 'Old Dallas budget story', description: '', publishedAt: daysAgo(45), topics: ['budget-taxes'], places: ['dallas'], counties: [] },
  ],
  topicLinks: [{ topic: 'budget-taxes', label: 'Budget', url: 'https://x.test', sourceName: 'X' }],
};

test('every request carries the language picked in the app', async () => {
  const { fetch, calls } = fakeFetch(() => ({ body: { ok: true } }));
  const { api } = createApi({ env: { BASE_URL: '/' }, fetch, locale: () => 'vi' });
  await api.health();
  await api.geocode('75075');
  await api.explain({ title: 'X', cityId: 'plano' });
  await api.comment({ name: 'Ana' });
  await api.news({ topic: 'housing' });
  for (const { url } of calls) assert.equal(new URL(url, 'http://app.test').searchParams.get('lang'), 'vi', url);
  assert.equal(calls[1].url, '/api/geocode?q=75075&lang=vi');
  assert.equal(calls[2].init.method, 'POST');
  assert.equal(calls[2].init.headers['Content-Type'], 'application/json');
});

test('the API base follows the build: same origin, a configured URL, or a path under the repo subpath', () => {
  const base = (env) => createApi({ env, fetch: async () => new Response('{}') }).apiBase;
  assert.equal(base({ BASE_URL: '/' }), '/api');
  assert.equal(base({ BASE_URL: '/agora/' }), '/agora/api');
  assert.equal(base({ BASE_URL: '/agora/', VITE_API_BASE: 'https://api.example.org/api/' }), 'https://api.example.org/api');
  assert.equal(base({ BASE_URL: '/agora/', VITE_API_BASE: '/api' }), '/api');
  assert.equal(base({ BASE_URL: '/agora/', VITE_API_BASE: 'backend' }), '/agora/backend');
  // A static deploy pointed at a hosted API uses it, news included.
  const hosted = createApi({ env: { BASE_URL: '/agora/', VITE_STATIC_DEPLOY: '1', VITE_API_BASE: 'https://api.example.org/api' }, fetch: async () => new Response('{}') });
  assert.equal(hosted.apiAvailable, true);
  assert.equal(hosted.staticOnly, false);
});

test('a static deploy never calls API routes that cannot exist, and reads the snapshot under its subpath', async () => {
  const { fetch, calls } = fakeFetch((url) => (url === '/agora/news-snapshot.json' ? { body: snapshot } : { status: 404, body: 'Not found', headers: { 'Content-Type': 'text/plain' } }));
  const client = createApi({ env: { BASE_URL: '/agora/', VITE_STATIC_DEPLOY: '1' }, fetch, now: () => NOW, locale: () => 'es' });
  assert.equal(client.apiAvailable, false);
  assert.equal(client.apiBase, '');
  for (const call of [() => client.api.geocode('10600 Preston Rd'), () => client.api.explain({ title: 'X' }), () => client.api.comment({ name: 'Ana', useAi: true }), () => client.api.health()]) {
    await assert.rejects(call(), (e) => e instanceof ApiError && e.code === 'offline');
  }
  assert.equal(calls.length, 0, 'nothing was requested, so no typed address left the device');

  const news = await client.api.news({ limit: 10 });
  assert.deepEqual(
    calls.map((c) => c.url),
    ['/agora/news-snapshot.json'],
  );
  assert.equal(news.items.length, 3, 'the 45-day-old story is outside the 30-day window');
  assert.equal(news.snapshotAt, snapshot.generatedAt);
});

test('failures carry status, code and retry time instead of one generic error', async () => {
  const { fetch } = fakeFetch((url) => {
    if (url.startsWith('/api/geocode')) return { status: 404, body: { error: 'Houston, TX is outside the Dallas-Fort Worth area', code: 'outside_area', label: 'Houston, TX' } };
    if (url.startsWith('/api/news')) return { status: 429, body: { error: 'Too many requests', code: 'rate_limited', retryAfter: 17 }, headers: { 'Content-Type': 'application/json', 'Retry-After': '17' } };
    if (url.startsWith('/api/explain')) return { status: 200, body: '<!doctype html><title>Agora</title>' };
    if (url === '/news-snapshot.json') return { status: 404, body: 'Not found', headers: { 'Content-Type': 'text/plain' } };
    throw new TypeError('Failed to fetch');
  });
  const { api } = createApi({ env: { BASE_URL: '/' }, fetch, now: () => NOW });

  await assert.rejects(api.geocode('Houston'), (e) => e.status === 404 && e.code === 'outside_area' && e.data.label === 'Houston, TX');
  await assert.rejects(api.news({}), (e) => e.status === 429 && e.code === 'rate_limited' && e.retryAfter === 17, 'with no snapshot, the real failure (busy, not offline) reaches the page');
  await assert.rejects(api.explain({ title: 'X' }), (e) => e.code === 'not_json', 'an HTML page is not mistaken for an answer');
  await assert.rejects(api.comment({}), (e) => e.code === 'network' && e.status === 0);
});

test('when the API fails but the build shipped a snapshot, news falls back to it', async () => {
  const { fetch } = fakeFetch((url) => (url === '/news-snapshot.json' ? { body: snapshot } : { status: 502, body: { error: 'Bad gateway' } }));
  const { api } = createApi({ env: { BASE_URL: '/' }, fetch, now: () => NOW });
  const result = await api.news({ topic: 'parks-recreation' });
  assert.deepEqual(
    result.items.map((i) => i.title),
    ['Allen council approves trail bond projects'],
  );
});

test('the snapshot filter matches the server: whole words, city ids, comma lists, 30-day window', () => {
  const titles = (params) => filterSnapshot(snapshot, params, NOW).items.map((i) => i.title);
  assert.deepEqual(titles({ city: 'Allen' }), ['Allen council approves trail bond projects'], '"challenge" is not Allen');
  assert.deepEqual(titles({ city: 'fort-worth' }), ['Fort Worth City Council delays zoning vote']);
  assert.deepEqual(titles({ city: 'Plano, Fort Worth' }), ['Plano council hears legal challenge to rental ordinance', 'Fort Worth City Council delays zoning vote']);
  assert.deepEqual(titles({ city: 'Plano ' }), ['Plano council hears legal challenge to rental ordinance']);
  assert.deepEqual(titles({ city: 'Dallas' }), [], 'too old');
  assert.equal(filterSnapshot(snapshot, { topic: 'budget-taxes' }, NOW).topicLinks.length, 1);
});

test('a caller can cancel a request it no longer needs', async () => {
  const fetch = (url, init) =>
    new Promise((resolve, reject) => {
      init.signal.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')));
    });
  const { api } = createApi({ env: { BASE_URL: '/' }, fetch, now: () => NOW });
  const controller = new AbortController();
  const pending = api.news({ city: 'Pla' }, { signal: controller.signal });
  controller.abort();
  await assert.rejects(pending, (e) => e instanceof ApiError && e.code === 'aborted', 'a cancelled search does not fall back to the snapshot or look like an outage');
  await assert.rejects(api.geocode('75075', { signal: controller.signal }), (e) => e.code === 'aborted');
});
