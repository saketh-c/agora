/**
 * Turning what someone typed ("75074", "Plano", "1520 K Ave, Plano", "Plano East Senior High")
 * into a point in Dallas-Fort Worth, as pure functions over OpenStreetMap Nominatim's answers.
 *
 * The server (packages/server/src/geocode.js) and the browser (packages/web/src/lib/places.js,
 * for the static deploy that has no server) run the same rules, so a place resolves the same
 * way everywhere. Neither ever searches as you type: a lookup runs only when someone submits.
 */
import { DFW_BOUNDS, cityPoint, isInDfw } from './geo.js';

export const PLACE_QUERY_MAX = 120;

/**
 * First three digits of the ZIP codes that serve Dallas-Fort Worth: the USPS sectional
 * centers for the Dallas area (750-753) and the Fort Worth and Denton area (760-762). A few
 * of these ZIP codes still fall outside the region (Sherman, Gainesville), which the
 * coordinate check catches.
 */
export const DFW_ZIP_PREFIXES = Object.freeze(['750', '751', '752', '753', '760', '761', '762']);

/** Nominatim's viewbox (left, top, right, bottom) around DFW: results inside rank first. */
export const DFW_VIEWBOX = [DFW_BOUNDS.minLng, DFW_BOUNDS.maxLat, DFW_BOUNDS.maxLng, DFW_BOUNDS.minLat].join(',');

export const NOMINATIM_SEARCH_URL = 'https://nominatim.openstreetmap.org/search';

const SETTLEMENT_TYPES = new Set(['city', 'town', 'village', 'hamlet', 'municipality', 'county', 'state', 'country', 'region', 'province', 'island', 'suburb', 'borough', 'city_district', 'district', 'quarter', 'neighbourhood', 'locality', 'postcode']);
const TOP_LEVEL_TYPES = new Set(['city', 'town', 'village', 'hamlet', 'municipality', 'county', 'state', 'country', 'region', 'province', 'island']);
const SCHOOL_TYPES = new Set(['school', 'college', 'university', 'kindergarten']);

/** Collapse whitespace and control characters; at most PLACE_QUERY_MAX characters. */
export function normalizePlaceQuery(query) {
  return String(query || '')
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, PLACE_QUERY_MAX);
}

/** "75074" or "75074-1234" gives "75074"; anything else gives null. */
export function zipOf(query) {
  const m = /^(\d{5})(?:-\d{4})?$/.exec(String(query || '').trim());
  return m ? m[1] : null;
}

/** True for a ZIP code whose prefix can be in DFW (the coordinates still decide). */
export function isDfwZip(zip) {
  return typeof zip === 'string' && /^\d{5}$/.test(zip) && DFW_ZIP_PREFIXES.includes(zip.slice(0, 3));
}

/** "Plano", "plano, tx" and "Plano Texas" all name the covered city; anything longer is a search. */
export function localCityFor(query, cities) {
  const plain = String(query || '')
    .toLowerCase()
    .replace(/,?\s*(?:tx|texas)\.?$/i, '')
    .trim();
  if (!plain) return null;
  return (cities || []).find((c) => c && typeof c.name === 'string' && (c.name.toLowerCase() === plain || c.cityId === plain)) || null;
}

/**
 * How to ask Nominatim about a query: a structured postal-code search for a ZIP code, else a
 * free-text search that ranks DFW first (viewbox) without being boxed into it, so "Houston"
 * finds Houston (and is reported as outside the area) instead of Sam Houston High School.
 * Returns { key, params } where key names the lookup in a cache.
 */
export function nominatimRequest(query) {
  const q = normalizePlaceQuery(query);
  const zip = zipOf(q);
  // English names, so a result's town compares with the covered cities' names in any app language.
  const base = { format: 'jsonv2', countrycodes: 'us', addressdetails: '1', 'accept-language': 'en' };
  if (zip) return { key: `zip:${zip}`, zip, params: { ...base, postalcode: zip, limit: '1' } };
  return { key: `q:${q.toLowerCase()}`, zip: null, params: { ...base, q, limit: '5', viewbox: DFW_VIEWBOX } };
}

