import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { fetchNews, parseFeed, scoreRelevance, NEWS_MAX_AGE_DAYS } from '../src/news.js';

// A few covered cities, enough for place detection and the city filter.
const cities = [
  { cityId: 'plano', name: 'Plano', county: 'Collin' },
  { cityId: 'dallas', name: 'Dallas', county: 'Dallas' },
  { cityId: 'garland', name: 'Garland', county: 'Dallas' },
  { cityId: 'allen', name: 'Allen', county: 'Collin' },
  { cityId: 'fort-worth', name: 'Fort Worth', county: 'Tarrant' },
];

const NOW = new Date('2026-10-10T17:00:00Z');
const hoursAgo = (h) => new Date(NOW.getTime() - h * 3600000).toUTCString();

// Realistic headlines of the kinds that used to fill the page, and the civic ones that got lost.
const FOOTBALL = { title: 'Prosper rallies past Rock Hill to stay unbeaten in district rivalry', description: 'The Prosper football team scored 21 unanswered points in the second half Friday night to stay unbeaten in District 5-6A.' };
const WEATHER = { title: 'Plenty of sunshine in store for North Texas this weekend', description: 'Expect highs near 90 and low humidity before a cold front arrives Monday. If you are headed to the Red River Rivalry, drink plenty of water.' };
const HOUSTON_CRIME = { title: 'Man killed in overnight shooting in southwest Houston, police say', description: 'Houston police said the victim was found shot in a parking lot off Bellaire Boulevard early Saturday.' };
const PLANO_ZONING = { title: 'Plano City Council approves zoning change for Collin Creek redevelopment', description: 'Council members voted 7-1 Monday to rezone 25 acres near the old mall site for mixed-use development after a public hearing.' };
const DALLAS_BUDGET = { title: 'Dallas City Council adopts $5.2 billion budget, keeps tax rate flat', description: 'The council approved the fiscal year 2026-27 budget Wednesday, including more money for police hiring and longer library hours.' };
const SPONSORED = { title: 'Flu Season Is Here: 3 Steps to Take Now', description: '(NAPSI) Influenza is nothing to sneeze at. Here is what families in Plano and across North Texas can do.' };
const FW_CRIME = { title: 'Fort Worth fatal shooting leaves man dead inside car', description: 'Police said the man was found shot in a car on the city\'s east side.' };

const STATEWIDE = { id: 'tv', name: 'Channel 11', coverage: ['dfw'], requirePlace: true };
const PLANO_GOV = { id: 'ci-plano', name: 'Community Impact (Plano)', coverage: ['Plano'], focus: 'government' };

const at = (h, item) => ({ ...item, link: `https://news.example/${encodeURIComponent(item.title)}`, publishedAt: new Date(NOW.getTime() - h * 3600000).toISOString() });

test('sports, weather, out-of-area crime and sponsored posts are not local civic news', () => {
  for (const [item, source] of [
    [FOOTBALL, { coverage: ['Plano', 'Frisco'] }],
    [WEATHER, STATEWIDE],
    [HOUSTON_CRIME, STATEWIDE],
    [SPONSORED, { coverage: ['Plano'], requirePlace: true }],
    [FW_CRIME, STATEWIDE],
  ]) {
    const r = scoreRelevance(at(2, item), source, { cities, now: NOW });
    assert.equal(r.relevant, false, `${item.title} should be dropped (${r.reasons.join(', ')})`);
  }
  assert.ok(scoreRelevance(at(2, HOUSTON_CRIME), STATEWIDE, { cities, now: NOW }).reasons.includes('outside-dfw'));
  assert.ok(scoreRelevance(at(2, FOOTBALL), { coverage: ['Plano'] }, { cities, now: NOW }).noise.includes('sports'));
});

