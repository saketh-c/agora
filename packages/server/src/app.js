import express from 'express';
import path from 'node:path';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import {
  BRAND,
  todayStr,
  upcomingMeetings,
  expandCityMeetings,
  addDays,
  nextMeetingFor,
  buildPlan,
  matchMeetings,
  matchAgendaItems,
  computeStats,
  findCity,
  isDateStr,
  isTopicId,
  topicList,
  glossary,
  checklist,
  speakingTips,
  buildComment,
  estimateSpeakingSeconds,
  timeOfDayFor,
  inferTopics,
  t,
  LOCALES,
  isLocale,
  setLocale,
  localizeCities,
} from '@agora/core';
import { fetchNews } from './news.js';
import { loadTranslations } from '@agora/core/node';
import { resolvePlace, normalizeQuery } from './geocode.js';
import { explainAgendaItem, draftComment, aiAvailable } from './ai.js';
import { apiMessage } from './messages.js';

const here = path.dirname(fileURLToPath(import.meta.url));

const CSP = [
  "default-src 'self'",
  // wasm-unsafe-eval lets the on-device vision models compile; it does not permit eval().
  "script-src 'self' 'wasm-unsafe-eval'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob: https://tile.openstreetmap.org https://*.tile.openstreetmap.org",
  "connect-src 'self' https://tile.openstreetmap.org https://*.tile.openstreetmap.org",
  // Community posts: photos and video stored on the device come back as blob: URLs, and
  // pasted video links are only ever rewritten to these two embed hosts.
  "media-src 'self' blob:",
  "frame-src https://www.youtube-nocookie.com https://player.vimeo.com",
  "font-src 'self'",
  "worker-src 'self'",
  "manifest-src 'self'",
  "frame-ancestors 'none'",
  "base-uri 'self'",
  "form-action 'self'",
].join('; ');

/**
 * Powerful browser features, per origin. Rehearse records the student with the camera and
 * microphone (live captions need the microphone too), and the location picker can ask for
 * the device location, all from this app's own pages, so those three are allowed for this
 * origin only; embedded frames get none of them. Features the app never uses are switched
 * off outright. Fullscreen, picture-in-picture and encrypted media are left at the browser
 * default because the Community page's video embeds ask for them.
 */
export const PERMISSIONS_POLICY = [
  'camera=(self)',
  'microphone=(self)',
  'geolocation=(self)',
  'accelerometer=()',
  'gyroscope=()',
  'magnetometer=()',
  'payment=()',
  'usb=()',
  'serial=()',
  'hid=()',
  'midi=()',
  'display-capture=()',
  'xr-spatial-tracking=()',
  'browsing-topics=()',
].join(', ');

/**
 * Requests per client per minute (per 10 minutes and per day for the AI allowance). The news
 * limit is generous because answers come from a shared 15-minute feed cache and cost a few
 * milliseconds; geocoding and AI cost a third party, so they are tighter. Note that a whole
 * school network can share one address.
 */
export const DEFAULT_LIMITS = Object.freeze({
  api: 240,
  news: 120,
  geocode: 20,
  explain: 30,
  comment: 30,
  aiPerClient: 10,
  aiWindowMs: 10 * 60 * 1000,
  aiPerDay: 300,
});

const DAY_MS = 24 * 60 * 60 * 1000;
const EXPLAIN_CACHE_MAX = 500;

