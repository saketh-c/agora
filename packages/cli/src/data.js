/**
 * The CLI's view of the engine: city data for one language, and wrappers around the
 * schedule functions that keep the schedule the same in every language.
 *
 * Newer engine features (agendaFor, calendarThrough, hasEnded, CITY_SOURCE_FIELDS) are
 * looked up on the module namespace, so this file works with engine versions that have them
 * and with older ones that do not.
 */
import * as core from '@agora/core';
import { loadCities, loadTranslations } from '@agora/core/node';
import { suggest } from './args.js';

const { addDays, isDateStr, t } = core;

/**
 * Find a city by id or name, accepting a unique prefix or substring ("fort" finds Fort
 * Worth). Unlike a first-match search, an ambiguous query ("park" fits Highland Park and
 * University Park, "a" fits a dozen cities) returns the candidates instead of quietly
 * picking the first one, and a near miss ("Plno") offers the closest name.
 * @returns {{city: object | null, candidates: object[]}}
 */
export function matchCity(cities, query) {
  const q = String(query ?? '')
    .trim()
    .toLowerCase();
  if (!q) return { city: null, candidates: [] };
  const slug = q.replace(/[^a-z0-9]+/g, '-');
  const exact = cities.find((x) => x.cityId === slug || x.name.toLowerCase() === q);
  if (exact) return { city: exact, candidates: [] };
  const initials = (name) =>
    name
      .split(/[\s-]+/)
      .filter(Boolean)
      .map((w) => w[0])
      .join('');
  for (const fits of [(name) => name.startsWith(q), (name) => /^[a-z]{2,4}$/.test(q) && name.includes(' ') && initials(name) === q, (name) => name.includes(q)]) {
    const hits = cities.filter((x) => fits(x.name.toLowerCase()));
    if (hits.length === 1) return { city: hits[0], candidates: [] };
    if (hits.length > 1) return { city: null, candidates: hits };
  }
  const near = suggest(q, cities.map((x) => x.name));
  return { city: null, candidates: near ? cities.filter((x) => x.name === near) : [] };
}

/**
 * Load the cities for one language.
 *
 * The schedule engine reads the English wording of schedule exceptions ("moved to Monday,
 * Nov. 2", "6 p.m.") to place moved and special meetings. Translating those notes before
 * expansion made Spanish and Vietnamese users see different meetings (Garland lost its
 * Nov 2 regular meeting, The Colony moved to 6:30 AM). The engine now keeps each translated
 * note's English original next to it and parses that. With an older engine that does not,
 * the notes are put back in English here, and localizeOccurrence translates them for display
 * after expansion. Either way the schedule is the same in every language.
 * @returns {{cities: object[], strings: Record<string, string> | null}}
 */
export function loadData(lang) {
  const raw = loadCities();
  const strings = loadTranslations(lang);
  if (!strings) return { cities: raw, strings: null };
  const localized = core.localizeCities(raw, strings);
  // An engine that keeps each translated note's English original next to it (noteSource)
  // already parses that; only older engines need the notes put back in English.
  if (engineReadsSources()) return { cities: localized, strings };
  const byId = new Map(raw.map((city) => [city.cityId, city]));
  return { cities: localized.map((city) => keepExceptionSource(city, byId.get(city.cityId))), strings };
}

function engineReadsSources() {
  const fields = core.CITY_SOURCE_FIELDS;
  return Boolean(fields && Array.isArray(fields.scheduleExceptions) && fields.scheduleExceptions.includes('note'));
}

function keepExceptionSource(city, source) {
  const list = city && city.scheduleExceptions;
  const english = source && source.scheduleExceptions;
  if (!Array.isArray(list) || !Array.isArray(english) || list.length !== english.length) return city;
  return { ...city, scheduleExceptions: list.map((ex, i) => ({ ...ex, note: english[i].note })) };
}

const has = (strings, s) => typeof s === 'string' && Object.prototype.hasOwnProperty.call(strings, s);

/** Rule labels per city, to tell a real meeting name from one the engine cut out of a note. */
const ruleLabelCache = new WeakMap();
function ruleLabels(city) {
  if (!city) return new Set();
  let set = ruleLabelCache.get(city);
  if (!set) {
    set = new Set((city.meetings || []).map((m) => m.label).filter(Boolean));
    ruleLabelCache.set(city, set);
  }
  return set;
}

/**
 * Translate the display text of one meeting occurrence (label, note, agenda items) with the
 * translation memory. Text that is already translated, or that the engine generated in the
 * active language, has no entry in the memory and passes through unchanged.
 * A special meeting the engine titled with the start of an English note gets the generic
 * "Special meeting" title in the active language instead of a half-English one.
 */
