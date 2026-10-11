import { readFileSync } from 'node:fs';
import {
  BRAND,
  LOCALES,
  topicList,
  getTopic,
  isTopicId,
  todayStr,
  addDays,
  isDateStr,
  computeStats,
  cityPoint,
  formatDate,
  formatTime,
  relativeDays,
  milesText,
  describeRecurrence,
  weekdayShortNames,
  glossary,
  checklist,
  speakingTips,
  buildComment,
  estimateSpeakingSeconds,
  timeOfDayFor,
  matchYouthPrograms,
  setLocale,
  isLocale,
  setBidiIsolation,
  t,
  tn,
  offeredLocales,
  getLocale,
  joinItems,
  labelValue,
} from '@agora/core';
import { loadNews } from '@agora/core/node';
import { parseArgs, UsageError, GLOBAL_FLAGS, textFlag, dateFlag, intFlag, numberFlag, langCode, suggest } from './args.js';
import { c, heading, labelBlock, bullet, table, bar, wrapText, wrapParagraphs, safe, padVisible, visibleLength, colorEnabled, setColorEnabled, outputWidth } from './ui.js';
import { loadPrefs, PREFS_PATH } from './prefs.js';
import { loadData, engine, splitAgenda, calendarGap, remoteState, matchCity } from './data.js';
import { renderAsciiMap, mapLegend } from './asciimap.js';
import { runWizard } from './wizard.js';
import { renderNews, newsOffline } from './news.js';
import { serve } from './serve.js';

export { parseArgs };

// Terminals print text in logical order and show bidi isolates as gaps, so the CLI asks the
// dictionaries for plain text in every language (the web app keeps them around Arabic params).
setBidiIsolation(false);

const CMD = BRAND.cliCommand;
const WIDTH = 76;

/**
 * Every command with its help group, the options it takes besides the global ones, whether
 * it reads positional words, and the usage hint shown by `agora <command> --help`. Help,
 * option checks and dispatch all read this list, so they cannot drift apart.
 */
const COMMANDS = [
  { name: 'setup', group: 'start', flags: [] },
  { name: 'match', group: 'start', flags: ['interests', 'city', 'near', 'evening', 'daytime', 'weekends', 'speak', 'miles', 'days'], hint: '[--interests housing,transit] [--city Plano] [--near "75024"] [--evening] [--daytime] [--weekends] [--speak] [--miles 10] [--days 45]' },
  { name: 'city', group: 'start', flags: ['city'], positional: true, hint: '<name>' },
  { name: 'speak', group: 'start', flags: ['city'], positional: true, hint: '<name>' },
  { name: 'comment', group: 'start', flags: ['name', 'school', 'city', 'topic', 'item', 'position', 'story', 'ask'], hint: '--name "Ana" --school "Plano East" --city Plano --topic parks-recreation [--item "..."] [--position support|oppose|concerned|ask] [--story "..."] --ask "..."' },
  { name: 'cities', group: 'browse', flags: ['county'], hint: '[--county Collin]' },
  { name: 'meetings', group: 'browse', flags: ['city', 'days', 'evening', 'speak', 'topic', 'all'], positional: true, hint: '[city] [--days 30] [--evening] [--speak] [--topic housing] [--all]' },
  { name: 'agenda', group: 'browse', flags: ['city', 'topic', 'recent'], positional: true, hint: '[city] [--topic housing] [--recent]' },
  { name: 'youth', group: 'browse', flags: ['city'], positional: true, hint: '[city]' },
  { name: 'news', group: 'browse', flags: ['topic', 'city', 'limit'], hint: '[--topic transit] [--city Dallas] [--limit 15]' },
  { name: 'map', group: 'browse', flags: ['near'], hint: '[--near "Richardson"]' },
  { name: 'learn', group: 'learn', flags: [], positional: true, hint: '[glossary|checklist|tips]' },
  { name: 'topics', group: 'learn', flags: [] },
  { name: 'explain', group: 'learn', flags: ['title', 'summary', 'city'], positional: true, hint: '"Rezoning case Z-2026-14" [--summary "..."] [--city plano]' },
  { name: 'stats', group: 'learn', flags: ['days'], hint: '[--days 30]' },
  { name: 'prefs', group: 'more', flags: [] },
  { name: 'demo', group: 'more', flags: [] },
  { name: 'serve', group: 'more', flags: ['port'], hint: '[--port 8787]' },
  { name: 'help', group: 'more', flags: [], positional: true, hint: '[command]' },
];

export const COMMAND_NAMES = COMMANDS.map((x) => x.name);
const GROUPS = ['start', 'browse', 'learn', 'more'];
const LEARN_SECTIONS = ['glossary', 'checklist', 'tips'];
const POSITIONS = ['support', 'oppose', 'concerned', 'ask'];
const STATUS_KEYS = new Set(['rescheduled', 'special', 'cancelled']);

function readVersion() {
  try {
    return JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')).version;
  } catch {
    return '0.0.0';
  }
}

/**
 * Run one command. Returns the exit code instead of exiting, so output piped to another
 * program can finish draining (see bin/agora.js).
 * @param {string[]} argv arguments after the program name
 * @param {{log: Function, error: Function}} io where output and errors go
 */
export async function run(argv, io = console) {
  const { cmd, flags, args } = parseArgs(argv);
  const colorsBefore = colorEnabled();
  if (flags['no-color']) setColorEnabled(false);
  try {
    return await main(cmd, flags, args, io);
  } catch (e) {
    if (e instanceof UsageError) {
      io.error(c.red(e.message));
      return e.exitCode;
    }
    throw e;
  } finally {
    setColorEnabled(colorsBefore);
  }
}

async function main(cmd, flags, args, io) {
  const out = (s) => io.log(s);
  const saved = loadPrefs();
  const lang = pickLanguage(flags, saved.prefs, io);

  if (flags.version) {
    out(`${CMD} ${readVersion()}`);
    return 0;
  }
  if (cmd === 'help') {
    out(flags.json === true ? JSON.stringify(helpData(), null, 2) : help(args[0]));
    return 0;
  }
  const command = COMMANDS.find((x) => x.name === cmd);
  if (!command) return unknownCommand(cmd, lang, io);
  if (flags.help) {
    out(help(cmd));
    return 0;
  }
  warnAboutInput(command, flags, args, io);

  const pretend = dateFlag(flags, 'today');
  const today = pretend || todayStr();
  // With a real date, meetings that already ended today drop out; a pretend date has no time.
  const now = pretend ? undefined : new Date().toISOString();
  if (cmd === 'serve') return serve(flags, io);

  let data;
  try {
    data = loadData(lang);
  } catch (e) {
    io.error(c.red(e.message));
    return 1;
  }
  const ctx = { ...engine(data, { now }), today, lang, json: flags.json === true, flags, args, io, out, saved };
  return RUNNERS[cmd](ctx);
}

/**
 * --lang, then AGORA_LANG, then the saved language, then English. Codes are matched
 * without case ("ES" works). An unsupported --lang is reported instead of silently
 * switching to English.
 */
