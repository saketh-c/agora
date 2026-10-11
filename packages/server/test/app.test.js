import { test, before, after, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import Anthropic from '@anthropic-ai/sdk';
import { createApp, PERMISSIONS_POLICY } from '../src/app.js';
import { parseFeed } from '../src/news.js';
import { setAiClient, NAME_PLACEHOLDER, SCHOOL_PLACEHOLDER } from '../src/ai.js';

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
    agendaItems: [{ title: 'Rezoning near Legacy', meetingDate: '2026-09-14', topics: ['zoning-development', 'housing'] }],
    confidence: 'high',
    sources: [],
  },
];

let server;
let base;

// Never let a developer's real key turn these tests into paid API calls.
const savedEnv = {};
before(() => {
  for (const k of ['ANTHROPIC_API_KEY', 'ANTHROPIC_AUTH_TOKEN', 'TRUST_PROXY', 'AI_DAILY_LIMIT']) {
    savedEnv[k] = process.env[k];
    delete process.env[k];
  }
});
after(() => {
  for (const [k, v] of Object.entries(savedEnv)) if (v !== undefined) process.env[k] = v;
});
afterEach(() => setAiClient(null));

before(async () => {
  const app = createApp({ cities, news: { sources: [], topicLinks: [{ topic: 'housing', label: 'Housing news', url: 'https://example.com', sourceName: 'Example' }] }, webDist: 'C:/definitely/not/here', now: () => new Date('2026-09-10T15:00:00Z') });
  await new Promise((resolve) => {
    server = app.listen(0, resolve);
  });
  base = `http://127.0.0.1:${server.address().port}`;
});

after(() => server && server.close());

test('health reports city count and today in Central time', async () => {
  const res = await fetch(`${base}/api/health`);
  const body = await res.json();
  assert.equal(body.ok, true);
  assert.equal(body.cities, 1);
  assert.equal(body.today, '2026-09-10');
});

test('cities summary includes next meeting', async () => {
  const body = await (await fetch(`${base}/api/cities`)).json();
  assert.equal(body.cities[0].nextMeeting.date, '2026-09-14');
});

test('meetings endpoint filters by city and evening', async () => {
  const body = await (await fetch(`${base}/api/meetings?days=30&city=Plano&evening=1`)).json();
  assert.equal(body.count, 2);
  const none = await (await fetch(`${base}/api/meetings?days=30&city=Nowhere`)).json();
  assert.equal(none.count, 0);
});

test('match via GET and POST agree', async () => {
  const get = await (await fetch(`${base}/api/match?interests=housing&city=plano`)).json();
  const post = await (await fetch(`${base}/api/match`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ prefs: { interests: ['housing'], homeCityId: 'plano' } }) })).json();
  assert.equal(get.meetings[0].cityId, 'plano');
  assert.equal(post.meetings[0].cityId, 'plano');
  assert.ok(post.summary.includes('Plano'));
});

test('unknown city is a 404 and unknown api route is JSON 404', async () => {
  assert.equal((await fetch(`${base}/api/cities/nope`)).status, 404);
  const res = await fetch(`${base}/api/nothing`);
  assert.equal(res.status, 404);
  assert.equal((await res.json()).error, 'Not found');
});

test('news falls back to topic links when there are no feeds', async () => {
  const body = await (await fetch(`${base}/api/news?topic=housing`)).json();
  assert.equal(body.items.length, 0);
  assert.equal(body.topicLinks.length, 1);
});

test('comment endpoint returns a template draft without AI', async () => {
  const body = await (await fetch(`${base}/api/comment`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: 'Ana', cityName: 'Plano', topicId: 'parks-recreation' }) })).json();
  assert.match(body.draft, /My name is Ana/);
  assert.ok(body.seconds > 0);
});

