/**
 * The Meetings page's filters as pure functions, so they can be tested in Node
 * (test/meetingFilters.test.js) and shared by the list, the map and the empty states.
 *
 * A filter state `f`:
 *   { q, when, from, to, dow, time, after, speak, remote, miles, near, pt, topics, counties, cities, sort }
 *  - when: a preset (WHEN) or 'custom' with from/to dates ('YYYY-MM-DD', either may be '').
 *  - dow: weekdays, 0 = Sunday. time: TIMES. miles: a number or null (any distance).
 *  - near: where distance is measured from: 'home' | 'school' | 'here' | 'pt' (a looked-up
 *    point in `pt`: { lat, lng, label }) | a covered city id.
 *  - counties (lowercase county names) and cities (ids) together say "in these places" (OR).
 *
 * Every filter is combined with AND. The URL holds only what differs from the profile's
 * defaults, so a link stays short and the saved copy follows later profile changes.
 */
import { addDays, daysBetween, daysInMonth, getLocale, hourOf, isDateStr, isTopicId, monthNames, monthShortNames, parseDate, searchFold, t, toDateStr, weekdayNames, weekdayOf, weekdayShortNames } from '@agora/core';

export const WHEN = Object.freeze(['today', 'tomorrow', 'weekend', 'week', '2weeks', 'month', '3months']);
export const DEFAULT_WHEN = '2weeks';
/** The furthest a custom range may reach. Most councils publish a few months ahead at most. */
export const MAX_DAYS_AHEAD = 180;
export const MILE_STEPS = Object.freeze([5, 10, 15, 25, 40, 60]);
export const TIMES = Object.freeze(['morning', 'afternoon', 'evening']);
export const DOW = Object.freeze(['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat']);
/** Weekdays in the order the chips show them: Monday first, the way meetings are planned. */
export const WEEK_ORDER = Object.freeze([1, 2, 3, 4, 5, 6, 0]);
export const SORTS = Object.freeze(['best', 'soonest', 'nearest']);
/** URL keys that are filters (a URL with none of them may be filled from the saved copy). */
export const FILTER_KEYS = Object.freeze(['q', 'when', 'from', 'to', 'days', 'dow', 'time', 'after', 'speak', 'remote', 'miles', 'near', 'at', 'atl', 'topics', 'county', 'cities', 'sort', 'view']);

/**
 * Search folding (core's searchFold): case, Latin accents, đ and full-width letters never stop
 * a match, while the marks Devanagari, Telugu and Arabic need stay; Arabic alef forms are unified.
 */
export const fold = (s) => searchFold(s);

const uniq = (xs) => [...new Set(xs)];

/** The inclusive date range a filter state covers, never before today and at most MAX_DAYS_AHEAD out. */
export function dateWindow(f, today) {
  const wd = weekdayOf(today);
  switch (f && f.when) {
    case 'today':
      return { from: today, to: today };
    case 'tomorrow': {
      const d = addDays(today, 1);
      return { from: d, to: d };
    }
    case 'weekend': {
      // Saturday and Sunday; on a Sunday, what is left of this weekend is today.
      if (wd === 0) return { from: today, to: today };
      const sat = addDays(today, 6 - wd);
      return { from: wd === 6 ? today : sat, to: addDays(sat, 1) };
    }
    case 'week':
      // A US calendar week ends on Saturday.
      return { from: today, to: addDays(today, 6 - wd) };
    case 'month': {
      const { y, m } = parseDate(today);
      return { from: today, to: toDateStr(y, m, daysInMonth(y, m)) };
    }
    case '3months':
      return { from: today, to: addDays(today, 89) };
    case 'custom': {
      const max = addDays(today, MAX_DAYS_AHEAD);
      let from = isDateStr(f.from) ? f.from : today;
      let to = isDateStr(f.to) ? f.to : addDays(from, 13);
      if (from < today) from = today;
      if (from > max) from = max;
      if (to < from) to = from;
      if (to > max) to = max;
      return { from, to };
    }
    default:
      return { from: today, to: addDays(today, 13) };
  }
}

/** Number of calendar days in a window (for upcomingMeetings' `days`). */
export function windowDays(win) {
  return daysBetween(win.from, win.to) + 1;
}