function pickLanguage(flags, prefs, io) {
  const fallback = langCode(process.env.AGORA_LANG) || (isLocale(prefs.lang) ? prefs.lang : 'en');
  setLocale(fallback);
  if (flags.lang === undefined || flags.lang === false) return fallback;
  // Languages still being translated work with --lang but are not suggested.
  const list = offeredLocales(getLocale()).map((l) => l.code).join(', ');
  if (flags.lang === true) {
    io.error(c.yellow(t('cli.errors.badLang', { lang: '', list })));
    return fallback;
  }
  const code = langCode(flags.lang);
  if (code) {
    setLocale(code);
    return code;
  }
  io.error(c.yellow(t('cli.errors.badLang', { lang: String(flags.lang), list })));
  return fallback;
}

/** Options a command does not use, and words it does not read, are reported instead of silently ignored. */
function warnAboutInput(command, flags, args, io) {
  const known = [...GLOBAL_FLAGS, ...command.flags];
  for (const k of Object.keys(flags)) {
    if (known.includes(k)) continue;
    const near = suggest(k, known);
    const params = { flag: `--${k}`, near: `--${near}`, cmd: `${CMD} ${command.name}`, help: `${CMD} ${command.name} --help` };
    io.error(c.yellow(near ? t('cli.errors.unknownFlagNear', params) : t('cli.errors.unknownFlag', params)));
  }
  if (!command.positional && args.length) io.error(c.yellow(t('cli.errors.extraWords', { words: args.join(' '), cmd: `${CMD} ${command.name}`, help: `${CMD} ${command.name} --help` })));
}

function unknownCommand(cmd, lang, io) {
  let near = suggest(cmd, COMMAND_NAMES);
  if (!near) {
    try {
      const { city } = matchCity(loadData(lang).cities, cmd);
      if (city) near = `city ${quoteArg(city.name)}`;
    } catch {
      // No city data: plain message below.
    }
  }
  io.error(c.red(t('cli.unknownCommand', { cmd })));
  if (near) io.error(t('cli.didYouMean', { suggestion: `${CMD} ${near}` }));
  io.error(t('cli.seeHelp', { cmd: CMD }));
  return 1;
}

/**
 * What to print when a command fails in a way nobody planned for: one line and a hint, or
 * the full stack when `debug` is set (AGORA_DEBUG or DEBUG in the environment). Expected
 * problems such as bad input never get here; they come back from run() as exit codes.
 * @returns {string[]} lines for stderr
 */
export function crashReport(err, { debug = false } = {}) {
  if (debug && err && err.stack) return [String(err.stack)];
  return [`${CMD}: ${err && err.message ? err.message : String(err)}`, t('cli.errors.debugHint')];
}

function emit(ctx, data, render) {
  ctx.out(ctx.json ? JSON.stringify(data, null, 2) : render());
}

/** Quote a word for a shell when it needs it, so commands shown on screen can be pasted. */
function quoteArg(a) {
  const s = String(a);
  return /^[\w@%+=:,./-]+$/.test(s) ? s : `"${s.replace(/(["\\$`])/g, '\\$1')}"`;
}

function requireCity(ctx, query) {
  if (!query) {
    ctx.io.error(c.red(t('cli.whichCity', { cmd: CMD })));
    return null;
  }
  const { city, candidates } = matchCity(ctx.cities, query);
  if (city) return city;
  if (candidates.length > 1) ctx.io.error(c.red(t('cli.cityWhich', { query, list: candidates.map((x) => x.name).join(', ') })));
  else if (candidates.length === 1) ctx.io.error(c.red(t('cli.cityDidYouMean', { query, name: candidates[0].name })));
  else ctx.io.error(c.red(t('cli.noCity', { query, cmd: CMD })));
  return null;
}

/** A city named by --city or by the words after the command ("agora meetings Fort Worth"). */
function cityFromInput(ctx) {
  return textFlag(ctx.flags, 'city') || ctx.args.join(' ').trim() || undefined;
}

/** Topic ids, validated: a typo is an error with a suggestion, not a filter that matches nothing. */
function topicIds(list) {
  const ids = String(list)
    .split(',')
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
  for (const id of ids) {
    if (isTopicId(id)) continue;
    const near = suggest(id, topicList().map((x) => x.id));
    throw new UsageError(near ? t('cli.errors.unknownTopicNear', { topic: id, near, cmd: CMD }) : t('cli.errors.unknownTopic', { topic: id, cmd: CMD }));
  }
  return [...new Set(ids)];
}

function topicFlag(flags) {
  const v = textFlag(flags, 'topic');
  if (v === undefined) return undefined;
  const ids = topicIds(v);
  if (ids.length !== 1) throw new UsageError(t('cli.errors.oneTopic', { cmd: CMD }));
  return ids[0];
}

/** Topic tags as one bracketed label list, so they never read as part of a title. */
function topicTags(ids) {
  const labels = (ids || []).filter((id) => id !== 'other').map((id) => getTopic(id).label);
  return labels.length ? c.cyan(`[${joinItems(labels)}]`) : '';
}

function statusText(status) {
  return STATUS_KEYS.has(status) ? t(`cli.status.${status}`) : status;
}

/**
 * What to say when a city has no meeting in a window of `days` days: that its published
 * calendar ends first (so the next one is simply not posted yet), or, for the 90-day
 * lookahead, that there is none; for other windows, the table's plain empty message.
 */
function noMeetingText(city, today, days = 90) {
  const end = calendarGap(city, today, days);
  if (end) return t('cli.calendarEnds', { date: formatDate(end) });
  return days === 90 ? t('cli.noneIn90') : undefined;
}

/** A gray detail line under a bullet (an address), wrapped and indented to sit under the bullet text. */
function detail(text, indent = 4) {
  return c.gray(wrapText(text, WIDTH - indent, indent));
}

/** Whether you can speak, any schedule change, and how many agenda items: "you can speak, moved". */
function meetingNotes(m) {
  return joinItems([
    m.openToPublicComment ? c.green(t('cli.canSpeak')) : c.dim(t('cli.watchOnly')),
    m.status !== 'scheduled' ? c.yellow(statusText(m.status)) : '',
    (m.agendaItems || []).length ? c.cyan(tn('common.agendaItems', m.agendaItems.length)) : '',
  ]);
}

/**
 * Meetings as a table, or, when the table is wider than the terminal, as two lines per
 * meeting (when and where, then what). In Spanish and Vietnamese a one-line row cannot fit
 * 80 columns without cutting every meeting name down to a word, so the list keeps the names
 * whole. Output sent to a pipe or file always gets the table.
 */
