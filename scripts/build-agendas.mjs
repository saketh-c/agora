/**
 * Read each city's own agenda site and write the snapshot the web app merges on top of the
 * curated city data: upcoming council meetings (date, time, name, cancelled or not, links)
 * and the items on their posted agendas.
 *
 * The hosted copy of Agora is a static site, so this runs at deploy time (four times a day in
 * .github/workflows/pages.yml); the API server runs the same code itself (see
 * packages/server/src/index.js). Sources, adapters and the merge rules live in
 * packages/core/src/agendas.js.
 *
 * Every run starts from the previous snapshot: the local file when there is one, and the one
 * on the live site (AGENDA_PREVIOUS_URL) when it is newer, since each Actions run starts from
 * a fresh checkout. A city whose source fails keeps its previous entry for up to two weeks.
 * The script always exits 0: a bad run leaves the curated data in charge, never a broken
 * build.
 *
 * Usage: node scripts/build-agendas.mjs [--out path] [--only plano,sachse] [--previous url-or-file]
 *   --out       write somewhere else (default packages/web/public/agendas-snapshot.json)
 *   --only      fetch these cities only; the others keep their previous entries
 *   --previous  start from this snapshot instead of AGENDA_PREVIOUS_URL
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildAgendaSnapshot, isAgendaSnapshot, snapshotCounts, failingAgendaSources, AGENDA_USER_AGENT } from '../packages/core/src/agendas.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const arg = (name) => {
  const i = process.argv.indexOf(`--${name}`);
  if (i > 0 && process.argv[i + 1]) return process.argv[i + 1];
  const eq = process.argv.find((a) => a.startsWith(`--${name}=`));
  return eq ? eq.slice(name.length + 3) : '';
};
const outFile = arg('out') ? path.resolve(arg('out')) : path.resolve(here, '..', 'packages', 'web', 'public', 'agendas-snapshot.json');
const only = arg('only')
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean);
const previousFrom = arg('previous') || process.env.AGENDA_PREVIOUS_URL || '';

function readLocal(file) {
  try {
    const data = JSON.parse(readFileSync(file, 'utf8'));
    return isAgendaSnapshot(data) ? data : null;
  } catch {
    return null;
  }
}

async function readRemote(url) {
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 20000);
    const res = await fetch(url, { headers: { 'User-Agent': AGENDA_USER_AGENT, Accept: 'application/json' }, signal: controller.signal });
    clearTimeout(timer);
    if (!res.ok) return null;
    const data = await res.json();
    return isAgendaSnapshot(data) ? data : null;
  } catch {
    return null;
  }
}

async function main() {
  const candidates = [readLocal(outFile)];
  if (previousFrom) candidates.push(/^https?:\/\//i.test(previousFrom) ? await readRemote(previousFrom) : readLocal(path.resolve(previousFrom)));
  const previous = candidates.filter(Boolean).sort((a, b) => String(b.generatedAt).localeCompare(String(a.generatedAt)))[0] || null;
  console.log(previous ? `Starting from the snapshot made ${previous.generatedAt}` : 'No previous snapshot: starting fresh');

  const started = Date.now();
  const snapshot = await buildAgendaSnapshot({ previous, cityIds: only, log: (line) => console.log(`  ${line}`) });
  mkdirSync(path.dirname(outFile), { recursive: true });
  writeFileSync(outFile, `${JSON.stringify(snapshot)}\n`);

  const counts = snapshotCounts(snapshot);
  const meetings = Object.values(snapshot.cities).reduce((n, c) => n + ((c && c.meetings) || []).length, 0);
  const items = Object.values(snapshot.cities).reduce((n, c) => n + ((c && c.meetings) || []).reduce((k, m) => k + ((m.items || []).length), 0), 0);
  const kb = Math.round(Buffer.byteLength(JSON.stringify(snapshot)) / 1024);
  console.log(`Wrote ${meetings} meetings and ${items} agenda items (${kb} KB, ${snapshot.requests} requests in ${Math.round((Date.now() - started) / 1000)} s) to ${path.relative(process.cwd(), outFile)}`);
  console.log(`Cities: ${counts.ok} fresh, ${counts.stale} kept from an earlier run, ${counts.error} failed, ${counts.unsupported} with no automatic source`);
  for (const f of failingAgendaSources(snapshot)) console.log(`  ${f.status === 'stale' ? 'kept' : 'failed'}: ${f.cityId} (${f.error || 'unknown error'})`);
  const tried = counts.ok + counts.stale + counts.error;
  // Loud, but still not a failure: the site falls back to the curated schedules.
  if (tried && counts.ok < tried / 2) console.warn('WARNING: most agenda sources failed this run. The site keeps the previous snapshot where it has one.');
}

main().catch((e) => {
  console.warn(`WARNING: the agenda snapshot could not be built (${(e && e.message) || e}). The site keeps its curated schedules.`);
});
