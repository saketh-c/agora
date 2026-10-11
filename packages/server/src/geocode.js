import { isInDfw, cityPoint, DFW_BOUNDS } from '@agora/core';

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
const MAX_QUERY_LENGTH = 120;
const CACHE_MAX = 300;
const HIT_TTL_MS = 24 * 60 * 60 * 1000;
const MISS_TTL_MS = 60 * 60 * 1000;
const MIN_GAP_MS = 1100;
const MAX_WAITING = 4;
const DEADLINE_MS = 8000;
export const GEOCODER_USER_AGENT = 'Agora civic app (student project; +https://github.com/saketh-c/agora)';

/**
 * First three digits of the ZIP codes that serve Dallas-Fort Worth: the USPS sectional
 * centers for the Dallas area (750-753) and the Fort Worth and Denton area (760-762). A few
 * of these ZIP codes still fall outside the region (Sherman, Gainesville), which the
 * coordinate check catches.
 */
export const DFW_ZIP_PREFIXES = Object.freeze(['750', '751', '752', '753', '760', '761', '762']);

const VIEWBOX = [DFW_BOUNDS.minLng, DFW_BOUNDS.maxLat, DFW_BOUNDS.maxLng, DFW_BOUNDS.minLat].join(',');
const SETTLEMENT_TYPES = new Set(['city', 'town', 'village', 'hamlet', 'municipality', 'county', 'state', 'country', 'region', 'province', 'island', 'suburb', 'borough', 'city_district', 'district', 'quarter', 'neighbourhood', 'locality', 'postcode']);
const TOP_LEVEL_TYPES = new Set(['city', 'town', 'village', 'hamlet', 'municipality', 'county', 'state', 'country', 'region', 'province', 'island']);

/** A lookup that could not run: code is 'busy' (queue full or deadline passed) or 'unavailable' (network or Nominatim error). */
export class GeocodeError extends Error {
  constructor(code, message) {
    super(message);
    this.name = 'GeocodeError';
    this.code = code;
  }
}