function meetingsTable(list, today, { showCity = true, empty } = {}) {
  const rows = list.map((m) => ({
    when: `${formatDate(m.date)} ${formatTime(m.time)}`,
    rel: c.gray(relativeDays(m.date, today)),
    city: c.bold(m.cityName),
    what: m.label,
    notes: meetingNotes(m),
  }));
  const columns = [
    { key: 'when', title: t('cli.colWhen') },
    { key: 'rel', title: '', optional: true },
    showCity && { key: 'city', title: t('cli.colCity') },
    { key: 'what', title: t('cli.colMeeting'), width: 34, flex: true },
    { key: 'notes', title: t('cli.colNotes'), flex: true },
  ].filter(Boolean);
  const room = outputWidth();
  const widest = (text) => Math.max(...text.split('\n').map(visibleLength));
  // The table is used when it fits with whole cells, after dropping the optional columns.
  if (!list.length || widest(table(rows, columns.filter((col) => !col.optional), { maxWidth: Infinity })) <= room) return table(rows, columns, { empty, maxWidth: room });
  const lines = [];
  for (const m of list) {
    lines.push(`  ${c.bold(`${formatDate(m.date)} ${formatTime(m.time)}`)} ${c.gray(`(${relativeDays(m.date, today).toLowerCase()})`)}${showCity ? `  ${c.bold(m.cityName)}` : ''}`);
    lines.push(wrapText(`${m.label} (${meetingNotes(m)})`, Math.min(WIDTH, room) - 4, 4));
  }
  return lines.join('\n');
}

/* ----------------------------------------------------------------------------------------
 * Commands. Each takes the run context and returns an exit code.
 * -------------------------------------------------------------------------------------- */

function cmdTopics(ctx) {
  const topics = topicList();
  emit(ctx, { topics }, () => {
    const idWidth = Math.max(...topics.map((x) => x.id.length));
    return [
      heading(t('cli.topicsHeading')),
      ...topics.map((x) => `  ${c.cyan(x.id.padEnd(idWidth))}  ${c.bold(x.label)}\n${c.dim(wrapText(x.youthAngle, WIDTH - idWidth - 4, idWidth + 4))}`),
      '',
      c.dim(wrapText(t('cli.topicsTip'), WIDTH)),
    ].join('\n');
  });
  return 0;
}

function cmdCities(ctx) {
  let list = ctx.cities;
  const county = textFlag(ctx.flags, 'county');
  if (county) {
    const counties = [...new Set(ctx.cities.map((x) => x.county))].sort();
    const wanted = county.toLowerCase().replace(/\s+county$/, '');
    const hit = counties.find((x) => x.toLowerCase() === wanted);
    if (!hit) throw new UsageError(t('cli.errors.badCounty', { county, list: counties.join(', ') }));
    list = list.filter((x) => x.county === hit);
  }
  // The column points at the next meeting where the public can speak: for 19 cities the very
  // next meeting is a work session or briefing where students can only watch.
  const entries = list.map((city) => {
    const next = ctx.next(city, ctx.today);
    const speakable = next && next.openToPublicComment ? next : ctx.next(city, ctx.today, { publicCommentOnly: true });
    return { city, next, speakable, gap: speakable ? null : calendarGap(city, ctx.today), remote: remoteState(city) };
  });
  emit(
    ctx,
    {
      cities: entries.map((e) => ({
        cityId: e.city.cityId,
        name: e.city.name,
        county: e.city.county,
        nextMeeting: e.next,
        nextSpeakableMeeting: e.speakable,
        remoteComment: e.remote,
        calendarThrough: e.gap,
      })),
    },
    () => {
      const remote = { yes: c.green(t('cli.remoteShort.yes')), no: t('cli.remoteShort.no'), unknown: c.dim(t('cli.remoteShort.unknown')) };
      const rows = entries.map((e) => ({
        name: c.bold(e.city.name),
        county: e.city.county,
        when: e.speakable ? `${formatDate(e.speakable.date)} ${formatTime(e.speakable.time)}` : c.dim(noMeetingText(e.city, ctx.today)),
        rel: e.speakable ? c.gray(relativeDays(e.speakable.date, ctx.today)) : '',
        remote: remote[e.remote],
        youth: (e.city.youthPrograms || []).length ? c.green(t('cli.yes')) : c.dim(t('cli.no')),
      }));
      return [
        heading(t('cli.citiesHeading', { app: BRAND.name, n: list.length, region: BRAND.region })),
        table(rows, [
          { key: 'name', title: t('cli.colCity') },
          { key: 'county', title: t('cli.colCounty') },
          { key: 'when', title: t('cli.colNextSpeak'), flex: true },
          { key: 'rel', title: '', optional: true },
          { key: 'remote', title: t('cli.colRemote'), flex: true },
          { key: 'youth', title: t('cli.colYouth'), flex: true },
        ]),
        '',
        c.dim(wrapText(t('cli.remoteLegend', { yes: t('cli.remoteShort.yes'), unknown: t('cli.remoteShort.unknown') }), WIDTH)),
        c.dim(t('cli.tip', { cmd: CMD })),
      ].join('\n');
    },
  );
  return 0;
}

function cmdCity(ctx) {
  const city = requireCity(ctx, cityFromInput(ctx));
  if (!city) return 1;
  const upcoming = ctx.expand(city, ctx.today, addDays(ctx.today, 60));
  const agenda = splitAgenda(city, ctx.today);
  emit(ctx, { city, upcoming, agenda }, () => renderCity(ctx, city, upcoming, agenda));
  return 0;
}

function agendaLine(a, today, { past = false } = {}) {
  const when = a.meetingDate ? (past ? `${formatDate(a.meetingDate)}, ${relativeDays(a.meetingDate, today).toLowerCase()}` : formatDate(a.meetingDate)) : t('cli.dateTbd');
  return `${a.title} ${c.gray(`(${when})`)}${a.topics && a.topics.length ? ` ${topicTags(a.topics)}` : ''}`.trim();
}

