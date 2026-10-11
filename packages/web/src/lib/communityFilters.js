/**
 * Community's filters live in the address (?kind=tip&city=plano&sort=newest), so Back, a
 * reload or a shared link opens the same list. Pure helpers, so the Node tests can run them.
 *
 * Sort defaults to "your city first" once a home city is set; the address only carries a
 * sort that differs from that default, and only filters that are set.
 */
import { KINDS } from './community.js';

const SORTS = ['newest', 'city'];

/**
 * { kind, cityId, sort, defaultSort } from URLSearchParams. `hasCity(id)` says whether a city
 * id is one the app covers; an unknown id or kind is ignored rather than showing nothing.
 */
export function readCommunityFilters(params, { homeCityId = '', hasCity = () => true } = {}) {
  const get = (k) => String(params.get(k) || '').trim().toLowerCase();
  const kind = KINDS.includes(get('kind')) ? get('kind') : '';
  const city = get('city');
  const cityId = city && hasCity(city) ? city : '';
  const defaultSort = homeCityId ? 'city' : 'newest';
  const asked = get('sort');
  // "Your city first" needs a home city; without one it falls back to newest.
  const sort = SORTS.includes(asked) && (asked !== 'city' || homeCityId) ? asked : defaultSort;
  return { kind, cityId, sort, defaultSort };
}

/** A copy of `params` with `patch` ({ kind, city, sort }) applied; empty and default values are dropped. */
export function writeCommunityFilters(params, patch, { defaultSort = 'newest' } = {}) {
  const next = new URLSearchParams(params);
  for (const [key, value] of Object.entries(patch)) {
    if (!value || (key === 'sort' && value === defaultSort)) next.delete(key);
    else next.set(key, value);
  }
  return next;
}

/** How many filters in the sheet differ from the defaults (the number on the Filters chip). */
export function communityFilterCount({ cityId, sort, defaultSort }) {
  return (cityId ? 1 : 0) + (sort !== defaultSort ? 1 : 0);
}
