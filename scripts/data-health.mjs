/**
 * Weekly data health check, run by .github/workflows/data-health.yml. It lists what a person
 * should look at before the curated data goes stale, and keeps one GitHub issue titled
 * "Data health" up to date with it:
 *  - cities whose published meeting calendar ends within 45 days (calendarThrough);
 *  - youth programs whose application window has passed while the data still says open, or
 *    whose next window should have opened by now;
 *  - official pages and news feeds that stopped answering (404, gone, server errors, no DNS).
 *    Sites that block automated requests (401, 403, 429, bot challenges) are counted, not
 *    reported: a person can still open them;
 *  - agenda sources that failed in the deployed agenda snapshot, or a snapshot that stopped
 *    being refreshed.
 *
 * It never fails noisily: every check catches its own errors, and the script exits 0.
 *
 * Usage: node scripts/data-health.mjs [--no-links] [--dry-run] [--today=YYYY-MM-DD]
 *   --no-links  skip the page and feed checks (fast, offline)
 *   --dry-run   print the report; never touch GitHub
 *   --today     check as of another date (to preview what will need attention)
 * Environment:
 *   GITHUB_TOKEN, GITHUB_REPOSITORY  open, update or close the "Data health" issue
 *   AGENDA_SNAPSHOT_URL              the deployed agenda snapshot (default: the Pages site for
 *                                    GITHUB_REPOSITORY, else packages/web/public/agendas-snapshot.json)
 *   GITHUB_STEP_SUMMARY              also written there when set (GitHub Actions)
 */
import { appendFileSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadCities, loadNews } from '@agora/core/node';
import { AGENDA_USER_AGENT, calendarThrough, daysBetween, failingAgendaSources, forEachCityUrl, isAgendaSnapshot, snapshotCounts, todayStr, youthApplyState } from '@agora/core';

const here = path.dirname(fileURLToPath(import.meta.url));
const ISSUE_TITLE = 'Data health';
const CALENDAR_WARN_DAYS = 45;
const SNAPSHOT_STALE_DAYS = 2;
const flag = (name) => process.argv.includes(`--${name}`);
const todayArg = (process.argv.find((a) => a.startsWith('--today=')) || '').slice(8);
const today = /^\d{4}-\d{2}-\d{2}$/.test(todayArg) ? todayArg : todayStr('America/Chicago');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** "Dec 15, 2026" */
const human = (date) => new Date(`${date}T12:00:00Z`).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' });

function calendarsEnding(cities) {
  const out = [];
  for (const city of cities) {
    const through = calendarThrough(city);
    if (!through) continue;
    const left = daysBetween(today, through);
    if (left <= CALENDAR_WARN_DAYS) out.push(`**${city.name}**: the published calendar ends ${human(through)} (${left < 0 ? 'already past' : `${left} days left`}). Add the next dates from ${city.agendaPortal && city.agendaPortal.url ? city.agendaPortal.url : city.website}.`);
  }
  return out;
}

function youthWindows(cities) {
  const out = [];
  for (const city of cities) {
    for (const p of city.youthPrograms || []) {
      const s = youthApplyState(p, today);
      if (p.applyStatus === 'open' && s.state === 'closed') out.push(`**${city.name}, ${p.name}**: the data says applications are open, but the deadline (${human(p.applyBy)}) has passed. Update applyStatus and applyWindow.`);
      else if (p.applyStatus === 'closed' && s.state === 'unknown') out.push(`**${city.name}, ${p.name}**: the next application window was expected ${p.applyOpens}. Check ${p.url || city.website} and update applyStatus.`);
      else if (!p.applyStatus) out.push(`**${city.name}, ${p.name}**: no applyStatus yet.`);
    }
  }
  return out;
}