function renderCity(ctx, city, upcoming, agenda) {
  const { today } = ctx;
  const council = city.council || {};
  const councilText = joinItems([council.size ? t('cli.membersCount', { n: council.size }) : '', council.structure || '', council.mayorName ? t('cli.mayor', { name: council.mayorName }) : '']);
  const lines = [
    heading(t('cli.cityHeading', { city: city.name })),
    labelBlock([
      [t('cli.county'), city.county],
      [t('cli.cityHall'), `${city.cityHall.name ? `${city.cityHall.name}, ` : ''}${city.cityHall.address}`],
      city.website && [t('cli.website'), c.gray(city.website)],
      councilText && [t('cli.council'), councilText],
      council.findMyDistrictUrl && [t('cli.yourDistrict'), c.gray(council.findMyDistrictUrl)],
      city.agendaPortal && city.agendaPortal.url && [t('cli.agendasLabel'), c.gray(city.agendaPortal.url)],
      city.liveStream && city.liveStream.url && [t('cli.watchLive'), c.gray(city.liveStream.url)],
    ]),
  ];

  lines.push('', c.bold(t('cli.schedule')));
  for (const m of city.meetings || []) {
    const rule = `${labelValue(m.label, describeRecurrence(m.recurrence))}${m.openToPublicComment === false ? c.dim(` (${t('cli.noPublicComment')})`) : ''}`;
    lines.push(bullet(`${wrapText(rule, WIDTH - 4, 4).trimStart()}${m.location ? `\n${detail(m.location)}` : ''}`));
  }

  const live = upcoming.filter((m) => m.status !== 'cancelled');
  lines.push('', c.bold(t('cli.next60')), meetingsTable(live, today, { showCity: false, empty: noMeetingText(city, today, 60) }));

  // Cancelled, moved and special meetings, once per date and note (two meetings cancelled on
  // the same night used to print the same date twice).
  const seen = new Set();
  const changes = upcoming.filter((m) => m.status !== 'scheduled' && m.note && !seen.has(`${m.date}|${m.status}|${m.note}`) && seen.add(`${m.date}|${m.status}|${m.note}`));
  if (changes.length) {
    lines.push('', c.bold(t('cli.scheduleChanges')));
    for (const m of changes) lines.push(bullet(wrapText(`${formatDate(m.date)}, ${statusText(m.status)}: ${m.note}`, WIDTH - 4, 4).trimStart()));
  }

  lines.push('', c.bold(t('cli.speakingUp')), wrapText((city.publicComment || {}).summary || '', WIDTH, 2), c.dim(`  ${t('cli.speakHint', { cmd: `${CMD} speak ${quoteArg(city.name)}` })}`));

  if ((city.youthPrograms || []).length) {
    lines.push('', c.bold(t('cli.youthProgramsHeading')));
    for (const p of city.youthPrograms) lines.push(bullet(`${wrapText(`${p.name}${p.ages ? ` (${p.ages})` : ''}`, WIDTH - 4, 4).trimStart()}${p.url ? `\n    ${c.gray(p.url)}` : ''}`));
  }

  lines.push('', c.bold(t('cli.upcomingAgenda', { n: agenda.upcoming.length })));
  if (agenda.upcoming.length) {
    for (const a of agenda.upcoming.slice(0, 8)) lines.push(bullet(wrapText(agendaLine(a, today), WIDTH - 4, 4).trimStart()));
    if (agenda.upcoming.length > 8) lines.push(c.dim(`  ${t('cli.andMore', { n: agenda.upcoming.length - 8, cmd: `${CMD} agenda ${quoteArg(city.name)}` })}`));
  } else {
    const where = (city.agendaPortal && city.agendaPortal.url) || city.website;
    lines.push(c.dim(wrapText(t('cli.noUpcomingAgenda', { url: where }), WIDTH, 2)));
  }
  if (agenda.recent.length) {
    lines.push('', c.bold(t('cli.recentAgenda', { n: agenda.recent.length })));
    for (const a of agenda.recent.slice(0, 5)) lines.push(bullet(wrapText(agendaLine(a, today, { past: true }), WIDTH - 4, 4).trimStart()));
    if (agenda.recent.length > 5) lines.push(c.dim(`  ${t('cli.andMore', { n: agenda.recent.length - 5, cmd: `${CMD} agenda ${quoteArg(city.name)} --recent` })}`));
  }

  const level = ['high', 'medium', 'low'].includes(city.confidence) ? t(`cli.confidence.${city.confidence}`) : city.confidence || t('cli.confidence.medium');
  const confidence = isDateStr(city.lastVerified) ? t('cli.dataConfidenceVerified', { level, date: formatDate(city.lastVerified, { withYear: true }) }) : t('cli.dataConfidence', { level });
  lines.push('', c.dim(wrapText(confidence, WIDTH)));
  return lines.join('\n');
}

function cmdSpeak(ctx) {
  const city = requireCity(ctx, cityFromInput(ctx));
  if (!city) return 1;
  const next = ctx.next(city, ctx.today, { publicCommentOnly: true });
  const calendarThrough = next ? null : calendarGap(city, ctx.today);
  emit(ctx, { cityId: city.cityId, publicComment: city.publicComment, nextSpeakableMeeting: next, remoteComment: remoteState(city), calendarThrough }, () => renderSpeak(ctx, city, next));
  return 0;
}

function renderSpeak(ctx, city, next) {
  const pc = city.publicComment || {};
  const remote = { yes: c.green(t('cli.remoteYes')), no: t('cli.remoteNo'), unknown: c.dim(t('cli.remoteUnknown')) }[remoteState(city)];
  const lines = [heading(t('cli.speakHeading', { city: city.name })), wrapText(pc.summary || '', WIDTH), '', c.bold(t('cli.steps')), wrapText(pc.howToRegister || '', WIDTH, 2), ''];
  lines.push(
    labelBlock(
      [
        pc.registrationUrl && [t('cli.signUp'), c.gray(pc.registrationUrl)],
        pc.deadline && [t('cli.deadline'), pc.deadline],
        pc.timeLimitMinutes && [t('cli.timeLimit'), t('cli.minutesValue', { n: pc.timeLimitMinutes })],
        [t('cli.remote'), remote],
        pc.writtenCommentMethod && [t('cli.written'), pc.writtenCommentMethod],
      ],
      { indent: 2 },
    ),
  );
  if (pc.notes) lines.push('', c.dim(wrapText(pc.notes, WIDTH)));
  lines.push('', c.bold(t('cli.nextChance')));
  if (next) lines.push(bullet(`${wrapText(`${formatDate(next.date, { withYear: true })}, ${formatTime(next.time)} (${relativeDays(next.date, ctx.today).toLowerCase()}): ${next.label}`, WIDTH - 4, 4).trimStart()}\n${detail(next.location)}`));
  else {
    const end = calendarGap(city, ctx.today);
    lines.push(c.dim(wrapText(end ? t('cli.noSpeakMeetingAfter', { date: formatDate(end, { withYear: true }) }) : t('cli.noSpeakMeeting'), WIDTH, 2)));
  }
  lines.push('', c.bold(t('cli.beforeYouGo')), ...speakingTips().slice(0, 3).map((tip) => bullet(wrapText(tip, WIDTH - 4, 4).trimStart())));
  lines.push('', c.dim(t('cli.draftHint', { cmd: CMD, city: city.name })));
  return lines.join('\n');
}

function cmdMeetings(ctx) {
  const { flags, today } = ctx;
  const days = intFlag(flags, 'days', { min: 1, max: 365, fallback: 30 });
  const topic = topicFlag(flags);
  const query = cityFromInput(ctx);
  const city = query ? requireCity(ctx, query) : null;
  if (query && !city) return 1;
  let list = ctx.upcoming({ from: today, days, includeCancelled: !!flags.all });
  if (city) list = list.filter((m) => m.cityId === city.cityId);
  if (flags.evening) list = list.filter((m) => m.isEvening);
  if (flags.speak) list = list.filter((m) => m.openToPublicComment);
  if (topic) list = list.filter((m) => (m.agendaItems || []).some((a) => (a.topics || []).includes(topic)));
  const empty = topic ? t('cli.noTopicMeetings', { topic: getTopic(topic).label }) : city ? noMeetingText(city, today, days) : undefined;
  emit(ctx, { from: today, days, meetings: list }, () => [heading(tn('cli.meetingsHeading', days, { total: list.length })), meetingsTable(list, today, { showCity: !city, empty })].join('\n'));
  return 0;
}