test('council zoning and budget stories are relevant, tagged, and placed', () => {
  const zoning = scoreRelevance(at(5, PLANO_ZONING), PLANO_GOV, { cities, now: NOW });
  assert.equal(zoning.relevant, true, zoning.reasons.join(', '));
  assert.deepEqual(zoning.places, ['plano']);
  assert.ok(zoning.topics.includes('zoning-development'));

  // A statewide-style source has to name the place, and this story does.
  const budget = scoreRelevance(at(5, DALLAS_BUDGET), STATEWIDE, { cities, now: NOW });
  assert.equal(budget.relevant, true, budget.reasons.join(', '));
  assert.deepEqual(budget.places, ['dallas']);
  assert.ok(budget.topics.includes('budget-taxes'));
});

test('relevance needs a DFW place, a recent date, and is the same every time', () => {
  const unnamed = { title: 'City council approves new zoning rules', description: 'The council voted 5-2 after a public hearing.' };
  assert.deepEqual(scoreRelevance(at(1, unnamed), STATEWIDE, { cities, now: NOW }).reasons, ['no-dfw-place']);
  // The same story from a city's own newsroom is about that city.
  assert.equal(scoreRelevance(at(1, unnamed), { coverage: ['Plano'] }, { cities, now: NOW }).relevant, true);

  const old = scoreRelevance(at(24 * (NEWS_MAX_AGE_DAYS + 2), PLANO_ZONING), PLANO_GOV, { cities, now: NOW });
  assert.ok(old.reasons.includes('too-old'));
  assert.ok(scoreRelevance({ ...PLANO_ZONING, link: 'https://x.test/a' }, PLANO_GOV, { cities, now: NOW }).reasons.includes('undated'));

  const a = scoreRelevance(at(3, DALLAS_BUDGET), STATEWIDE, { cities, now: NOW });
  const b = scoreRelevance(at(3, DALLAS_BUDGET), STATEWIDE, { cities, now: NOW });
  assert.deepEqual(a, b);
});

test('a county story counts as that county, and "Dallas-Fort Worth" is not the two cities', () => {
  const county = scoreRelevance(at(1, { title: 'Dallas County commissioners approve budget and lower the tax rate', description: '' }), STATEWIDE, { cities, now: NOW });
  assert.equal(county.relevant, true);
  assert.deepEqual(county.places, []);
  assert.deepEqual(county.counties, ['Dallas']);

  const region = scoreRelevance(at(1, { title: 'Dallas-Fort Worth voters face record number of bond propositions', description: '' }), STATEWIDE, { cities, now: NOW });
  assert.equal(region.relevant, true);
  assert.deepEqual(region.places, []);
});

test('rss and atom parsing: alternate links, WordPress footers, word-boundary summaries', () => {
  const atom = `<feed xmlns="http://www.w3.org/2005/Atom"><entry><title>DART vote</title><link rel="self" href="https://x.test/feed/1"/><link rel="replies" href="https://x.test/1#comments"/><link rel="alternate" href="https://x.test/stories/1"/><updated>2026-09-08T10:00:00Z</updated><summary>Bus plan</summary></entry></feed>`;
  assert.equal(parseFeed(atom)[0].link, 'https://x.test/stories/1');

  const long = 'The council voted on the budget after a long public hearing that ran past midnight. '.repeat(6);
  const rss = `<rss><channel><item><title>Budget</title><link>https://x.test/b</link><description><![CDATA[<p>${long}</p><p>The post Budget appeared first on Example News.</p>]]></description></item></channel></rss>`;
  const [item] = parseFeed(rss);
  assert.ok(!/appeared first on/.test(item.description));
  assert.ok(item.description.length <= 280);
  assert.ok(item.description.endsWith('\u2026'));
  assert.ok(/[a-z]\u2026$/.test(item.description), 'cut at the end of a word, not mid-word');
  assert.ok(long.startsWith(item.description.slice(0, -1)));

  const short = `<rss><channel><item><title>T</title><link>https://x.test/c</link><description>Short. The post T appeared first on Site.</description></item></channel></rss>`;
  assert.equal(parseFeed(short)[0].description, 'Short.');
});

// A tiny stand-in for the newsrooms: each path serves one RSS document, optionally slowly.
let server;
let origin;
const feeds = new Map();
const hits = new Map();

function rss(items) {
  return `<?xml version="1.0"?><rss version="2.0"><channel><title>Fixture</title>${items
    .map((i) => `<item><title><![CDATA[${i.title}]]></title><link>${i.link}</link><pubDate>${i.pubDate}</pubDate><description><![CDATA[${i.description || ''}]]></description></item>`)
    .join('')}</channel></rss>`;
}