/** 'morning' (before noon) | 'afternoon' (noon to 5 PM) | 'evening' (5 PM or later). */
export function timeOfDay(time) {
  const h = hourOf(time);
  return h < 12 ? 'morning' : h < 17 ? 'afternoon' : 'evening';
}

/** Same rule as components/ui/meetingInfo.js schoolTiming (kept here so this file runs in Node). */
export function schoolTimingOf(m) {
  if (!m) return 'after';
  if (m.weekday === 0 || m.weekday === 6) return 'weekend';
  if (m.isSchoolHours) return 'during';
  if (m.time && m.time < '07:30') return 'before';
  return 'after';
}

export const countyKey = (name) => fold(name).replace(/\s+county$/, '');

const listParam = (params, key) =>
  (params.get(key) || '')
    .split(',')
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);

function readPoint(params) {
  const m = /^(-?\d{1,2}(?:\.\d+)?),(-?\d{1,3}(?:\.\d+)?)$/.exec(String(params.get('at') || '').replace(/\s+/g, ''));
  if (!m) return null;
  const lat = Number(m[1]);
  const lng = Number(m[2]);
  if (!(Math.abs(lat) <= 90 && Math.abs(lng) <= 180)) return null;
  return { lat, lng, label: String(params.get('atl') || '').slice(0, 80) };
}

/** True when a custom range ended before today (a missing end is the start plus two weeks). */
export function isPastRange(from, to, today) {
  const end = isDateStr(to) ? to : isDateStr(from) ? addDays(from, 13) : null;
  return Boolean(end && today && end < today);
}

/**
 * Filters from URL search params. `defaults` = { when, after, speak, remote, miles, near, sort };
 * `ctx` = { today, cityIds: Set, counties: Set (countyKey) } validates ids.
 */
export function readFilters(params, defaults, ctx = {}) {
  const today = ctx.today;
  const flag = (key, fallback) => (params.has(key) ? params.get(key) === '1' : fallback);

  let when = params.get('when');
  let from = '';
  let to = '';
  if (!WHEN.includes(when) && when !== 'custom') when = null;
  const pf = params.get('from');
  const pt = params.get('to');
  if (isDateStr(pf) || isDateStr(pt)) {
    when = 'custom';
    from = isDateStr(pf) ? pf : '';
    to = isDateStr(pt) ? pt : '';
  }
  // A range that is over (a remembered or old shared one) would shrink to today alone and
  // show nothing: the default window takes its place.
  if (when === 'custom' && today && isPastRange(from, to, today)) {
    when = null;
    from = '';
    to = '';
  }
  if (!when && params.has('days')) {
    // Links from before date presets: ?days=7|14|30.
    const days = Number(params.get('days'));
    if (days === 14) when = '2weeks';
    else if (Number.isInteger(days) && days >= 1 && days <= MAX_DAYS_AHEAD && today) {
      when = 'custom';
      from = today;
      to = addDays(today, days - 1);
    }
  }

  const rawMiles = params.get('miles');
  const n = Number(rawMiles);
  const miles = rawMiles === 'any' ? null : rawMiles != null && Number.isFinite(n) && n > 0 && n <= 500 ? n : defaults.miles;

  let near = params.get('near') || defaults.near;
  const point = near === 'pt' ? readPoint(params) : null;
  if (near === 'pt' && !point) near = defaults.near;
  const validNear = (v) => v === 'home' || v === 'school' || v === 'here' || v === 'pt' || (ctx.cityIds ? ctx.cityIds.has(v) : Boolean(v));
  if (!validNear(near)) near = defaults.near;

  const sort = params.get('sort');
  return {
    q: params.get('q') || '',
    when: when || defaults.when || DEFAULT_WHEN,
    from,
    to,
    dow: WEEK_ORDER.filter((i) => listParam(params, 'dow').includes(DOW[i])),
    time: TIMES.filter((x) => listParam(params, 'time').includes(x)),
    after: flag('after', defaults.after),
    speak: flag('speak', defaults.speak),
    remote: flag('remote', Boolean(defaults.remote)),
    miles,
    near: near || null,
    pt: point,
    topics: uniq(listParam(params, 'topics').filter(isTopicId)),
    counties: uniq(listParam(params, 'county').filter((c) => !ctx.counties || ctx.counties.has(c))),
    cities: uniq(listParam(params, 'cities').filter((c) => !ctx.cityIds || ctx.cityIds.has(c))),
    sort: SORTS.includes(sort) ? sort : defaults.sort,
  };
}