test('rss and atom parsing', () => {
  const rss = `<?xml version="1.0"?><rss><channel><item><title><![CDATA[Council OKs budget]]></title><link>https://x.test/a</link><pubDate>Wed, 09 Sep 2026 12:00:00 GMT</pubDate><description>&lt;p&gt;Tax rate set&lt;/p&gt;</description></item></channel></rss>`;
  const items = parseFeed(rss);
  assert.equal(items.length, 1);
  assert.equal(items[0].title, 'Council OKs budget');
  assert.equal(items[0].description, 'Tax rate set');
  assert.equal(items[0].publishedAt.slice(0, 10), '2026-09-09');
  const atom = `<feed xmlns="http://www.w3.org/2005/Atom"><entry><title>DART vote</title><link href="https://x.test/b"/><updated>2026-09-08T10:00:00Z</updated><summary>Bus plan</summary></entry></feed>`;
  const a = parseFeed(atom);
  assert.equal(a[0].link, 'https://x.test/b');
});

test('an encoded angle bracket inside an attribute does not leak markup into the summary', () => {
  // Newsroom feeds lead with an <img> in CDATA. Decoding entities before stripping tags
  // turns an encoded &gt; in the alt text into a real bracket that ends the tag early,
  // which used to spill the remaining attributes into the description.
  const item = (description) => `<rss><channel><item><title>T</title><link>https://x.test/a</link><description>${description}</description></item></channel></rss>`;

  const withImage = parseFeed(item('<![CDATA[<img alt="Photo by: A &gt; B" data-large-file="https://i.test/x.jpg?fit=780%2C440&amp;ssl=1" />Council raises the tax rate.]]>'));
  assert.equal(withImage[0].description, 'Council raises the tax rate.');

  // Feeds that escape their markup rather than embedding it still get stripped.
  assert.equal(parseFeed(item('&lt;p&gt;Bond package moves ahead.&lt;/p&gt;'))[0].description, 'Bond package moves ahead.');

  // Entities in genuine prose are still decoded.
  assert.equal(parseFeed(item('Parks &amp; recreation &quot;master plan&quot;'))[0].description, 'Parks & recreation "master plan"');
});

test('language comes from the query string and the Accept-Language header', async () => {
  const en = await (await fetch(`${base}/api/topics`)).json();
  const es = await (await fetch(`${base}/api/topics?lang=es`)).json();
  const vi = await (await fetch(`${base}/api/topics`, { headers: { 'Accept-Language': 'vi-VN,vi;q=0.9' } })).json();
  assert.notEqual(es.topics[0].label, en.topics[0].label);
  assert.notEqual(vi.topics[0].label, en.topics[0].label);
  assert.notEqual(vi.topics[0].label, es.topics[0].label);
  assert.equal(es.topics.length, en.topics.length);

  const health = await (await fetch(`${base}/api/health?lang=es`));
  assert.equal(health.headers.get('content-language'), 'es');
  assert.equal((await health.json()).lang, 'es');

  const unknown = await (await fetch(`${base}/api/health?lang=klingon`)).json();
  assert.equal(unknown.lang, 'en', 'an unsupported language falls back to English');
});

test('learn content and match reasons follow the request language', async () => {
  const en = await (await fetch(`${base}/api/learn`)).json();
  const es = await (await fetch(`${base}/api/learn?lang=es`)).json();
  assert.equal(es.glossary.length, en.glossary.length);
  assert.notEqual(es.glossary[0].term, en.glossary[0].term);
  assert.notEqual(es.checklist[0], en.checklist[0]);

  const planEn = await (await fetch(`${base}/api/match?interests=housing&city=plano`)).json();
  const planEs = await (await fetch(`${base}/api/match?interests=housing&city=plano&lang=es`)).json();
  assert.equal(planEs.meetings.length, planEn.meetings.length);
  assert.notEqual(planEs.meetings[0].reasons[0].text, planEn.meetings[0].reasons[0].text);
});