/** Every page the app links to that a city record names on purpose, once per URL. */
function pagesToCheck(cities, news) {
  const urls = new Map();
  const add = (url, where) => {
    if (typeof url !== 'string' || !/^https?:\/\//i.test(url)) return;
    if (!urls.has(url)) urls.set(url, where);
  };
  const keep = /^(website|councilPageUrl|council\.(findMyDistrictUrl|districtMapUrl)|publicComment\.(registrationUrl|source)|agendaPortal\.url|liveStream\.url|youthPrograms\[\d+\]\.url)$/;
  for (const city of cities) forEachCityUrl(city, (value, at) => keep.test(at) && add(value, `${city.name} (${at})`));
  for (const source of news.sources || []) add(source.rssUrl, `news feed: ${source.name}`);
  return [...urls].map(([url, where]) => ({ url, where }));
}

const BLOCKED = new Set([401, 403, 405, 406, 429, 451, 503]);
const SOFT_404 = /<title>[^<]*(page not found|404|file or directory not found|custom404)[^<]*<\/title>/i;

/** 'ok' | 'blocked' | a short failure reason. Polite: one retry, a timeout, the app's user agent. */
async function checkUrl(url) {
  let last = '';
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 20000);
    try {
      const res = await fetch(url, { headers: { 'User-Agent': AGENDA_USER_AGENT, Accept: 'text/html,application/xhtml+xml,application/xml,*/*' }, redirect: 'follow', signal: controller.signal });
      const text = res.ok ? (await res.text()).slice(0, 20000) : '';
      if (res.ok) return SOFT_404.test(text) ? 'the page says it was not found' : 'ok';
      if (BLOCKED.has(res.status) || res.headers.get('cf-mitigated')) return 'blocked';
      if (res.status === 404 || res.status === 410) return `HTTP ${res.status}`;
      last = `HTTP ${res.status}`;
    } catch (e) {
      const code = e && e.cause && e.cause.code;
      if (code === 'ENOTFOUND') return 'the address no longer resolves';
      // A firewall that dislikes automated requests drops the connection mid-answer.
      if (code === 'UND_ERR_SOCKET' || code === 'ECONNRESET') return 'blocked';
      last = controller.signal.aborted ? 'no answer in 20 s' : `network error (${code || (e && e.message) || e})`;
    } finally {
      clearTimeout(timer);
    }
    await sleep(3000);
  }
  return last;
}

async function brokenPages(cities, news) {
  const pages = pagesToCheck(cities, news);
  const byHost = new Map();
  for (const p of pages) {
    const host = new URL(p.url).host;
    if (!byHost.has(host)) byHost.set(host, []);
    byHost.get(host).push(p);
  }
  const results = [];
  let blocked = 0;
  const hosts = [...byHost.values()];
  // A few hosts at a time, one request at a time per host, a second apart.
  const workers = Array.from({ length: 6 }, async () => {
    while (hosts.length) {
      const list = hosts.shift();
      for (const p of list) {
        const verdict = await checkUrl(p.url);
        if (verdict === 'blocked') blocked += 1;
        else if (verdict !== 'ok') results.push(`**${p.where}**: ${p.url} (${verdict})`);
        await sleep(1000);
      }
    }
  });
  await Promise.all(workers);
  return { broken: results.sort(), checked: pages.length, blocked };
}

async function loadAgendaSnapshot() {
  const repo = process.env.GITHUB_REPOSITORY || '';
  const url = process.env.AGENDA_SNAPSHOT_URL || (repo ? `https://${repo.split('/')[0].toLowerCase()}.github.io/${repo.split('/')[1]}/agendas-snapshot.json` : '');
  if (url) {
    try {
      const res = await fetch(url, { headers: { 'User-Agent': AGENDA_USER_AGENT, Accept: 'application/json' } });
      const data = res.ok ? await res.json() : null;
      if (isAgendaSnapshot(data)) return { snapshot: data, from: url };
      return { snapshot: null, from: url, error: `HTTP ${res.status}` };
    } catch (e) {
      return { snapshot: null, from: url, error: (e && e.message) || String(e) };
    }
  }
  try {
    const file = path.resolve(here, '..', 'packages', 'web', 'public', 'agendas-snapshot.json');
    const data = JSON.parse(readFileSync(file, 'utf8'));
    return isAgendaSnapshot(data) ? { snapshot: data, from: path.relative(process.cwd(), file) } : { snapshot: null, from: file, error: 'not a snapshot' };
  } catch (e) {
    return { snapshot: null, from: 'packages/web/public/agendas-snapshot.json', error: 'missing' };
  }
}

function agendaProblems({ snapshot, from, error }) {
  if (!snapshot) return [`The agenda snapshot could not be read from ${from} (${error}). Check the "Gather upcoming meetings and agendas" step of the Pages workflow.`];
  const out = [];
  const age = daysBetween(todayStr('America/Chicago', new Date(snapshot.generatedAt)), today);
  if (age > SNAPSHOT_STALE_DAYS) out.push(`The agenda snapshot was last made ${human(todayStr('America/Chicago', new Date(snapshot.generatedAt)))}, ${age} days ago. Check that the Pages workflow still runs on schedule.`);
  for (const f of failingAgendaSources(snapshot)) {
    const since = f.lastSuccessAt ? `last worked ${human(todayStr('America/Chicago', new Date(f.lastSuccessAt)))}` : 'has not worked yet';
    out.push(`**${f.cityId}**: ${f.status === 'stale' ? 'showing its last good agenda data' : 'no live agenda data'}; the source ${since} (${f.error || 'unknown error'}).`);
  }
  return out;
}

