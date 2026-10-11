/**
 * Saved places and address lookup, all on the device.
 *
 * The model (stored in prefs, so it travels with a profile's export):
 *   prefs.places = { home, school, here }   each null or { label, lat, lng, kind, cityId?, at? }
 *   prefs.origin = 'home' | 'school' | 'here'   which one distances are measured from
 * kind is 'city' (a covered city: its city hall), 'address' (a street address, school or other
 * named place), 'zip' (a ZIP code's center) or 'current' (the device's position). Points are
 * rounded to about 100 meters and labels never carry a house number.
 *
 * The engine still reads one origin, prefs.location, and the home council, prefs.homeCityId.
 * withPlaces() keeps them in step: location/locationLabel/locationSource follow the active
 * origin, and homeCityId is the covered city that contains Home (or is nearest to it). Older
 * setups have only prefs.location; placesOf() reads them as a Home place.
 *
 * Lookup: lookupPlace() turns typed text into a place. It uses the app's API when this build
 * has one, and otherwise asks OpenStreetMap Nominatim straight from the browser, within its
 * usage policy: only when someone submits (never as they type), at most one request a second,
 * US results ranked inside a DFW viewbox, the page's address sent as the Referer to identify
 * the app, and answers cached for the session.
 */
import { NOMINATIM_SEARCH_URL, cityPoint, haversineMiles, isInDfw, judgeNominatim, nearestCity, nominatimRequest, normalizePlaceQuery, resolveLocally, round3, t } from '@agora/core';
import { api as defaultApi, apiAvailable as defaultApiAvailable } from './api.js';

export const PLACE_SLOTS = Object.freeze(['home', 'school']);
export const ORIGINS = Object.freeze(['home', 'school', 'here']);
export const PLACE_KINDS = Object.freeze(['city', 'address', 'zip', 'current']);
const LABEL_MAX = 120;

const SOURCE_OF_KIND = { city: 'hall', current: 'device', zip: 'search', address: 'search' };

/** A stored place, repaired, or null when it is not a usable point in DFW. */
export function cleanPlace(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const lat = Number(raw.lat);
  const lng = Number(raw.lng);
  if (!Number.isFinite(lat) || !Number.isFinite(lng) || !isInDfw({ lat, lng })) return null;
  const kind = PLACE_KINDS.includes(raw.kind) ? raw.kind : 'address';
  const out = { label: String(raw.label || '').trim().slice(0, LABEL_MAX), lat: round3(lat), lng: round3(lng), kind };
  if (typeof raw.cityId === 'string' && /^[a-z0-9-]{1,60}$/.test(raw.cityId)) out.cityId = raw.cityId;
  if (typeof raw.at === 'string' && Number.isFinite(Date.parse(raw.at))) out.at = raw.at;
  return out;
}

/** A covered city as a place: distances measure from its city hall. */
export function placeFromCity(city) {
  const p = cityPoint(city);
  return p ? cleanPlace({ label: city.name, lat: p.lat, lng: p.lng, kind: 'city', cityId: city.cityId }) : null;
}

/** A lookup result ({ label, lat, lng, kind, cityId }) as a place. */
export function placeFromLookup(r) {
  const kind = r.kind === 'city' ? 'city' : r.kind === 'postcode' || r.kind === 'zip' ? 'zip' : 'address';
  return cleanPlace({ label: r.label, lat: r.lat, lng: r.lng, kind, cityId: r.cityId || undefined });
}

/** The device's position as a place. */
export function placeFromDevice(point, at = new Date().toISOString()) {
  return cleanPlace({ label: '', lat: point.lat, lng: point.lng, kind: 'current', at });
}

const byIdOf = (cities) => (cities ? (id) => cities.find((c) => c.cityId === id) || null : () => null);