test('city data is localized when a translation memory is supplied', async () => {
  const app = createApp({
    cities,
    news: { sources: [], topicLinks: [] },
    webDist: 'C:/definitely/not/here',
    now: () => new Date('2026-09-10T15:00:00Z'),
    translations: (lang) => (lang === 'es' ? { 'Fill out a card.': 'Llene una tarjeta.', 'Rezoning near Legacy': 'Rezonificación cerca de Legacy' } : null),
  });
  const server2 = await new Promise((resolve) => {
    const s = app.listen(0, () => resolve(s));
  });
  const base2 = `http://127.0.0.1:${server2.address().port}`;
  try {
    const es = await (await fetch(`${base2}/api/cities/plano?lang=es`)).json();
    assert.equal(es.city.publicComment.summary, 'Llene una tarjeta.');
    assert.equal(es.city.agendaItems[0].title, 'Rezonificación cerca de Legacy');
    assert.equal(es.city.name, 'Plano', 'the city name stays as it is');
    const en = await (await fetch(`${base2}/api/cities/plano`)).json();
    assert.equal(en.city.publicComment.summary, 'Fill out a card.', 'English is untouched');
  } finally {
    server2.close();
  }
});

/** Start an app on a free port; returns its base URL and a close function. */
async function listen(app) {
  const s = await new Promise((resolve) => {
    const srv = app.listen(0, () => resolve(srv));
  });
  return { url: `http://127.0.0.1:${s.address().port}`, close: () => new Promise((resolve) => s.close(resolve)) };
}

const fixedNow = () => new Date('2026-09-10T15:00:00Z');
const json = (body) => ({ method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });

/** A stand-in Anthropic client that records each request and answers with `reply(params)`. */
function stubAi(reply) {
  const calls = [];
  setAiClient({
    beta: {
      messages: {
        create: async (params) => {
          calls.push(params);
          const out = await reply(params);
          return typeof out === 'string' ? { stop_reason: 'end_turn', content: [{ type: 'text', text: out }] } : out;
        },
      },
    },
  });
  return calls;
}

test('the app page allows camera and microphone for its own origin, and nothing more powerful', async () => {
  const dist = mkdtempSync(path.join(tmpdir(), 'agora-dist-'));
  writeFileSync(path.join(dist, 'index.html'), '<!doctype html><title>Agora</title>');
  const { url, close } = await listen(createApp({ cities, news: { sources: [], topicLinks: [] }, webDist: dist, now: fixedNow }));
  try {
    for (const page of ['/', '/rehearse']) {
      const res = await fetch(`${url}${page}`, { headers: { Accept: 'text/html' } });
      assert.equal(res.status, 200);
      const policy = Object.fromEntries(
        res.headers
          .get('permissions-policy')
          .split(',')
          .map((d) => d.trim().split('=')),
      );
      assert.equal(policy.camera, '(self)', 'Rehearse records with the camera');
      assert.equal(policy.microphone, '(self)', 'Rehearse and live captions need the microphone');
      assert.equal(policy.geolocation, '(self)');
      for (const off of ['payment', 'usb', 'serial', 'hid', 'midi', 'display-capture', 'accelerometer', 'gyroscope', 'magnetometer']) assert.equal(policy[off], '()', `${off} stays off`);
    }
    assert.equal(PERMISSIONS_POLICY.includes('camera=()'), false);
  } finally {
    await close();
    rmSync(dist, { recursive: true, force: true });
  }
});

test('client routes get the app, but missing files and API routes are real 404s', async () => {
  const dist = mkdtempSync(path.join(tmpdir(), 'agora-dist-'));
  writeFileSync(path.join(dist, 'index.html'), '<!doctype html><title>Agora</title>');
  mkdirSync(path.join(dist, 'assets'));
  writeFileSync(path.join(dist, 'assets', 'index-abc123.js'), 'console.log(1)');
  writeFileSync(path.join(dist, 'sw.js'), 'self.x = 1');
  const { url, close } = await listen(createApp({ cities, news: { sources: [], topicLinks: [] }, webDist: dist, now: fixedNow }));
  try {
    const page = await fetch(`${url}/city/plano`, { headers: { Accept: 'text/html,application/xhtml+xml' } });
    assert.equal(page.status, 200);
    assert.match(await page.text(), /<title>Agora/);
    assert.equal(page.headers.get('cache-control'), 'no-cache');

    for (const missing of ['/news-snapshot.json', '/models/face_landmarker.task', '/assets/index-missing.js']) {
      const res = await fetch(`${url}${missing}`);
      assert.equal(res.status, 404, missing);
      assert.doesNotMatch(await res.text(), /<title>Agora/, `${missing} is not answered with the app`);
    }
    const jsonRoute = await fetch(`${url}/some/route`, { headers: { Accept: 'application/json' } });
    assert.equal(jsonRoute.status, 404, 'a request that does not accept HTML is not a page navigation');

    const api = await fetch(`${url}/api/does-not-exist`, { headers: { Accept: 'text/html' } });
    assert.equal(api.status, 404);
    assert.equal((await api.json()).code, 'not_found');

    assert.equal((await fetch(`${url}/assets/index-abc123.js`)).headers.get('cache-control'), 'public, max-age=31536000, immutable');
    assert.equal((await fetch(`${url}/sw.js`)).headers.get('cache-control'), 'no-cache');
    assert.equal((await fetch(`${url}/`)).headers.get('cache-control'), 'no-cache');
  } finally {
    await close();
    rmSync(dist, { recursive: true, force: true });
  }
});