function cmdAgenda(ctx) {
  const { flags, today } = ctx;
  const topic = topicFlag(flags);
  const query = cityFromInput(ctx);
  const city = query ? requireCity(ctx, query) : null;
  if (query && !city) return 1;
  const recent = flags.recent === true;
  const pool = { upcoming: [], recent: [] };
  for (const x of city ? [city] : ctx.cities) {
    const split = splitAgenda(x, today);
    for (const key of ['upcoming', 'recent']) for (const a of split[key]) pool[key].push({ ...a, cityId: x.cityId, cityName: x.name });
  }
  const keep = (a) => !topic || (a.topics || []).includes(topic);
  const byDate = (a, b) => String(a.meetingDate || '9').localeCompare(String(b.meetingDate || '9')) || a.cityName.localeCompare(b.cityName);
  const items = (recent ? pool.recent : pool.upcoming).filter(keep).sort(recent ? (a, b) => byDate(b, a) : byDate);
  const otherCount = (recent ? pool.upcoming : pool.recent).filter(keep).length;
  const SHOW = 40;
  emit(ctx, { items, window: recent ? 'recent' : 'upcoming' }, () => {
    const lines = [heading(t(recent ? 'cli.recentAgendaHeading' : 'cli.agendaHeading', { n: items.length }))];
    for (const a of items.slice(0, SHOW)) {
      const when = a.meetingDate ? (recent ? `${formatDate(a.meetingDate)}, ${relativeDays(a.meetingDate, today).toLowerCase()}` : formatDate(a.meetingDate)) : t('cli.dateTbd');
      lines.push(wrapText(`${c.bold(a.cityName)} ${c.gray(when)}  ${topicTags(a.topics)}`.trimEnd(), WIDTH));
      lines.push(wrapText(a.title, WIDTH, 2));
      if (a.summary) lines.push(c.dim(wrapText(a.summary, WIDTH, 2)));
      if (a.url) lines.push(`  ${c.gray(a.url)}`);
      lines.push('');
    }
    if (items.length > SHOW) lines.push(c.dim(wrapText(t('cli.showingOf', { shown: SHOW, n: items.length }), WIDTH)));
    if (!items.length && !recent) {
      lines.push(c.dim(wrapText(t('cli.noUpcomingAgendaAll'), WIDTH)));
      if (otherCount) lines.push(c.dim(wrapText(t('cli.recentHint', { n: otherCount, cmd: `${CMD} agenda${city ? ` ${quoteArg(city.name)}` : ''}${topic ? ` --topic ${topic}` : ''} --recent` }), WIDTH)));
    } else if (!items.length) lines.push(c.dim(`  ${t('cli.nothingToShow')}`));
    return lines.join('\n').trimEnd();
  });
  return 0;
}

function cmdYouth(ctx) {
  const query = cityFromInput(ctx);
  const city = query ? requireCity(ctx, query) : null;
  if (query && !city) return 1;
  let programs = matchYouthPrograms(ctx.cities, ctx.saved.prefs);
  if (city) programs = programs.filter((p) => p.cityId === city.cityId);
  emit(ctx, { programs }, () => {
    const lines = [heading(t('cli.youthHeading', { n: programs.length }))];
    for (const p of programs) {
      lines.push(c.bold(wrapText(labelValue(p.cityName, p.name), WIDTH)));
      if (p.ages) lines.push(c.gray(wrapText(p.ages, WIDTH, 2)));
      if (p.description) lines.push(wrapText(p.description, WIDTH, 2));
      if (p.applyWindow) lines.push(wrapText(`${c.yellow(t('cli.applyLabel'))} ${p.applyWindow}`, WIDTH, 2));
      if (p.url) lines.push(`  ${c.gray(p.url)}`);
      lines.push('');
    }
    if (!city && programs.length) lines.push(c.dim(t('cli.youthTip', { cmd: CMD })));
    return lines.join('\n').trimEnd();
  });
  return 0;
}

function cmdPrefs(ctx) {
  const { saved } = ctx;
  emit(ctx, { prefs: saved.prefs, saved: saved.saved, path: PREFS_PATH, error: saved.error }, () => {
    const lines = [heading(t('cli.prefsHeading'))];
    if (saved.error) lines.push(c.yellow(wrapText(t('cli.prefsUnreadable', { path: PREFS_PATH, error: saved.error, cmd: CMD }), WIDTH)));
    else if (saved.saved) lines.push(c.dim(PREFS_PATH));
    else lines.push(c.yellow(t('cli.nothingSaved', { cmd: CMD })), c.dim(t('cli.defaultsBelow')));
    lines.push(renderPrefs(ctx, saved.prefs));
    return lines.join('\n');
  });
  return 0;
}

function renderPrefs(ctx, prefs) {
  const city = prefs.homeCityId ? ctx.cityById.get(prefs.homeCityId) : null;
  const yn = (v) => (v ? t('cli.yes') : t('cli.no'));
  const available = ['evenings', 'daytime', 'weekends'].filter((k) => prefs.availability[k]).map((k) => t(`cli.availability.${k}`));
  const language = LOCALES.find((l) => l.code === prefs.lang);
  // A city-hall location is labeled in the language being shown, not the one it was saved in.
  const hall = city ? cityPoint(city) : null;
  const atHall = Boolean(hall && prefs.location && hall.lat === prefs.location.lat && hall.lng === prefs.location.lng);
  const place = atHall ? t('common.cityHallOf', { city: city.name }) : safe(prefs.locationLabel || '');
  const where = prefs.location ? [place, `(${prefs.location.lat.toFixed(3)}, ${prefs.location.lng.toFixed(3)})`].filter(Boolean).join(' ') : c.dim(t('cli.notSet'));
  return labelBlock([
    [t('cli.languageLabel'), language ? language.nativeName : c.dim(t('cli.notSet'))],
    [t('cli.interests'), prefs.interests.length ? joinItems(prefs.interests.map((id) => getTopic(id).label)) : c.dim(t('cli.noneYet'))],
    [t('cli.available'), available.length ? joinItems(available) : c.dim(t('cli.notSet'))],
    [t('cli.student'), yn(prefs.student)],
    [t('cli.homeCity'), city ? city.name : c.dim(t('cli.notSet'))],
    [t('cli.location'), where],
    [t('cli.maxDistance'), t('cli.milesValue', { n: prefs.maxMiles })],
    [t('cli.speakOnly'), yn(prefs.canSpeakOnly)],
    [t('cli.remoteOk'), yn(prefs.virtualOk)],
  ]);
}

async function cmdSetup(ctx) {
  if (ctx.saved.error) ctx.io.error(c.yellow(wrapText(t('cli.prefsWillReplace', { path: PREFS_PATH, error: ctx.saved.error }), WIDTH)));
  const result = await runWizard(ctx.cities, ctx.saved.prefs, ctx.lang);
  return result.code;
}

async function resolveLocation(ctx, query) {
  const { city } = matchCity(ctx.cities, query);
  const hall = city ? { ...cityPoint(city), label: t('common.cityHallOf', { city: city.name }) } : null;
  if (city && city.name.toLowerCase() === query.trim().toLowerCase()) return hall;
  try {
    const { geocode } = await import('@agora/server/geocode');
    const g = await geocode(query, ctx.cities);
    if (g) return { lat: g.lat, lng: g.lng, label: safe(g.label) };
    ctx.io.error(c.yellow(t('cli.couldNotPlace', { query })));
  } catch (e) {
    ctx.io.error(c.yellow(t('cli.geocoderUnreachable', { error: safe(e.message) })));
  }
  return hall;
}

