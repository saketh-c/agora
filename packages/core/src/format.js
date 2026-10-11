import { parseDate, weekdayOf, daysBetween, addDays } from './schedule.js';
import { t, tn, tList, joinList, getLocale, isLocale, intlLocale, usesIntlFormats } from './i18n/runtime.js';

/**
 * Dates, times, numbers and distances in the app's language.
 *
 * English, Spanish and Vietnamese write them from their dictionaries (format.* names and
 * templates, tuned by hand and tested). The other languages ask Intl, with the locale's own
 * conventions and Latin digits (LOCALES[].intl, for example 'ar-u-ca-gregory-nu-latn'), so a
 * date, a time or a weekday name is right in them before a translator touches anything.
 * Sentences built around those values (recurrence rules, "In 3 days") stay dictionary
 * templates, so every language can put the words in its own order.
 */

/** English names, kept for callers that need a stable reference. Prefer weekdayNames() for display. */
export const WEEKDAY_NAMES = Object.freeze(['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']);
export const WEEKDAY_SHORT = Object.freeze(['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']);

function activeLocale(locale) {
  return locale && isLocale(locale) ? locale : getLocale();
}

const formats = new Map();

/** A cached Intl.DateTimeFormat for a language (UTC unless the options say otherwise). */
function dateFormat(lang, options) {
  const tag = intlLocale(lang);
  const key = `${tag}|${JSON.stringify(options)}`;
  if (!formats.has(key)) formats.set(key, new Intl.DateTimeFormat(tag, { timeZone: 'UTC', ...options }));
  return formats.get(key);
}

/** Noon UTC on a calendar date, so no time zone can move it to another day. */
function noon(dateStr) {
  const { y, m, d } = parseDate(dateStr);
  return new Date(Date.UTC(y, m - 1, d, 12));
}

const nameCache = new Map();

/** Seven weekday names (Sunday first) or twelve month names from Intl. */
function intlNames(lang, kind, width) {
  const key = `${intlLocale(lang)}|${kind}|${width}`;
  if (!nameCache.has(key)) {
    const list =
      kind === 'weekday'
        ? Array.from({ length: 7 }, (_, i) => dateFormat(lang, { weekday: width }).format(new Date(Date.UTC(2026, 9, 11 + i, 12))))
        : Array.from({ length: 12 }, (_, i) => dateFormat(lang, { month: width }).format(new Date(Date.UTC(2026, i, 15, 12))));
    nameCache.set(key, Object.freeze(list));
  }
  return nameCache.get(key);
}

/** Weekday names, Sunday first: 'Monday', 'lunes', 'Thứ Hai', '星期一', 'सोमवार'. */
export function weekdayNames(locale) {
  const lang = activeLocale(locale);
  return usesIntlFormats(lang) ? intlNames(lang, 'weekday', 'long') : tList('format.weekdays', lang);
}

/** Short weekday names, Sunday first: 'Mon', 'lun', 'T2', '周一', 'सोम'. */
export function weekdayShortNames(locale) {
  const lang = activeLocale(locale);
  return usesIntlFormats(lang) ? intlNames(lang, 'weekday', 'short') : tList('format.weekdaysShort', lang);
}

/** Month names, January first. */
export function monthNames(locale) {
  const lang = activeLocale(locale);
  return usesIntlFormats(lang) ? intlNames(lang, 'month', 'long') : tList('format.months', lang);
}

/** Short month names, January first: 'Oct', 'oct', 'thg 10', '10月', 'अक्टू॰'. */
export function monthShortNames(locale) {
  const lang = activeLocale(locale);
  return usesIntlFormats(lang) ? intlNames(lang, 'month', 'short') : tList('format.monthsShort', lang);
}

/** The weekday of a 'YYYY-MM-DD' date as a word ({ short: true } for 'Mon'). */
export function weekdayName(dateStr, { short = false, locale } = {}) {
  return (short ? weekdayShortNames(locale) : weekdayNames(locale))[weekdayOf(dateStr)] || '';
}

const numberFormats = new Map();

/** A number in the language's style (Latin digits everywhere): 1.5, 1,5, 1,234. */
export function formatNumber(n, locale, options = {}) {
  const lang = activeLocale(locale);
  const tag = intlLocale(lang);
  const key = `${tag}|${JSON.stringify(options)}`;
  try {
    if (!numberFormats.has(key)) numberFormats.set(key, new Intl.NumberFormat(tag, options));
    return numberFormats.get(key).format(n);
  } catch {
    return String(n);
  }
}

/**
 * Locales that write clock times on a 24-hour clock with the dictionary path. This follows
 * CLDR: Vietnamese writes "19:00", while US English and Mexican and US Spanish write a 12-hour
 * time with a day-period marker ("7:00 PM", "7:00 p.m."), which the dictionaries supply as
 * format.am and format.pm. Languages that use Intl get their clock from CLDR the same way:
 * Chinese "19:00", Hindi "7:00 pm", Telugu "7:00 PM", Arabic "7:00 م".
 */
const TWENTY_FOUR_HOUR = new Set(['vi']);

/** True when a language writes clock times with a day period (AM/PM) rather than 0 to 23. */
export function usesDayPeriods(locale) {
  const lang = activeLocale(locale);
  if (!usesIntlFormats(lang)) return !TWENTY_FOUR_HOUR.has(lang);
  const cycle = dateFormat(lang, { hour: 'numeric' }).resolvedOptions().hourCycle;
  return cycle === 'h11' || cycle === 'h12';
}