test('an explicit lang from the app wins over the browser language, in the query or the body', async () => {
  const fromQuery = await fetch(`${base}/api/health?lang=vi`, { headers: { 'Accept-Language': 'es-MX,es;q=0.9' } });
  assert.equal((await fromQuery.json()).lang, 'vi');
  assert.equal(fromQuery.headers.get('content-language'), 'vi');

  const fromBody = await (await fetch(`${base}/api/comment`, { ...json({ name: 'Ana', cityName: 'Plano', lang: 'es' }), headers: { 'Content-Type': 'application/json', 'Accept-Language': 'en-US' } })).json();
  assert.equal(fromBody.lang, 'es');
  assert.match(fromBody.draft, /Me llamo Ana/);

  const header = await (await fetch(`${base}/api/health`, { headers: { 'Accept-Language': 'es-MX,es;q=0.9' } })).json();
  assert.equal(header.lang, 'es', 'Accept-Language still works when the app sends nothing');
});

test('rate limits answer honestly, in the request language, with the real wait', async () => {
  const { url, close } = await listen(createApp({ cities, news: { sources: [], topicLinks: [] }, webDist: 'C:/definitely/not/here', now: fixedNow, limits: { news: 2 } }));
  try {
    assert.equal((await fetch(`${url}/api/news`)).status, 200);
    assert.equal((await fetch(`${url}/api/news`)).status, 200);
    const limited = await fetch(`${url}/api/news?lang=es`);
    assert.equal(limited.status, 429);
    const body = await limited.json();
    assert.equal(body.code, 'rate_limited');
    assert.match(body.error, /red/, 'says the limit is per network, in Spanish');
    const wait = Number(limited.headers.get('retry-after'));
    assert.ok(wait >= 1 && wait <= 60);
    assert.equal(body.retryAfter, wait);
    assert.ok(body.error.includes(`${wait} segundos`));
  } finally {
    await close();
  }
});

test('ordinary browsing never trips the news limit', async () => {
  const { url, close } = await listen(createApp({ cities, news: { sources: [], topicLinks: [] }, webDist: 'C:/definitely/not/here', now: fixedNow }));
  try {
    // One request per keystroke of "North Richland Hills" plus a few topic chips, twice over.
    const statuses = [];
    for (let i = 0; i < 60; i++) statuses.push((await fetch(`${url}/api/news?city=North%20Richland%20Hills`)).status);
    assert.ok(statuses.every((s) => s === 200));
  } finally {
    await close();
  }
});

test('comment drafts reject non-text fields and report when AI is off', async () => {
  const bad = await fetch(`${base}/api/comment`, json({ name: { first: 'Ana' }, cityName: 'Plano' }));
  assert.equal(bad.status, 400);
  const body = await bad.json();
  assert.equal(body.code, 'invalid_input');
  assert.equal(body.field, 'name');
  assert.equal((await fetch(`${base}/api/comment`, json([1, 2, 3]))).status, 400);
  assert.equal((await fetch(`${base}/api/comment`, json({ useAi: 'yes' }))).status, 400);

  const off = await (await fetch(`${base}/api/comment?lang=vi`, json({ name: 'Ana', cityId: 'plano', useAi: true }))).json();
  assert.equal(off.ai, null);
  assert.equal(off.aiError, 'off');
  assert.match(off.draft, /Tôi tên là Ana/);
});

