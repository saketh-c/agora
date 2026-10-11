/**
 * The one route table for navigation: the four destinations (desktop header links and the
 * phone tab bar), which destination each path belongs to, and each path's document title.
 */
import { BRAND, t } from '@agora/core';

export const DESTINATIONS = [
  { id: 'home', to: '/', labelKey: 'nav.home', icon: 'home' },
  { id: 'meetings', to: '/meetings', labelKey: 'nav.meetings', icon: 'cal' },
  { id: 'prepare', to: '/prepare', labelKey: 'nav.prepare', icon: 'mic' },
  { id: 'community', to: '/community', labelKey: 'nav.community', icon: 'people' },
];

/**
 * A path as the router matches it: routes ignore case and a trailing slash, so "/Meetings/"
 * is the Meetings page and must get its tab and title too.
 */
function routePath(pathname) {
  return String(pathname || '/').toLowerCase().replace(/\/+$/, '') || '/';
}

/** The destination a path belongs to, or null for secondary pages (News, The data, About, Profiles). */
export function activeDestination(pathname) {
  const p = routePath(pathname);
  if (p === '/') return 'home';
  if (p === '/meetings' || p === '/cities' || p.startsWith('/city/') || p.startsWith('/meetings/')) return 'meetings';
  if (p === '/prepare' || p.startsWith('/prepare/')) return 'prepare';
  if (p === '/community' || p.startsWith('/community/')) return 'community';
  return null;
}

const TITLES = [
  [/^\/$/, 'shell.titles.home'],
  [/^\/meetings\/?$/, 'nav.meetings'],
  [/^\/cities\/?$/, 'shell.titles.cities'],
  [/^\/city\/[^/]+\/?$/, 'shell.titles.city'],
  [/^\/prepare\/?$/, 'nav.prepare'],
  [/^\/prepare\/write\/?$/, 'shell.titles.write'],
  [/^\/prepare\/practice\/?$/, 'shell.titles.practice'],
  [/^\/community\/?$/, 'nav.community'],
  [/^\/news\/?$/, 'nav.news'],
  [/^\/insights\/?$/, 'nav.data'],
  [/^\/about\/?$/, 'nav.about'],
  [/^\/profile\/?$/, 'shell.titles.profile'],
  [/^\/__ui\/?$/, 'shell.titles.components'],
];

/** The page name for a path ("Meetings"), or the not-found title. */
export function pageNameFor(pathname) {
  const p = routePath(pathname);
  const hit = TITLES.find(([re]) => re.test(p));
  return t(hit ? hit[1] : 'shell.titles.notFound');
}

/** "Meetings | Agora"; Home is just the app's name and tagline. */
export function documentTitle(name, pathname) {
  if (routePath(pathname) === '/' && !name) return t('shell.titles.homeDocument', { app: BRAND.name });
  return t('shell.titles.pattern', { page: name || pageNameFor(pathname), app: BRAND.name });
}