export function normalizeQuery(query) {
  return String(query || '')
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, MAX_QUERY_LENGTH);
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
    const url = new URL('https://nominatim.openstreetmap.org/search');
    for (const [k, v] of Object.entries({ format: 'jsonv2', countrycodes: 'us', addressdetails: '1', ...params })) url.searchParams.set(k, v);
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
   * @returns {Promise<{status: 'found', query: string, place: {query: string, label: string, lat: number, lng: number, cityId: string|null, source: 'local'|'nominatim', kind: 'city'|'postcode'|'place'|'address'}} | {status: 'outside', query: string, label: string|null, zip: string|null} | {status: 'none', query: string}>}
   *   'found' places are inside the DFW box. cityId is set only when the result lies in a
   *   covered city by name, never by fuzzy matching the query. Labels never include a house
   *   number. 'outside' carries the best match's label when one was found, or the ZIP code
   *   when its prefix alone settled it. Rejects with GeocodeError when the lookup cannot run.
   */
  async function resolvePlace(query, cities = []) {
    const q = normalizeQuery(query);
    if (!q) return { status: 'none', query: q };
    const list = Array.isArray(cities) ? cities : [];

    const local = localCity(q, list);
    if (local) {
      const p = cityPoint(local);
      if (p) return { status: 'found', query: q, place: { query: q, label: `${local.name}, TX`, lat: p.lat, lng: p.lng, cityId: local.cityId, source: 'local', kind: 'city' } };
    }

    const zip = /^(\d{5})(?:-\d{4})?$/.exec(q);
    if (zip && !DFW_ZIP_PREFIXES.includes(zip[1].slice(0, 3))) return { status: 'outside', query: q, label: null, zip: zip[1] };

    const key = zip ? `zip:${zip[1]}` : `q:${q.toLowerCase()}`;
    const cached = recall(key);
    if (cached !== undefined) return { ...cached, query: q };
    if (inflight.has(key)) return inflight.get(key).then((r) => ({ ...r, query: q }));

    const deadline = Date.now() + deadlineMs;
    const promise = throttled(async (remaining) => {
      if (zip) {
        const rows = await search({ postalcode: zip[1], limit: '1' }, remaining);
        return judgePostcode(rows[0], zip[1], q, list);
      }
      const rows = await search({ q, limit: '5', viewbox: VIEWBOX }, remaining);
      return judgeSearch(rows, q, list);
    }, deadline)
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

/** "Plano", "plano, tx" and "Plano Texas" all name the city; anything longer goes to the search. */
function localCity(q, cities) {
  const plain = q
    .toLowerCase()
    .replace(/,?\s*(?:tx|texas)\.?$/i, '')
    .trim();
  return cities.find((c) => c && typeof c.name === 'string' && (c.name.toLowerCase() === plain || c.cityId === plain)) || null;
}

function judgePostcode(row, zip, q, cities) {
  const a = (row && row.address) || {};
  if (!row || (a.postcode && !String(a.postcode).startsWith(zip)) || (!a.postcode && row.type !== 'postcode')) return { status: 'none', query: q };
  const point = { lat: Number(row.lat), lng: Number(row.lon) };
  const label = labelFor(row, 'postcode');
  if (!isInDfw(point)) return { status: 'outside', query: q, label, zip };
  return { status: 'found', query: q, place: placeFrom(row, point, label, 'postcode', q, cities) };
}

/**
 * Pick the result the person meant. A town, city or county whose name is exactly the query
 * wins over a boosted DFW match that merely contains the word (so "Houston" is the city of
 * Houston, not Sam Houston High School); otherwise Nominatim's own ranking, which already
 * prefers places inside the DFW box, decides.
 */
function judgeSearch(rows, q, cities) {
  if (!rows.length) return { status: 'none', query: q };
  const wanted = simplify(q);
  const settlement = rows.find((r) => TOP_LEVEL_TYPES.has(r.addresstype) && simplify(r.name) === wanted);
  const pick = settlement || rows[0];
  const point = { lat: Number(pick.lat), lng: Number(pick.lon) };
  if (!Number.isFinite(point.lat) || !Number.isFinite(point.lng)) return { status: 'none', query: q };
  const kind = pick.addresstype === 'postcode' ? 'postcode' : pick.address && pick.address.house_number && !isNamedFeature(pick) ? 'address' : 'place';
  const label = labelFor(pick, kind);
  if (!isInDfw(point)) return { status: 'outside', query: q, label, zip: null };
  return { status: 'found', query: q, place: placeFrom(pick, point, label, kind, q, cities) };
}

function placeFrom(row, point, label, kind, q, cities) {
  return { query: q, label, lat: round3(point.lat), lng: round3(point.lng), cityId: coveredCityOf(row, cities), source: 'nominatim', kind };
}

/** The covered city a result lies in, by the name Nominatim gives its municipality. */
function coveredCityOf(row, cities) {
  const a = row.address || {};
  const town = String(a.city || a.town || a.village || a.municipality || '').toLowerCase();
  if (!town) return null;
  const city = cities.find((c) => c && typeof c.name === 'string' && c.name.toLowerCase() === town);
  return city ? city.cityId : null;
}

function simplify(s) {
  return String(s || '')
    .toLowerCase()
    .replace(/,?\s*(?:tx|texas|usa|united states)\.?$/i, '')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim();
}

function isNumberish(s) {
  return /^\d+[a-z]?$/i.test(String(s || '').trim());
}

function isNamedFeature(row) {
  const a = row.address || {};
  return Boolean(row.name) && !isNumberish(row.name) && row.name !== a.road && row.addresstype !== 'road' && row.addresstype !== 'place';
}

function stateCode(a) {
  const iso = String(a['ISO3166-2-lvl4'] || '');
  return /^US-[A-Z]{2}$/.test(iso) ? iso.slice(3) : a.state || '';
}

/**
 * A short label with no house number: "Plano, TX 75075", "Klyde Warren Park, Dallas",
 * "Preston Road, Dallas", "Houston, TX". Kept coarse on purpose, since it is stored and shown.
 */
function labelFor(row, kind) {
  const a = row.address || {};
  const locality = a.city || a.town || a.village || a.hamlet || a.municipality || a.suburb || a.county || '';
  const state = stateCode(a);
  let parts;
  if (kind === 'postcode') parts = [locality, [state, a.postcode].filter(Boolean).join(' ')];
  else if (TOP_LEVEL_TYPES.has(row.addresstype)) parts = [row.name || locality, state];
  else if (SETTLEMENT_TYPES.has(row.addresstype)) parts = [row.name, locality || state];
  else if (isNamedFeature(row)) parts = [row.name, locality];
  else parts = [a.road || row.name, locality];
  const label = parts
    .map((p) => String(p || '').trim())
    .filter((p) => p && !isNumberish(p))
    .filter((p, i, all) => all.indexOf(p) === i)
    .join(', ');
  return label || shortLabel(row.display_name);
}

/** Fallback for a result with no address details: the first two parts that are not numbers. */
function shortLabel(displayName) {
  return String(displayName || '')
    .split(',')
    .map((s) => s.trim())
    .filter((p) => p && !isNumberish(p))
    .slice(0, 2)
    .join(', ');
}

/** About 100 meters of precision: enough for distances, not enough to identify a house. */
function round3(n) {
  return Math.round(n * 1000) / 1000;
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
