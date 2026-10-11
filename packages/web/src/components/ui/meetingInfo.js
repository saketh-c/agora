/**
 * Small, shared answers about a meeting occurrence, worded once so every screen says the
 * same thing: can I speak and for how long, does it clash with school, is there a sign-up
 * deadline, what kind of meeting is it. Strings come from the `ui` dictionary namespace.
 */
import { formatDate, formatTime, getLocale, tList, t, tn, parseDate } from '@agora/core';
import { rawCity } from '../../lib/data.js';
import { signupDeadline } from '../../lib/deadline.js';

/** 'weekend' | 'during' (a weekday, 7:30 to 16:00) | 'before' (weekday morning) | 'after'. */
export function schoolTiming(meeting) {
  if (!meeting) return 'after';
  if (meeting.weekday === 0 || meeting.weekday === 6) return 'weekend';
  if (meeting.isSchoolHours) return 'during';
  if (meeting.time && meeting.time < '07:30') return 'before';
  return 'after';
}

export const TIMING_ICON = { weekend: 'cal', during: 'sun', before: 'sun', after: 'moon' };

export function timingLabel(meeting) {
  return t(`ui.timing.${schoolTiming(meeting)}`);
}

/** Minutes each speaker gets at this city, or null when the city does not publish it. */
export function speakMinutes(city) {
  const n = city && city.publicComment && Number(city.publicComment.timeLimitMinutes);
  return Number.isFinite(n) && n > 0 ? n : null;
}

/** 'yes' | 'no' | 'unknown': can you comment online instead of in person? */
export function remoteState(city) {
  const v = city && city.publicComment ? city.publicComment.virtualAllowed : undefined;
  return v === true ? 'yes' : v === false ? 'no' : 'unknown';
}

/** Short type label for rows: "Council meeting", "Work session". */
export function typeLabel(meeting) {
  if (!meeting) return '';
  if (meeting.status === 'special') return t('ui.meetingType.special');
  const key = `ui.meetingType.${meeting.type}`;
  const label = t(key);
  return label === key ? t('ui.meetingType.regular') : label;
}

// Generic words in English meeting labels. A label made only of these is sentence-cased;
// anything else (a person, a commission, "Fourth-Tuesday") is left exactly as the city wrote it.
const GENERIC = new Set('a and as afternoon agenda briefing called city council day evening executive joint meeting meetings needed of open pre-council pre-meeting preliminary regular session sessions special study the town voting with work workshop worksession'.split(' '));

/**
 * The meeting's own name for a title under the council name: "City Council Regular Meeting"
 * becomes "Regular meeting" (sentence case, no repeated "City Council"). Translated labels
 * are already in sentence case and are only trimmed of the city's name.
 */
export function meetingTitle(meeting, lang = getLocale()) {
  if (!meeting) return '';
  let label = String(meeting.label || '').trim();
  if (meeting.cityName && label.toLowerCase().startsWith(`${meeting.cityName.toLowerCase()} `)) label = label.slice(meeting.cityName.length + 1);
  if (lang !== 'en') return label.charAt(0).toLocaleUpperCase(lang) + label.slice(1);
  const stripped = label.replace(/^(?:city |town )?council /i, '');
  if (stripped && stripped !== label && /\S/.test(stripped)) label = stripped;
  const words = label.split(/([\s/()]+)/);
  const generic = words.every((w) => !/[A-Za-z]/.test(w) || GENERIC.has(w.toLowerCase()));
  if (!generic) return label.charAt(0).toUpperCase() + label.slice(1);
  const lower = words.map((w) => (/[A-Za-z]/.test(w) ? w.toLowerCase() : w)).join('');
  return lower.charAt(0).toUpperCase() + lower.slice(1);
}

/** A clock time that never breaks between its digits and AM/PM. */
export function timeText(time) {
  return formatTime(time).replace(/ /g, '\u00a0');
}

/** "Plano City Council" */
export function councilName(cityOrMeeting) {
  const name = cityOrMeeting && (cityOrMeeting.cityName || cityOrMeeting.name);
  return name ? t('ui.council', { city: name }) : '';
}

/** "Mon, Oct 12, 7:00 PM" */
export function whenText(date, time) {
  return time ? t('ui.dateTime', { date: formatDate(date), time: timeText(time) }) : formatDate(date);
}

/** "Monday, October 12, 7:00 PM", for screen readers next to a date tile. */
export function whenLong(date, time) {
  const long = formatDate(date, { long: true });
  return time ? t('ui.dateTime', { date: long, time: timeText(time) }) : long;
}

/** "Oct 12" or, with a year, "Oct 12, 2026": a date without its weekday, in the app language. */
export function monthDay(date, { withYear = false } = {}) {
  const { y, m, d } = parseDate(date);
  const month = tList('format.monthsShort')[m - 1];
  return t(withYear ? 'ui.monthDayYear' : 'ui.monthDay', { month, day: d, year: y });
}

/** "Mon, 4:00 PM": weekday and time, for deadlines that are days away at most. */
export function dayTimeText(date, time) {
  const { y, m, d } = parseDate(date);
  const weekday = tList('format.weekdaysShort')[new Date(Date.UTC(y, m - 1, d)).getUTCDay()];
  return t('ui.dayTime', { day: weekday, time: timeText(time) });
}

/**
 * The structured sign-up deadline for a meeting ({ date, time, passed }) or null. Parsed from
 * the city's English source text, so it works the same in every language.
 */
export function meetingDeadline(meeting, now = new Date().toISOString()) {
  if (!meeting) return null;
  const raw = rawCity(meeting.cityId);
  const text = raw && raw.publicComment ? raw.publicComment.deadline : '';
  return signupDeadline(text, meeting, now);
}

/** A phrase as a sentence: one closing period, even after a Spanish "4:00 p.m.". */
export function asSentence(text) {
  const s = String(text || '').trim();
  return !s || /[.!?]$/.test(s) ? s : `${s}.`;
}

/** "Sign up by Mon, 4:00 PM" / "Sign-up closes Mon, 4:00 PM" / "Sign-up closed". */
export function deadlineText(deadline, form = 'by') {
  if (!deadline) return '';
  if (deadline.passed) return t('ui.signupClosed');
  const when = dayTimeText(deadline.date, deadline.time);
  return form === 'closes' ? t('ui.signupCloses', { when }) : t('ui.signupBy', { when });
}

/** A number never wraps away from its unit ("3 min", "3 phút", "2.7 mi"). */
const keepUnit = (text) => String(text).replace(/(\d)\s+(?=\S)/g, '$1\u00a0');

/** "Can speak, 3 min" or "Can speak". */
export function canSpeakText(city) {
  const n = speakMinutes(city);
  return n ? keepUnit(t('ui.canSpeakMin', { n })) : t('ui.canSpeak');
}

/** "Yes, for 3 minutes" or "Yes". */
export function canSpeakAnswer(city) {
  const n = speakMinutes(city);
  return n ? tn('ui.answerYesFor', n) : t('ui.answerYes');
}

/** Distance label for a row: "Your city", "2.7 mi", or ''. */
export function distanceText(meeting, { homeCityId, distanceMiles } = {}) {
  if (meeting && homeCityId && meeting.cityId === homeCityId) return t('ui.yourCity');
  const miles = distanceMiles != null ? distanceMiles : meeting && meeting.distanceMiles;
  if (miles == null || Number.isNaN(Number(miles))) return '';
  return keepUnit(t('ui.milesShort', { n: Number(miles) < 10 ? Number(miles).toFixed(1) : Math.round(Number(miles)) }));
}