export function localizeOccurrence(occ, { strings, cityById } = {}) {
  if (!occ || !strings) return occ;
  const tr = (s) => (has(strings, s) ? strings[s] : s);
  let label = tr(occ.label);
  const city = cityById ? cityById.get(occ.cityId) : null;
  if (label === occ.label && occ.type === 'other' && occ.status === 'special' && has(strings, occ.note) && !has(strings, occ.label) && !ruleLabels(city).has(occ.label)) {
    label = t('schedule.specialMeeting');
  }
  const out = { ...occ, label, note: tr(occ.note) };
  if (Array.isArray(occ.agendaItems)) out.agendaItems = occ.agendaItems.map((a) => ({ ...a, title: tr(a.title), summary: tr(a.summary) }));
  if (Array.isArray(occ.matchedItems)) out.matchedItems = occ.matchedItems.map((a) => ({ ...a, title: tr(a.title), summary: tr(a.summary) }));
  return out;
}

/**
 * Bind the schedule functions to one loaded data set.
 * @param {{cities: object[], strings: object | null}} data from loadData
 * @param {{now?: string}} [opts] the current instant (ISO). When set, meetings that already
 *   ended today are left out, so a 9 AM meeting is not "next" at 8 PM. Leave it unset when
 *   the user picked a day with --today, since a pretend date has no time of day.
 */
export function engine({ cities, strings }, { now } = {}) {
  const cityById = new Map(cities.map((city) => [city.cityId, city]));
  const loc = (o) => localizeOccurrence(o, { strings, cityById });
  const ended = (o) => Boolean(now && typeof core.hasEnded === 'function' && core.hasEnded(o, now));
  return {
    cities,
    strings,
    cityById,
    now,
    expand: (city, from, to) =>
      core
        .expandCityMeetings(city, from, to)
        .filter((o) => !ended(o))
        .map(loc),
    upcoming: (opts) =>
      core
        .upcomingMeetings(cities, { ...opts, now })
        .filter((o) => !ended(o))
        .map(loc),
    next: (city, from, opts) => {
      const o = core.nextMeetingFor(city, from, { ...opts, now });
      return o && !ended(o) ? loc(o) : null;
    },
    plan: (prefs, opts) => {
      const plan = core.buildPlan(cities, prefs, { ...opts, now });
      return { ...plan, meetings: plan.meetings.filter((o) => !ended(o)).map(loc) };
    },
  };
}

/**
 * Agenda items of one city split into upcoming ones (meeting today or later, or not dated)
 * and recent ones (meeting already happened), newest first. Agenda data goes stale between
 * refreshes, and showing September items as "on the agenda" in October misled students.
 * Uses the engine's agendaFor(city, today) when it exists and returns that shape.
 * @returns {{upcoming: object[], recent: object[]}}
 */
export function splitAgenda(city, today) {
  if (typeof core.agendaFor === 'function') {
    try {
      const r = core.agendaFor(city, today);
      const recent = r && (Array.isArray(r.recent) ? r.recent : Array.isArray(r.past) ? r.past : null);
      if (r && Array.isArray(r.upcoming) && recent) return { upcoming: r.upcoming, recent };
    } catch {
      // Fall back to the local split below.
    }
  }
  const upcoming = [];
  const recent = [];
  for (const item of (city && city.agendaItems) || []) {
    if (isDateStr(item.meetingDate) && item.meetingDate < today) recent.push(item);
    else upcoming.push(item);
  }
  upcoming.sort((a, b) => String(a.meetingDate || '9').localeCompare(String(b.meetingDate || '9')));
  recent.sort((a, b) => String(b.meetingDate).localeCompare(String(a.meetingDate)));
  return { upcoming, recent };
}

/**
 * The last date a city has published meetings for, when its calendar is a list of dates
 * that runs out (Fort Worth, Arlington, Irving and Denton publish through mid-December).
 * Null when any rule repeats on its own (2nd and 4th Mondays never run out).
 * Uses the engine's calendarThrough(city) when it exists.
 */
export function calendarEnd(city) {
  if (typeof core.calendarThrough === 'function') {
    try {
      const d = core.calendarThrough(city);
      if (d === null || isDateStr(d)) return d;
    } catch {
      // Fall back to reading the rules below.
    }
  }
  let last = null;
  for (const rule of (city && city.meetings) || []) {
    const rec = rule.recurrence || {};
    if (rec.kind !== 'custom') return null;
    for (const d of rec.dates || []) if (isDateStr(d) && (!last || d > last)) last = d;
  }
  return last;
}

/**
 * Why a city has no meeting in a window: its published calendar ends before the window does
 * (returns that date), or nothing is planned (returns null).
 */
export function calendarGap(city, today, horizonDays = 90) {
  const end = calendarEnd(city);
  return end && end < addDays(today, horizonDays) ? end : null;
}

/** Remote comment as one of three states: 'yes', 'no', or 'unknown' when the city has not said. */
export function remoteState(city) {
  const v = city && city.publicComment ? city.publicComment.virtualAllowed : undefined;
  return v === true ? 'yes' : v === false ? 'no' : 'unknown';
}
