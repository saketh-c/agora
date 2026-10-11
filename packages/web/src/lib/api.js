/**
 * Client for the optional Agora API.
 *
 * Every request carries the language picked in the app (?lang=), which the server prefers
 * over the browser's Accept-Language, so explanations and drafts come back in the language
 * the student is reading. Failures reject with an ApiError that says what happened (status,
 * code, retryAfter), so a page can tell "offline" from "not found" from "busy" and fall back
 * to bundled data or a template.
 *
 * Where the API lives:
 * - The single-server build (npm start) serves it on the same origin, at `${BASE_URL}api`.
 * - VITE_API_BASE overrides that: an absolute URL (https://api.example.org/api), a root path
 *   (/api), or a path relative to the app's base (api).
 * - A static deploy (VITE_STATIC_DEPLOY=1, GitHub Pages) without VITE_API_BASE has no API at
 *   all. News reads the headline snapshot shipped with the build, and geocode, explain and
 *   comment reject at once with code 'offline' instead of requesting URLs that cannot exist
 *   (and sending a typed address along with them).
 */
import { getLocale } from '@agora/core';

/**
 * A failed API call. code is one of: 'offline' (no API in this build), 'network' (no
 * answer), 'timeout', 'aborted' (the caller cancelled it), 'not_json' (something other than
 * the API answered), 'no_snapshot',
 * or the server's own code ('rate_limited', 'not_found', 'outside_area', 'busy',
 * 'unavailable', 'invalid_input', ...), or one derived from the HTTP status.
 */
export class ApiError extends Error {
  constructor(message, { status = 0, code = 'network', retryAfter = null, data = null } = {}) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
    this.retryAfter = retryAfter;
    this.data = data;
  }
}

const TIMEOUT_MS = { health: 8000, news: 12000, geocode: 15000, explain: 45000, comment: 45000 };
const DEFAULT_MAX_AGE_DAYS = 30;
const DAY_MS = 86400000;