/** Read an older setup (prefs.location only) as a Home place. */
function legacyHome(prefs, cityById) {
  const city = prefs.homeCityId && cityById ? cityById(prefs.homeCityId) : null;
  const source = prefs.locationSource;
  const hall = city ? cityPoint(city) : null;
  const atHall = Boolean(hall && haversineMiles(prefs.location, hall) < 0.3);
  const label = String(prefs.locationLabel || '');
  let kind;
  if (source === 'device') kind = 'current';
  else if (source === 'search') kind = /\b\d{5}\b/.test(label) ? 'zip' : 'address';
  // A looked-up label always names a street or town after a comma ("Preston Road, Dallas");
  // a bare name ("Plano") is how older versions labelled a city hall.
  else if (source === 'hall' || atHall || !label || (!source && !label.includes(','))) kind = 'city';
  else kind = 'address';
  const cityId = kind === 'city' ? (city ? city.cityId : prefs.homeCityId || undefined) : undefined;
  return cleanPlace({ label: kind === 'city' && city ? city.name : label, lat: prefs.location.lat, lng: prefs.location.lng, kind, cityId });
}

/**
 * The saved places and which one distances come from: { home, school, here, origin }.
 * `cityById` (optional) lets an older setup's city hall read as a city.
 */
export function placesOf(prefs, cityById) {
  const p = prefs || {};
  const stored = p.places && typeof p.places === 'object' ? p.places : null;
  let home = stored ? cleanPlace(stored.home) : null;
  const school = stored ? cleanPlace(stored.school) : null;
  const here = stored ? cleanPlace(stored.here) : null;
  if (!home && !school && p.location && Number.isFinite(p.location.lat)) home = legacyHome(p, cityById);
  const all = { home, school, here };
  let origin = ORIGINS.includes(p.origin) ? p.origin : 'home';
  if (!all[origin]) origin = home ? 'home' : school ? 'school' : here ? 'here' : 'home';
  return { home, school, here, origin };
}

/** The place distances are measured from, as { id, place }, or null with no place saved. */
export function activeOrigin(prefs, cityById) {
  const s = placesOf(prefs, cityById);
  return s[s.origin] ? { id: s.origin, place: s[s.origin] } : null;
}

/** The covered city that contains a place (when the lookup said so) or is nearest to it. */
export function councilFor(place, cities) {
  if (!place) return null;
  if (place.cityId && cities && cities.some((c) => c.cityId === place.cityId)) return place.cityId;
  const near = cities && cities.length ? nearestCity(cities, place) : null;
  return near ? near.city.cityId : null;
}

/**
 * New prefs with saved places changed: `patch` may set home, school, here (a place or null)
 * and origin. The engine's fields follow: location and its label and source from the active
 * origin; homeCityId from Home whenever Home changes (or when it was never set). A `here`
 * place is kept only while it is the origin, so an old position is not stored for nothing.
 */
export function withPlaces(prefs, patch = {}, cities = []) {
  const p = prefs || {};
  const cur = placesOf(p, byIdOf(cities));
  const next = { home: cur.home, school: cur.school, here: cur.here, origin: cur.origin };
  for (const key of ['home', 'school', 'here']) if (key in patch) next[key] = cleanPlace(patch[key]);
  if (ORIGINS.includes(patch.origin)) next.origin = patch.origin;
  if (!next[next.origin]) next.origin = next.home ? 'home' : next.school ? 'school' : next.here ? 'here' : 'home';
  if (next.origin !== 'here') next.here = null;
  const active = next[next.origin];

  // Home decides the council; with no Home, School does.
  const anchor = next.home || next.school;
  const anchorChanged = 'home' in patch || (!next.home && 'school' in patch);
  let homeCityId = p.homeCityId || null;
  if (anchorChanged || !homeCityId) homeCityId = anchor ? councilFor(anchor, cities) || homeCityId : anchorChanged ? null : homeCityId;

  return {
    ...p,
    places: { home: next.home, school: next.school, here: next.here },
    origin: next.origin,
    location: active ? { lat: active.lat, lng: active.lng } : null,
    locationLabel: active ? active.label : '',
    locationSource: active ? SOURCE_OF_KIND[active.kind] : undefined,
    homeCityId,
  };
}

/**
 * "Set as my city" on a city page. A precise Home (an address, ZIP or the device's position)
 * stays where it is and only the home council changes; otherwise Home becomes that city.
 */