test('AI polish: no name or school leaves the server, the rewrite keeps the language, failures stay vague', async () => {
  const calls = stubAi(() => `Buenas noches, alcalde y miembros del concejo. Me llamo ${NAME_PLACEHOLDER} y estudio en ${SCHOOL_PLACEHOLDER}, aquí en Plano. Les pido que apoyen este punto, porque los parques son importantes para los jóvenes de la ciudad.`);
  const ok = await (await fetch(`${base}/api/comment?lang=es`, json({ name: 'Ana Reyes', school: 'Plano East', cityId: 'plano', topicId: 'parks-recreation', position: 'support', useAi: true }))).json();
  assert.equal(ok.ai.source, 'claude');
  assert.equal(ok.ai.model, 'claude-opus-5-5');
  assert.match(ok.ai.text, /Me llamo Ana Reyes y estudio en Plano East/);
  assert.ok(ok.ai.seconds > 0);
  const sent = JSON.stringify(calls[0]);
  assert.ok(!sent.includes('Ana Reyes') && !sent.includes('Plano East'), 'name and school are replaced before sending');
  assert.match(calls[0].messages[0].content, /Write it in Spanish/);

  stubAi(() => {
    throw Anthropic.APIError.generate(401, { type: 'error', error: { type: 'authentication_error', message: 'invalid x-api-key' }, request_id: 'req_123' }, 'invalid x-api-key', new Headers());
  });
  const failed = await fetch(`${base}/api/comment`, json({ name: 'Ana', cityId: 'plano', useAi: true }));
  const text = await failed.text();
  const body = JSON.parse(text);
  assert.equal(body.ai, null, 'a failed call is never labeled as an AI rewrite');
  assert.equal(body.aiError, 'unavailable');
  assert.doesNotMatch(text, /x-api-key|authentication_error|req_123|fallbackReason/);
});

test('the AI allowance caps model calls per client and still answers with the template', async () => {
  const calls = stubAi(() => `Good evening. My name is ${NAME_PLACEHOLDER}. Please keep the parks open for students in our city, because we use them every day.`);
  const { url, close } = await listen(createApp({ cities, news: { sources: [], topicLinks: [] }, webDist: 'C:/definitely/not/here', now: fixedNow, limits: { aiPerClient: 1 } }));
  try {
    const first = await (await fetch(`${url}/api/comment`, json({ name: 'Ana', cityId: 'plano', useAi: true }))).json();
    assert.equal(first.ai.source, 'claude');
    const second = await (await fetch(`${url}/api/comment`, json({ name: 'Ana', cityId: 'plano', useAi: true }))).json();
    assert.equal(second.ai, null);
    assert.equal(second.aiError, 'rate_limited');
    assert.match(second.draft, /My name is Ana/);
    assert.equal(calls.length, 1);
  } finally {
    await close();
  }
});

// Agenda items with summaries, one longer than the old 300-character cut, and translations.
const LONG_TITLE = `Board appointments: Park Facilities Development Corporation, Economic Development Corporation, Planning and Zoning Commission, Library Advisory Board, Animal Services Advisory Committee, Building Standards Commission, Parks and Recreation Board, Youth Advisory Council, Cultural Arts Commission, Community Relations Commission and the Mansfield Historic Landmark Commission`;
const explainCities = [
  {
    ...cities[0],
    agendaItems: [
      { title: 'Rezoning near Legacy', summary: 'A request to rezone 12 acres near Legacy West for apartments.', meetingDate: '2026-09-14', topics: ['zoning-development', 'housing'] },
      { title: LONG_TITLE, summary: 'The council fills open seats on city boards.', meetingDate: '2026-09-14', topics: ['governance-elections'] },
    ],
  },
];
const explainTranslations = (lang) =>
  ({
    es: { 'Fill out a card.': 'Llena una tarjeta.', 'Rezoning near Legacy': 'Rezonificación cerca de Legacy', 'A request to rezone 12 acres near Legacy West for apartments.': 'Una solicitud para rezonificar 12 acres cerca de Legacy West para departamentos.' },
    vi: { 'Fill out a card.': 'Điền vào một phiếu.', 'Rezoning near Legacy': 'Thay đổi quy hoạch gần Legacy', 'A request to rezone 12 acres near Legacy West for apartments.': 'Đề nghị thay đổi quy hoạch 12 mẫu đất gần Legacy West để xây căn hộ.' },
  })[lang] || null;