/** Write a filter state into URL search params (mutates `params`), keeping only what differs from `defaults`. */
export function writeFilters(params, f, defaults) {
  const put = (key, value, omit) => (omit ? params.delete(key) : params.set(key, value));
  put('q', f.q, !f.q);
  params.delete('days');
  if (f.when === 'custom') {
    params.set('when', 'custom');
    put('from', f.from, !isDateStr(f.from));
    put('to', f.to, !isDateStr(f.to));
  } else {
    params.delete('from');
    params.delete('to');
    put('when', f.when, f.when === (defaults.when || DEFAULT_WHEN));
  }
  put('dow', f.dow.map((i) => DOW[i]).join(','), !f.dow.length);
  put('time', f.time.join(','), !f.time.length);
  put('after', f.after ? '1' : '0', f.after === defaults.after);
  put('speak', f.speak ? '1' : '0', f.speak === defaults.speak);
  put('remote', f.remote ? '1' : '0', f.remote === Boolean(defaults.remote));
  put('miles', f.miles == null ? 'any' : String(f.miles), f.miles === defaults.miles || (f.miles == null && defaults.miles == null));
  put('near', f.near || '', !f.near || f.near === defaults.near);
  if (f.near === 'pt' && f.pt) {
    params.set('at', `${round3(f.pt.lat)},${round3(f.pt.lng)}`);
    put('atl', f.pt.label || '', !f.pt.label);
  } else {
    params.delete('at');
    params.delete('atl');
  }
  put('topics', f.topics.join(','), !f.topics.length);
  put('county', f.counties.join(','), !f.counties.length);
  put('cities', f.cities.join(','), !f.cities.length);
  put('sort', f.sort, f.sort === defaults.sort);
  return params;
}

export const round3 = (x) => Math.round(Number(x) * 1000) / 1000;

/**
 * The active filters, one entry per removable chip, in display order:
 * 'when', 'dow', 'time', 'after', 'speak', 'remote', 'miles', 'topic:<id>', 'county:<name>', 'city:<id>'.
 * Used for the removable chips and the ways out of an empty list (the Filters button counts
 * changedKeys instead). The date window counts only when it is not the default two weeks;
 * distance counts only when there is somewhere to measure from.
 */
export function activeKeys(f, { hasOrigin = true } = {}) {
  const keys = [];
  if (f.when !== DEFAULT_WHEN) keys.push('when');
  if (f.dow.length) keys.push('dow');
  if (f.time.length) keys.push('time');
  if (f.after) keys.push('after');
  if (f.speak) keys.push('speak');
  if (f.remote) keys.push('remote');
  if (f.miles != null && hasOrigin) keys.push('miles');
  for (const id of f.topics) keys.push(`topic:${id}`);
  for (const c of f.counties) keys.push(`county:${c}`);
  for (const c of f.cities) keys.push(`city:${c}`);
  return keys;
}

/**
 * The filters that differ from the profile's defaults: the number on the Filters button and what
 * a screen reader hears ("Filters, 2 on"), so a student who changed nothing sees no number. The
 * same entries as activeKeys, except that 'after', 'speak' and 'remote' count when they differ
 * from the default (on or off), and 'miles' when the limit, or where it is measured from,
 * changed. `defaults` is what readFilters got.
 */
export function changedKeys(f, defaults, { hasOrigin = true } = {}) {
  const d = defaults || {};
  const keys = [];
  if (f.when !== (d.when || DEFAULT_WHEN)) keys.push('when');
  if (f.dow.length) keys.push('dow');
  if (f.time.length) keys.push('time');
  if (f.after !== Boolean(d.after)) keys.push('after');
  if (f.speak !== Boolean(d.speak)) keys.push('speak');
  if (f.remote !== Boolean(d.remote)) keys.push('remote');
  const limit = d.miles == null ? null : d.miles;
  if (hasOrigin && (f.miles !== limit || (f.miles != null && (f.near || null) !== (d.near || null)))) keys.push('miles');
  for (const id of f.topics) keys.push(`topic:${id}`);
  for (const c of f.counties) keys.push(`county:${c}`);
  for (const c of f.cities) keys.push(`city:${c}`);
  return keys;
}

