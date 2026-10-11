/**
 * Structured speaker sign-up deadlines, read conservatively from a city's English
 * `publicComment.deadline` text.
 *
 * Most councils take a speaker card at the meeting, so there is nothing to warn about.
 * A few close sign-up before the meeting with no way to sign up at the door (Plano: online
 * only, 4 p.m. on meeting day; Fort Worth: two hours before; Dallas: 5 p.m. the last business
 * day before). Only those patterns produce a deadline; anything with an at-the-meeting
 * alternative, or wording this parser does not fully understand, returns null, because a
 * wrong amber "Sign-up closes" line is worse than none. Pure functions, tested in
 * test/deadline.test.js.
 */
import { addDays, weekdayOf } from '@agora/core';

const WORD_NUMBERS = { one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, twenty: 20, thirty: 30 };
/** Wording that means you can still sign up at the meeting itself. */
const AT_MEETING = /in[- ]person|card|at the meeting|at the door|before the meeting (?:begins|starts|is called)|before the item|paper|onsite|on site/i;
const TIME = String.raw`(noon|\d{1,2}(?::\d{2})?\s*[ap]\.?\s?m\.?)`;

/** '4 p.m.' / '4:30 pm' / 'noon' -> 'HH:MM', or null. */
export function clockFromText(text) {
  const s = String(text || '').trim().toLowerCase();
  if (s === 'noon') return '12:00';
  const m = /^(\d{1,2})(?::(\d{2}))?\s*([ap])\.?\s?m\.?$/.exec(s);
  if (!m) return null;
  let h = Number(m[1]) % 12;
  if (m[3] === 'p') h += 12;
  const mm = m[2] || '00';
  if (h > 23 || Number(mm) > 59) return null;
  return `${String(h).padStart(2, '0')}:${mm}`;
}

function toMinutes(hhmm) {
  const [h, m] = hhmm.split(':').map(Number);
  return h * 60 + m;
}

function fromMinutes(total) {
  const h = Math.floor(total / 60);
  const m = total % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

/**
 * Parse a deadline sentence into a rule, or null.
 * Rules: { kind: 'sameDay', time } | { kind: 'hoursBefore', minutes } | { kind: 'businessDayBefore', time }
 */
export function parseDeadlineRule(text) {
  const s = String(text || '').trim();
  if (!s) return null;

  // "4:00 p.m. on the day of the meeting", only when nothing offers a way in at the meeting.
  const same = new RegExp(String.raw`^${TIME} on (?:the day of the meeting|meeting day|the meeting date|the day of)\b`, 'i').exec(s);
  if (same && !AT_MEETING.test(s)) {
    const time = clockFromText(same[1]);
    return time ? { kind: 'sameDay', time } : null;
  }

  // "No later than two hours before the meeting start time"
  const before = /^no later than (\w+) (hours?|minutes?) before the meeting/i.exec(s);
  if (before && !AT_MEETING.test(s)) {
    const n = Number(before[1]) || WORD_NUMBERS[before[1].toLowerCase()];
    if (!n) return null;
    return { kind: 'hoursBefore', minutes: /^hour/i.test(before[2]) ? n * 60 : n };
  }

  // "5:00 p.m. of the last regular business day before the meeting"
  const business = new RegExp(String.raw`^${TIME} (?:of|on) the last (?:regular )?business day before the meeting`, 'i').exec(s);
  if (business && !AT_MEETING.test(s)) {
    const time = clockFromText(business[1]);
    return time ? { kind: 'businessDayBefore', time } : null;
  }
  return null;
}

/** The weekday before `date`, skipping Saturday and Sunday. */
function previousBusinessDay(date) {
  let d = addDays(date, -1);
  while (weekdayOf(d) === 0 || weekdayOf(d) === 6) d = addDays(d, -1);
  return d;
}

/**
 * The sign-up deadline for one meeting: { date: 'YYYY-MM-DD', time: 'HH:MM', passed } or null.
 * `deadlineText` is the city's ENGLISH publicComment.deadline (read it from the raw data,
 * not a translated copy). `now` (ISO string or Date) decides `passed`; it is compared as
 * Central time wall clock, like the rest of the schedule.
 */
export function signupDeadline(deadlineText, meeting, now) {
  if (!meeting || !meeting.openToPublicComment || meeting.status === 'cancelled') return null;
  const rule = parseDeadlineRule(deadlineText);
  if (!rule) return null;
  let date = meeting.date;
  let time;
  if (rule.kind === 'sameDay') {
    time = rule.time;
    // A deadline at or after the start time is not an advance deadline.
    if (meeting.time && toMinutes(time) >= toMinutes(meeting.time)) return null;
  } else if (rule.kind === 'hoursBefore') {
    if (!meeting.time) return null;
    let total = toMinutes(meeting.time) - rule.minutes;
    while (total < 0) {
      total += 24 * 60;
      date = addDays(date, -1);
    }
    time = fromMinutes(total);
  } else {
    date = previousBusinessDay(meeting.date);
    time = rule.time;
  }
  return { date, time, passed: isPast(date, time, now) };
}

/** Wall-clock comparison in America/Chicago. */
function isPast(date, time, now) {
  if (!now) return false;
  const instant = now instanceof Date ? now : new Date(now);
  if (Number.isNaN(instant.getTime())) return false;
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Chicago', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(instant);
  const get = (type) => (parts.find((p) => p.type === type) || {}).value;
  const nowKey = `${get('year')}-${get('month')}-${get('day')} ${get('hour')}:${get('minute')}`;
  return nowKey >= `${date} ${time}`;
}