/**
 * 'HH:MM' -> a clock time in the locale's convention: '7:00 PM' (en), '7:00 p.m.' (es),
 * '19:00' (vi, zh), '7:00 pm' (hi), '7:00 م' (ar). With `{ compact: true }` a time on the hour
 * drops ':00' where a day-period marker keeps it unambiguous ('7 PM', '7 p.m.'), for chart
 * axes and other tight labels; a 24-hour time keeps its minutes, because a bare '19' reads as
 * a count. A value that is not a time comes back unchanged instead of turning into 'NaN:00 PM'.
 */
export function formatTime(time, locale, { compact = false } = {}) {
  if (time == null || time === '') return '';
  const m = /^\s*(\d{1,2})(?::(\d{1,2}))?\s*$/.exec(String(time));
  if (!m || Number(m[1]) > 24 || Number(m[2] || 0) > 59) return String(time);
  const lang = activeLocale(locale);
  const hour = Number(m[1]) % 24;
  const mm = (m[2] || '00').padStart(2, '0');
  if (usesIntlFormats(lang)) {
    const at = new Date(Date.UTC(2026, 0, 5, hour, Number(mm)));
    const dropMinutes = compact && mm === '00' && usesDayPeriods(lang);
    return dateFormat(lang, dropMinutes ? { hour: 'numeric' } : { hour: 'numeric', minute: '2-digit' }).format(at);
  }
  if (TWENTY_FOUR_HOUR.has(lang)) return `${hour}:${mm}`;
  const suffix = hour >= 12 ? t('format.pm', undefined, lang) : t('format.am', undefined, lang);
  const h12 = hour % 12 === 0 ? 12 : hour % 12;
  return compact && mm === '00' ? `${h12} ${suffix}` : `${h12}:${mm} ${suffix}`;
}

/**
 * '2026-09-14' -> 'Mon, Sep 14' (or with year, or with long names) in the active locale.
 * `weekday` and `month` ('long' or 'short') set one name's width on its own: { weekday: 'long' }
 * is 'Monday, Sep 14'.
 */
export function formatDate(dateStr, { withYear = false, long = false, locale, weekday: weekdayWidth, month: monthWidth } = {}) {
  const lang = activeLocale(locale);
  const wdWidth = weekdayWidth || (long ? 'long' : 'short');
  const mWidth = monthWidth || (long ? 'long' : 'short');
  if (usesIntlFormats(lang)) {
    return dateFormat(lang, { weekday: wdWidth, month: mWidth, day: 'numeric', ...(withYear ? { year: 'numeric' } : {}) }).format(noon(dateStr));
  }
  const { y, m, d } = parseDate(dateStr);
  const wd = weekdayOf(dateStr);
  const month = (mWidth === 'long' ? tList('format.months', lang) : tList('format.monthsShort', lang))[m - 1];
  const weekday = (wdWidth === 'long' ? tList('format.weekdays', lang) : tList('format.weekdaysShort', lang))[wd];
  return t(withYear ? 'format.dateWithYear' : 'format.date', { weekday, month, day: d, year: y }, lang);
}

/** "Oct 12" or, with a year, "Oct 12, 2026": a date without its weekday. */
export function formatMonthDay(dateStr, { withYear = false, locale } = {}) {
  const lang = activeLocale(locale);
  if (usesIntlFormats(lang)) return dateFormat(lang, { month: 'short', day: 'numeric', ...(withYear ? { year: 'numeric' } : {}) }).format(noon(dateStr));
  const { y, m, d } = parseDate(dateStr);
  const month = tList('format.monthsShort', lang)[m - 1];
  return t(withYear ? 'ui.monthDayYear' : 'ui.monthDay', { month, day: d, year: y }, lang);
}

/** The Sunday that starts the calendar week containing `dateStr`. */
function weekStartOf(dateStr) {
  return addDays(dateStr, -weekdayOf(dateStr));
}

/**
 * Human phrase for how far away a date is from `today`: 'Today', 'Tomorrow', 'In 3 days',
 * 'Next week', 'In 10 days', 'In 3 weeks', '2 days ago'. Each is a dictionary template with
 * plural forms, so Arabic can say "بعد يومين" (in two days) and "بعد 11 يومًا" (in 11 days).
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
  if (n < 7) return tn('common.inDays', n, undefined, locale);
  if (weekStartOf(dateStr) === addDays(weekStartOf(today), 7)) return t('common.nextWeek', undefined, locale);
  if (n < 14) return tn('common.inDays', n, undefined, locale);
  const weeks = Math.round(n / 7);
  return tn('common.inWeeks', weeks, undefined, locale);
}

/** A distance as a number, one decimal under 10 miles: '2.7', '12'. */
export function formatMiles(miles, locale) {
  const lang = activeLocale(locale);
  const digits = miles < 10 ? 1 : 0;
  if (usesIntlFormats(lang)) return formatNumber(miles, lang, { minimumFractionDigits: digits, maximumFractionDigits: digits });
  return Number(miles).toFixed(digits);
}

export function milesText(miles, locale) {
  if (miles == null || Number.isNaN(miles)) return '';
  if (miles < 0.95) return t('common.under1Mile', undefined, locale);
  return t('common.miles', { n: formatMiles(miles, locale) }, locale);
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