/** The state with one filter (an activeKeys entry) removed. Removing 'when' widens to the default window. */
export function withoutKey(f, key) {
  const [kind, id] = key.split(/:(.*)/s);
  switch (kind) {
    case 'when':
      return { ...f, when: f.when === DEFAULT_WHEN ? '3months' : DEFAULT_WHEN, from: '', to: '' };
    case 'dow':
      return { ...f, dow: [] };
    case 'time':
      return { ...f, time: [] };
    case 'after':
    case 'speak':
    case 'remote':
      return { ...f, [kind]: false };
    case 'miles':
      return { ...f, miles: null };
    case 'topic':
      return { ...f, topics: f.topics.filter((x) => x !== id) };
    case 'county':
      return { ...f, counties: f.counties.filter((x) => x !== id) };
    case 'city':
      return { ...f, cities: f.cities.filter((x) => x !== id) };
    default:
      return f;
  }
}

/** Every filter off: the default window, no day, time, speaking, distance, topic or place limits. Keeps search, origin and sort. */
export function clearFilters(f) {
  return { ...f, when: DEFAULT_WHEN, from: '', to: '', dow: [], time: [], after: false, speak: false, remote: false, miles: null, topics: [], counties: [], cities: [] };
}

/** The distance choices: the scale plus any other value in play (a saved or linked one). */
export function mileChoices(...extra) {
  const nums = extra.map(Number).filter((n) => Number.isFinite(n) && n > 0);
  return uniq([...MILE_STEPS, ...nums]).sort((a, b) => a - b);
}

// ---------------------------------------------------------------------------------------------
// Search: cities, counties, topics, meeting names, weekdays and dates in one box.

const ENGLISH_WEEKDAYS = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
const ENGLISH_WEEKDAY_SHORT = [['sun'], ['mon'], ['tue', 'tues'], ['wed'], ['thu', 'thur', 'thurs'], ['fri'], ['sat']];
const ENGLISH_MONTHS = ['january', 'february', 'march', 'april', 'may', 'june', 'july', 'august', 'september', 'october', 'november', 'december'];
const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const splitWords = (s) =>
  String(s || '')
    .split('|')
    .map(fold)
    .filter(Boolean);

/**
 * The words search understands, in English and the app language: weekday and month names,
 * today / tomorrow / this weekend, and the word for county. Built from the dictionaries
 * (format.*, meetings.searchWords.*), so a new language brings its own words.
 */
export function queryVocab(locale = getLocale()) {
  const langs = uniq(['en', locale]);
  const weekdays = ENGLISH_WEEKDAYS.map((w, i) => [w, `${w}s`, ...ENGLISH_WEEKDAY_SHORT[i]]);
  const months = ENGLISH_MONTHS.map((m) => [m, m.slice(0, 3)]);
  months[8].push('sept');
  const words = { today: [], tomorrow: [], weekend: [], county: [] };
  for (const lang of langs) {
    const long = weekdayNames(lang);
    const short = weekdayShortNames(lang);
    long.forEach((w, i) => weekdays[i].push(fold(w)));
    // Short names only when they are a real word (not "T2" or a month abbreviation such as "mar").
    short.forEach((w, i) => {
      const s = fold(w);
      if (s.length >= 3 && /^[a-z]+$/.test(s)) weekdays[i].push(s);
    });
    monthNames(lang).forEach((m, i) => months[i].push(fold(m)));
    monthShortNames(lang).forEach((m, i) => months[i].push(fold(m).replace(/[.\u0970]$/, '')));
    for (const k of Object.keys(words)) words[k].push(...splitWords(t(`meetings.searchWords.${k}`, undefined, lang)));
  }
  const monthWords = new Set(months.flat());
  return {
    // A short weekday that is also a month abbreviation ("mar") is left to the month.
    weekdays: weekdays.map((list) => uniq(list.filter((w) => w.length > 3 || !monthWords.has(w)))),
    months: months.map(uniq),
    today: uniq(words.today),
    tomorrow: uniq(words.tomorrow),
    weekend: uniq(words.weekend),
    county: uniq(words.county),
  };
}