/**
 * Preferences for one `match` run: saved ones overridden by flags. --city sets the home
 * city but not a location: the home-city bonus already covers it, and using city hall as
 * "your location" invented an "under 1 mile away" reason and counted the city twice.
 */
async function prefsFromFlags(ctx) {
  const { flags } = ctx;
  const p = { ...ctx.saved.prefs };
  const interests = textFlag(flags, 'interests');
  if (interests) p.interests = topicIds(interests);
  const query = textFlag(flags, 'city');
  if (query) {
    const city = requireCity(ctx, query);
    if (!city) return null;
    p.homeCityId = city.cityId;
  }
  const near = textFlag(flags, 'near');
  if (near) {
    const loc = await resolveLocation(ctx, near);
    if (loc) {
      p.location = { lat: loc.lat, lng: loc.lng };
      p.locationLabel = loc.label || near;
    }
  }
  if (flags.evening || flags.daytime || flags.weekends) p.availability = { evenings: !!flags.evening, daytime: !!flags.daytime, weekends: !!flags.weekends };
  if (flags.speak) p.canSpeakOnly = true;
  p.maxMiles = numberFlag(flags, 'miles', { max: 200, fallback: p.maxMiles });
  return p;
}

async function cmdMatch(ctx) {
  const days = intFlag(ctx.flags, 'days', { min: 1, max: 365, fallback: 45 });
  const prefs = await prefsFromFlags(ctx);
  if (!prefs) return 1;
  const plan = ctx.plan(prefs, { today: ctx.today, days });
  emit(ctx, plan, () => renderPlan(ctx, plan));
  return 0;
}

/** Wrap a run of reasons as plain text, then color each line, so color codes never split. */
function reasonLines(texts, color) {
  if (!texts.length) return [];
  return wrapText(texts.join(' | '), WIDTH - 4, 4)
    .split('\n')
    .map((l) => `    ${color(l.trimStart())}`);
}

function renderPlan(ctx, plan) {
  const { today } = ctx;
  const lines = [heading(t('cli.matchesHeading')), wrapText(plan.summary, WIDTH), ''];
  if (!plan.prefs.interests.length) lines.push(c.yellow(wrapText(t('cli.matchTip', { cmd: CMD }), WIDTH)), '');
  plan.meetings.forEach((m, i) => {
    lines.push(`${c.bold(String(i + 1).padStart(2))}. ${c.bold(m.cityName)}: ${m.label}`);
    lines.push(`    ${formatDate(m.date, { withYear: true })}, ${formatTime(m.time)} ${c.gray(`(${relativeDays(m.date, today).toLowerCase()})`)}`);
    lines.push(detail(m.location));
    // The strongest few reasons read better than every one (--json keeps them all); the
    // ones counting against a meeting always show.
    const strongest = m.reasons.filter((r) => r.points > 0).sort((a, b) => b.points - a.points);
    lines.push(...reasonLines(strongest.slice(0, 3).map((r) => r.text), c.green));
    lines.push(...reasonLines(m.reasons.filter((r) => r.points < 0).map((r) => r.text), c.yellow));
    for (const a of m.matchedItems.slice(0, 3)) lines.push(`    ${c.cyan('>')} ${wrapText(a.title, WIDTH - 6, 6).trimStart()}`);
    lines.push('');
  });
  if (plan.agendaItems.length) {
    lines.push(c.bold(t('cli.agendaItemsOnTopics')));
    for (const a of plan.agendaItems.slice(0, 8)) lines.push(bullet(wrapText(`${c.bold(a.cityName)}${a.meetingDate ? c.gray(` (${formatDate(a.meetingDate)})`) : ''}: ${a.title} ${topicTags(a.matchedTopics)}`.trim(), WIDTH - 4, 4).trimStart()));
    lines.push('');
  } else if (plan.prefs.interests.length) {
    lines.push(c.dim(wrapText(t('cli.noAgendaOnTopics'), WIDTH)), '');
    // Older engines do not return recentAgendaItems; then this section is simply skipped.
    const recent = Array.isArray(plan.recentAgendaItems) ? plan.recentAgendaItems : [];
    if (recent.length) {
      lines.push(c.bold(t('cli.recentOnTopics')));
      for (const a of recent.slice(0, 5)) lines.push(bullet(wrapText(labelValue(c.bold(a.cityName), agendaLine(a, today, { past: true })), WIDTH - 4, 4).trimStart()));
      lines.push('');
    }
  }
  if (plan.youthPrograms.length) {
    // "Near you" only when there is a location to be near; otherwise the list is home city first, then A to Z.
    const title = plan.prefs.location ? t('cli.youthNearYou') : plan.prefs.homeCityId ? t('cli.youthHomeFirst') : t('cli.youthPlain');
    lines.push(c.bold(title));
    for (const p of plan.youthPrograms.slice(0, 5)) lines.push(bullet(`${labelValue(c.bold(p.cityName), p.name)}${p.distanceMiles != null ? c.gray(` (${milesText(p.distanceMiles)})`) : ''}`));
    lines.push('');
  }
  lines.push(c.dim(t('cli.nextSpeak', { cmd: CMD })));
  return lines.join('\n');
}

async function cmdMap(ctx) {
  const near = textFlag(ctx.flags, 'near');
  const you = near ? await resolveLocation(ctx, near) : ctx.saved.prefs.location;
  const legend = mapLegend(ctx.cities, { today: ctx.today, next: (city) => ctx.next(city, ctx.today, { publicCommentOnly: true }), gap: (city) => calendarGap(city, ctx.today) });
  emit(ctx, { note: t('cli.mapUseWithoutJson'), today: ctx.today, you: you ? { lat: you.lat, lng: you.lng } : null, legend }, () =>
    [heading(t('cli.mapHeading', { region: BRAND.region })), renderAsciiMap(ctx.cities, { today: ctx.today, you, legend })].join('\n'),
  );
  return 0;
}

/**
 * Topic counts for the agenda chart. The engine's stats count every agenda item ever
 * loaded, which labeled September items as "upcoming" in October. These count upcoming
 * items, or, when none are posted yet, the most recent ones under a heading that says so.
 */
function agendaTopicCounts(cities, today) {
  const upcoming = [];
  const recent = [];
  for (const city of cities) {
    const split = splitAgenda(city, today);
    upcoming.push(...split.upcoming);
    recent.push(...split.recent);
  }
  const items = upcoming.length ? upcoming : recent;
  const counts = new Map();
  for (const item of items) for (const id of item.topics || []) counts.set(id, (counts.get(id) || 0) + 1);
  const dates = items
    .map((a) => a.meetingDate)
    .filter(isDateStr)
    .sort();
  return {
    window: upcoming.length ? 'upcoming' : 'recent',
    from: dates[0] || null,
    to: dates[dates.length - 1] || null,
    items: items.length,
    counts: [...counts].map(([topicId, count]) => ({ topicId, count })).sort((a, b) => b.count - a.count || a.topicId.localeCompare(b.topicId)),
  };
}

