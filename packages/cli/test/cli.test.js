import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadCities } from '@agora/core/node';
import { t } from '@agora/core';
import { parseArgs, crashReport } from '../src/main.js';
import { intFlag, dateFlag, suggest, UsageError } from '../src/args.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const bin = path.join(here, '..', 'bin', 'agora.js');
const scratch = mkdtempSync(path.join(os.tmpdir(), 'agora-cli-test-'));
const env = { ...process.env, NO_COLOR: '1', AGORA_PREFS: path.join(scratch, 'no-such-prefs.json'), AGORA_DEMO_PAUSE_MS: '0' };
delete env.FORCE_COLOR;
delete env.AGORA_LANG;
delete env.ANTHROPIC_API_KEY;
delete env.ANTHROPIC_AUTH_TOKEN;

/** Run the CLI and return stdout. stderr is captured (not leaked into the test output). */
function cli(args, extraEnv = {}) {
  return execFileSync(process.execPath, [bin, ...args], { env: { ...env, ...extraEnv }, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
}

/** Run the CLI and return {status, stdout, stderr} without throwing on a non-zero exit. */
function runCli(args, extraEnv = {}) {
  const r = spawnSync(process.execPath, [bin, ...args], { env: { ...env, ...extraEnv }, encoding: 'utf8' });
  return { status: r.status, stdout: r.stdout, stderr: r.stderr };
}

const json = (args, extraEnv) => JSON.parse(cli([...args, '--json'], extraEnv));
const TODAY = '2026-10-10';

test('argument parser', () => {
  assert.deepEqual(parseArgs(['match', '--interests', 'a,b', '--evening', 'extra', '--miles=5']), { cmd: 'match', flags: { interests: 'a,b', evening: true, miles: '5' }, args: ['extra'] });
  assert.deepEqual(parseArgs([]).cmd, 'help');
  // --no-color is a switch: it must not swallow the command after it.
  assert.deepEqual(parseArgs(['--no-color', 'cities']), { cmd: 'cities', flags: { 'no-color': true }, args: [] });
  assert.deepEqual(parseArgs(['--no-color', 'speak', 'Plano']).args, ['Plano']);
  assert.equal(parseArgs(['meetings', '--evening=false']).flags.evening, false);
  assert.equal(parseArgs(['meetings', '--json=true']).flags.json, true);
  assert.equal(parseArgs(['-h']).flags.help, true);
  assert.deepEqual(parseArgs(['explain', '--', '--not-a-flag']).args, ['--not-a-flag']);
});

test('flag validation helpers reject impossible dates and out-of-range numbers', () => {
  assert.equal(dateFlag({ today: '2026-10-10' }, 'today'), '2026-10-10');
  assert.equal(dateFlag({}, 'today'), undefined);
  assert.throws(() => dateFlag({ today: '2026-02-30' }, 'today'), UsageError);
  assert.throws(() => dateFlag({ today: 'tomorrow' }, 'today'), UsageError);
  assert.throws(() => dateFlag({ today: true }, 'today'), UsageError);
  assert.equal(intFlag({ days: '7' }, 'days', { max: 365, fallback: 30 }), 7);
  assert.equal(intFlag({}, 'days', { max: 365, fallback: 30 }), 30);
  for (const bad of ['0', '-5', '7.5', '400', 'abc', '']) assert.throws(() => intFlag({ days: bad || true }, 'days', { max: 365, fallback: 30 }), UsageError, bad);
  assert.equal(suggest('metings', ['meetings', 'match']), 'meetings');
  assert.equal(suggest('zzzzzz', ['meetings', 'match']), null);
});

test('help prints commands, and --json help is JSON', () => {
  const out = cli(['help']);
  assert.match(out, /Start here:/);
  assert.match(out, /match/);
  assert.match(out, /--no-color/);
  const data = json(['help']);
  assert.ok(data.commands.some((c) => c.name === 'match' && c.options.includes('interests')));
  assert.match(cli(['match', '--help']), /agora match \[--interests/);
});

test('cities and meetings run against the merged data', () => {
  const cities = json(['cities', '--today', '2026-09-14']);
  assert.ok(cities.cities.length >= 1, 'data/cities.json should have at least one city');
  const meetings = json(['meetings', '--days', '30', '--today', '2026-09-14']);
  assert.ok(Array.isArray(meetings.meetings));
  assert.ok(meetings.meetings.every((m) => m.date >= '2026-09-14'));
});

test('match with flags returns ranked meetings with reasons', () => {
  const plan = json(['match', '--interests', 'housing,transit', '--evening', '--weekends', '--today', '2026-09-14']);
  assert.ok(plan.meetings.length > 0);
  assert.ok(plan.meetings[0].reasons.length > 0);
  assert.ok(plan.meetings.every((m, i, arr) => i === 0 || arr[i - 1].score >= m.score), 'sorted by score');
});

test('unknown city fails with a clear message', () => {
  const r = runCli(['speak', 'Atlantis']);
  assert.equal(r.status, 1);
  assert.match(r.stderr, /No city called "Atlantis"/);
  const ambiguous = runCli(['city', 'park']);
  assert.equal(ambiguous.status, 1);
  assert.match(ambiguous.stderr, /Highland Park, University Park/);
  assert.match(runCli(['city', 'Plno']).stderr, /Did you mean Plano\?/);
});

test('comment drafting works offline', () => {
  const out = cli(['comment', '--name', 'Sam', '--topic', 'transit', '--ask', 'add a bus stop by the high school']);
  assert.match(out, /My name is Sam/);
  assert.match(out, /add a bus stop/);
});

test('the schedule is the same in English, Spanish and Vietnamese', () => {
  const key = (m) => [m.id, m.cityId, m.date, m.time, m.status, m.type, m.openToPublicComment].join('|');
  const byLang = {};
  for (const lang of ['en', 'es', 'vi']) byLang[lang] = json(['meetings', '--all', '--days', '120', '--today', TODAY, '--lang', lang]).meetings.map(key);
  assert.ok(byLang.en.length > 100);
  assert.deepEqual(byLang.es, byLang.en);
  assert.deepEqual(byLang.vi, byLang.en);

  // The Colony's moved meeting says "6:30 p.m."; translated, it once became 6:30 AM.
  const colony = json(['speak', 'The Colony', '--today', '2026-10-01', '--lang', 'vi']);
  const colonyEn = json(['speak', 'The Colony', '--today', '2026-10-01']);
  assert.equal(colony.nextSpeakableMeeting.time, colonyEn.nextSpeakableMeeting.time);
  assert.ok(colony.nextSpeakableMeeting.time >= '12:00', 'an evening meeting, not a morning one');

  // Garland's regular meeting moved off Election Day must exist in every language.
  for (const lang of ['en', 'es', 'vi']) {
    const garland = json(['city', 'Garland', '--today', TODAY, '--lang', lang]).upcoming;
    assert.ok(garland.some((m) => m.date === '2026-11-02' && m.type === 'regular' && m.status !== 'cancelled'), lang);
  }
});

test('cities points at the next meeting where you can speak and is honest about remote comment', () => {
  const { cities } = json(['cities', '--today', TODAY]);
  for (const c of cities) {
    assert.ok(c.nextSpeakableMeeting === null || c.nextSpeakableMeeting.openToPublicComment, c.cityId);
    assert.ok('nextMeeting' in c, 'the older nextMeeting field is kept');
  }
  // Some cities hold a watch-only session first; the speak column must skip it.
  assert.ok(cities.some((c) => c.nextMeeting && !c.nextMeeting.openToPublicComment && c.nextSpeakableMeeting));
  const raw = loadCities();
  for (const c of cities) {
    const v = raw.find((x) => x.cityId === c.cityId).publicComment.virtualAllowed;
    assert.equal(c.remoteComment, v === true ? 'yes' : v === false ? 'no' : 'unknown', c.cityId);
  }
  const text = cli(['cities', '--today', TODAY]);
  const unknown = cities.find((c) => c.remoteComment === 'unknown');
  const rows = text.split('\n').filter((l) => cities.some((c) => l.startsWith(`  ${c.name} `)));
  assert.equal(rows.length, cities.length);
  if (unknown) assert.match(rows.find((l) => l.startsWith(`  ${unknown.name} `)), /\bask\b/);
  assert.ok(rows.every((l) => !/in person/.test(l)), 'unknown remote comment is never shown as "in person"');
});

test('agenda items from meetings that already happened are labeled as past', () => {
  const dates = loadCities()
    .flatMap((c) => (c.agendaItems || []).map((a) => a.meetingDate))
    .filter(Boolean)
    .sort();
  const after = (d) => new Date(Date.parse(`${d}T12:00:00Z`) + 86400000).toISOString().slice(0, 10);
  const later = after(dates[dates.length - 1]);

  const city = json(['city', 'Plano', '--today', later]);
  assert.equal(city.agenda.upcoming.length, 0);
  assert.ok(city.agenda.recent.length > 0);
  const text = cli(['city', 'Plano', '--today', later]);
  assert.match(text, /On upcoming agendas \(0\)/);
  assert.match(text, /No agenda for an upcoming meeting is posted yet/);
  assert.match(text, /From recent meetings that already happened/);
  assert.match(text, /days? ago/);

  const agenda = cli(['agenda', '--today', later]);
  assert.match(agenda, /No agenda for an upcoming meeting is posted yet/);
  assert.match(agenda, /agora agenda --recent/);
  assert.ok(json(['agenda', '--recent', '--today', later]).items.length > 0);
  assert.match(cli(['stats', '--today', later]), /Topics on recent agendas/);

  // Before the meetings, the same items are upcoming.
  const before = json(['city', 'Plano', '--today', dates[0]]);
  assert.ok(before.agenda.upcoming.length > 0);
  assert.match(cli(['stats', '--today', dates[0]]), /Topics on upcoming agendas/);
});

test('--no-color turns colors off even when FORCE_COLOR is set', () => {
  const ESC = '\u001b[';
  assert.ok(cli(['topics'], { FORCE_COLOR: '1', NO_COLOR: '' }).includes(ESC), 'colors on without the flag');
  assert.ok(!cli(['topics', '--no-color'], { FORCE_COLOR: '1', NO_COLOR: '' }).includes(ESC));
  assert.match(cli(['--no-color', 'speak', 'Plano', '--today', TODAY], { FORCE_COLOR: '1', NO_COLOR: '' }), /How to speak at Plano/);
});

test('--today, --days and other values are validated with a clear error', () => {
  const cases = [
    [['cities', '--today', '2026-02-30'], /--today needs a real date/],
    [['meetings', '--today', 'tomorrow'], /--today needs a real date/],
    [['meetings', '--days', '-5'], /--days needs a whole number from 1 to 365/],
    [['meetings', '--days', '0'], /--days needs a whole number/],
    [['stats', '--days', '7.5'], /--days needs a whole number/],
    [['match', '--miles', 'far'], /--miles needs a number/],
    [['news', '--limit', '0'], /--limit needs a whole number/],
    [['serve', '--port', 'abc'], /--port needs a whole number from 1 to 65535/],
    [['meetings', '--topic', 'housng'], /Did you mean "housing"\?/],
    [['learn', 'bogus'], /There is no "bogus" section/],
    [['comment', '--city', 'atlantis'], /No city called "atlantis"/],
    [['cities', '--county', 'Harris'], /No county called "Harris"/],
  ];
  for (const [args, message] of cases) {
    const r = runCli(args);
    assert.equal(r.status, 1, args.join(' '));
    assert.match(r.stderr, message, args.join(' '));
    assert.doesNotMatch(r.stderr, /\n\s+at /, 'no stack trace');
  }
  assert.match(runCli(['cities', '--today', '2026-02-30', '--lang', 'es']).stderr, /necesita una fecha real/);
});

test('unknown options, stray words and commands are reported, not silently ignored', () => {
  const r = runCli(['meetings', '--cty', 'Plano', '--today', TODAY]);
  assert.equal(r.status, 0);
  assert.match(r.stderr, /Ignoring --cty.*Did you mean --city/);
  assert.match(runCli(['cities', 'Plano', '--today', TODAY]).stderr, /Ignoring "Plano"/);
  const typo = runCli(['metings']);
  assert.equal(typo.status, 1);
  assert.match(typo.stderr, /Did you mean: agora meetings/);
  assert.match(runCli(['Plano']).stderr, /agora city Plano/);
  assert.match(runCli(['topics', '--lang', 'fr']).stderr, /Language "fr" is not available/);
  assert.equal(json(['topics', '--lang', 'ES']).topics[0].label, json(['topics', '--lang', 'es']).topics[0].label);
});

test('list commands accept a city name after the command', () => {
  const all = json(['meetings', '--today', TODAY]).meetings;
  const plano = json(['meetings', 'Plano', '--today', TODAY]).meetings;
  assert.ok(plano.length > 0 && plano.length < all.length);
  assert.ok(plano.every((m) => m.cityId === 'plano'));
  assert.ok(json(['youth', 'Fort Worth']).programs.every((p) => p.cityId === 'fort-worth'));
  assert.deepEqual(Object.keys(json(['learn', 'tips'])), ['tips']);
});

test('every data command prints valid JSON', () => {
  const commands = [['topics'], ['cities'], ['city', 'Plano'], ['speak', 'Dallas'], ['meetings'], ['agenda'], ['youth'], ['prefs'], ['match'], ['map'], ['stats'], ['learn'], ['comment', '--name', 'Sam']];
  for (const args of commands) assert.doesNotThrow(() => json([...args, '--today', TODAY]), args.join(' '));
});

test('demo prints commands you can paste and says "agora setup" once', () => {
  const out = cli(['demo', '--today', TODAY]);
  assert.match(out, /Run agora setup to save your own preferences/);
  assert.doesNotMatch(out, /setup setup/);
  assert.match(out, /--school "Plano Senior High"/);
  assert.match(out, /--ask "keep rec centers open until 9 PM on school nights"/);
  assert.doesNotMatch(cli(['demo', '--today', TODAY, '--lang', 'es']), /setup setup/);
});

test('map legend gives each city its next date with a glyph, and --json returns it', () => {
  const data = json(['map', '--today', TODAY]);
  assert.equal(data.legend.length, loadCities().length);
  for (const e of data.legend) {
    assert.match(e.letter, /^[A-Za-z]$/);
    assert.ok(['soon', 'week', 'later', 'none'].includes(e.bucket));
    if (e.nextMeeting) assert.match(e.nextMeeting.date, /^\d{4}-\d{2}-\d{2}$/);
  }
  const text = cli(['map', '--today', TODAY]);
  assert.match(text, /\* within 3 days {3}\+ within 10 days {3}- later/);
  assert.match(text, /A Addison +[*+?-] \S/);
  for (const lang of ['en', 'es', 'vi']) {
    for (const line of cli(['map', '--today', TODAY, '--lang', lang]).split('\n')) assert.ok([...line].length <= 80, `${lang}: ${line}`);
  }
});

test('labels line up even when a translation is longer than the English', () => {
  /** Column where the value starts on each line that begins with one of these labels. */
  const valueColumns = (out, labels) =>
    out
      .split('\n\n')
      .find((block) => labels.some((l) => block.includes(`\n${l} `)))
      .split('\n')
      .filter((line, i, all) => !(all[i + 1] || '').startsWith('---'))
      .map((line, i, all) => {
        // A label too long for the column keeps its line, and its value starts the next one.
        if (labels.includes(line)) return all[i + 1].search(/\S/);
        const label = labels.find((l) => line.startsWith(`${l} `));
        if (!label) return null;
        return label.length + line.slice(label.length).search(/\S/);
      })
      .filter((n) => n !== null);
  const prefsKeys = ['languageLabel', 'interests', 'available', 'student', 'homeCity', 'location', 'maxDistance', 'speakOnly', 'remoteOk'];
  const statsKeys = ['cities', 'meetings', 'after5', 'openToSpeak', 'youthProgramsLabel', 'remoteComment'];
  for (const lang of ['en', 'es', 'vi']) {
    const prefs = valueColumns(cli(['prefs', '--lang', lang]), prefsKeys.map((k) => t(`cli.${k}`, undefined, lang)));
    assert.equal(prefs.length, prefsKeys.length, lang);
    assert.equal(new Set(prefs).size, 1, `${lang} prefs values start in one column`);
    const stats = valueColumns(cli(['stats', '--today', TODAY, '--lang', lang]), statsKeys.map((k) => t(`cli.${k}`, undefined, lang)));
    assert.equal(stats.length, statsKeys.length, lang);
    assert.equal(new Set(stats).size, 1, `${lang} stats values start in one column`);
  }
  // A topic label longer than the old fixed 30-column pad ("Elections and how the city runs")
  // no longer pushes its bar out of line.
  const topicBars = cli(['stats', '--today', '2026-09-01'])
    .split('\n')
    .slice(-11)
    .filter((l) => /[█░]/.test(l));
  assert.ok(topicBars.length > 3);
  assert.equal(new Set(topicBars.map((l) => l.search(/[█░]/))).size, 1);
});

test('Spanish and Vietnamese output has no English leftovers', () => {
  const es = cli(['meetings', '--all', '--days', '60', '--today', TODAY, '--lang', 'es']);
  assert.doesNotMatch(es, /\b(rescheduled|special session|watch only|you can speak)\b/);
  assert.match(es, /cancelada|cambio de fecha|sesión especial/);
  assert.match(cli(['city', 'Plano', '--today', TODAY, '--lang', 'es']), /Confianza en los datos: alta/);
  assert.match(cli(['speak', 'Plano', '--today', TODAY, '--lang', 'vi']), /3 phút/);
  const prefs = cli(['prefs', '--lang', 'es']);
  assert.match(prefs, /noches entre semana/);
  assert.doesNotMatch(prefs, /evenings|weekends/);
  assert.match(cli(['help', '--lang', 'es']), /agora <comando> \[opciones\]/);
  assert.match(cli(['meetings', '--topic', 'housing', '--today', '2027-06-01', '--lang', 'es']), /Ninguna reunión de este periodo/);
  assert.match(cli(['meetings', 'Plano', '--evening', '--days', '1', '--today', '2026-10-11', '--lang', 'vi']), /không có trong 90 ngày tới|lịch chỉ đến|không có gì để hiện/);
});

test('match --city does not invent a distance, and youth programs are only "near you" with a location', () => {
  const plan = json(['match', '--interests', 'housing,transit', '--city', 'Plano', '--today', TODAY]);
  assert.equal(plan.prefs.location, null);
  assert.ok(plan.meetings.every((m) => m.distanceMiles === null));
  assert.ok(plan.meetings.every((m) => m.reasons.every((r) => r.kind !== 'distance' || /city/i.test(r.text))));
  const text = cli(['match', '--interests', 'housing', '--city', 'Plano', '--today', TODAY]);
  assert.doesNotMatch(text, /under 1 mile/);
  assert.doesNotMatch(text, /near you/);
  assert.match(text, /Youth councils and programs \(your city first\)/);
});

test('explain keeps paragraphs apart and rejects an unknown --city', () => {
  const out = cli(['explain', 'Rezoning case Z-2026-14', '--city', 'plano']);
  const body = out.split('\n').slice(4).join('\n');
  assert.ok(body.split(/\n\s*\n/).length >= 3, `paragraphs survive wrapping:\n${body}`);
  assert.equal(runCli(['explain', 'Budget', '--city', 'atlantis']).status, 1);
});

test('an unexpected crash prints one line, and the stack only with AGORA_DEBUG', () => {
  const err = new Error('boom');
  const quiet = crashReport(err);
  assert.equal(quiet[0], 'agora: boom');
  assert.match(quiet[1], /AGORA_DEBUG=1/);
  assert.ok(quiet.every((l) => !/\n\s+at /.test(l)));
  assert.match(crashReport(err, { debug: true })[0], /Error: boom\n\s+at /);
});

test('a prefs file that cannot be read is reported instead of looking empty', () => {
  const file = path.join(scratch, 'broken-prefs.json');
  writeFileSync(file, '{"lang": "es", ');
  const r = runCli(['prefs'], { AGORA_PREFS: file });
  assert.equal(r.status, 0);
  assert.match(r.stdout, /Could not read\s+\S*broken-prefs\.json/);
  assert.equal((r.stdout.match(/defaults/g) || []).length, 1, 'the defaults note is not repeated');
  assert.equal(JSON.parse(cli(['prefs', '--json'], { AGORA_PREFS: file })).error !== null, true);
});