/** A month and day (and maybe a year) as the next such date on or after today. */
function resolveMonthDay(month, day, year, today) {
  if (!(month >= 1 && month <= 12 && day >= 1 && day <= 31)) return null;
  const { y } = parseDate(today);
  let yy = year ? Number(year) : y;
  if (yy < 100) yy += 2000;
  if (day > daysInMonth(yy, month)) return null;
  let d = toDateStr(yy, month, day);
  if (!year && d < today) d = toDateStr(yy + 1, month, Math.min(day, daysInMonth(yy + 1, month)));
  return d;
}

/** Longest phrases first, as one global alternation that only matches whole words. */
function phraseRe(phrases) {
  const list = [...new Set(phrases)].filter(Boolean).sort((a, b) => b.length - a.length).map(escapeRe);
  return list.length ? new RegExp(`(?<![\\p{L}\\p{N}])(?:${list.join('|')})(?![\\p{L}\\p{N}])`, 'gu') : null;
}

/** test() on a global regex, from the start every time. */
function found(re, text) {
  if (!re) return false;
  re.lastIndex = 0;
  const hit = re.test(text);
  re.lastIndex = 0;
  return hit;
}

function matchCityText(n, cities) {
  const words = (s) => fold(s).split(/[\s,/-]+/);
  let hits = cities.filter((c) => c.cityId === n || fold(c.name).startsWith(n) || words(c.name).some((w) => w.startsWith(n)));
  if (!hits.length) {
    const bare = n.replace(/\s+/g, '');
    hits = cities.filter((c) => {
      const w = words(c.name);
      return (w.length > 1 && bare.length > 1 && w.map((x) => x[0]).join('').startsWith(bare)) || (n.length >= 3 && fold(c.name).includes(n)) || countyKey(c.county).startsWith(n);
    });
  }
  return hits.map((c) => c.cityId);
}

function matchTopicText(n, topics) {
  if (n.length < 3) return [];
  const words = (s) => fold(s).split(/[\s,/-]+/);
  return topics
    .filter((tp) => words(tp.label).some((w) => w.startsWith(n)) || (n.length >= 4 && fold(tp.label).includes(n)) || fold(tp.short).startsWith(n) || (tp.keywords || []).some((k) => fold(k).startsWith(n)))
    .map((tp) => tp.id);
}

/**
 * What a search box query means. Returns null for an empty query, otherwise
 *   { text, weekdays: Set<0..6>, dates: Set<'YYYY-MM-DD'> | null, dateWord: 'today'|'tomorrow'|'weekend'|null,
 *     counties: Set<countyKey>, countyHint, terms: [{ text, cityIds: Set, topicIds: [] }] }
 * Every part must hold (AND); inside a term a city, a topic on a recent agenda or the meeting's
 * own name may match (OR). "dallas county tuesday", "plano parks", "oct 20" and "work session"
 * all work. `ctx` = { cities, topics, today, vocab }.
 */