test('"Explain this" answers entirely in Spanish and Vietnamese when the template is used', async () => {
  const { url, close } = await listen(createApp({ cities: explainCities, news: { sources: [], topicLinks: [] }, webDist: 'C:/definitely/not/here', now: fixedNow, translations: explainTranslations }));
  const english = /This item|Why it might matter|How to weigh in|How to speak here|your city/;
  try {
    const es = await (await fetch(`${url}/api/explain?lang=es`, json({ title: 'Rezonificación cerca de Legacy', summary: 'Una solicitud para rezonificar 12 acres cerca de Legacy West para departamentos.', cityId: 'plano' }))).json();
    assert.equal(es.lang, 'es');
    assert.doesNotMatch(es.text, english);
    assert.match(es.text, /^Este punto trata sobre .* en Plano\./);
    assert.match(es.text, /Una solicitud para rezonificar/);
    assert.match(es.text, /Cómo hablar aquí: Llena una tarjeta\./);
    assert.deepEqual(es.topics, ['zoning-development', 'housing'], 'topics come from the dataset, not from guessing at Spanish words');

    const vi = await (await fetch(`${url}/api/explain`, { ...json({ title: 'Thay đổi quy hoạch gần Legacy', cityId: 'plano', lang: 'vi' }) })).json();
    assert.doesNotMatch(vi.text, english);
    assert.match(vi.text, /Đề nghị thay đổi quy hoạch/);
    assert.match(vi.text, /Cách phát biểu ở đây: Điền vào một phiếu\./);

    const unknown = await (await fetch(`${url}/api/explain?lang=es`, json({ title: 'Algo que no está en los datos', cityId: 'nowhere' }))).json();
    assert.doesNotMatch(unknown.text, english);
    assert.equal(unknown.source, 'template');
  } finally {
    await close();
  }
});

test('"Explain this" finds dataset items by translated title, long title or index, and the model answers in that language', async () => {
  const SPANISH = 'Este punto cambia la zonificación de 12 acres cerca de Legacy West para que se puedan construir departamentos. Afecta a las familias que buscan vivienda y a los vecinos de la zona. Para opinar, llena una tarjeta antes de la reunión.';
  const calls = stubAi(() => SPANISH);
  const { url, close } = await listen(createApp({ cities: explainCities, news: { sources: [], topicLinks: [] }, webDist: 'C:/definitely/not/here', now: fixedNow, translations: explainTranslations }));
  try {
    const es = await (await fetch(`${url}/api/explain?lang=es`, json({ title: 'Rezonificación cerca de Legacy', cityId: 'plano' }))).json();
    assert.equal(es.source, 'claude');
    assert.equal(es.text, SPANISH);
    assert.match(calls[0].messages[0].content, /Title: Rezoning near Legacy/, 'the model reads the English original');
    assert.match(calls[0].messages[0].content, /Spanish/);

    // Cached per item and language: the same click again does not call the model.
    await fetch(`${url}/api/explain?lang=es`, json({ title: 'Rezonificación cerca de Legacy', cityId: 'plano' }));
    assert.equal(calls.length, 1);

    const long = await (await fetch(`${url}/api/explain?lang=es`, json({ title: LONG_TITLE, cityId: 'plano' }))).json();
    assert.equal(long.source, 'claude', 'titles longer than 300 characters still match');
    assert.match(calls[1].messages[0].content, /Mansfield Historic Landmark Commission/);

    const byIndex = await (await fetch(`${url}/api/explain?lang=vi`, json({ cityId: 'plano', itemIndex: 0 }))).json();
    assert.equal(calls.length, 3);
    assert.match(calls[2].messages[0].content, /Vietnamese/);
    assert.equal(byIndex.source, 'template', 'a Spanish answer to a Vietnamese reader is rejected');
    assert.equal(byIndex.aiError, 'declined');
    assert.match(byIndex.text, /^Mục này nói về/);

    assert.equal((await fetch(`${url}/api/explain`, json({ cityId: 'plano', itemIndex: -1 }))).status, 400);
    assert.equal((await fetch(`${url}/api/explain`, json({ title: ['x'] }))).status, 400);
  } finally {
    await close();
  }
});