function serve(path, items, { delayMs = 0 } = {}) {
  feeds.set(path, { body: rss(items), delayMs });
  return `${origin}${path}`;
}

before(async () => {
  server = http.createServer((req, res) => {
    hits.set(req.url, (hits.get(req.url) || 0) + 1);
    const feed = feeds.get(req.url);
    if (!feed) {
      res.writeHead(404).end();
      return;
    }
    setTimeout(() => {
      res.writeHead(200, { 'Content-Type': 'application/rss+xml' });
      res.end(feed.body);
    }, feed.delayMs);
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  origin = `http://127.0.0.1:${server.address().port}`;
});

after(() => server && server.close());

const item = (h, story, slug) => ({ ...story, link: `https://news.example/${slug}`, pubDate: hoursAgo(h) });

test('the relevance check runs before the newest-N cut, so busy sports feeds cannot crowd out civic news', async () => {
  const sports = Array.from({ length: 12 }, (_, i) => item(i + 1, { title: `Week ${i + 1} football scoreboard: Plano rivals trade touchdowns`, description: 'High school football scores from across Collin County.' }, `football-${i}`));
  const news = {
    sources: [
      { id: 'sports-desk', name: 'Sports Desk', coverage: ['Plano'], rssUrl: serve('/limit/sports.xml', sports) },
      { id: 'ci-plano', name: 'Community Impact (Plano)', coverage: ['Plano'], focus: 'government', rssUrl: serve('/limit/gov.xml', [item(40, PLANO_ZONING, 'plano-zoning')]) },
    ],
    topicLinks: [],
  };
  const result = await fetchNews(news, { limit: 1, now: NOW, cities });
  assert.equal(result.items.length, 1);
  assert.equal(result.items[0].title, PLANO_ZONING.title);
  assert.equal(result.fetchedFeeds, 2);
  assert.deepEqual(result.items[0].places, ['plano']);
  assert.equal(typeof result.items[0].relevance, 'number');
});

test('realistic mixed feed: only the Plano zoning and Dallas budget stories survive', async () => {
  const news = {
    sources: [
      {
        id: 'channel-11',
        name: 'Channel 11',
        coverage: ['dfw'],
        requirePlace: true,
        rssUrl: serve('/mixed/tv.xml', [item(1, FOOTBALL, 'football'), item(2, WEATHER, 'weather'), item(3, HOUSTON_CRIME, 'houston'), item(4, FW_CRIME, 'fw-crime'), item(5, DALLAS_BUDGET, 'dallas-budget'), item(6, SPONSORED, 'napsi')]),
      },
      { id: 'ci-plano', name: 'Community Impact (Plano)', coverage: ['Plano'], focus: 'government', rssUrl: serve('/mixed/plano.xml', [item(7, PLANO_ZONING, 'plano-zoning')]) },
    ],
    topicLinks: [{ topic: 'budget-taxes', label: 'Budget', url: 'https://x.test', sourceName: 'X' }],
  };
  const all = await fetchNews(news, { now: NOW, cities });
  assert.deepEqual(
    all.items.map((i) => i.title),
    [DALLAS_BUDGET.title, PLANO_ZONING.title],
  );

  const budget = await fetchNews(news, { topic: 'budget-taxes', now: NOW, cities });
  assert.deepEqual(
    budget.items.map((i) => i.title),
    [DALLAS_BUDGET.title],
  );
  assert.equal(budget.topicLinks.length, 1);
});

test('city filter matches whole words, city ids, comma lists, and county-wide stories', async () => {
  const news = {
    sources: [
      {
        id: 'metro',
        name: 'Metro Desk',
        coverage: ['dfw'],
        rssUrl: serve('/city/metro.xml', [
          item(1, { title: 'Plano council hears legal challenge to short-term rental ordinance', description: '' }, 'challenge'),
          item(2, { title: 'Allen council approves new trail bond projects', description: '' }, 'allen'),
          item(3, { title: 'Dallas County commissioners approve budget and lower the tax rate', description: '' }, 'county'),
          item(4, { title: 'Fort Worth City Council delays vote on zoning case', description: '' }, 'fw'),
        ]),
      },
    ],
    topicLinks: [],
  };
  const titles = async (city) => (await fetchNews(news, { city, now: NOW, cities })).items.map((i) => i.title);
  assert.deepEqual(await titles('Allen'), ['Allen council approves new trail bond projects'], '"challenge" does not match Allen');
  assert.deepEqual(await titles('garland'), ['Dallas County commissioners approve budget and lower the tax rate'], 'a Dallas County story is a Garland story');
  assert.deepEqual(await titles('Plano, fort-worth'), ['Plano council hears legal challenge to short-term rental ordinance', 'Fort Worth City Council delays vote on zoning case']);
  assert.deepEqual(await titles('Plano '), ['Plano council hears legal challenge to short-term rental ordinance']);
});

test('old stories, repeats and unverified feeds are left out', async () => {
  const story = { title: 'McKinney recall campaign submits petition with 7,400 signatures', description: 'The McKinney City Council must now call an election.' };
  const news = {
    sources: [
      { id: 'a', name: 'A', coverage: ['dfw'], rssUrl: serve('/dedupe/a.xml', [item(3, story, 'a/recall?utm_source=rss'), item(24 * 45, PLANO_ZONING, 'old-zoning')]) },
      { id: 'b', name: 'B', coverage: ['dfw'], rssUrl: serve('/dedupe/b.xml', [item(2, story, 'b/recall-syndicated')]) },
      { id: 'c', name: 'C', coverage: ['dfw'], rssVerified: false, rssUrl: serve('/dedupe/c.xml', [item(1, DALLAS_BUDGET, 'unverified')]) },
    ],
    topicLinks: [],
  };
  const result = await fetchNews(news, { now: NOW, cities });
  assert.equal(result.items.length, 1, result.items.map((i) => i.title).join(' | '));
  assert.equal(result.items[0].title, story.title);
  assert.equal(result.totalFeeds, 2, 'the unverified feed is not counted or fetched');
  assert.equal(hits.get('/dedupe/c.xml'), undefined);
  assert.equal(result.maxAgeDays, NEWS_MAX_AGE_DAYS);
});

test('a slow feed does not hold the answer past the wait budget, and is used once it arrives', async () => {
  const news = {
    sources: [
      { id: 'fast', name: 'Fast', coverage: ['Plano'], focus: 'government', rssUrl: serve('/slow/fast.xml', [item(2, PLANO_ZONING, 'fast-zoning')]) },
      { id: 'slow', name: 'Slow', coverage: ['dfw'], rssUrl: serve('/slow/slow.xml', [item(1, DALLAS_BUDGET, 'slow-budget')], { delayMs: 600 }) },
    ],
    topicLinks: [],
  };
  const started = Date.now();
  const first = await fetchNews(news, { now: NOW, cities, waitMs: 150 });
  assert.ok(Date.now() - started < 550, 'answered before the slow feed finished');
  assert.equal(first.pendingFeeds, 1);
  assert.deepEqual(
    first.items.map((i) => i.title),
    [PLANO_ZONING.title],
  );

  await new Promise((resolve) => setTimeout(resolve, 700));
  const second = await fetchNews(news, { now: NOW, cities, waitMs: 150 });
  assert.equal(second.pendingFeeds, 0);
  assert.deepEqual(
    second.items.map((i) => i.title),
    [DALLAS_BUDGET.title, PLANO_ZONING.title],
  );
  assert.equal(hits.get('/slow/slow.xml'), 1, 'the second request was served from the cache');
});

test('a feed that fails contributes nothing and never rejects', async () => {
  const news = { sources: [{ id: 'gone', name: 'Gone', coverage: ['dfw'], rssUrl: `${origin}/missing/feed.xml` }], topicLinks: [] };
  const result = await fetchNews(news, { now: NOW, cities });
  assert.equal(result.fetchedFeeds, 0);
  assert.equal(result.totalFeeds, 1);
  assert.deepEqual(result.items, []);
});