/** Where the API lives for a build, or '' when it has none. */
function resolveApiBase(configured, base) {
  const root = base.endsWith('/') ? base : `${base}/`;
  if (!configured) return `${root}api`;
  if (/^https?:\/\//i.test(configured) || configured.startsWith('/')) return configured.replace(/\/+$/, '');
  return `${root}${configured.replace(/^\/+|\/+$/g, '')}`;
}

function codeForStatus(status) {
  if (status === 404) return 'not_found';
  if (status === 429) return 'rate_limited';
  if (status === 503) return 'busy';
  if (status >= 500) return 'server';
  if (status >= 400) return 'bad_request';
  return 'http_error';
}

/** The body as JSON, or null when the response is not JSON (a dev server's index.html, say). */
async function readJson(res) {
  const type = (res.headers && typeof res.headers.get === 'function' && res.headers.get('content-type')) || '';
  if (!/json/i.test(type)) return null;
  try {
    return await res.json();
  } catch {
    return null;
  }
}

function retryAfterOf(res, data) {
  const header = res.headers && typeof res.headers.get === 'function' ? Number(res.headers.get('retry-after')) : NaN;
  if (Number.isFinite(header) && header >= 0) return header;
  return data && Number.isFinite(Number(data.retryAfter)) ? Number(data.retryAfter) : null;
}

const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/**
 * The same city filter the server applies: each comma-separated name matches the stories
 * that name it as a whole word or that the server tagged with that city's id.
 */
function cityTest(city) {
  const names = String(city || '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  if (!names.length) return null;
  const tests = names.map((name) => {
    const slug = name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '');
    const word = new RegExp(`\\b${escapeRe(name)}\\b`, 'i');
    return (item) => (item.places || []).includes(slug) || word.test(`${item.title} ${item.description || ''}`);
  });
  return (item) => tests.some((test) => test(item));
}

/**
 * Filter the deploy-time snapshot the way the server filters live headlines, including the
 * 30-day window, so an old snapshot shows fewer headlines instead of month-old ones.
 */
export function filterSnapshot(snap, { topic, city, limit = 20 } = {}, nowMs = Date.now()) {
  const maxAgeDays = Number(snap.maxAgeDays) > 0 ? Number(snap.maxAgeDays) : DEFAULT_MAX_AGE_DAYS;
  let items = (snap.items || []).filter((i) => {
    const t = Date.parse(i.publishedAt || '');
    return Number.isFinite(t) && nowMs - t <= maxAgeDays * DAY_MS;
  });
  if (topic) items = items.filter((i) => (i.topics || []).includes(topic));
  const matches = cityTest(city);
  if (matches) items = items.filter(matches);
  return {
    topic: topic || null,
    city: city || null,
    fetchedFeeds: snap.fetchedFeeds,
    totalFeeds: snap.totalFeeds,
    pendingFeeds: 0,
    maxAgeDays,
    items: items.slice(0, limit),
    topicLinks: (snap.topicLinks || []).filter((l) => !topic || l.topic === topic),
    snapshotAt: snap.generatedAt,
  };
}

/**
 * Build a client for one build configuration. The app uses the instance below; tests pass
 * their own env and fetch.
 * @param {{env?: object, fetch?: typeof fetch, now?: () => number, locale?: () => string}} [options]
 */
export function createApi({ env = {}, fetch: fetchImpl, now = () => Date.now(), locale = getLocale } = {}) {
  const doFetch = fetchImpl || ((...args) => globalThis.fetch(...args));
  const base = typeof env.BASE_URL === 'string' && env.BASE_URL ? env.BASE_URL : '/';
  const configured = String(env.VITE_API_BASE || '').trim();
  const staticOnly = env.VITE_STATIC_DEPLOY === '1' && !configured;
  const apiBase = staticOnly ? '' : resolveApiBase(configured, base);
  let snapshot = null;

  async function request(route, { query = {}, method = 'GET', body, timeoutMs = 15000, signal } = {}) {
    if (staticOnly) throw new ApiError('This copy of the app has no server to ask.', { code: 'offline' });
    if (signal && signal.aborted) throw new ApiError('The request was cancelled.', { code: 'aborted' });
    const params = new URLSearchParams();
    for (const [k, v] of Object.entries(query)) if (v !== undefined && v !== null && v !== '') params.set(k, String(v));
    params.set('lang', locale());
    const controller = typeof AbortController === 'function' ? new AbortController() : null;
    const timer = controller ? setTimeout(() => controller.abort(), timeoutMs) : null;
    // A caller's signal (a newer search replacing this one) cancels the request too.
    const cancel = () => controller && controller.abort();
    if (signal && controller) signal.addEventListener('abort', cancel, { once: true });
    let res;
    let data;
    try {
      res = await doFetch(`${apiBase}/${route}?${params}`, {
        method,
        headers: { Accept: 'application/json', ...(body === undefined ? {} : { 'Content-Type': 'application/json' }) },
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: controller ? controller.signal : undefined,
      });
      data = await readJson(res);
    } catch {
      if (signal && signal.aborted) throw new ApiError('The request was cancelled.', { code: 'aborted' });
      const timedOut = Boolean(controller && controller.signal.aborted);
      throw new ApiError(timedOut ? 'The server took too long to answer.' : 'The app could not reach its server.', { code: timedOut ? 'timeout' : 'network' });
    } finally {
      if (timer) clearTimeout(timer);
      if (signal && controller) signal.removeEventListener('abort', cancel);
    }
    if (!res.ok) throw new ApiError((data && data.error) || `Request failed (${res.status})`, { status: res.status, code: (data && data.code) || codeForStatus(res.status), retryAfter: retryAfterOf(res, data), data });
    if (data === null) throw new ApiError('Something other than the API answered.', { status: res.status, code: 'not_json' });
    return data;
  }

  /**
   * Headlines gathered at deploy time, fetched once per session and filtered in the browser.
   * A failed load is not cached, so it can be retried.
   */
  function loadSnapshot() {
    if (!snapshot) {
      snapshot = Promise.resolve()
        .then(() => doFetch(`${base.endsWith('/') ? base : `${base}/`}news-snapshot.json`, { headers: { Accept: 'application/json' } }))
        .then(async (res) => {
          const data = res.ok ? await readJson(res) : null;
          if (!data || !Array.isArray(data.items)) throw new ApiError(`No headline snapshot (${res.status})`, { status: res.status, code: 'no_snapshot' });
          return data;
        });
      snapshot.catch(() => {
        snapshot = null;
      });
    }
    return snapshot;
  }

  // Every call takes an optional { signal } last, so a page can cancel a request it no
  // longer needs (a newer search replacing an older one); it then rejects with code 'aborted'.
  const api = {
    /** Server status, including whether AI rewrites are available (ai: true). */
    health: ({ signal } = {}) => request('health', { timeoutMs: TIMEOUT_MS.health, signal }),
    /** Local civic headlines: { items, topicLinks, fetchedFeeds, totalFeeds, pendingFeeds, maxAgeDays, snapshotAt? }. */
    news: async (params = {}, { signal } = {}) => {
      if (staticOnly) return filterSnapshot(await loadSnapshot(), params, now());
      try {
        return await request('news', { query: { topic: params.topic, city: params.city, limit: params.limit }, timeoutMs: TIMEOUT_MS.news, signal });
      } catch (err) {
        if (err.code === 'aborted') throw err;
        // The API did not deliver. A build that shipped a snapshot can still show headlines;
        // otherwise report the original failure, with its status and code, so the page can
        // say what actually happened (busy is not the same as offline).
        let snap;
        try {
          snap = await loadSnapshot();
        } catch {
          throw err;
        }
        return filterSnapshot(snap, params, now());
      }
    },
    /** A ZIP code or address in DFW. Rejects with code 'outside_area' or 'not_found' when there is none. */
    geocode: (q, { signal } = {}) => request('geocode', { query: { q }, timeoutMs: TIMEOUT_MS.geocode, signal }),
    /** Plain-language explanation of an agenda item ({ title, summary, cityId, itemIndex? }). */
    explain: (body, { signal } = {}) => request('explain', { method: 'POST', body, timeoutMs: TIMEOUT_MS.explain, signal }),
    /** Comment draft, and an AI rewrite with { useAi: true }: { draft, seconds, ai, aiError? }. */
    comment: (body, { signal } = {}) => request('comment', { method: 'POST', body, timeoutMs: TIMEOUT_MS.comment, signal }),
  };

  return { api, apiAvailable: !staticOnly, staticOnly, apiBase };
}

const client = createApi({ env: import.meta.env || {} });

export const api = client.api;
/** False in a static deploy with no API: address lookup and AI features cannot work there. */
export const apiAvailable = client.apiAvailable;
/** True for the static deploy that reads headlines from the snapshot only. */
export const STATIC_ONLY = client.staticOnly;
/** The API's base URL for this build ('' when there is none). */
export const API_BASE = client.apiBase;