function cmdStats(ctx) {
  const days = intFlag(ctx.flags, 'days', { min: 1, max: 365, fallback: 30 });
  const s = computeStats(ctx.cities, { today: ctx.today, days, now: ctx.now });
  const agendaTopics = agendaTopicCounts(ctx.cities, ctx.today);
  emit(ctx, { ...s, agendaTopics }, () => renderStats(s, agendaTopics));
  return 0;
}

function renderStats(s, agendaTopics) {
  const lines = [heading(tn('cli.statsHeading', s.windowDays, { region: BRAND.region }))];
  lines.push(
    labelBlock([
      [t('cli.cities'), String(s.totals.cities)],
      [t('cli.meetings'), String(s.totals.meetings)],
      [t('cli.after5'), `${Math.round(s.totals.eveningShare * 100)}%`],
      [t('cli.openToSpeak'), `${Math.round(s.totals.speakableShare * 100)}%`],
      [t('cli.youthProgramsLabel'), t('cli.citiesCount', { n: s.totals.citiesWithYouthPrograms })],
      [t('cli.remoteComment'), t('cli.citiesCount', { n: s.totals.citiesWithVirtualComment })],
    ]),
  );
  lines.push('', c.bold(t('cli.byWeekday')));
  const days = weekdayShortNames();
  const dayWidth = Math.max(...days.map(visibleLength));
  const byDay = s.byWeekdayHour.map((row) => row.reduce((a, b) => a + b, 0));
  const max = Math.max(...byDay, 1);
  byDay.forEach((n, i) => lines.push(`  ${padVisible(days[i], dayWidth)} ${bar(n, max)} ${n}`));
  lines.push('', c.bold(t('cli.startTimes')));
  const byHour = Array(24).fill(0);
  s.byWeekdayHour.forEach((row) => row.forEach((n, h) => (byHour[h] += n)));
  const hmax = Math.max(...byHour, 1);
  byHour.forEach((n, h) => {
    if (n) lines.push(`  ${formatTime(`${String(h).padStart(2, '0')}:00`).padStart(8)}  ${bar(n, hmax)} ${n}`);
  });
  lines.push('', c.bold(t('cli.studentFriendly')));
  const top = s.perCity.slice(0, 10);
  const nameWidth = Math.max(...top.map((x) => visibleLength(x.name)));
  const emax = Math.max(...s.perCity.map((x) => x.evening), 1);
  for (const city of top) {
    const tags = joinItems([city.virtualComment ? c.green(t('cli.remoteTag')) : '', city.youthPrograms ? c.cyan(t('cli.youthTag')) : '']);
    lines.push(`  ${padVisible(city.name, nameWidth)} ${bar(city.evening, emax, 16)} ${city.evening}${tags ? `  ${tags}` : ''}`);
  }
  if (agendaTopics.counts.length) {
    const title =
      agendaTopics.window === 'upcoming' ? t('cli.topicsOnAgendas') : t('cli.topicsOnRecentAgendas', { from: agendaTopics.from ? formatDate(agendaTopics.from) : '?', to: agendaTopics.to ? formatDate(agendaTopics.to) : '?' });
    lines.push('', c.bold(wrapText(title, WIDTH)));
    const shown = agendaTopics.counts.slice(0, 10);
    const labelWidth = Math.max(...shown.map((x) => visibleLength(getTopic(x.topicId).label)));
    const tmax = shown[0].count;
    for (const x of shown) lines.push(`  ${padVisible(getTopic(x.topicId).label, labelWidth)} ${bar(x.count, tmax, 16)} ${x.count}`);
  }
  return lines.join('\n');
}

async function cmdNews(ctx) {
  const { flags } = ctx;
  const topic = topicFlag(flags);
  const city = textFlag(flags, 'city');
  const limit = intFlag(flags, 'limit', { min: 1, max: 200, fallback: 15 });
  const { fetchNews } = await import('@agora/server/news');
  let result;
  try {
    result = await fetchNews(loadNews(), { topic, city, limit, cities: ctx.cities });
  } catch (e) {
    ctx.io.error(c.red(t('cli.couldNotFetchNews', { error: safe(e.message) })));
    return 1;
  }
  // fetchNews never throws: a feed that fails just returns nothing. When every feed failed,
  // say so, instead of "no stories matched" as if the filters had found nothing.
  const offline = newsOffline(result);
  if (offline) ctx.io.error(c.yellow(t('cli.newsOffline')));
  emit(ctx, result, () => renderNews(result, { topic, city }));
  return offline ? 1 : 0;
}

async function cmdExplain(ctx) {
  const title = safe(ctx.args.join(' ').trim() || textFlag(ctx.flags, 'title') || '');
  if (!title) throw new UsageError(t('cli.explainUsage', { cmd: CMD }));
  const query = textFlag(ctx.flags, 'city');
  const city = query ? requireCity(ctx, query) : null;
  if (query && !city) return 1;
  // Loaded here, not at startup: the AI SDK is heavy and only this command needs it.
  const ai = await import('@agora/server/ai');
  if (ai.aiAvailable()) ctx.io.error(c.dim(t('cli.askingAi')));
  let result;
  try {
    // The explanation (from the AI or the template) comes back in the user's language.
    result = await ai.explainAgendaItem({ title, summary: textFlag(ctx.flags, 'summary'), city, locale: ctx.lang });
  } catch (e) {
    ctx.io.error(c.red(t('cli.couldNotExplain', { error: safe(e.message) })));
    return 1;
  }
  const text = safe(result.text, { multiline: true });
  emit(ctx, { ...result, text }, () => {
    const source =
      result.source === 'claude'
        ? t('cli.explainedBy', { model: safe(result.model) })
        : result.fallbackReason
          ? t('cli.templateAfterError', { reason: safe(result.fallbackReason) })
          : t('cli.templateExplanation');
    return [heading(title), c.dim(wrapText(source, WIDTH)), '', wrapParagraphs(text, WIDTH)].join('\n');
  });
  return 0;
}

function cmdComment(ctx) {
  const { flags } = ctx;
  const query = textFlag(flags, 'city');
  const city = query ? requireCity(ctx, query) : null;
  if (query && !city) return 1;
  const topicId = topicFlag(flags);
  const position = textFlag(flags, 'position');
  if (position && !POSITIONS.includes(position.toLowerCase())) throw new UsageError(t('cli.errors.badPosition', { value: position, list: POSITIONS.join(', ') }));
  // Greet for the time of the next meeting where the student could actually read this.
  const next = city ? ctx.next(city, ctx.today, { publicCommentOnly: true }) : null;
  const firstRule = city && (city.meetings || [])[0];
  const time = next ? next.time : firstRule && firstRule.recurrence ? firstRule.recurrence.time : '18:00';
  const draft = buildComment({
    name: textFlag(flags, 'name'),
    school: textFlag(flags, 'school'),
    cityName: city ? city.name : undefined,
    topicId,
    itemTitle: textFlag(flags, 'item'),
    position: position ? position.toLowerCase() : undefined,
    story: textFlag(flags, 'story'),
    ask: textFlag(flags, 'ask'),
    timeOfDay: timeOfDayFor(time),
  });
  const seconds = estimateSpeakingSeconds(draft, ctx.lang);
  emit(ctx, { draft, seconds }, () =>
    [
      heading(t('cli.draftHeading')),
      wrapParagraphs(draft, WIDTH),
      '',
      c.dim(wrapText(t('cli.spokenSeconds', { n: seconds }), WIDTH)),
      city && city.publicComment ? c.dim(wrapText(t('cli.howToSignUp', { city: city.name, how: city.publicComment.howToRegister }), WIDTH)) : '',
    ]
      .join('\n')
      .trimEnd(),
  );
  return 0;
}