export function withHomeCity(prefs, city, cities = []) {
  const cur = placesOf(prefs, byIdOf(cities));
  if (cur.home && cur.home.kind !== 'city') return { ...withPlaces(prefs, {}, cities), homeCityId: city.cityId };
  return { ...withPlaces(prefs, { home: placeFromCity(city) }, cities), homeCityId: city.cityId };
}

/** True when a place is a precise point rather than a city hall. */
export const isPrecise = (place) => Boolean(place) && place.kind !== 'city';

/* ---------- Words ---------- */

/** "Near Plano East Senior High", "Near where you are now", "Near Plano". */
export function nearText(id, place) {
  if (!place) return '';
  if (id === 'here') return t('home.places.nearHere');
  if (place.kind === 'current') return t('home.places.nearYou');
  return t('home.places.near', { place: place.label });
}

/** "2.1 mi from Plano East Senior High", "2.1 mi from Plano City Hall", "2.1 mi from where you are". */
export function fromText(id, place, distance) {
  if (!place || !distance) return '';
  if (id === 'here') return t('home.places.fromHere', { distance });
  if (place.kind === 'current') return t('home.places.fromYou', { distance });
  if (place.kind === 'city') return t('home.places.fromHall', { distance, hall: t('common.cityHallOf', { city: place.label }) });
  return t('home.places.from', { distance, place: place.label });
}

/** What a saved place is, in a few words: the label, or "Your location" for a device position. */
export function placeName(place) {
  if (!place) return '';
  if (place.kind === 'current') return t('home.places.yourLocation');
  return place.label;
}

/** The same as placeName (the name Meetings imports). */
export const placeLabel = placeName;

/* ---------- Lookup ---------- */

/** A lookup that found nothing usable. code: empty | outside_area | not_found | busy | offline | aborted | unavailable. */
export class PlaceError extends Error {
  constructor(code, { label = null, query = '' } = {}) {
    super(code);
    this.name = 'PlaceError';
    this.code = code;
    this.label = label;
    this.query = query;
  }
}

const CACHE_KEY = 'agora.places.lookups.v1';
const CACHE_MAX = 40;
const MIN_GAP_MS = 1100;

function sessionStore() {
  try {
    return typeof sessionStorage !== 'undefined' ? sessionStorage : null;
  } catch {
    return null;
  }
}

const wait = (ms, signal) =>
  new Promise((resolve, reject) => {
    if (ms <= 0) return resolve();
    const timer = setTimeout(resolve, ms);
    if (signal)
      signal.addEventListener(
        'abort',
        () => {
          clearTimeout(timer);
          reject(new PlaceError('aborted'));
        },
        { once: true },
      );
    return undefined;
  });

/**
 * Nominatim from the browser, for builds with no API. Requests are serialized at least
 * `minGapMs` apart; answers (misses too) are cached in memory and in sessionStorage, so a
 * repeated lookup never leaves the device and nothing typed outlives the browser session.
 */