/** Origins allowed to call the API from a browser on another host (dev tools, a separately hosted web build). */
function corsAllowed(origin) {
  if (!origin) return false;
  if (/^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/i.test(origin)) return true;
  const extra = String(process.env.CORS_ORIGINS || '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  return extra.includes(origin);
}

/**
 * Express "trust proxy" setting: TRUST_PROXY may be true/false, a hop count, or a list of
 * addresses or subnets. The default trusts only a proxy on this machine (the Vite dev server).
 * Behind a hosting proxy, set it so every visitor is not counted as the proxy's one address.
 */
function trustProxySetting(value) {
  const v = String(value === undefined || value === null ? '' : value).trim();
  if (!v) return 'loopback';
  if (/^(true|false)$/i.test(v)) return v.toLowerCase() === 'true';
  if (/^\d+$/.test(v)) return Number(v);
  return v;
}

/**
 * The response language: an explicit lang from the app (query string, then JSON body) wins
 * over the browser's Accept-Language, so the server answers in the language the student
 * picked in Agora rather than the one their device is set to.
 */
export function requestLang(req) {
  const query = req.query && typeof req.query.lang === 'string' ? req.query.lang : '';
  const body = req.body && typeof req.body === 'object' && !Array.isArray(req.body) && typeof req.body.lang === 'string' ? req.body.lang : '';
  const header = String(req.headers['accept-language'] || '')
    .split(',')
    .map((part) => part.split(';')[0].trim());
  return (
    [query, body, ...header]
      .map((x) =>
        String(x || '')
          .toLowerCase()
          .split(/[-_]/)[0],
      )
      .find(isLocale) || 'en'
  );
}

const clientKey = (req) => req.ip || (req.socket && req.socket.remoteAddress) || 'unknown';

/**
 * Per-client sliding-window limiter. A refusal says, in the client's language, that the
 * limit is per network and when the oldest request leaves the window, and Retry-After
 * carries the same number of seconds.
 */
function limiter(max, windowMs = 60000) {
  const hits = new Map();
  let lastPrune = Date.now();
  return (req, res, next) => {
    const now = Date.now();
    if (now - lastPrune > windowMs || hits.size > 10000) {
      for (const [key, times] of hits) {
        const keep = times.filter((x) => now - x < windowMs);
        if (keep.length) hits.set(key, keep);
        else hits.delete(key);
      }
      lastPrune = now;
    }
    const key = clientKey(req);
    const times = (hits.get(key) || []).filter((x) => now - x < windowMs);
    if (times.length >= max) {
      hits.set(key, times);
      const retryAfter = Math.max(1, Math.ceil((times[0] + windowMs - now) / 1000));
      res.setHeader('Retry-After', String(retryAfter));
      return res.status(429).json({ error: apiMessage('rateLimited', { seconds: retryAfter }, req.lang || requestLang(req)), code: 'rate_limited', retryAfter });
    }
    times.push(now);
    hits.set(key, times);
    next();
  };
}

/**
 * The AI allowance: a few model calls per client per window, and a daily ceiling for the
 * whole server, so an open endpoint cannot run up an unbounded bill. Requests over the
 * allowance still get the template answer.
 */
function aiAllowance({ aiPerClient, aiWindowMs, aiPerDay }) {
  const perClient = new Map();
  let today = [];
  return {
    take(key) {
      const now = Date.now();
      today = today.filter((x) => now - x < DAY_MS);
      if (today.length >= aiPerDay) return { ok: false, retryAfter: Math.ceil((today[0] + DAY_MS - now) / 1000) };
      if (perClient.size > 10000) for (const [k, v] of perClient) if (!v.some((x) => now - x < aiWindowMs)) perClient.delete(k);
      const times = (perClient.get(key) || []).filter((x) => now - x < aiWindowMs);
      if (times.length >= aiPerClient) {
        perClient.set(key, times);
        return { ok: false, retryAfter: Math.ceil((times[0] + aiWindowMs - now) / 1000) };
      }
      times.push(now);
      perClient.set(key, times);
      today.push(now);
      return { ok: true };
    },
  };
}

const str = (v, max) => (typeof v === 'string' ? v.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, '').trim().slice(0, max) : '');

/** The JSON body as an object, or null when it is something else (an array, a string). */
function objectBody(req) {
  if (req.body === undefined || req.body === null) return {};
  return typeof req.body === 'object' && !Array.isArray(req.body) ? req.body : null;
}

/** The first of these fields that is present but is not a string. */
function nonStringField(body, fields) {
  return fields.find((f) => body[f] !== undefined && body[f] !== null && typeof body[f] !== 'string') || null;
}

