import { useMemo } from 'react';
import { useCities } from '../lib/DataProvider.jsx';

/**
 * A small locator mark for one city: a tiny map of the city halls Agora covers, with this one
 * drawn like a map pin (an Ink dot with a white halo). The frame fits the city halls themselves,
 * not the whole region, so the cluster fills the tile and each city's mark is easy to tell
 * apart. It stays neutral: Go green means "you can speak", which a directory row does not say.
 * Decorative unless a `label` is given.
 */
const BOX = 64;
const PAD = 10;

/** Project every city hall into the tile with one scale for both axes (miles look like miles). */
function useProjection(cities) {
  return useMemo(() => {
    const halls = cities.map((c) => c.cityHall).filter((h) => h && Number.isFinite(h.lat) && Number.isFinite(h.lng));
    if (!halls.length) return () => ({ x: BOX / 2, y: BOX / 2 });
    const lats = halls.map((h) => h.lat);
    const lngs = halls.map((h) => h.lng);
    const minLat = Math.min(...lats);
    const maxLat = Math.max(...lats);
    const minLng = Math.min(...lngs);
    const maxLng = Math.max(...lngs);
    const kx = Math.cos((((minLat + maxLat) / 2) * Math.PI) / 180);
    const w = (maxLng - minLng) * kx || 1;
    const h = maxLat - minLat || 1;
    const scale = (BOX - PAD * 2) / Math.max(w, h);
    const ox = (BOX - w * scale) / 2;
    const oy = (BOX - h * scale) / 2;
    // Latitude grows northward and SVG y grows downward, so that axis is inverted.
    return (p) => ({ x: ox + (p.lng - minLng) * kx * scale, y: oy + (maxLat - p.lat) * scale });
  }, [cities]);
}

export default function CityEmblem({ city, size = 44, label, className = '' }) {
  const { cities } = useCities();
  const place = useProjection(cities);
  const { me, others } = useMemo(
    () => ({
      me: place(city.cityHall),
      others: cities.filter((c) => c.cityId !== city.cityId && c.cityHall).map((c) => place(c.cityHall)),
    }),
    [city, cities, place],
  );

  return (
    <svg
      className={`emblem ${className}`.trim()}
      viewBox={`0 0 ${BOX} ${BOX}`}
      width={size}
      height={size}
      role={label ? 'img' : undefined}
      aria-label={label}
      aria-hidden={label ? undefined : 'true'}
      focusable="false"
    >
      <rect width={BOX} height={BOX} rx="14" fill="var(--well)" />
      {others.map((p, i) => (
        <circle key={i} cx={p.x} cy={p.y} r="2.4" fill="var(--edge)" opacity="0.6" />
      ))}
      <circle cx={me.x} cy={me.y} r="6.5" fill="var(--ink)" stroke="var(--card)" strokeWidth="3" />
    </svg>
  );
}