export function createBrowserGeocoder({ fetch: fetchImpl, storage = sessionStore(), minGapMs = MIN_GAP_MS, now = () => Date.now() } = {}) {
  const doFetch = fetchImpl || ((...args) => globalThis.fetch(...args));
  let memory = null;
  let lastAt = 0;
  let queue = Promise.resolve();

  const load = () => {
    if (memory) return memory;
    memory = new Map();
    try {
      const raw = storage && JSON.parse(storage.getItem(CACHE_KEY) || '[]');
      if (Array.isArray(raw)) for (const [k, v] of raw) memory.set(k, v);
    } catch {
      /* a broken cache is an empty one */
    }
    return memory;
  };
  const save = (key, value) => {
    const m = load();
    m.delete(key);
    m.set(key, value);
    while (m.size > CACHE_MAX) m.delete(m.keys().next().value);
    try {
      if (storage) storage.setItem(CACHE_KEY, JSON.stringify([...m]));
    } catch {
      /* private mode: memory still works */
    }
  };

  async function request(params, signal) {
    const url = new URL(NOMINATIM_SEARCH_URL);
    for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
    let res;
    try {
      // A browser may not set User-Agent; the Referer (this page's origin) identifies the app.
      res = await doFetch(url.toString(), { headers: { Accept: 'application/json' }, credentials: 'omit', referrerPolicy: 'strict-origin-when-cross-origin', signal });
    } catch {
      if (signal && signal.aborted) throw new PlaceError('aborted');
      throw new PlaceError('offline');
    }
    if (res.status === 429) throw new PlaceError('busy');
    if (!res.ok) throw new PlaceError('unavailable');
    try {
      const rows = await res.json();
      return Array.isArray(rows) ? rows : [];
    } catch {
      throw new PlaceError('unavailable');
    }
  }

  /** Resolve typed text like the server does: { status: 'found'|'outside'|'none', ... }. */
  function lookup(query, cities = [], { signal } = {}) {
    const q = normalizePlaceQuery(query);
    const local = resolveLocally(q, cities);
    if (local) return Promise.resolve(local);
    const { key, params } = nominatimRequest(q);
    const hit = load().get(key);
    if (hit) return Promise.resolve({ ...hit, query: q });
    const run = queue.then(async () => {
      if (signal && signal.aborted) throw new PlaceError('aborted');
      await wait(lastAt + minGapMs - now(), signal);
      lastAt = now();
      const result = judgeNominatim(await request(params, signal), q, cities);
      save(key, result);
      return result;
    });
    queue = run.catch(() => {});
    return run;
  }

  return { lookup };
}

let browserGeocoder = null;
const sharedBrowserGeocoder = () => browserGeocoder || (browserGeocoder = createBrowserGeocoder());

const FALL_THROUGH = new Set(['offline', 'network', 'not_json', 'not_found', 'unavailable', 'server', 'http_error']);

function placeOrThrow(result, q) {
  if (result.status === 'found') return result.place;
  if (result.status === 'outside') throw new PlaceError('outside_area', { label: result.label || result.zip || null, query: q });
  throw new PlaceError('not_found', { query: q });
}

/**
 * Turn typed text into a place in DFW: { label, lat, lng, kind, cityId, school? } with kind
 * as the lookup names it ('city' | 'postcode' | 'address' | 'place'). Use placeFromLookup()
 * to store it. Rejects with PlaceError. Call it only when someone submits.
 *
 * `cities` should carry the covered cities' English names (the app's do). Options for tests:
 * { api, apiAvailable, geocoder }.
 */
export async function lookupPlace(query, { cities = [], signal, api = defaultApi, apiAvailable = defaultApiAvailable, geocoder } = {}) {
  const q = normalizePlaceQuery(query);
  if (q.length < 2) throw new PlaceError('empty', { query: q });
  if (signal && signal.aborted) throw new PlaceError('aborted', { query: q });
  const local = resolveLocally(q, cities);
  if (local) return placeOrThrow(local, q);

  if (apiAvailable) {
    try {
      return await api.geocode(q, { signal });
    } catch (err) {
      const code = err && err.code;
      if (code === 'aborted') throw new PlaceError('aborted', { query: q });
      if (code === 'outside_area') throw new PlaceError('outside_area', { label: (err.data && err.data.label) || null, query: q });
      // A 404 that the API itself wrote; a bare 404 page means there is no API here.
      if (code === 'not_found' && err.data) throw new PlaceError('not_found', { query: q });
      if (code === 'rate_limited' || code === 'busy') throw new PlaceError('busy', { query: q });
      if (!FALL_THROUGH.has(code)) throw new PlaceError('unavailable', { query: q });
      // No server answered (or it could not reach the geocoder): ask from the browser instead.
    }
  }

  const g = geocoder || sharedBrowserGeocoder();
  let result;
  try {
    result = await g.lookup(q, cities, { signal });
  } catch (err) {
    if (err instanceof PlaceError) throw new PlaceError(err.code, { query: q });
    throw new PlaceError('unavailable', { query: q });
  }
  return placeOrThrow(result, q);
}