export function parseQuery(raw, { cities = [], topics = [], today, vocab = queryVocab() } = {}) {
  let text = fold(raw);
  if (!text) return null;
  const out = { text, weekdays: new Set(), dates: null, dateWord: null, counties: new Set(), countyHint: null, terms: [] };
  const addDate = (d) => {
    if (!d) return;
    out.dates = out.dates || new Set();
    out.dates.add(d);
  };

  // Numeric dates: 10/20, 10/20/2026.
  text = text.replace(/(?<!\d)(\d{1,2})\/(\d{1,2})(?:\/(\d{2,4}))?(?!\d)/g, (all, m, d, y) => {
    const date = today ? resolveMonthDay(Number(m), Number(d), y, today) : null;
    if (!date) return all;
    addDate(date);
    return ' ';
  });

  // Month names with a day: "oct 20", "october 20th", "20 de octubre", "20 thang 10".
  const monthIndex = new Map();
  vocab.months.forEach((list, i) => list.forEach((w) => monthIndex.set(w, i + 1)));
  const monthAlt = [...monthIndex.keys()].sort((a, b) => b.length - a.length).map(escapeRe).join('|');
  if (monthAlt && today) {
    const md = new RegExp(`(?<![\\p{L}\\p{N}])(${monthAlt})\\.? (\\d{1,2})(?:st|nd|rd|th)?(?:,? (\\d{4}))?(?![\\p{L}\\p{N}])`, 'gu');
    text = text.replace(md, (all, mon, d, y) => {
      const date = resolveMonthDay(monthIndex.get(mon), Number(d), y, today);
      if (!date) return all;
      addDate(date);
      return ' ';
    });
    const dm = new RegExp(`(?<![\\p{L}\\p{N}])(\\d{1,2}) (?:de )?(${monthAlt})(?![\\p{L}\\p{N}])`, 'gu');
    text = text.replace(dm, (all, d, mon) => {
      const date = resolveMonthDay(monthIndex.get(mon), Number(d), null, today);
      if (!date) return all;
      addDate(date);
      return ' ';
    });
  }

  // Today, tomorrow, this weekend.
  if (today) {
    const weekendRe = phraseRe(vocab.weekend);
    if (found(weekendRe, text)) {
      text = text.replace(weekendRe, ' ');
      const win = dateWindow({ when: 'weekend' }, today);
      for (let d = win.from; d <= win.to; d = addDays(d, 1)) addDate(d);
      out.dateWord = 'weekend';
    }
    const tomorrowRe = phraseRe(vocab.tomorrow);
    if (found(tomorrowRe, text)) {
      text = text.replace(tomorrowRe, ' ');
      addDate(addDays(today, 1));
      out.dateWord = out.dateWord ? null : 'tomorrow';
    }
    const todayRe = phraseRe(vocab.today);
    if (found(todayRe, text)) {
      text = text.replace(todayRe, ' ');
      addDate(today);
      out.dateWord = out.dateWord ? null : 'today';
    }
  }

  // Weekdays: "tuesday", "tuesdays", "tue", "martes", "thu ba".
  vocab.weekdays.forEach((list, i) => {
    const re = phraseRe(list);
    if (found(re, text)) {
      out.weekdays.add(i);
      text = text.replace(re, ' ');
    }
  });

  // "Dallas County", "condado de Dallas", "quan Dallas".
  const countyNames = [...new Set(cities.map((c) => countyKey(c.county)))];
  const countyRe = phraseRe(vocab.county.flatMap((w) => [`${w} de`, `${w} of`, w]));
  if (found(countyRe, text)) {
    for (const name of countyNames) {
      const re = phraseRe([name]);
      if (found(re, text)) {
        out.counties.add(name);
        text = text.replace(re, ' ');
      }
    }
    if (out.counties.size) text = text.replace(countyRe, ' ');
  }

  const rest = text.replace(/\s+/g, ' ').trim();
  if (rest) {
    const whole = { text: rest, cityIds: new Set(matchCityText(rest, cities)), topicIds: matchTopicText(rest, topics) };
    const words = rest.split(' ').filter((w) => w.length > 1);
    if (whole.cityIds.size || whole.topicIds.length || words.length < 2) {
      out.terms.push(whole);
      // "dallas" is a city and a county: offer the county as a filter too.
      if (countyNames.includes(rest) && cities.some((c) => fold(c.name) === rest)) out.countyHint = rest;
    } else {
      // "plano parks": each word on its own (a city, a topic or part of a meeting's name).
      for (const w of words) out.terms.push({ text: w, cityIds: new Set(matchCityText(w, cities)), topicIds: matchTopicText(w, topics) });
    }
  }
  return out;
}

/**
 * True when a meeting matches a parsed query. `topicsAt(cityId)` returns the Set of topic ids
 * on that council's recent and upcoming agendas; `countyOf(cityId)` its countyKey.
 */
export function matchesQuery(m, query, { topicsAt, countyOf }) {
  if (!query) return true;
  if (query.weekdays.size && !query.weekdays.has(m.weekday)) return false;
  if (query.dates && !query.dates.has(m.date)) return false;
  if (query.counties.size && !query.counties.has(countyOf(m.cityId))) return false;
  for (const term of query.terms) {
    const byCity = term.cityIds.has(m.cityId);
    const byLabel = term.text.length >= 3 && fold(m.label).includes(term.text);
    const own = (m.agendaItems || []).flatMap((it) => it.topics || []);
    const byTopic = term.topicIds.some((id) => own.includes(id) || topicsAt(m.cityId).has(id));
    if (!byCity && !byLabel && !byTopic) return false;
  }
  return true;
}

/**
 * True when a meeting passes every filter and the search. `ctx` = { cityById, topicsAt,
 * countyOf, milesTo(cityId) -> number|null, hasOrigin, query }.
 */
