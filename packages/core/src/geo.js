/** Geography helpers for the Dallas-Fort Worth region. */

export const DFW_BOUNDS = Object.freeze({ minLat: 32.4, maxLat: 33.4, minLng: -97.6, maxLng: -96.3 });
export const DFW_CENTER = Object.freeze({ lat: 32.85, lng: -96.95 });

const EARTH_RADIUS_MILES = 3958.7613;

function toRad(deg) {
  return (deg * Math.PI) / 180;
}

export function haversineMiles(a, b) {
  if (!a || !b || a.lat == null || b.lat == null) return null;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const s = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_RADIUS_MILES * Math.asin(Math.min(1, Math.sqrt(s)));
}

export function isInDfw(p) {
  return !!p && p.lat >= DFW_BOUNDS.minLat && p.lat <= DFW_BOUNDS.maxLat && p.lng >= DFW_BOUNDS.minLng && p.lng <= DFW_BOUNDS.maxLng;
}

export function cityPoint(city) {
  return city && city.cityHall ? { lat: city.cityHall.lat, lng: city.cityHall.lng } : null;
}

export function nearestCity(cities, point) {
  let best = null;
  for (const city of cities) {
    const miles = haversineMiles(point, cityPoint(city));
    if (miles == null) continue;
    if (!best || miles < best.miles) best = { city, miles };
  }
  return best;
}

export function citiesWithin(cities, point, maxMiles) {
  return cities
    .map((city) => ({ city, miles: haversineMiles(point, cityPoint(city)) }))
    .filter((x) => x.miles != null && x.miles <= maxMiles)
    .sort((a, b) => a.miles - b.miles);
}

/** Compass direction from one point to another, for terminal output. */
export function cardinal(from, to) {
  const dLng = to.lng - from.lng;
  const y = Math.sin(toRad(dLng)) * Math.cos(toRad(to.lat));
  const x = Math.cos(toRad(from.lat)) * Math.sin(toRad(to.lat)) - Math.sin(toRad(from.lat)) * Math.cos(toRad(to.lat)) * Math.cos(toRad(dLng));
  const bearing = ((Math.atan2(y, x) * 180) / Math.PI + 360) % 360;
  const dirs = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'];
  return dirs[Math.round(bearing / 45) % 8];
}

/** "North Richland Hills" -> "nrh". */
function initialsOf(name) {
  return String(name || '')
    .toLowerCase()
    .split(/[\s-]+/)
    .filter(Boolean)
    .map((w) => w[0])
    .join('');
}

/**
 * Find a city by id, or by a case-insensitive name: exact, then prefix ("dal"), then the
 * initials of a multi-word name ("fw", "nrh"), then any substring. A blank query finds nothing.
 */
export function findCity(cities, query) {
  const q = String(query ?? '')
    .trim()
    .toLowerCase();
  if (!q) return null;
  const slugQ = q.replace(/[^a-z0-9]+/g, '-');
  return (
    cities.find((c) => c.cityId === slugQ) ||
    cities.find((c) => c.name.toLowerCase() === q) ||
    cities.find((c) => c.name.toLowerCase().startsWith(q)) ||
    (/^[a-z]{2,4}$/.test(q) && cities.find((c) => initialsOf(c.name) === q)) ||
    cities.find((c) => c.name.toLowerCase().includes(q)) ||
    null
  );
}
