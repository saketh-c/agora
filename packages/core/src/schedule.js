/**
 * Calendar math for council meetings.
 *
 * Every date is a 'YYYY-MM-DD' string and every time is 24-hour 'HH:MM' in Central Time.
 * All arithmetic goes through Date.UTC so results never depend on the machine's timezone.
 *
 * Schedules never depend on the display language. Callers often pass city records that were
 * already localized (see i18n/data.js), and a translated field keeps its English original next
 * to it as `<field>Source`. Everything the engine reads for meaning (the exception notes it
 * parses, the labels it builds meeting ids from and matches agenda items against) comes from
 * that English source; only display strings (labels, notes) follow the active locale.
 */

import { t, tList } from './i18n/index.js';

const DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/;
const TIME_RE = /^([01]\d|2[0-3]):([0-5]\d)$/;

/** Meetings with no published length are assumed to run this long (also the .ics default). */
export const DEFAULT_MEETING_MINUTES = 120;

/**
 * Exceptions can move a meeting into or out of a window from just outside it (an exception on
 * Nov 10 that moves the meeting to Nov 17), so expansion looks this many days past each edge.
 */
const EXCEPTION_REACH_DAYS = 45;

export function isDateStr(s) {
  const m = DATE_RE.exec(String(s || ''));
  if (!m) return false;
  const y = +m[1];
  const mo = +m[2];
  const d = +m[3];
  return mo >= 1 && mo <= 12 && d >= 1 && d <= daysInMonth(y, mo);
}

export function isTimeStr(s) {
  return TIME_RE.test(String(s || ''));
}

export function parseDate(s) {
  const m = DATE_RE.exec(String(s || ''));
  if (!m) throw new Error(`Invalid date: ${s}`);
  return { y: +m[1], m: +m[2], d: +m[3] };
}

