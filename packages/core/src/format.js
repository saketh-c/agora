import { parseDate, weekdayOf, daysBetween, addDays } from './schedule.js';
import { t, tn, tList, joinList, getLocale, isLocale } from './i18n/runtime.js';

/** English names, kept for callers that need a stable reference. Prefer weekdayNames() for display. */
export const WEEKDAY_NAMES = Object.freeze(['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']);
export const WEEKDAY_SHORT = Object.freeze(['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']);

export function weekdayNames(locale) {
  return tList('format.weekdays', locale);
}

export function weekdayShortNames(locale) {
  return tList('format.weekdaysShort', locale);
}

/**
 * Locales that write clock times on a 24-hour clock. This follows CLDR: Vietnamese writes
 * "19:00", while US English and Mexican and US Spanish write a 12-hour time with a
 * day-period marker ("7:00 PM", "7:00 p.m."), which the dictionaries supply as format.am
 * and format.pm. Which clock a language uses is locale data, not a translatable string, so
 * it lives here rather than in the dictionaries.
 */
const TWENTY_FOUR_HOUR = new Set(['vi']);

function activeLocale(locale) {
  return locale && isLocale(locale) ? locale : getLocale();
}

/**
 * 'HH:MM' -> a clock time in the locale's convention: '7:00 PM' (en), '7:00 p.m.' (es),
 * '19:00' (vi). With `{ compact: true }` a time on the hour drops ':00' where a day-period
 * marker keeps it unambiguous ('7 PM', '7 p.m.'), for chart axes and other tight labels; a
 * 24-hour time keeps its minutes, because a bare '19' reads as a count. A value that is not
 * a time comes back unchanged instead of turning into 'NaN:00 PM'.
 */
export function formatTime(time, locale, { compact = false } = {}) {
  if (time == null || time === '') return '';
  const m = /^\s*(\d{1,2})(?::(\d{1,2}))?\s*$/.exec(String(time));
  if (!m || Number(m[1]) > 24 || Number(m[2] || 0) > 59) return String(time);
  const lang = activeLocale(locale);
  const hour = Number(m[1]) % 24;
  const mm = (m[2] || '00').padStart(2, '0');
  if (TWENTY_FOUR_HOUR.has(lang)) return `${hour}:${mm}`;
  const suffix = hour >= 12 ? t('format.pm', undefined, lang) : t('format.am', undefined, lang);
  const h12 = hour % 12 === 0 ? 12 : hour % 12;
  return compact && mm === '00' ? `${h12} ${suffix}` : `${h12}:${mm} ${suffix}`;
}

/** '2026-09-14' -> 'Mon, Sep 14' (or with year, or with long names) in the active locale. */
export function formatDate(dateStr, { withYear = false, long = false, locale } = {}) {
  const { y, m, d } = parseDate(dateStr);
  const wd = weekdayOf(dateStr);
  const month = (long ? tList('format.months', locale) : tList('format.monthsShort', locale))[m - 1];
  const weekday = (long ? tList('format.weekdays', locale) : tList('format.weekdaysShort', locale))[wd];
  return t(withYear ? 'format.dateWithYear' : 'format.date', { weekday, month, day: d, year: y }, locale);
}

/** The Sunday that starts the calendar week containing `dateStr`. */
function weekStartOf(dateStr) {
  return addDays(dateStr, -weekdayOf(dateStr));
}

/**
 * Human phrase for how far away a date is from `today`: 'Today', 'Tomorrow', 'In 3 days',
 * 'Next week', 'In 10 days', 'In 3 weeks', '2 days ago'.
 *
 * 'Next week' means the following calendar week (Sunday to Saturday, as on the US calendars
 * the cities publish), not "7 to 13 days away". On Saturday, Oct 10 a meeting on Tuesday,
 * Oct 20 is in the week after next, so calling it 'Next week' sent students to the wrong
 * week; it now reads 'In 10 days'. Dates under a week away keep their exact count even when
 * they fall in the next calendar week, because 'In 3 days' says more than a week label.
 */
export function relativeDays(dateStr, today, locale) {
  const n = daysBetween(today, dateStr);
  if (n === 0) return t('common.today', undefined, locale);
  if (n === 1) return t('common.tomorrow', undefined, locale);
  if (n < 0) return tn('common.daysAgo', -n, undefined, locale);
  if (n < 7) return t('common.inDays', { n }, locale);
  if (weekStartOf(dateStr) === addDays(weekStartOf(today), 7)) return t('common.nextWeek', undefined, locale);
  if (n < 14) return t('common.inDays', { n }, locale);
  const weeks = Math.round(n / 7);
  return tn('common.inWeeks', weeks, undefined, locale);
}

export function milesText(miles, locale) {
  if (miles == null || Number.isNaN(miles)) return '';
  if (miles < 0.95) return t('common.under1Mile', undefined, locale);
  return t('common.miles', { n: miles.toFixed(miles < 10 ? 1 : 0) }, locale);
}

/**
 * Describe a recurrence rule in words: "2nd and 4th Mondays at 7:00 PM". The wording comes
 * from the dictionaries, so each language can keep ordinals apart from weekday names: in
 * Vietnamese the weekdays are themselves ordinals (Thứ Hai is Monday, thứ hai is "second"),
 * so its ordinals name the week ("Thứ Hai tuần thứ hai và tuần thứ tư hằng tháng").
 */
export function describeRecurrence(rule, locale) {
  if (!rule) return '';
  const day = weekdayNames(locale)[rule.weekday] || '';
  const at = rule.time ? t('format.at', { time: formatTime(rule.time, locale) }, locale) : '';
  switch (rule.kind) {
    case 'weekly':
      return t('format.every', { day, at }, locale);
    case 'biweekly':
      return t('format.everyOther', { day, at }, locale);
    case 'nth-weekday': {
      const ordinals = joinList((rule.ordinals || []).map((n) => ordinalWord(n, locale)), locale);
      return t('format.nthDays', { ordinals, day, at }, locale).trim();
    }
    case 'custom':
      return t('format.published', { usually: day ? t('format.usually', { day }, locale) : '', at }, locale);
    default:
      return `${day}${at}`;
  }
}

export function ordinalWord(n, locale) {
  const list = tList('format.ordinals', locale);
  return list[n] || `${n}`;
}

export function pluralize(n, word, plural = `${word}s`) {
  return `${n} ${n === 1 ? word : plural}`;
}