const sameTitle = (s) =>
  String(s || '')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();

/**
 * Cache-Control for a file of the built app, by its path inside dist: content-hashed assets
 * forever, the entry points (HTML, service worker, manifest, headline snapshot) always
 * revalidated so a deploy shows up on the next visit, everything else for an hour.
 */
function staticCacheHeaders(res, relativePath) {
  const rel = relativePath.split(path.sep).join('/');
  const base = path.basename(rel);
  if (rel.startsWith('assets/')) res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
  else if (/\.html$/.test(base) || ['sw.js', 'registerSW.js', 'manifest.webmanifest', 'news-snapshot.json'].includes(base) || /^workbox-.*\.js$/.test(base)) res.setHeader('Cache-Control', 'no-cache');
  else res.setHeader('Cache-Control', 'public, max-age=3600');
}

/**
 * Build the Express app. Data is injected so tests can pass fixtures.
 * @param {{cities: object[], news: {sources: object[], topicLinks: object[]}, webDist?: string, now?: () => Date, translations?: (lang: string) => object|null, limits?: Partial<typeof DEFAULT_LIMITS>, trustProxy?: string|boolean|number, newsWaitMs?: number, geocoder?: typeof resolvePlace}} deps
 */
export function createApp({ cities, news, webDist, now = () => new Date(), translations = loadTranslationsSafely, limits: limitOverrides = {}, trustProxy = process.env.TRUST_PROXY, newsWaitMs = 2500, geocoder = resolvePlace }) {
  const limits = { ...DEFAULT_LIMITS, ...(Number(process.env.AI_DAILY_LIMIT) > 0 ? { aiPerDay: Number(process.env.AI_DAILY_LIMIT) } : {}), ...limitOverrides };
  // City data localized per language, built once per language and reused.
  const localized = new Map([['en', cities]]);
  const citiesIn = (lang) => {
    if (localized.has(lang)) return localized.get(lang);
    const list = localizeCities(cities, translations(lang));
    localized.set(lang, list);
    return list;
  };
  const allowance = aiAllowance(limits);
  const explanations = new Map();

  const app = express();
  app.disable('x-powered-by');
  app.set('trust proxy', trustProxySetting(trustProxy));
  app.use(express.json({ limit: '32kb' }));

  app.use((req, res, next) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
    res.setHeader('Permissions-Policy', PERMISSIONS_POLICY);
    res.setHeader('X-Frame-Options', 'DENY');
    if (req.path.startsWith('/api/')) {
      res.setHeader('Cache-Control', 'no-store');
      const origin = req.headers.origin;
      if (corsAllowed(origin)) {
        res.setHeader('Access-Control-Allow-Origin', origin);
        res.setHeader('Vary', 'Origin');
        res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
        res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
      }
      if (req.method === 'OPTIONS') return res.sendStatus(204);
    } else {
      res.setHeader('Content-Security-Policy', CSP);
    }
    next();
  });

  // Language for this request only: explicit lang first, then Accept-Language. Handlers that
  // build text after an await pass req.lang explicitly instead of relying on the global locale.
  app.use('/api', (req, res, next) => {
    req.lang = requestLang(req);
    setLocale(req.lang);
    res.setHeader('Content-Language', req.lang);
    res.setHeader('Vary', [res.getHeader('Vary'), 'Accept-Language'].filter(Boolean).join(', '));
    next();
  });

  app.use('/api', limiter(limits.api));

  const today = () => todayStr('America/Chicago', now());
  const cityIndex = new Map(cities.map((c) => [c.cityId, c]));
  const invalid = (res, req, field) => res.status(400).json({ error: apiMessage('invalidField', { field }, req.lang), code: 'invalid_input', field });

  /**
   * Find a dataset agenda item from what the drawer knows about it: an index into the city's
   * agendaItems when given, otherwise its title in any language the app shows. Indexes line
   * up across languages because localizing a city keeps the order of its items.
   */
  const findAgendaItem = ({ cityId, title, itemIndex, lang }) => {
    const pool = cityId && cityIndex.has(cityId) ? [cityIndex.get(cityId)] : cities;
    const wanted = sameTitle(title);
    if (Number.isInteger(itemIndex) && cityId && cityIndex.has(cityId)) {
      const city = cityIndex.get(cityId);
      const item = (city.agendaItems || [])[itemIndex];
      const shown = item && (citiesIn(lang).find((c) => c.cityId === cityId) || city).agendaItems[itemIndex];
      if (item && (!wanted || sameTitle(item.title) === wanted || sameTitle(shown && shown.title) === wanted)) return { city, item, index: itemIndex };
    }
    if (!wanted) return null;
    const langs = [...new Set([lang, 'en', ...LOCALES.map((l) => l.code)])];
    for (const code of langs) {
      for (const english of pool) {
        const shown = code === 'en' ? english : citiesIn(code).find((c) => c.cityId === english.cityId);
        const index = ((shown && shown.agendaItems) || []).findIndex((item) => sameTitle(item.title) === wanted);
        if (index >= 0 && english.agendaItems && english.agendaItems[index]) return { city: english, item: english.agendaItems[index], index };
      }
    }
    return null;
  };

  app.get('/api/health', (req, res) => {
    res.json({ ok: true, app: BRAND.name, cities: cities.length, today: today(), ai: aiAvailable(), lang: req.lang, languages: LOCALES });
  });

  app.get('/api/topics', (req, res) => res.json({ topics: topicList(req.lang) }));

  app.get('/api/cities', (req, res) => {
    const from = today();
    res.json({ cities: citiesIn(req.lang).map((c) => summarizeCity(c, from)) });
  });

  app.get('/api/cities/:id', (req, res) => {
    const city = citiesIn(req.lang).find((c) => c.cityId === req.params.id) || findCity(citiesIn(req.lang), req.params.id);
    if (!city) return res.status(404).json({ error: t('city.notFound', undefined, req.lang), code: 'not_found' });
    const from = today();
    res.json({ city, upcoming: expandCityMeetings(city, from, addDays(from, 60)) });
  });

  app.get('/api/meetings', (req, res) => {
    const from = isDateStr(req.query.from) ? req.query.from : today();
    const days = clampInt(req.query.days, 1, 120, 30);
    let list = upcomingMeetings(citiesIn(req.lang), { from, days, includeCancelled: req.query.includeCancelled === '1' });
    if (req.query.city) {
      const city = findCity(citiesIn(req.lang), str(req.query.city, 60));
      list = city ? list.filter((m) => m.cityId === city.cityId) : [];
    }
    if (req.query.evening === '1') list = list.filter((m) => m.isEvening);
    if (req.query.speak === '1') list = list.filter((m) => m.openToPublicComment);
    if (isTopicId(req.query.topic)) list = list.filter((m) => m.agendaItems.some((a) => a.topics.includes(req.query.topic)));
    res.json({ from, days, count: list.length, meetings: list });
  });

  app.post('/api/match', (req, res) => {
    const body = req.body && typeof req.body === 'object' ? req.body : {};
    const prefs = body.prefs && typeof body.prefs === 'object' ? body.prefs : body;
    const from = today();
    res.json(buildPlan(citiesIn(req.lang), prefs, { today: from, days: clampInt(body.days, 7, 120, 45) }));
  });

  app.get('/api/match', (req, res) => {
    const list = citiesIn(req.lang);
    const homeCity = req.query.city ? findCity(list, str(req.query.city, 60)) : null;
    const prefs = {
      interests: str(req.query.interests, 400)
        .split(',')
        .map((s) => s.trim())
        .filter(isTopicId),
      availability: { evenings: req.query.evenings !== '0', daytime: req.query.daytime === '1', weekends: req.query.weekends !== '0' },
      homeCityId: homeCity ? homeCity.cityId : null,
      location: req.query.lat && req.query.lng ? { lat: Number(req.query.lat), lng: Number(req.query.lng) } : null,
      maxMiles: req.query.miles ? Number(req.query.miles) : undefined,
      canSpeakOnly: req.query.speak === '1',
    };
    const from = today();
    res.json({
      prefs,
      meetings: matchMeetings(list, prefs, { today: from, days: clampInt(req.query.days, 7, 120, 45), limit: clampInt(req.query.limit, 1, 50, 10) }),
      agendaItems: matchAgendaItems(list, prefs, { today: from, limit: 10 }),
    });
  });

  app.get('/api/stats', (req, res) => {
    res.json(computeStats(citiesIn(req.lang), { today: today(), days: clampInt(req.query.days, 7, 120, 30) }));
  });

  // Headlines that pass the relevance check, newest first. Slow feeds get a short budget and
  // keep loading in the background (counted in pendingFeeds), so one stalled newsroom never
  // holds up the page. fetchNews never rejects.
  app.get('/api/news', limiter(limits.news), async (req, res) => {
    const topic = isTopicId(req.query.topic) ? req.query.topic : undefined;
    const city = typeof req.query.city === 'string' ? str(req.query.city, 120) : '';
    const result = await fetchNews(news, { topic, city: city || undefined, limit: clampInt(req.query.limit, 1, 200, 20), now: now(), waitMs: newsWaitMs, cities });
    res.json(result);
  });

  app.get('/api/geocode', limiter(limits.geocode), async (req, res) => {
    if (req.query.q !== undefined && typeof req.query.q !== 'string') return invalid(res, req, 'q');
    const q = normalizeQuery(req.query.q);
    if (!q) return res.status(400).json({ error: apiMessage('missingQuery', null, req.lang), code: 'missing_query' });
    try {
      const result = await geocoder(q, cities);
      if (result.status === 'found') return res.json(result.place);
      if (result.status === 'outside') {
        const error = result.label ? apiMessage('geoOutside', { place: result.label }, req.lang) : apiMessage('geoOutsideZip', { zip: result.zip || q }, req.lang);
        return res.status(404).json({ error, code: 'outside_area', label: result.label || result.zip || null });
      }
      return res.status(404).json({ error: apiMessage('geoNotFound', null, req.lang), code: 'not_found' });
    } catch (e) {
      if (e && e.code === 'busy') {
        res.setHeader('Retry-After', '5');
        return res.status(503).json({ error: apiMessage('geoBusy', null, req.lang), code: 'busy', retryAfter: 5 });
      }
      console.warn(`Address lookup failed: ${e && e.message ? e.message : e}`);
      return res.status(502).json({ error: apiMessage('geoUnavailable', null, req.lang), code: 'unavailable' });
    }
  });

  app.get('/api/learn', (req, res) => {
    res.json({ glossary: glossary(req.lang), checklist: checklist(req.lang), tips: speakingTips(req.lang), nonpartisan: BRAND.nonpartisanNote });
  });

  /**
   * A first-draft public comment in the request's language, and, when asked for and allowed,
   * an AI rewrite of it. ai is null unless the model's rewrite passed every check; aiError
   * then says why ('off', 'rate_limited', 'busy', 'declined' or 'unavailable').
   */
  app.post('/api/comment', limiter(limits.comment), async (req, res) => {
    const body = objectBody(req);
    if (!body) return res.status(400).json({ error: apiMessage('invalidBody', null, req.lang), code: 'invalid_input' });
    const bad = nonStringField(body, ['name', 'school', 'cityId', 'cityName', 'topicId', 'itemTitle', 'position', 'story', 'ask', 'lang']);
    if (bad) return invalid(res, req, bad);
    if (body.useAi !== undefined && body.useAi !== null && typeof body.useAi !== 'boolean') return invalid(res, req, 'useAi');
    const lang = req.lang;
    const city = body.cityId ? citiesIn(lang).find((c) => c.cityId === str(body.cityId, 60)) : null;
    const input = {
      name: str(body.name, 80),
      school: str(body.school, 120),
      cityName: city ? city.name : str(body.cityName, 60),
      topicId: isTopicId(body.topicId) ? body.topicId : 'other',
      itemTitle: str(body.itemTitle, 200),
      position: ['support', 'oppose', 'concerned', 'ask'].includes(body.position) ? body.position : 'ask',
      story: str(body.story, 1200),
      ask: str(body.ask, 300),
      timeOfDay: city && city.meetings && city.meetings[0] ? timeOfDayFor(city.meetings[0].recurrence.time) : 'evening',
      locale: lang,
    };
    const draft = buildComment(input);
    let ai = null;
    let aiError;
    if (body.useAi === true) {
      if (!aiAvailable()) aiError = 'off';
      else if (!allowance.take(clientKey(req)).ok) aiError = 'rate_limited';
      else {
        const result = await draftComment(input, draft, { cityName: city ? city.name : undefined });
        if (result.source === 'claude') ai = { source: result.source, model: result.model, text: result.text, seconds: estimateSpeakingSeconds(result.text) };
        else {
          aiError = result.aiError || 'unavailable';
          if (result.fallbackReason) console.warn(`AI comment rewrite fell back to the template: ${result.fallbackReason}`);
        }
      }
    }
    res.json({ draft, seconds: estimateSpeakingSeconds(draft), ai, ...(aiError ? { aiError } : {}), lang });
  });

  /**
   * A plain-language explanation of an agenda item, entirely in the request's language. The
   * model is only spent on items that exist in the dataset (found by itemIndex or by their
   * title in any language) and within the AI allowance; its answers are cached per item and
   * language for a day. Everything else gets the template, and aiError says why when the
   * model was tried or skipped.
   */
  app.post('/api/explain', limiter(limits.explain), async (req, res) => {
    const body = objectBody(req);
    if (!body) return res.status(400).json({ error: apiMessage('invalidBody', null, req.lang), code: 'invalid_input' });
    const bad = nonStringField(body, ['title', 'summary', 'cityId', 'lang']);
    if (bad) return invalid(res, req, bad);
    if (body.itemIndex !== undefined && body.itemIndex !== null && !(Number.isInteger(body.itemIndex) && body.itemIndex >= 0)) return invalid(res, req, 'itemIndex');
    const lang = req.lang;
    const title = str(body.title, 1000);
    const cityId = str(body.cityId, 60);
    const itemIndex = Number.isInteger(body.itemIndex) ? body.itemIndex : undefined;
    if (!title && itemIndex === undefined) return res.status(400).json({ error: apiMessage('missingTitle', null, lang), code: 'missing_title' });

    const known = findAgendaItem({ cityId, title, itemIndex, lang });
    const english = known ? known.city : cityIndex.get(cityId) || null;
    const shownCity = english ? citiesIn(lang).find((c) => c.cityId === english.cityId) || english : null;
    let result;
    if (known) {
      const key = `${english.cityId}#${known.index}#${lang}`;
      const cached = explanations.get(key);
      if (cached && cached.expires > Date.now()) return res.json(cached.response);
      const shown = (shownCity.agendaItems || [])[known.index] || known.item;
      const topics = known.item.topics && known.item.topics.length ? known.item.topics : inferTopics(`${known.item.title} ${known.item.summary || ''}`);
      const input = { title: shown.title, summary: shown.summary, city: shownCity, topics, source: { title: known.item.title, summary: known.item.summary, city: english }, locale: lang };
      if (aiAvailable() && !allowance.take(clientKey(req)).ok) result = { ...(await explainAgendaItem({ ...input, templateOnly: true })), aiError: 'rate_limited' };
      else result = await explainAgendaItem(input);
      const response = explainResponse(result);
      if (result.source === 'claude') {
        if (explanations.size >= EXPLAIN_CACHE_MAX) explanations.delete(explanations.keys().next().value);
        explanations.set(key, { response, expires: Date.now() + DAY_MS });
      }
      return res.json(response);
    }
    result = await explainAgendaItem({ title, summary: str(body.summary, 2000), city: shownCity, locale: lang, templateOnly: true });
    res.json(explainResponse(result));
  });

  /** What a browser may see of an explanation: never the raw provider error. */
  function explainResponse(result) {
    if (result.fallbackReason) console.warn(`AI explanation fell back to the template: ${result.fallbackReason}`);
    const { source, model, topics, text, locale, aiError } = result;
    return { source, ...(model ? { model } : {}), topics, text, lang: locale, ...(aiError ? { aiError } : {}) };
  }

  app.use('/api', (req, res) => res.status(404).json({ error: apiMessage('notFound', null, req.lang), code: 'not_found' }));

  // Serve the built web app when it exists (npm run build). Client routes get index.html;
  // anything that looks like a file (it has an extension) or does not accept HTML is a real
  // 404, so a missing news-snapshot.json or model file fails fast instead of "succeeding"
  // with the app's HTML.
  const dist = webDist || path.resolve(here, '..', '..', 'web', 'dist');
  if (existsSync(dist)) {
    app.use(express.static(dist, { index: 'index.html', cacheControl: false, setHeaders: (res, filePath) => staticCacheHeaders(res, path.relative(dist, filePath)) }));
    app.use((req, res, next) => {
      if (req.method !== 'GET' && req.method !== 'HEAD') return next();
      if (path.extname(req.path) || req.accepts(['html', 'json']) !== 'html') return res.status(404).type('text/plain').send('Not found');
      res.setHeader('Cache-Control', 'no-cache');
      res.sendFile(path.join(dist, 'index.html'));
    });
  } else {
    app.get('/', (req, res) => {
      res.type('text/plain').send(`${BRAND.name} API is running. Build the web app with "npm run build" to serve it here, or run "npm run dev".\n\nTry: /api/health, /api/cities, /api/meetings?days=14, /api/match?interests=housing,transit&city=plano`);
    });
  }

  // Every error, including malformed JSON bodies, comes back as JSON without a stack trace.
  // eslint-disable-next-line no-unused-vars
  app.use((err, req, res, next) => {
    const lang = req.lang || requestLang(req);
    const status = err.type === 'entity.parse.failed' ? 400 : err.type === 'entity.too.large' ? 413 : err.status || err.statusCode || 500;
    const code = err.type === 'entity.parse.failed' ? 'invalid_json' : status === 413 ? 'too_large' : status >= 500 ? 'server_error' : 'bad_request';
    const error = code === 'invalid_json' ? apiMessage('invalidJson', null, lang) : code === 'too_large' ? apiMessage('bodyTooLarge', null, lang) : code === 'server_error' ? apiMessage('serverError', null, lang) : String(err.message || 'Request failed');
    if (status >= 500) console.error(err);
    res.status(status).json({ error, code });
  });

  return app;
}

function summarizeCity(city, from) {
  const next = nextMeetingFor(city, from);
  const nextSpeak = nextMeetingFor(city, from, { publicCommentOnly: true });
  return {
    cityId: city.cityId,
    name: city.name,
    county: city.county,
    populationApprox: city.populationApprox,
    cityHall: city.cityHall,
    website: city.website,
    confidence: city.confidence,
    meetingRules: (city.meetings || []).map((m) => ({ type: m.type, label: m.label, recurrence: m.recurrence, openToPublicComment: m.openToPublicComment !== false })),
    publicComment: city.publicComment,
    youthProgramCount: (city.youthPrograms || []).length,
    agendaItemCount: (city.agendaItems || []).length,
    nextMeeting: next,
    nextSpeakableMeeting: nextSpeak,
  };
}

/** Translation memory loader that never throws, so a missing file just means English. */
function loadTranslationsSafely(lang) {
  try {
    return loadTranslations(lang);
  } catch {
    return null;
  }
}

function clampInt(value, min, max, fallback) {
  const n = Number.parseInt(value, 10);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, n));
}