/** Judge Nominatim's answer rows for a request made by nominatimRequest. */
export function judgeNominatim(rows, query, cities = []) {
  const q = normalizePlaceQuery(query);
  const list = Array.isArray(rows) ? rows : [];
  const zip = zipOf(q);
  return zip ? judgePostcode(list[0], zip, q, cities) : judgeSearch(list, q, cities);
}

/**
 * Resolve a query with no network at all, when that is possible: a covered city's name, or a
 * ZIP code that cannot be in DFW. Returns a result like judgeNominatim's, or null when only a
 * lookup can tell.
 */
export function resolveLocally(query, cities = []) {
  const q = normalizePlaceQuery(query);
  if (!q) return { status: 'none', query: q };
  const local = localCityFor(q, cities);
  if (local) {
    const p = cityPoint(local);
    if (p) return { status: 'found', query: q, place: { query: q, label: `${local.name}, TX`, lat: p.lat, lng: p.lng, cityId: local.cityId, source: 'local', kind: 'city' } };
  }
  const zip = zipOf(q);
  if (zip && !isDfwZip(zip)) return { status: 'outside', query: q, label: null, zip };
  return null;
}

function judgePostcode(row, zip, q, cities) {
  const a = (row && row.address) || {};
  if (!row || (a.postcode && !String(a.postcode).startsWith(zip)) || (!a.postcode && row.type !== 'postcode')) return { status: 'none', query: q };
  const point = { lat: Number(row.lat), lng: Number(row.lon) };
  const label = placeLabel(row, 'postcode');
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
  // Someone who typed a house number meant a street address, even when a shop or office sits
  // there: "3000 Custer Rd" reads back as "Custer Road, Plano", not the business's name.
  const typedStreet = /^\d+[a-z]?\s+\S/i.test(q) && Boolean(pick.address && pick.address.road);
  const kind = pick.addresstype === 'postcode' ? 'postcode' : typedStreet || (pick.address && pick.address.house_number && !isNamedFeature(pick)) ? 'address' : 'place';
  const label = placeLabel(pick, typedStreet ? 'street' : kind);
  if (!isInDfw(point)) return { status: 'outside', query: q, label, zip: null };
  return { status: 'found', query: q, place: placeFrom(pick, point, label, kind, q, cities, !typedStreet) };
}

function placeFrom(row, point, label, kind, q, cities, mayBeSchool = true) {
  const place = { query: q, label, lat: round3(point.lat), lng: round3(point.lng), cityId: coveredCityOf(row, cities), source: 'nominatim', kind };
  if (mayBeSchool && isSchool(row)) place.school = true;
  return place;
}

/** A school, college or university, by OpenStreetMap's own tags. */
function isSchool(row) {
  const type = String(row.type || '');
  return SCHOOL_TYPES.has(type) && (row.category === 'amenity' || row.class === 'amenity' || row.addresstype === 'amenity' || row.addresstype === type);
}

/** The covered city a result lies in, by the name Nominatim gives its municipality. */
function coveredCityOf(row, cities) {
  const a = row.address || {};
  const town = String(a.city || a.town || a.village || a.municipality || '').toLowerCase();
  if (!town) return null;
  const city = (cities || []).find((c) => c && typeof c.name === 'string' && c.name.toLowerCase() === town);
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
 * kind is 'postcode', 'street' (the road only), 'address' or 'place'.
 */
export function placeLabel(row, kind) {
  const a = (row && row.address) || {};
  const locality = a.city || a.town || a.village || a.hamlet || a.municipality || a.suburb || a.county || '';
  const state = stateCode(a);
  let parts;
  if (kind === 'postcode') parts = [locality, [state, a.postcode].filter(Boolean).join(' ')];
  else if (kind === 'street') parts = [a.road, locality];
  else if (TOP_LEVEL_TYPES.has(row.addresstype)) parts = [row.name || locality, state];
  else if (SETTLEMENT_TYPES.has(row.addresstype)) parts = [row.name, locality || state];
  else if (isNamedFeature(row)) parts = [row.name, locality];
  else parts = [a.road || row.name, locality];
  const label = parts
    .map((p) => String(p || '').trim())
    .filter((p) => p && !isNumberish(p))
    .filter((p, i, all) => all.indexOf(p) === i)
    .join(', ');
  return label || shortLabel(row && row.display_name);
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
export function round3(n) {
  return Math.round(n * 1000) / 1000;
}