function workflowLink() {
  const repo = process.env.GITHUB_REPOSITORY;
  const server = process.env.GITHUB_SERVER_URL || 'https://github.com';
  return repo ? `[data health workflow](${server}/${repo}/actions/workflows/data-health.yml)` : 'data health check';
}

function section(title, lines, empty) {
  return `### ${title}\n\n${lines.length ? lines.map((l) => `- [ ] ${l}`).join('\n') : `${empty}`}\n`;
}

async function safely(fn, fallback) {
  try {
    return await fn();
  } catch (e) {
    return fallback((e && e.message) || String(e));
  }
}

async function github(method, route, body) {
  const res = await fetch(`https://api.github.com${route}`, {
    method,
    headers: { Authorization: `Bearer ${process.env.GITHUB_TOKEN}`, Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28', 'User-Agent': AGENDA_USER_AGENT, ...(body ? { 'Content-Type': 'application/json' } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) throw new Error(`${method} ${route}: HTTP ${res.status} ${(await res.text()).slice(0, 200)}`);
  return res.status === 204 ? null : res.json();
}

/** Open or update the one "Data health" issue; close it when everything is clear. */
async function syncIssue(body, problems) {
  const repo = process.env.GITHUB_REPOSITORY;
  if (!process.env.GITHUB_TOKEN || !repo) return 'no GITHUB_TOKEN or GITHUB_REPOSITORY, so no issue was touched';
  const issues = await github('GET', `/repos/${repo}/issues?state=all&per_page=100&sort=created&direction=desc`);
  const existing = issues.find((i) => i.title === ISSUE_TITLE && !i.pull_request);
  if (problems) {
    if (existing) {
      await github('PATCH', `/repos/${repo}/issues/${existing.number}`, { body, state: 'open' });
      return `updated issue #${existing.number}`;
    }
    const created = await github('POST', `/repos/${repo}/issues`, { title: ISSUE_TITLE, body });
    return `opened issue #${created.number}`;
  }
  if (existing && existing.state === 'open') {
    await github('PATCH', `/repos/${repo}/issues/${existing.number}`, { body, state: 'closed', state_reason: 'completed' });
    return `closed issue #${existing.number}: all clear`;
  }
  return 'all clear; no issue needed';
}

async function main() {
  const cities = loadCities();
  const news = loadNews();
  const calendars = await safely(() => calendarsEnding(cities), (m) => [`The calendar check failed: ${m}`]);
  const youth = await safely(() => youthWindows(cities), (m) => [`The youth program check failed: ${m}`]);
  const agendaInput = await loadAgendaSnapshot();
  const agendas = await safely(() => agendaProblems(agendaInput), (m) => [`The agenda check failed: ${m}`]);
  const links = flag('no-links') ? null : await safely(() => brokenPages(cities, news), (m) => ({ broken: [`The page check failed: ${m}`], checked: 0, blocked: 0 }));

  const problems = calendars.length + youth.length + agendas.length + (links ? links.broken.length : 0);
  const counts = agendaInput.snapshot ? snapshotCounts(agendaInput.snapshot) : null;
  const body = [
    `Checked ${human(today)} by the weekly ${workflowLink()}. ${problems ? `${problems} thing${problems === 1 ? '' : 's'} to look at.` : 'Nothing to fix.'} Tick items off as you fix them; the next run rewrites this list.`,
    '',
    section(`Meeting calendars ending within ${CALENDAR_WARN_DAYS} days`, calendars, 'Every published calendar runs past the next 45 days.'),
    section('Youth program applications', youth, 'Every application status matches its dates.'),
    section('Agenda sources', agendas, counts ? `All agenda sources answered: ${counts.ok} cities fresh, ${counts.unsupported} with no automatic source.` : 'No agenda snapshot to check.'),
    links ? section('Pages and feeds that stopped answering', links.broken, `All ${links.checked - links.blocked} reachable pages and feeds answered.`) : '### Pages and feeds\n\nNot checked this run.\n',
    links ? `${links.checked} official pages and news feeds checked; ${links.blocked} block automated requests and were skipped.\n` : '',
  ].join('\n');

  console.log(body);
  if (process.env.GITHUB_STEP_SUMMARY) {
    try {
      appendFileSync(process.env.GITHUB_STEP_SUMMARY, `## ${ISSUE_TITLE}\n\n${body}\n`);
    } catch {
      // The summary is a convenience.
    }
  }
  if (flag('dry-run')) return;
  const outcome = await safely(() => syncIssue(body, problems > 0), (m) => `the issue could not be updated (${m})`);
  console.log(`Data health: ${outcome}`);
}

main().catch((e) => console.warn(`Data health check did not finish: ${(e && e.message) || e}`));
