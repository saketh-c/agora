import { DFW_ZIP_PREFIXES, NOMINATIM_SEARCH_URL, judgeNominatim, nominatimRequest, normalizePlaceQuery, resolveLocally } from '@agora/core';

/**
 * Turn "75230", "Plano", or "10600 Preston Rd, Dallas" into a DFW lat/lng, or say clearly
 * that the place is outside Dallas-Fort Worth.
 *
 * City names resolve locally with no network call. ZIP codes outside the area's postal
 * prefixes are answered locally too. Other ZIP codes use OpenStreetMap Nominatim's
 * structured postal-code search, and everything else its free-text search, which ranks
 * places inside the DFW box first but is not limited to it. The search is deliberately not
 * bounded to the box: a bounded search answers "77002" (downtown Houston) with whichever DFW
 * place best matches the leftover words, and "Houston" with Sam Houston High School. Seeing
 * the real best match lets the lookup say "Houston, TX is outside the area" instead.
 *
 * Nominatim's usage policy allows about one request per second per application, so outbound
 * calls are serialized with a short gap. The queue is bounded, every lookup has a deadline
 * measured from when it was queued, identical lookups share one request, and results
 * (including misses) are cached in a bounded map.
 */
const CACHE_MAX = 300;
const HIT_TTL_MS = 24 * 60 * 60 * 1000;
const MISS_TTL_MS = 60 * 60 * 1000;
const MIN_GAP_MS = 1100;
const MAX_WAITING = 4;
const DEADLINE_MS = 8000;
export const GEOCODER_USER_AGENT = 'Agora civic app (student project; +https://github.com/saketh-c/agora)';

/** Re-exported for older callers: the rules now live in @agora/core (place.js). */
export { DFW_ZIP_PREFIXES };

/** A lookup that could not run: code is 'busy' (queue full or deadline passed) or 'unavailable' (network or Nominatim error). */
export class GeocodeError extends Error {
  constructor(code, message) {
    super(message);
    this.name = 'GeocodeError';
    this.code = code;
  }
}

export function normalizeQuery(query) {
  return normalizePlaceQuery(query);
}

/**
 * A geocoder with its own queue and cache. The module's resolvePlace and geocode share one;
 * tests build their own with a stand-in fetch and a short gap.
 * @param {{fetch?: typeof fetch, minGapMs?: number, maxWaiting?: number, deadlineMs?: number, userAgent?: string}} [options]
 */
export function createGeocoder({ fetch: fetchImpl, minGapMs = MIN_GAP_MS, maxWaiting = MAX_WAITING, deadlineMs = DEADLINE_MS, userAgent = GEOCODER_USER_AGENT } = {}) {
  const doFetch = fetchImpl || ((...args) => globalThis.fetch(...args));
  const cache = new Map();
  const inflight = new Map();
  let lastRequestAt = 0;
  let queue = Promise.resolve();
  let waiting = 0;

  function remember(key, value, ttl) {
    if (cache.size >= CACHE_MAX) cache.delete(cache.keys().next().value);
    cache.set(key, { value, expires: Date.now() + ttl });
  }

  function recall(key) {
    const hit = cache.get(key);
    if (!hit) return undefined;
    if (hit.expires < Date.now()) {
      cache.delete(key);
      return undefined;
    }
    return hit.value;
  }

  /**
   * Run one outbound request at a time with at least minGapMs between them. A job that
   * cannot start before its deadline, or that would join a queue already holding
   * maxWaiting jobs, fails fast as 'busy' instead of making the user wait for the backlog.
   */
  function throttled(fn, deadline) {
    if (waiting >= maxWaiting) return Promise.reject(new GeocodeError('busy', 'Too many lookups are waiting'));
    waiting++;
    const run = queue.then(async () => {
      waiting--;
      const gap = Math.max(0, lastRequestAt + minGapMs - Date.now());
      if (Date.now() + gap >= deadline) throw new GeocodeError('busy', 'The lookup waited too long to start');
      if (gap > 0) await new Promise((resolve) => setTimeout(resolve, gap));
      lastRequestAt = Date.now();
      return fn(deadline - Date.now());
    });
    queue = run.catch(() => {});
    return run;
  }

  async function search(params, remainingMs) {
    const url = new URL(NOMINATIM_SEARCH_URL);
    for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), Math.max(1000, remainingMs));
    try {
      const res = await doFetch(url, { signal: controller.signal, headers: { 'User-Agent': userAgent, Accept: 'application/json' } });
      if (res.status === 429) throw new GeocodeError('busy', 'Nominatim asked us to slow down (HTTP 429)');
      if (!res.ok) throw new GeocodeError('unavailable', `Nominatim answered HTTP ${res.status}`);
      const rows = await res.json();
      return Array.isArray(rows) ? rows : [];
    } catch (e) {
      if (e instanceof GeocodeError) throw e;
      throw new GeocodeError('unavailable', controller.signal.aborted ? 'Nominatim did not answer in time' : `Nominatim could not be reached: ${e && e.message ? e.message : e}`);
    } finally {
      clearTimeout(timer);
    }
  }

  /**
   * Resolve a query to a place in the area.
   *
   * @param {string} query a ZIP code, an address, a place name, or a city name
   * @param {object[]} [cities] the covered cities (English names), for local matches and cityId
   * @returns {Promise<{status: 'found', query: string, place: {query: string, label: string, lat: number, lng: number, cityId: string|null, source: 'local'|'nominatim', kind: 'city'|'postcode'|'place'|'address', school?: true}} | {status: 'outside', query: string, label: string|null, zip: string|null} | {status: 'none', query: string}>}
   *   'found' places are inside the DFW box. cityId is set only when the result lies in a
   *   covered city by name, never by fuzzy matching the query. Labels never include a house
   *   number. 'outside' carries the best match's label when one was found, or the ZIP code
   *   when its prefix alone settled it. `school` marks a school, college or university by its
   *   OpenStreetMap tags. Rejects with GeocodeError when the lookup cannot run.
   */
  async function resolvePlace(query, cities = []) {
    const q = normalizeQuery(query);
    const list = Array.isArray(cities) ? cities : [];
    const local = resolveLocally(q, list);
    if (local) return local;

    const { key, params } = nominatimRequest(q);
    const cached = recall(key);
    if (cached !== undefined) return { ...cached, query: q };
    if (inflight.has(key)) return inflight.get(key).then((r) => ({ ...r, query: q }));

    const deadline = Date.now() + deadlineMs;
    const promise = throttled(async (remaining) => judgeNominatim(await search(params, remaining), q, list), deadline)
      .then((result) => {
        remember(key, result, result.status === 'none' ? MISS_TTL_MS : HIT_TTL_MS);
        return result;
      })
      .finally(() => inflight.delete(key));
    inflight.set(key, promise);
    return promise;
  }

  /** The found place, or null when there is none in the area. Kept for the CLI. */
  async function geocode(query, cities) {
    const result = await resolvePlace(query, cities);
    return result.status === 'found' ? result.place : null;
  }

  return { resolvePlace, geocode };
}

const shared = createGeocoder();

/** See createGeocoder: resolve a query with the shared queue and cache. */
export function resolvePlace(query, cities) {
  return shared.resolvePlace(query, cities);
}

/**
 * The DFW place for a query, or null when there is none in the area (including places that
 * are outside it). Rejects with GeocodeError when the lookup cannot run. Kept for the CLI;
 * resolvePlace tells "outside the area" apart from "not found".
 */
export function geocode(query, cities) {
  return shared.geocode(query, cities);
}