test('"Explain this" never passes a provider error to the browser', async () => {
  stubAi(() => {
    throw Anthropic.APIError.generate(529, { type: 'error', error: { type: 'overloaded_error', message: 'Overloaded' }, request_id: 'req_456' }, 'Overloaded', new Headers());
  });
  const res = await fetch(`${base}/api/explain`, json({ title: 'Rezoning near Legacy', cityId: 'plano' }));
  const text = await res.text();
  const body = JSON.parse(text);
  assert.equal(body.source, 'template');
  assert.equal(body.aiError, 'busy');
  assert.doesNotMatch(text, /Overloaded|overloaded_error|req_456|fallbackReason/);
});

test('address lookup separates "outside the area", "not found", "busy" and "unavailable"', async () => {
  const answers = {
    77002: { status: 'outside', query: '77002', label: null, zip: '77002' },
    Houston: { status: 'outside', query: 'Houston', label: 'Houston, TX', zip: null },
    zzzz: { status: 'none', query: 'zzzz' },
    75075: { status: 'found', query: '75075', place: { query: '75075', label: 'Plano, TX 75075', lat: 33.016, lng: -96.736, cityId: 'plano', source: 'nominatim', kind: 'postcode' } },
  };
  const geocoder = async (q) => {
    if (q === 'busy st') throw Object.assign(new Error('queue full'), { code: 'busy' });
    if (q === 'down st') throw Object.assign(new Error('getaddrinfo ENOTFOUND nominatim.openstreetmap.org'), { code: 'unavailable' });
    return answers[q];
  };
  const { url, close } = await listen(createApp({ cities, news: { sources: [], topicLinks: [] }, webDist: 'C:/definitely/not/here', now: fixedNow, geocoder }));
  try {
    const found = await (await fetch(`${url}/api/geocode?q=75075`)).json();
    assert.equal(found.label, 'Plano, TX 75075');
    assert.equal(found.cityId, 'plano');

    const zip = await fetch(`${url}/api/geocode?q=77002&lang=es`);
    assert.equal(zip.status, 404);
    const zipBody = await zip.json();
    assert.equal(zipBody.code, 'outside_area');
    assert.match(zipBody.error, /77002 está fuera del área de Dallas-Fort Worth/);

    const city = await (await fetch(`${url}/api/geocode?q=Houston`)).json();
    assert.equal(city.code, 'outside_area');
    assert.equal(city.label, 'Houston, TX');
    assert.match(city.error, /^Houston, TX is outside/);

    const none = await fetch(`${url}/api/geocode?q=zzzz`);
    assert.equal(none.status, 404);
    assert.equal((await none.json()).code, 'not_found');

    const busy = await fetch(`${url}/api/geocode?q=busy%20st`);
    assert.equal(busy.status, 503);
    assert.equal(busy.headers.get('retry-after'), '5');
    assert.equal((await busy.json()).code, 'busy');

    const down = await fetch(`${url}/api/geocode?q=down%20st`);
    assert.equal(down.status, 502);
    const downText = await down.text();
    assert.equal(JSON.parse(downText).code, 'unavailable');
    assert.doesNotMatch(downText, /ENOTFOUND|nominatim/i);

    assert.equal((await fetch(`${url}/api/geocode?q=a&q=b`)).status, 400);
    assert.equal((await (await fetch(`${url}/api/geocode`)).json()).code, 'missing_query');
  } finally {
    await close();
  }
});
