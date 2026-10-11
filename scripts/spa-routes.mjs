/**
 * Give every route the app knows its own copy of index.html in a built site.
 *
 * GitHub Pages has no server-side routing. A link straight to /agora/city/plano used to be
 * answered by 404.html, which renders the app but with HTTP status 404, so link previews,
 * crawlers and some browsers treated every shared link as missing. Pages serves a file named
 * city/plano.html for the address /city/plano with 200, so each known route gets a copy of
 * index.html under that name. (A folder with an index.html would make Pages redirect to an
 * address ending in a slash first.) 404.html stays as the fallback for anything else, such
 * as an old address with a typo.
 *
 * Usage: node scripts/spa-routes.mjs [dist]   (default: packages/web/dist)
 */
import { copyFileSync, existsSync, mkdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const dist = path.resolve(process.argv[2] || path.join(root, 'packages/web/dist'));

/** The routes in packages/web/src/App.jsx, plus the old addresses that forward. */
export const ROUTES = [
  'meetings',
  'cities',
  'prepare',
  'prepare/write',
  'prepare/practice',
  'community',
  'news',
  'insights',
  'about',
  'profile',
  'map',
  'for-you',
  'start',
  'learn',
  'rehearse',
  'more',
];

export function cityRoutes(citiesFile = path.join(root, 'data/cities.json')) {
  const { cities } = JSON.parse(readFileSync(citiesFile, 'utf8'));
  return cities.map((c) => `city/${c.cityId}`);
}

function main() {
  const index = path.join(dist, 'index.html');
  if (!existsSync(index)) {
    console.error(`No index.html in ${dist}. Build the web app first.`);
    process.exit(1);
  }
  const routes = [...ROUTES, ...cityRoutes()];
  for (const route of routes) {
    const file = path.join(dist, `${route}.html`);
    mkdirSync(path.dirname(file), { recursive: true });
    copyFileSync(index, file);
    // "prepare" is also a folder (prepare/write.html). Should Pages answer /prepare with a
    // redirect to /prepare/, that address needs a page too.
    if (routes.some((r) => r.startsWith(`${route}/`))) {
      mkdirSync(path.join(dist, route), { recursive: true });
      copyFileSync(index, path.join(dist, route, 'index.html'));
    }
  }
  console.log(`Copied index.html to ${routes.length} routes in ${path.relative(root, dist) || dist}`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
