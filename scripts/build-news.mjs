/**
 * Gather the newsroom feeds once and write a static snapshot the web app can read.
 *
 * The hosted copy of Agora is a static site with no server behind it, so /api/news has
 * nowhere to run. Fetching the feeds at deploy time instead gives that copy real
 * headlines; a scheduled workflow re-runs this every few hours so they stay current.
 * Anywhere the API is actually running, the live endpoint is still used first and this
 * file is never read.
 *
 * fetchNews applies the relevance check before it cuts the list, so the snapshot holds every
 * local civic headline from the last 30 days (usually 100 to 200), not the newest few hundred
 * items of whatever the feeds published. The web app applies the same 30-day window again
 * when it reads the file, so an old snapshot shows fewer headlines rather than stale ones.
 *
 * Usage: node scripts/build-news.mjs [--out path/to/news-snapshot.json]
 *   --out  write somewhere else, for example to inspect a snapshot without touching the web app
 */
import { writeFileSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadNews, loadCities } from '@agora/core/node';
import { fetchNews } from '../packages/server/src/news.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const outArg = process.argv.indexOf('--out');
const outFile = outArg > 0 && process.argv[outArg + 1] ? path.resolve(process.argv[outArg + 1]) : path.resolve(here, '..', 'packages', 'web', 'public', 'news-snapshot.json');
const outDir = path.dirname(outFile);

// A ceiling, not a target: the relevance check and the 30-day window decide what is kept.
const LIMIT = 400;

const news = loadNews();
// fetchNews never rejects: a feed that fails contributes nothing, and fetchedFeeds says so.
// Wait for every feed here, since nobody is waiting on this request.
const result = await fetchNews(news, { limit: LIMIT, waitMs: Infinity, cities: loadCities() });

const snapshot = {
  generatedAt: new Date().toISOString(),
  maxAgeDays: result.maxAgeDays,
  fetchedFeeds: result.fetchedFeeds,
  totalFeeds: result.totalFeeds,
  items: result.items,
  topicLinks: result.topicLinks,
};

mkdirSync(outDir, { recursive: true });
writeFileSync(outFile, `${JSON.stringify(snapshot)}\n`);

const kb = Math.round(Buffer.byteLength(JSON.stringify(snapshot)) / 1024);
console.log(`Wrote ${snapshot.items.length} headlines from ${snapshot.fetchedFeeds} of ${snapshot.totalFeeds} feeds (${kb} KB) to ${path.relative(process.cwd(), outFile)}`);

// A snapshot with no headlines is not worth deploying silently, so say so loudly. It is
// still not a build failure: the page degrades to the curated links.
if (!snapshot.fetchedFeeds) console.warn('WARNING: no feed answered. The news page will show its curated links only.');
else if (!snapshot.items.length) console.warn('WARNING: no local civic headlines from the last 30 days were found. The news page will show its curated links only.');
