/**
 * Matching what someone types against a city: its name, its initials, or its county. Pure, so
 * the Node tests run it. The Cities directory uses it; any city search can.
 */
import { t } from '@agora/core';

/** Lowercase, accents and extra spaces removed: "  Fort Wórth " -> "fort worth". */
export function fold(s) {
  return String(s || '')
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * The county a query names, or ''. The county chips read "Denton County" (or "Condado de
 * Denton", "Quận Denton"), so that is what people type: the English word "county" (or "co",
 * "co.") after the name, or the label of the app's current language around it, marks a county.
 */
export function countyQuery(query) {
  const q = fold(query);
  if (!q) return '';
  const english = /^(.+?)\s+(?:county|co\.?)$/.exec(q);
  if (english) return english[1].trim();
  const label = fold(t('ui.cityPicker.county', { county: '\u0001' }));
  const [pre, post] = label.split('\u0001');
  if ((pre.trim() || post.trim()) && q.startsWith(pre) && q.endsWith(post) && q.length > pre.length + post.length) {
    return q.slice(pre.length, q.length - post.length).trim();
  }
  return '';
}

/**
 * Does `city` ({ cityId, name, county }) match the query? A county query ("denton county")
 * matches every city in that county; otherwise the name or one of its words starts with the
 * query, then initials ("nrh"), then any part of the name, then the start of the county.
 */
export function cityMatches(city, query) {
  const q = fold(query);
  if (!q) return true;
  const county = fold(city.county);
  const named = countyQuery(q);
  if (named) return county === named || county.startsWith(named);
  const name = fold(city.name);
  const words = name.split(/[\s-]+/);
  if (city.cityId === q || name.startsWith(q) || words.some((w) => w.startsWith(q))) return true;
  const bare = q.replace(/\s+/g, '');
  return (words.length > 1 && words.map((w) => w[0]).join('').startsWith(bare)) || name.includes(q) || county.startsWith(q);
}
