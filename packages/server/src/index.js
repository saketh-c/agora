import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { createApp } from './app.js';
import { aiAvailable } from './ai.js';
import { loadCities, loadNews, REPO_ROOT } from '@agora/core/node';
import { BRAND, buildAgendaSnapshot, isAgendaSnapshot, snapshotCounts } from '@agora/core';

const port = Number(process.env.PORT) || 8787;
const cities = loadCities();
const news = loadNews();

/**
 * Live agendas. The server reads each city's agenda site itself, with the same code as
 * scripts/build-agendas.mjs: on start and every 6 hours after. It starts from the newest
 * snapshot on disk (its own cache, or one a build left in the web app), and on start it only
 * refetches when that snapshot is over an hour old, because a dev server restarts on every
 * save and city sites should not see a burst of requests each time. AGENDAS_REFRESH=off turns
 * fetching off; the snapshot on disk is still served.
 */
const AGENDA_REFRESH_MS = 6 * 60 * 60 * 1000;
const AGENDA_FRESH_MS = 60 * 60 * 1000;
const agendaCache = path.join(REPO_ROOT, '.cache', 'agendas-snapshot.json');
const agendaFiles = [agendaCache, path.join(REPO_ROOT, 'packages', 'web', 'public', 'agendas-snapshot.json'), path.join(REPO_ROOT, 'packages', 'web', 'dist', 'agendas-snapshot.json')];

function readSnapshot(file) {
  try {
    const data = JSON.parse(readFileSync(file, 'utf8'));
    return isAgendaSnapshot(data) ? data : null;
  } catch {
    return null;
  }
}

let liveSnapshot =
  agendaFiles
    .map(readSnapshot)
    .filter(Boolean)
    .sort((a, b) => String(b.generatedAt).localeCompare(String(a.generatedAt)))[0] || null;
const agendas = { version: 0, snapshot: () => liveSnapshot };
let refreshing = false;

async function refreshAgendas() {
  if (refreshing) return;
  refreshing = true;
  try {
    const next = await buildAgendaSnapshot({ previous: liveSnapshot });
    liveSnapshot = next;
    agendas.version += 1;
    try {
      mkdirSync(path.dirname(agendaCache), { recursive: true });
      writeFileSync(agendaCache, JSON.stringify(next));
    } catch (e) {
      console.warn(`Could not save the agenda snapshot: ${e.message}`);
    }
    const c = snapshotCounts(next);
    console.log(`Agendas refreshed: ${c.ok} cities fresh, ${c.stale} kept from an earlier run, ${c.error} failed`);
  } catch (e) {
    console.warn(`Agenda refresh failed: ${(e && e.message) || e}`);
  } finally {
    refreshing = false;
  }
}

if (!/^(0|off|false|no)$/i.test(String(process.env.AGENDAS_REFRESH || '').trim())) {
  const age = liveSnapshot ? Date.now() - Date.parse(liveSnapshot.generatedAt) : Infinity;
  const first = Number.isFinite(age) && age < AGENDA_FRESH_MS ? AGENDA_FRESH_MS - age : 2000;
  setTimeout(refreshAgendas, first).unref();
  setInterval(refreshAgendas, AGENDA_REFRESH_MS).unref();
}

const app = createApp({ cities, news, agendas });

app.listen(port, () => {
  // aiAvailable() also accepts ANTHROPIC_AUTH_TOKEN, so ask it rather than checking one variable.
  console.log(`${BRAND.name} API listening on http://localhost:${port}  (${cities.length} cities, AI ${aiAvailable() ? 'on' : 'off: set ANTHROPIC_API_KEY to enable'})`);
});