export function passes(m, f, ctx) {
  const city = ctx.cityById(m.cityId);
  if (f.dow.length && !f.dow.includes(m.weekday)) return false;
  if (f.time.length && !f.time.includes(timeOfDay(m.time))) return false;
  if (f.after && !['after', 'weekend'].includes(schoolTimingOf(m))) return false;
  if (f.speak && !m.openToPublicComment) return false;
  if (f.remote && !(city && city.publicComment && city.publicComment.virtualAllowed === true)) return false;
  if (f.miles != null && ctx.hasOrigin) {
    const d = ctx.milesTo(m.cityId);
    if (!(d <= f.miles)) return false;
  }
  if (f.topics.length) {
    const own = (m.agendaItems || []).flatMap((it) => it.topics || []);
    if (!f.topics.some((id) => own.includes(id) || ctx.topicsAt(m.cityId).has(id))) return false;
  }
  if (f.counties.length || f.cities.length) {
    if (!f.cities.includes(m.cityId) && !f.counties.includes(ctx.countyOf(m.cityId))) return false;
  }
  return matchesQuery(m, ctx.query, ctx);
}

/**
 * Order a filtered list. 'soonest' keeps date order; 'nearest' sorts by distance (unknown last),
 * then date; 'best' sorts by `scoreOf(m)` and lets each council place at most `perCity`
 * meetings before the others, so the top of the list is not one city's calendar.
 */
export function sortMeetings(list, sort, { scoreOf, milesTo, perCity = 2 } = {}) {
  const byDate = (a, b) => a.date.localeCompare(b.date) || a.time.localeCompare(b.time) || a.cityName.localeCompare(b.cityName);
  if (sort === 'nearest' && milesTo) {
    const d = (m) => {
      const x = milesTo(m.cityId);
      return x == null ? Infinity : x;
    };
    return [...list].sort((a, b) => d(a) - d(b) || byDate(a, b));
  }
  if (sort !== 'best' || !scoreOf) return [...list].sort(byDate);
  const scored = list.map((m) => ({ m, s: scoreOf(m) }));
  scored.sort((a, b) => b.s - a.s || byDate(a.m, b.m));
  const first = [];
  const later = [];
  const seen = new Map();
  for (const { m } of scored) {
    const n = seen.get(m.cityId) || 0;
    (n < perCity ? first : later).push(m);
    seen.set(m.cityId, n + 1);
  }
  return [...first, ...later];
}

/**
 * Ways out of an empty or thin list: for each active filter, how many meetings would show
 * without it. Returns [{ key, count }] for the filters that would add meetings, biggest first.
 * `countFor(f)` counts the meetings a state shows (the window included).
 */
export function relaxations(f, keys, countFor) {
  const now = countFor(f);
  const out = [];
  for (const key of keys) {
    const n = countFor(withoutKey(f, key));
    if (n > now) out.push({ key, count: n - now });
  }
  return out.sort((a, b) => b.count - a.count);
}

/** Which filters stay longest when several must go at once: the student's own choices first, the date window and distance last. */
const KEEP_ORDER = ['speak', 'after', 'remote', 'topic', 'dow', 'time', 'county', 'city', 'miles', 'when'];

/**
 * When no single filter is enough (relaxations() found nothing), the fewest filters to give up
 * together so meetings show: from all of `keys` given up, each one is put back, in KEEP_ORDER,
 * whenever meetings still show without it. A city searched beyond the distance limit and past
 * the two-week window ("irving") gets one way out: wider window and no distance limit, with
 * Can speak and After school kept. Returns { keys, count } (keys in their given order) or
 * null when even giving up all of them shows nothing.
 */
export function relaxTogether(f, keys, countFor) {
  if (!keys.length || !countFor(keys.reduce(withoutKey, f))) return null;
  const rank = (k) => {
    const i = KEEP_ORDER.indexOf(k.split(':')[0]);
    return i < 0 ? KEEP_ORDER.length : i;
  };
  let drop = [...keys];
  for (const k of [...keys].sort((a, b) => rank(a) - rank(b))) {
    const fewer = drop.filter((x) => x !== k);
    if (countFor(fewer.reduce(withoutKey, f)) > 0) drop = fewer;
  }
  return { keys: drop, count: countFor(drop.reduce(withoutKey, f)) };
}