export function toDateStr(y, m, d) {
  return `${String(y).padStart(4, '0')}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
}

function utcOf(s) {
  const { y, m, d } = parseDate(s);
  return Date.UTC(y, m - 1, d);
}

function fromUtc(ms) {
  const dt = new Date(ms);
  return toDateStr(dt.getUTCFullYear(), dt.getUTCMonth() + 1, dt.getUTCDate());
}

export function addDays(s, n) {
  return fromUtc(utcOf(s) + n * 86400000);
}

/** Whole days from a to b (positive when b is later). */
export function daysBetween(a, b) {
  return Math.round((utcOf(b) - utcOf(a)) / 86400000);
}

/**
 * Last date of a window of `days` calendar days that starts on (and includes) `from`, so a
 * "next 30 days" window holds exactly 30 dates. Fewer than one day counts as one.
 */
export function windowEnd(from, days) {
  const n = Math.max(1, Math.floor(Number(days)) || 1);
  return addDays(from, n - 1);
}

/** 0 = Sunday ... 6 = Saturday */
export function weekdayOf(s) {
  return new Date(utcOf(s)).getUTCDay();
}

export function daysInMonth(y, m) {
  return new Date(Date.UTC(y, m, 0)).getUTCDate();
}

/** Date of the nth (1..5) given weekday in a month, or null if the month has no such day. */
export function nthWeekdayOfMonth(y, m, weekday, n) {
  const firstWd = new Date(Date.UTC(y, m - 1, 1)).getUTCDay();
  const offset = (weekday - firstWd + 7) % 7;
  const day = 1 + offset + (n - 1) * 7;
  if (day > daysInMonth(y, m)) return null;
  return toDateStr(y, m, day);
}

export function compareDates(a, b) {
  return a < b ? -1 : a > b ? 1 : 0;
}

/** Read named parts so the result never depends on a locale's date pattern. */
function zonedParts(options, tz, now) {
  const parts = new Intl.DateTimeFormat('en-US', { timeZone: tz, ...options }).formatToParts(now);
  const out = {};
  for (const p of parts) if (p.type !== 'literal') out[p.type] = Number(p.value);
  return out;
}

/** Today's calendar date in a timezone (default Central). */
export function todayStr(tz = 'America/Chicago', now = new Date()) {
  const { year, month, day } = zonedParts({ year: 'numeric', month: '2-digit', day: '2-digit' }, tz, now);
  return toDateStr(year, month, day);
}

/** The wall-clock time ('HH:MM', 24-hour) in a timezone (default Central). */
export function nowTimeStr(tz = 'America/Chicago', now = new Date()) {
  const { hour, minute } = zonedParts({ hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }, tz, now);
  return `${String(hour % 24).padStart(2, '0')}:${String(minute).padStart(2, '0')}`;
}

/** US daylight saving time: second Sunday of March through first Sunday of November. */
export function isDst(dateStr) {
  const { y } = parseDate(dateStr);
  const start = nthWeekdayOfMonth(y, 3, 0, 2);
  const end = nthWeekdayOfMonth(y, 11, 0, 1);
  return dateStr >= start && dateStr < end;
}

export function centralOffset(dateStr) {
  return isDst(dateStr) ? '-05:00' : '-06:00';
}

export function toISO(dateStr, time = '00:00') {
  return `${dateStr}T${time}:00${centralOffset(dateStr)}`;
}

export function hourOf(time) {
  return Number(String(time || '00:00').split(':')[0]);
}

export function isEvening(time) {
  return hourOf(time) >= 17;
}

/** Weekday between 7:30 and 16:00: a student cannot attend without missing class. */
export function isSchoolHours(dateStr, time) {
  const wd = weekdayOf(dateStr);
  if (wd === 0 || wd === 6) return false;
  return time >= '07:30' && time < '16:00';
}

/** An instant in milliseconds from an ISO string, a Date, or epoch milliseconds; NaN otherwise. */
function instantOf(value) {
  if (value instanceof Date) return value.getTime();
  if (typeof value === 'number') return value;
  return value ? Date.parse(String(value)) : NaN;
}

/**
 * True when a meeting has already finished at `now` (an ISO string such as
 * '2026-10-14T20:00:00-05:00', a Date, or epoch ms): its start plus its length, or
 * DEFAULT_MEETING_MINUTES when the length is unknown. A meeting still in progress has not
 * ended. Without a valid `now` nothing has ended, so date-only callers keep today's meetings.
 */
export function hasEnded(occurrence, now) {
  const at = instantOf(now);
  if (!occurrence || !Number.isFinite(at)) return false;
  const start = Date.parse(occurrence.startISO);
  if (!Number.isFinite(start)) return false;
  return start + (occurrence.durationMinutes || DEFAULT_MEETING_MINUTES) * 60000 <= at;
}

const WEEKDAY_KINDS = new Set(['nth-weekday', 'weekly', 'biweekly']);

/**
 * Concrete dates for one recurrence rule within [from, to].
 * kinds: 'nth-weekday' | 'weekly' | 'biweekly' | 'custom'. A rule of an unknown kind, or a
 * weekday-based rule without a valid weekday, yields no dates instead of guessed ones.
 */
export function occurrencesForRule(rule, from, to) {
  if (!rule || !isDateStr(from) || !isDateStr(to) || from > to) return [];
  const weekday = Number(rule.weekday);
  if (WEEKDAY_KINDS.has(rule.kind) && !(Number.isInteger(weekday) && weekday >= 0 && weekday <= 6)) return [];
  const out = [];
  switch (rule.kind) {
    case 'custom': {
      for (const d of rule.dates || []) if (isDateStr(d) && d >= from && d <= to) out.push(d);
      break;
    }
    case 'weekly': {
      let d = addDays(from, (weekday - weekdayOf(from) + 7) % 7);
      while (d <= to) {
        out.push(d);
        d = addDays(d, 7);
      }
      break;
    }
    case 'biweekly': {
      const anchor = isDateStr(rule.anchorDate) ? rule.anchorDate : null;
      let d = addDays(from, (weekday - weekdayOf(from) + 7) % 7);
      while (d <= to) {
        if (!anchor || Math.abs(daysBetween(anchor, d)) % 14 === 0) out.push(d);
        d = addDays(d, 7);
      }
      break;
    }
    case 'nth-weekday': {
      const ords = (Array.isArray(rule.ordinals) && rule.ordinals.length ? rule.ordinals : [1]).map(Number).filter((n) => Number.isInteger(n) && n >= 1 && n <= 5);
      let { y, m } = parseDate(from);
      const end = parseDate(to);
      while (y < end.y || (y === end.y && m <= end.m)) {
        for (const n of ords) {
          const d = nthWeekdayOfMonth(y, m, weekday, n);
          if (d && d >= from && d <= to) out.push(d);
        }
        m += 1;
        if (m > 12) {
          m = 1;
          y += 1;
        }
      }
      break;
    }
    default:
      return [];
  }
  return [...new Set(out)].sort(compareDates);
}

function slug(s) {
  return String(s || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
}

/** The English text of a field on a record that may have been localized (see i18n/data.js). */
function sourceText(record, field) {
  if (!record) return undefined;
  const source = record[`${field}Source`];
  return typeof source === 'string' ? source : record[field];
}

/** Lowercase a note and drop the periods in "p.m." so they never end a sentence or clause. */
function plainNote(note) {
  return String(note || '')
    .toLowerCase()
    .replace(/\b([ap])\.\s?m\b\.?/g, '$1m');
}

// A range ("6:30 to 7:30 p.m.", "6-8 pm"), a single time with am/pm, or an unambiguous 24-hour time.
const TIME_TOKEN_RE = /\b(\d{1,2})(?::([0-5]\d))?\s*(am|pm)?\s*(?:to|until|-|–)\s*(\d{1,2})(?::([0-5]\d))?\s*(am|pm)\b|\b(\d{1,2})(?::([0-5]\d))?\s*(am|pm)\b|\b(1[3-9]|2[0-3]):([0-5]\d)\b/g;

function to24(h, mm, ap) {
  let hour = Number(h);
  if (ap) {
    if (hour < 1 || hour > 12) return null;
    if (ap === 'pm' && hour < 12) hour += 12;
    if (ap === 'am' && hour === 12) hour = 0;
  }
  if (!Number.isInteger(hour) || hour > 23) return null;
  return `${String(hour).padStart(2, '0')}:${mm || '00'}`;
}

/**
 * Every start time named in an English note, in order and without repeats ('HH:MM').
 * A range counts once, by its start ("6:30 to 7:30 p.m." is 18:30). Bare times such as "6:30"
 * are skipped because they could be morning or evening.
 */
export function timesFromNote(note) {
  const text = plainNote(note).replace(/\bnoon\b/g, '12 pm');
  const out = [];
  for (const m of text.matchAll(TIME_TOKEN_RE)) {
    let time;
    if (m[6]) {
      const end = to24(m[4], m[5], m[6]);
      time = to24(m[1], m[2], m[3] || m[6]);
      // "11 to 1 p.m." starts in the morning.
      if (time && !m[3] && end && time > end) time = to24(m[1], m[2], 'am');
      if (!time) time = end;
    } else if (m[9]) time = to24(m[7], m[8], m[9]);
    else time = to24(m[10], m[11], null);
    if (time && !out.includes(time)) out.push(time);
  }
  return out;
}

/** The first start time named in an English note, or null. */
export function timeFromNote(note) {
  return timesFromNote(note)[0] || null;
}

const WEEKDAY_WORDS = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
const MONTH_WORDS = ['january', 'february', 'march', 'april', 'may', 'june', 'july', 'august', 'september', 'october', 'november', 'december'];
const MONTH_DAY_RE = /\b(jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|june?|july?|aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)\.?\s+(\d{1,2})(?:st|nd|rd|th)?\b(?:,?\s+(\d{4})\b)?/i;

/** "2026-11-10" -> "Tue, Nov 10" in the active locale (kept local to avoid a circular import with format.js). */
function shortDate(dateStr) {
  const { m, d } = parseDate(dateStr);
  return t('format.date', { weekday: tList('format.weekdaysShort')[weekdayOf(dateStr)], month: tList('format.monthsShort')[m - 1], day: d });
}

function validDate(y, m, d) {
  const s = toDateStr(y, m, d);
  return isDateStr(s) ? s : null;
}

/** A month and day with no year, in whichever year puts it closest to `near` (a December note about "Jan 12" means next January). */
function closestYear(month, day, near) {
  const { y } = parseDate(near);
  let best = null;
  for (const year of [y - 1, y, y + 1]) {
    const d = validDate(year, month, day);
    if (!d) continue;
    const gap = Math.abs(daysBetween(near, d));
    if (!best || gap < best.gap) best = { d, gap };
  }
  return best ? best.d : null;
}

/** Parse "Nov. 10", "November 10, 2026", "11/10", or "2026-11-10" out of free text, near a reference date. */
export function dateFromNote(text, near) {
  const s = String(text || '');
  let m = MONTH_DAY_RE.exec(s);
  if (m) {
    const month = MONTH_WORDS.findIndex((w) => w.startsWith(m[1].toLowerCase().slice(0, 3))) + 1;
    return m[3] ? validDate(Number(m[3]), month, Number(m[2])) : closestYear(month, Number(m[2]), near);
  }
  m = /\b(\d{4})-(\d{2})-(\d{2})\b/.exec(s);
  if (m && isDateStr(m[0])) return m[0];
  m = /\b(\d{1,2})\/(\d{1,2})(?:\/(\d{2,4}))?\b/.exec(s);
  if (m) {
    if (!m[3]) return closestYear(Number(m[1]), Number(m[2]), near);
    return validDate(m[3].length === 2 ? 2000 + Number(m[3]) : Number(m[3]), Number(m[1]), Number(m[2]));
  }
  return null;
}

/** Nearest date to `near` (excluding it) that falls on `weekday`, within 7 days; ties go forward. */
function nearestDateWithWeekday(near, weekday) {
  for (let d = 1; d <= 7; d += 1) {
    const fwd = addDays(near, d);
    if (weekdayOf(fwd) === weekday) return fwd;
    const back = addDays(near, -d);
    if (weekdayOf(back) === weekday) return back;
  }
  return null;
}

/**
 * Read direction words out of an English note: "moved to Wednesday, Nov. 4" gives a target,
 * "moved from Tuesday" gives a source. Every "to"/"until"/"from" clause is tried in turn, so
 * "due to the holiday" does not hide a later "to Wednesday".
 */
function noteDirection(note, date) {
  // Month abbreviations keep their day: the clause must not stop at the period in "Nov. 19".
  const text = plainNote(note).replace(/\b(jan|feb|mar|apr|jun|jul|aug|sep|sept|oct|nov|dec)\./g, '$1');
  const resolve = (clause) => {
    if (!clause) return null;
    const explicit = dateFromNote(clause, date);
    if (explicit && explicit !== date) return explicit;
    const wd = WEEKDAY_WORDS.findIndex((w) => new RegExp(`\\b${w}\\b`).test(clause));
    if (wd >= 0 && wd !== weekdayOf(date)) return nearestDateWithWeekday(date, wd);
    return null;
  };
  const first = (re) => {
    for (const m of text.matchAll(re)) {
      const found = resolve(m[1].split(/\bto\b|\buntil\b|\bfrom\b/)[0]);
      if (found) return found;
    }
    return null;
  };
  return {
    to: first(/\b(?:to|until)\s+((?:[a-z]+day\b)?[^;.]{0,40})/g),
    from: first(/\bfrom\s+((?:[a-z]+day\b)?[^;.]{0,40})/g),
  };
}

/**
 * Expand every meeting rule for a city into dated occurrences, apply exceptions,
 * and attach agenda items. Returns occurrences sorted by date then time.
 *
 * Exceptions (scheduleExceptions[]) are applied in a fixed order so their order in the data
 * never matters: rescheduled, then cancelled/recess, then special, then note.
 *  - rescheduled: see applyReschedule.
 *  - cancelled / recess: the meetings on that date are cancelled (only the one at `time` when
 *    given). A meeting that was already moved away keeps its "Moved to" note.
 *  - special: a special session. With an explicit `time` it marks the meeting at that time, or
 *    adds a separate meeting when none starts then. Without one it marks the date's meetings
 *    (those at a time the note names, when it names one), or adds a separate meeting on an
 *    empty date. An added meeting takes `label`, `type` and `openToPublicComment` from the
 *    exception, defaulting to a "Special council meeting" of type 'other' with no public
 *    comment, because nothing says the public may speak.
 *  - note: only attaches the note to the date's meetings (only the one at `time` when given);
 *    the status is unchanged. Use it for "the regular meeting is still on Election Day".
 */
export function expandCityMeetings(city, from, to) {
  if (!isDateStr(from) || !isDateStr(to) || from > to) return [];
  const rules = Array.isArray(city.meetings) ? city.meetings : [];
  const lo = addDays(from, -EXCEPTION_REACH_DAYS);
  const hi = addDays(to, EXCEPTION_REACH_DAYS);
  const firstTime = rules[0] && rules[0].recurrence && rules[0].recurrence.time;
  const ctx = { city, rules, occurrences: [], defaultTime: isTimeStr(firstTime) ? firstTime : '18:00' };
  rules.forEach((rule) => {
    const rec = rule && rule.recurrence;
    if (!rec) return;
    for (const date of occurrencesForRule(rec, lo, hi)) {
      ctx.occurrences.push(makeOccurrence(city, rule, date, isTimeStr(rec.time) ? rec.time : '18:00', 'scheduled'));
    }
  });

  const exceptions = (Array.isArray(city.scheduleExceptions) ? city.scheduleExceptions : []).filter((ex) => ex && isDateStr(ex.date) && ex.date >= lo && ex.date <= hi);
  const phase = (statuses, apply) => {
    for (const ex of exceptions) if (statuses.includes(ex.status)) apply(ctx, ex);
  };
  phase(['rescheduled'], applyReschedule);
  phase(['cancelled', 'recess'], applyCancel);
  phase(['special'], applySpecial);
  phase(['note'], applyNote);

  const inWindow = ctx.occurrences.filter((o) => o.date >= from && o.date <= to);
  inWindow.sort((a, b) => compareDates(a.date, b.date) || a.time.localeCompare(b.time));
  attachAgendaItems(city, inWindow);
  return inWindow;
}

/** Meetings on a date that still take place, optionally only the one starting at `time`. */
function liveOn(occurrences, date, time) {
  return occurrences.filter((o) => o.date === date && o.status !== 'cancelled' && (!time || o.time === time));
}

function applyCancel(ctx, ex) {
  const time = isTimeStr(ex.time) ? ex.time : null;
  for (const o of liveOn(ctx.occurrences, ex.date, time)) {
    o.status = 'cancelled';
    o.note = ex.note || (ex.status === 'recess' ? t('schedule.councilRecess') : t('schedule.cancelled'));
  }
}

function applySpecial(ctx, ex) {
  const explicit = isTimeStr(ex.time) ? ex.time : null;
  const live = liveOn(ctx.occurrences, ex.date);
  const noted = timesFromNote(sourceText(ex, 'note'));
  let marked = [];
  if (explicit) marked = live.filter((o) => o.time === explicit);
  else if (live.length) {
    const atNoted = live.filter((o) => noted.includes(o.time));
    marked = atNoted.length ? atNoted : live;
  }
  if (marked.length) {
    for (const o of marked) {
      o.status = 'special';
      o.note = ex.note || t('schedule.specialMeeting');
    }
    return;
  }
  const type = typeof ex.type === 'string' && ex.type ? ex.type : 'other';
  const rule = {
    type,
    label: ex.label || t('schedule.specialMeeting'),
    labelSource: sourceText(ex, 'label') || t('schedule.specialMeeting', undefined, 'en'),
    openToPublicComment: ex.openToPublicComment === true,
  };
  ctx.occurrences.push(makeOccurrence(ctx.city, rule, ex.date, explicit || noted[0] || ctx.defaultTime, 'special', ex.note));
}

function applyNote(ctx, ex) {
  if (!ex.note) return;
  for (const o of liveOn(ctx.occurrences, ex.date, isTimeStr(ex.time) ? ex.time : null)) o.note = ex.note;
}

/**
 * Apply one 'rescheduled' exception. Explicit fields always win:
 *  - movedFrom / movedTo: the meetings on the old date move to the new one (the exception's own
 *    date fills in whichever side is missing);
 *  - time: the new start time, when a single meeting moves or changes time.
 * Without them the English note is read, in this order:
 *  1. "moved to <day or date>" (exception on the OLD date) or "moved from <day or date>"
 *     (exception on the NEW date);
 *  2. on a date that has meetings: a single meeting whose note names exactly one other time
 *     changes time ("starts at 5 p.m. instead of 7 p.m."); otherwise a different date named in
 *     the note (within two weeks) is where the meetings went;
 *  3. on an empty date: the usual holiday shift, where the nearest scheduled date within
 *     3 days moves here, every meeting on that evening together.
 * A move to an unknown place never leaves the old date looking like a live meeting: those
 * meetings are cancelled, with the city's note (or "Rescheduled: check the city calendar").
 */
function applyReschedule(ctx, ex) {
  const { occurrences, rules, city } = ctx;
  const note = sourceText(ex, 'note');
  const noteTimes = timesFromNote(note);
  const explicitTime = isTimeStr(ex.time) ? ex.time : null;
  const scheduledOn = (date) => occurrences.filter((o) => o.date === date && o.status === 'scheduled');

  let source = isDateStr(ex.movedFrom) ? ex.movedFrom : null;
  let target = isDateStr(ex.movedTo) ? ex.movedTo : null;
  if (source && !target) target = ex.date;
  else if (target && !source) source = ex.date;
  else if (!source && !target) {
    const dir = noteDirection(note, ex.date);
    const here = scheduledOn(ex.date);
    if (dir.to) {
      source = ex.date;
      target = dir.to;
    } else if (dir.from) {
      source = dir.from;
      target = ex.date;
    } else if (here.length) {
      source = ex.date;
      const otherTimes = here.length === 1 ? noteTimes.filter((x) => x !== here[0].time) : [];
      if (explicitTime || otherTimes.length === 1) target = ex.date;
      else {
        const named = dateFromNote(note, ex.date);
        if (named && named !== ex.date && Math.abs(daysBetween(ex.date, named)) <= 14) target = named;
      }
    } else {
      target = ex.date;
      source = nearestScheduledDate(occurrences, ex.date, 3);
    }
  }

  const moved = source ? scheduledOn(source) : [];

  if (target && target === source) {
    // Same date: a time change.
    const otherTimes = moved.length === 1 ? noteTimes.filter((x) => x !== moved[0].time) : [];
    const time = moved.length === 1 ? explicitTime || (otherTimes.length === 1 ? otherTimes[0] : null) : null;
    for (const o of moved) {
      o.status = 'rescheduled';
      o.note = ex.note || t('schedule.rescheduledCheck');
      if (time && time !== o.time) retime(o, time);
    }
    return;
  }

  if (!target) {
    // Moved somewhere the data does not say: not a live meeting on the old date.
    for (const o of moved) {
      o.status = 'cancelled';
      o.note = ex.note || t('schedule.rescheduledCheck');
    }
    return;
  }

  for (const o of moved) {
    o.status = 'cancelled';
    o.note = t('schedule.movedTo', { date: shortDate(target) });
    o.movedTo = target;
  }
  if (moved.length) {
    // A note listing several times names the whole evening ("work session 6 p.m., regular
    // meeting 7 p.m."), so each meeting keeps its own time unless one meeting moves to one time.
    const singleTime = moved.length === 1 ? explicitTime || (noteTimes.length === 1 ? noteTimes[0] : null) : null;
    for (const o of moved) {
      const meta = META.get(o);
      const template = meta.rule || { type: o.type, label: o.label, labelSource: meta.labelSource, openToPublicComment: o.openToPublicComment, location: o.location };
      const next = makeOccurrence(city, template, target, singleTime || o.time, 'rescheduled', ex.note);
      const existing = occurrences.find((x) => x.id === next.id && x.status !== 'cancelled');
      if (existing) {
        existing.status = 'rescheduled';
        existing.note = ex.note || existing.note;
        existing.movedFrom = source;
        continue;
      }
      next.movedFrom = source;
      occurrences.push(next);
    }
  } else if (!liveOn(occurrences, target).length) {
    // Nothing found to move: show the meeting on its new date anyway, as the main meeting.
    const template = rules.find((r) => r && r.type === 'regular') || rules[0] || { type: 'regular', label: t('schedule.rescheduledCouncil'), labelSource: t('schedule.rescheduledCouncil', undefined, 'en') };
    occurrences.push(makeOccurrence(city, template, target, explicitTime || noteTimes[0] || ctx.defaultTime, 'rescheduled', ex.note));
  }
}

function retime(o, time) {
  o.time = time;
  o.startISO = toISO(o.date, time);
  o.isEvening = isEvening(time);
  o.isSchoolHours = isSchoolHours(o.date, time);
}

/** Nearest date to `date` (excluding it, within maxDays) that still has scheduled meetings. */
function nearestScheduledDate(occurrences, date, maxDays) {
  let best = null;
  for (const o of occurrences) {
    if (o.status !== 'scheduled') continue;
    const d = Math.abs(daysBetween(date, o.date));
    if (d === 0 || d > maxDays) continue;
    if (!best || d < best.d || (d === best.d && o.date > best.date)) best = { date: o.date, d };
  }
  return best ? best.date : null;
}

/**
 * Per-occurrence facts the engine needs but pages do not: the English label (for ids and agenda
 * matching) and the rule it came from (so a moved meeting keeps its type, label and comment
 * rules). Kept off the public shape.
 */
const META = new WeakMap();

function makeOccurrence(city, rule, date, time, status, note) {
  const label = rule.label || defaultLabel(rule.type);
  const labelSource = sourceText(rule, 'label') || defaultLabel(rule.type, 'en');
  const fromRule = Array.isArray(city.meetings) && city.meetings.includes(rule);
  const occ = {
    id: `${city.cityId}:${date}:${slug(labelSource)}`,
    cityId: city.cityId,
    cityName: city.name,
    county: city.county,
    type: rule.type || 'regular',
    label,
    date,
    time,
    startISO: toISO(date, time),
    weekday: weekdayOf(date),
    isEvening: isEvening(time),
    isSchoolHours: isSchoolHours(date, time),
    location: rule.location || (city.cityHall && (city.cityHall.name ? `${city.cityHall.name}, ${city.cityHall.address}` : city.cityHall.address)) || '',
    lat: city.cityHall && city.cityHall.lat,
    lng: city.cityHall && city.cityHall.lng,
    virtualUrl: rule.virtualUrl || (city.liveStream && city.liveStream.url) || '',
    openToPublicComment: rule.openToPublicComment !== false,
    status,
    note: note || rule.notes || '',
    durationMinutes: (rule.recurrence && rule.recurrence.durationMinutes) || null,
    agendaItems: [],
  };
  META.set(occ, { labelSource, rule: fromRule ? rule : null });
  return occ;
}

function defaultLabel(type, locale) {
  const labels = t('schedule.labels', undefined, locale);
  return (labels && typeof labels === 'object' && labels[type]) || t('schedule.labels.regular', undefined, locale);
}

/** Lowercase words without parentheticals or punctuation: "City Council Work Session (3 p.m.)" -> "city council work session". */
function labelWords(s) {
  return String(s || '')
    .toLowerCase()
    .replace(/\([^)]*\)/g, ' ')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

const SESSION_WORDS = /\b(work ?session|worksession|workshop|study session|briefing|pre ?council|pre ?meeting|preliminary)\b/;

/** How well an agenda item's meetingLabel names this occurrence: 3 same label, 2 one extends the other, 1 same kind of meeting. */
function agendaLabelScore(itemLabel, occ) {
  const a = labelWords(itemLabel);
  const b = labelWords((META.get(occ) || {}).labelSource || occ.label);
  if (!a || !b) return 0;
  if (a === b) return 3;
  if (a.startsWith(b) || b.startsWith(a)) return 2;
  if (SESSION_WORDS.test(a)) return occ.type === 'work-session' || occ.type === 'briefing' ? 1 : 0;
  if (/\bregular\b/.test(a)) return occ.type === 'regular' ? 1 : 0;
  return 0;
}

/**
 * Put each agenda item on the meeting it belongs to. A dated item goes only to a meeting on
 * that exact date, so a meeting never carries an item from another day: the one whose label
 * matches the item's meetingLabel (so work-session items stay on the work session), else the
 * regular meeting. An undated item goes to the first regular meeting in the window.
 * Expects `occurrences` sorted by date and time.
 */
function attachAgendaItems(city, occurrences) {
  const items = Array.isArray(city.agendaItems) ? city.agendaItems : [];
  if (!items.length || !occurrences.length) return;
  const live = occurrences.filter((o) => o.status !== 'cancelled');
  const firstRegular = live.find((o) => o.type === 'regular') || live[0];
  for (const item of items) {
    let target = null;
    if (isDateStr(item.meetingDate)) {
      const sameDay = live.filter((o) => o.date === item.meetingDate);
      let best = -1;
      for (const o of sameDay) {
        const score = agendaLabelScore(item.meetingLabel, o) * 2 + (o.type === 'regular' ? 1 : 0);
        if (score > best) {
          best = score;
          target = o;
        }
      }
    } else target = firstRegular;
    if (target) target.agendaItems.push(item);
  }
}

/**
 * A city's agenda items split around `today`: `upcoming` holds items dated today or later plus
 * undated ones (soonest first, undated last); `recent` holds items dated in the `recentDays`
 * days before today (newest first). Older items are left out. Without a valid `today` every
 * item counts as upcoming.
 */
export function agendaFor(city, today, { recentDays = 60 } = {}) {
  const items = Array.isArray(city && city.agendaItems) ? city.agendaItems : [];
  const known = isDateStr(today);
  const since = known ? addDays(today, -recentDays) : null;
  const upcoming = [];
  const recent = [];
  for (const item of items) {
    const date = isDateStr(item.meetingDate) ? item.meetingDate : null;
    if (!known || !date || date >= today) upcoming.push(item);
    else if (date >= since) recent.push(item);
  }
  const key = (item) => (isDateStr(item.meetingDate) ? item.meetingDate : '9999-99-99');
  upcoming.sort((a, b) => compareDates(key(a), key(b)));
  recent.sort((a, b) => compareDates(key(b), key(a)));
  return { upcoming, recent };
}

/**
 * The last date a city's published calendar covers, when every meeting rule is a list of
 * published dates (kind 'custom'): the latest listed date or exception-added meeting. Returns
 * null when any rule recurs indefinitely. Lets a page tell "the next calendar is not posted
 * yet" apart from "no meetings".
 */
export function calendarThrough(city) {
  const rules = Array.isArray(city && city.meetings) ? city.meetings : [];
  if (!rules.length) return null;
  let last = null;
  const consider = (d) => {
    if (isDateStr(d) && (!last || d > last)) last = d;
  };
  for (const rule of rules) {
    const rec = (rule && rule.recurrence) || {};
    if (rec.kind !== 'custom') return null;
    for (const d of rec.dates || []) consider(d);
  }
  if (!last) return null;
  for (const ex of city.scheduleExceptions || []) {
    if (ex.status === 'special') consider(ex.date);
    else if (ex.status === 'rescheduled') consider(isDateStr(ex.movedTo) ? ex.movedTo : ex.date);
  }
  return last;
}

/**
 * All meetings across cities in the `days` calendar days starting on `from` (inclusive),
 * soonest first. Cancelled meetings are left out unless asked for; with `now` (an ISO string),
 * meetings that already ended are left out too.
 */
export function upcomingMeetings(cities, { from, days = 30, includeCancelled = false, now } = {}) {
  const to = windowEnd(from, days);
  const all = [];
  for (const city of cities) {
    for (const occ of expandCityMeetings(city, from, to)) {
      if (!includeCancelled && occ.status === 'cancelled') continue;
      if (hasEnded(occ, now)) continue;
      all.push(occ);
    }
  }
  all.sort((a, b) => compareDates(a.date, b.date) || a.time.localeCompare(b.time) || a.cityName.localeCompare(b.cityName));
  return all;
}

/** The next meeting for one city on or after `from`, within `horizonDays` days; with `now`, skips meetings that already ended. */
export function nextMeetingFor(city, from, { publicCommentOnly = false, horizonDays = 90, now } = {}) {
  const list = expandCityMeetings(city, from, windowEnd(from, horizonDays)).filter((o) => o.status !== 'cancelled' && !hasEnded(o, now));
  return list.find((o) => !publicCommentOnly || o.openToPublicComment) || null;
}
