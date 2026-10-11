/**
 * Small, shared answers about a meeting occurrence, worded once so every screen says the
 * same thing: can I speak and for how long, does it clash with school, is there a sign-up
 * deadline, what kind of meeting is it. Strings come from the `ui` dictionary namespace.
 */
import { formatDate, formatMiles, formatMonthDay, formatTime, t, tn, weekdayName } from '@agora/core';
import { rawCity } from '../../lib/data.js';
import { signupDeadline } from '../../lib/deadline.js';
import { setDeadlineResolver } from '../../lib/ics.js';
import { keepUnit, meetingTitle } from './meetingText.js';

export { keepUnit, meetingTitle };

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
  return formatMonthDay(date, { withYear });
}

/** "Mon, 4:00 PM": weekday and time, for deadlines that are days away at most. */
export function dayTimeText(date, time) {
  return t('ui.dayTime', { day: weekdayName(date, { short: true }), time: timeText(time) });
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

// Calendar files add the sign-up deadline as its own event, wherever they are made.
setDeadlineResolver((meeting) => meetingDeadline(meeting));

/**
 * A phrase as a sentence: one closing mark in the language's own style (core's asSentence:
 * "." in English, "。" in Chinese, "।" in Hindi), never a second one after a Spanish
 * "4:00 p.m.", a "？" or a "।".
 */
export { asSentence, joinSentences } from '@agora/core';

/** "Sign up by Mon, 4:00 PM" / "Sign-up closes Mon, 4:00 PM" / "Sign-up closed". */
export function deadlineText(deadline, form = 'by') {
  if (!deadline) return '';
  if (deadline.passed) return t('ui.signupClosed');
  const when = dayTimeText(deadline.date, deadline.time);
  return form === 'closes' ? t('ui.signupCloses', { when }) : t('ui.signupBy', { when });
}

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
  return keepUnit(t('ui.milesShort', { n: formatMiles(Number(miles)) }));
}