function cmdLearn(ctx) {
  const which = String(ctx.args[0] || 'all').toLowerCase();
  if (which !== 'all' && !LEARN_SECTIONS.includes(which)) throw new UsageError(t('cli.errors.badLearn', { value: ctx.args[0], list: LEARN_SECTIONS.join(', '), cmd: CMD }));
  const want = (s) => which === 'all' || which === s;
  const data = {};
  if (want('glossary')) data.glossary = glossary();
  if (want('checklist')) data.checklist = checklist();
  if (want('tips')) data.tips = speakingTips();
  emit(ctx, data, () => {
    const parts = [];
    if (data.glossary) parts.push(heading(t('cli.glossaryHeading')), ...data.glossary.map((g) => `${c.bold(g.term)}\n${wrapText(g.definition, WIDTH, 2)}`));
    if (data.checklist) parts.push(heading(t('cli.checklistHeading')), ...data.checklist.map((s, i) => `${c.cyan(String(i + 1).padStart(2))}. ${wrapText(s, WIDTH - 4, 4).trimStart()}`));
    if (data.tips) parts.push(heading(t('cli.tipsHeading')), ...data.tips.map((s) => bullet(wrapText(s, WIDTH - 4, 4).trimStart())));
    return parts.join('\n');
  });
  return 0;
}

async function cmdDemo(ctx) {
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const pause = Number(process.env.AGORA_DEMO_PAUSE_MS ?? 250);
  // Each step runs with the data already loaded and the same output, today and language.
  const step = async (title, argv) => {
    ctx.out(`\n${c.bgBlue(c.bold(` ${title} `))} ${c.gray(`$ ${CMD} ${argv.map(quoteArg).join(' ')}`)}`);
    if (pause > 0) await sleep(pause);
    const parsed = parseArgs(argv);
    await RUNNERS[parsed.cmd]({ ...ctx, json: false, flags: parsed.flags, args: parsed.args });
  };
  ctx.out(heading(t('cli.demoHeading', { app: BRAND.name })));
  ctx.out(wrapText(`${BRAND.shortDescription} ${BRAND.nonpartisanNote}`, WIDTH));
  const plano = ctx.cityById.get('plano') || ctx.cities[0];
  await step(t('cli.demo1'), ['cities']);
  await step(t('cli.demo2'), ['match', '--interests', 'housing,transit,parks-recreation', '--city', plano.name, '--evening', '--weekends']);
  await step(t('cli.demo3'), ['speak', plano.name]);
  await step(t('cli.demo4'), ['map', '--near', plano.name]);
  await step(t('cli.demo5'), ['comment', '--name', 'Jordan', '--school', t('cli.demoSchool', { city: plano.name }), '--city', plano.name, '--topic', 'parks-recreation', '--ask', t('cli.demoAsk')]);
  ctx.out(`\n${c.green(t('cli.demoDone'))} ${t('cli.demoSetup', { cmd: c.cyan(`${CMD} setup`) })}`);
  return 0;
}

const RUNNERS = {
  topics: cmdTopics,
  cities: cmdCities,
  city: cmdCity,
  speak: cmdSpeak,
  meetings: cmdMeetings,
  agenda: cmdAgenda,
  youth: cmdYouth,
  prefs: cmdPrefs,
  setup: cmdSetup,
  match: cmdMatch,
  map: cmdMap,
  stats: cmdStats,
  news: cmdNews,
  explain: cmdExplain,
  comment: cmdComment,
  learn: cmdLearn,
  demo: cmdDemo,
};

function globalOptionLines() {
  const rows = [
    ['--json', t('cli.jsonOpt')],
    ['--today', t('cli.todayOpt')],
    ['--lang', t('cli.langOpt', { codes: offeredLocales(getLocale()).map((l) => l.code).join(', ') })],
    ['--no-color', t('cli.noColorOpt')],
    ['-h, --help', t('cli.helpOpt', { cmd: CMD })],
    ['--version', t('cli.versionOpt')],
  ];
  const width = Math.max(...rows.map(([k]) => k.length)) + 2;
  return rows.map(([k, v]) => `  ${c.cyan(k.padEnd(width))}${wrapText(v, WIDTH - width - 2, width + 2).trimStart()}`);
}

/** The command list as data, for `agora help --json`. */
function helpData() {
  return {
    version: readVersion(),
    commands: COMMANDS.map((x) => ({ name: x.name, group: x.group, description: t(`cli.commands.${x.name}`), usage: `${CMD} ${x.name}${x.hint ? ` ${x.hint}` : ''}`, options: x.flags })),
    globalOptions: GLOBAL_FLAGS,
  };
}

/** The full help screen, or one command's usage when `name` is a command. */
function help(name) {
  const command = COMMANDS.find((x) => x.name === name && x.name !== 'help');
  if (command) {
    return [
      heading(`${CMD} ${command.name}`),
      wrapText(t(`cli.commands.${command.name}`), WIDTH),
      '',
      c.bold(t('cli.usage')),
      wrapText(`${CMD} ${command.name}${command.hint ? ` ${command.hint}` : ''}`, WIDTH - 2, 2),
      '',
      c.bold(t('cli.globalOptions')),
      ...globalOptionLines(),
    ].join('\n');
  }
  const width = Math.max(...COMMAND_NAMES.map((n) => n.length)) + 2;
  const lines = [heading(`${BRAND.name}: ${BRAND.tagline}`), wrapText(BRAND.shortDescription, WIDTH), '', c.bold(t('cli.usage')), `  ${t('cli.usageLine', { cmd: CMD })}`];
  for (const group of GROUPS) {
    lines.push('', c.bold(t(`cli.groups.${group}`)));
    for (const x of COMMANDS.filter((y) => y.group === group)) lines.push(`  ${c.cyan(x.name.padEnd(width))}${wrapText(t(`cli.commands.${x.name}`), WIDTH - width - 2, width + 2).trimStart()}`);
  }
  lines.push('', c.bold(t('cli.globalOptions')), ...globalOptionLines(), '', c.dim(wrapText(t('cli.prefsFileNote', { path: PREFS_PATH }), WIDTH)), '', c.dim(wrapText(BRAND.nonpartisanNote, WIDTH)));
  return lines.join('\n');
}
