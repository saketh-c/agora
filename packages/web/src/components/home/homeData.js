/**
 * What Home shows, as pure functions over the core engine, so they can be tested in Node.
 * Nothing here touches React, the DOM or the bundled data: callers pass the cities, the
 * preferences, `today` (a Central-time 'YYYY-MM-DD'), `now` (an ISO instant, so meetings that
 * already ended drop out) and `deadlineOf(meeting)` (the sign-up deadline, or null).
 */
import { cityPoint, daysBetween, expandCityMeetings, hasEnded, haversineMiles, isDateStr, matchMeetings, matchYouthPrograms, normalizePrefs, todayStr, upcomingMeetings, youthApplyRank, youthApplyState } from '@agora/core';

/** Home looks this many days ahead (the same window the old For you page used). */
export const HOME_DAYS = 45;
/** Rows in "Meetings you can speak at" and "Coming up for you". */
export const HOME_ROWS = 3;
/** The first-visit topic chips: the ones students pick most, then "All 17 topics". */
export const STARTER_TOPICS = Object.freeze(['parks-recreation', 'transit', 'housing', 'youth', 'environment', 'public-safety']);

const noDeadline = () => null;

/** Can a student still speak at this meeting: open to comment, not cancelled, sign-up not closed. */
export function isSpeakable(meeting, deadlineOf = noDeadline) {
  if (!meeting || !meeting.openToPublicComment || meeting.status === 'cancelled') return false;
  const dl = deadlineOf(meeting);
  return !(dl && dl.passed);
}

/**
 * Meetings ranked for these preferences that a student can speak at, at most one per council
 * (so a list is not one city's calendar). Ranking is core's matchMeetings: topics, times,
 * distance, home city, how soon.
 */
export function rankedSpeakable(cities, prefs, { today, now, deadlineOf = noDeadline, perCity = 1, limit = 12, days = HOME_DAYS, keepFar = false } = {}) {
  const p = { ...normalizePrefs(prefs), canSpeakOnly: true };
  return matchMeetings(cities, p, { today, now, days, perCity, limit: limit + 8, keepFar })
    .filter((m) => isSpeakable(m, deadlineOf))
    .slice(0, limit);
}

/** True when a meeting is within the student's distance limit (always, with no limit or no place). */
export function withinLimit(meeting, prefs) {
  const p = normalizePrefs(prefs);
  return p.maxMiles == null || !p.location || meeting.distanceMiles == null || meeting.distanceMiles <= p.maxMiles;
}

/**
 * Speakable meetings for the returning Home: those within the distance limit first, then (so
 * Home is never quietly empty) the ones farther away, which the page labels as farther.
 */
function nearThenFar(cities, prefs, opts) {
  const list = rankedSpeakable(cities, prefs, { ...opts, keepFar: true });
  return [...list.filter((m) => withinLimit(m, prefs)), ...list.filter((m) => !withinLimit(m, prefs))];
}

/** True when a meeting falls in a time the student said works (weekday evenings, daytime, weekends). */
export function fitsTimes(meeting, prefs) {
  const { availability } = normalizePrefs(prefs);
  if (meeting.weekday === 0 || meeting.weekday === 6) return availability.weekends;
  return meeting.isEvening ? availability.evenings : availability.daytime;
}

/**
 * The first-visit list: meetings a student can speak at, at times that work for them, one per
 * council. Councils whose recent agendas touched the chosen topics come first; otherwise the
 * soonest come first, so the list reads like a calendar until a topic says otherwise.
 */
export function firstVisitMeetings(cities, prefs, { today, now, deadlineOf = noDeadline, limit = HOME_ROWS } = {}) {
  const topical = (m) => (m.reasons || []).some((r) => r.kind === 'topic' && r.points > 0);
  return rankedSpeakable(cities, prefs, { today, now, deadlineOf, perCity: 1, limit: 60 })
    .filter((m) => fitsTimes(m, prefs))
    .sort((a, b) => Number(topical(b)) - Number(topical(a)) || a.date.localeCompare(b.date) || a.time.localeCompare(b.time) || a.cityName.localeCompare(b.cityName))
    .slice(0, limit);
}

/** A meeting occurrence from its language-independent id (`${cityId}:${date}:${slug}`), or null. */
export function findMeeting(cityById, id) {
  if (!id || typeof id !== 'string' || id.length > 200) return null;
  const [cityId, date] = id.split(':');
  const city = cityId ? cityById(cityId) : null;
  if (!city || !isDateStr(date)) return null;
  return expandCityMeetings(city, date, date).find((m) => m.id === id) || null;
}

/**
 * The meeting for the "Your next meeting" card.
 * - The one the student chose in Prepare (ui.prepMeeting), while it is still ahead and open to
 *   comment, so Home and Prepare talk about the same meeting. A closed sign-up still counts
 *   here: the card says so instead of silently switching meetings.
 * - Otherwise the best-ranked meeting they can still speak at.
 */
export function pickNextMeeting(cities, cityById, prefs, { today, now, prepMeetingId, deadlineOf = noDeadline } = {}) {
  if (prepMeetingId && prepMeetingId !== 'practice') {
    const chosen = findMeeting(cityById, prepMeetingId);
    if (chosen && chosen.date >= today && !hasEnded(chosen, now) && chosen.openToPublicComment && chosen.status !== 'cancelled') {
      const p = normalizePrefs(prefs);
      const distanceMiles = p.location ? haversineMiles(p.location, cityPoint(cityById(chosen.cityId))) : null;
      return { ...chosen, distanceMiles };
    }
  }
  return nearThenFar(cities, prefs, { today, now, deadlineOf, perCity: 1, limit: 12 })[0] || null;
}

/**
 * "Coming up for you": good matches at other councils than the featured meeting, one per
 * council, shown soonest first so the list reads as a calendar. Meetings within the distance
 * limit come first; farther ones only fill the list when there are too few near.
 */
export function comingUp(cities, prefs, { today, now, exclude, deadlineOf = noDeadline, limit = HOME_ROWS } = {}) {
  const skipCity = exclude ? exclude.cityId : null;
  const bySoonest = (a, b) => a.date.localeCompare(b.date) || a.time.localeCompare(b.time) || a.cityName.localeCompare(b.cityName);
  const list = nearThenFar(cities, prefs, { today, now, deadlineOf, perCity: 1, limit: limit + 30 }).filter((m) => m.cityId !== skipCity && (!exclude || m.id !== exclude.id));
  const near = list.filter((m) => withinLimit(m, prefs)).slice(0, limit);
  // Past the limit, the nearest councils fill in (not the best scored far away).
  const far = list
    .filter((m) => !withinLimit(m, prefs))
    .sort((a, b) => a.distanceMiles - b.distanceMiles)
    .slice(0, limit - near.length);
  return [...near.sort(bySoonest), ...far.sort(bySoonest)];
}

/**
 * "Seats you can apply for": youth councils and programs, each with `apply`, where its
 * application stands (core/src/youth.js youthApplyState). A program whose window is closed is
 * left out. Within the student's distance limit first; then the ones you can apply to now
 * (closing soon, open, rolling) before those the city says nothing about; then home city
 * first and nearest.
 */
export function seatsNear(cities, prefs, limit = HOME_ROWS, today = todayStr('America/Chicago')) {
  const p = normalizePrefs(prefs);
  const within = (s) => p.maxMiles == null || s.distanceMiles == null || s.distanceMiles <= p.maxMiles;
  return matchYouthPrograms(cities, prefs)
    .map((s, i) => ({ s: { ...s, apply: youthApplyState(s, today) }, i }))
    .filter(({ s }) => s.apply.state !== 'closed')
    .sort((a, b) => Number(within(b.s)) - Number(within(a.s)) || youthApplyRank(a.s.apply.state) - youthApplyRank(b.s.apply.state) || a.i - b.i)
    .slice(0, limit)
    .map(({ s }) => s);
}

/**
 * Share of council meetings in the next `days` days that start at 5 PM or later, rounded to
 * tenths ("8 in 10"). Cancelled and ended meetings do not count.
 */
export function eveningShare(cities, { today, now, days = 90 } = {}) {
  const list = upcomingMeetings(cities, { from: today, days, now });
  if (!list.length) return null;
  const evening = list.filter((m) => m.isEvening).length;
  return { inTen: Math.round((evening / list.length) * 10), days, total: list.length };
}

/** Whole days from `today` to the meeting (0 = today). */
export function daysUntil(meeting, today) {
  return meeting ? Math.max(0, daysBetween(today, meeting.date)) : null;
}

/**
 * Which greeting the returning headline uses: 'today', 'tomorrow', 'day' (a weekday within the
 * coming week) or 'date' (further out), or 'hi' with no meeting to point at.
 */
export function greetingKind(meeting, today) {
  if (!meeting) return 'hi';
  const n = daysUntil(meeting, today);
  if (n === 0) return 'today';
  if (n === 1) return 'tomorrow';
  return n <= 6 ? 'day' : 'date';
}

/**
 * Up to `limit` headlines for Home: the student's topics and city first, newest first among
 * equals. With nothing that matches, the newest regional headlines.
 */
export function pickNews(items, { interests = [], homeCityId = null, county = null, limit = 3 } = {}) {
  const list = (items || []).filter((i) => i && i.title && i.link);
  const time = (i) => Date.parse(i.publishedAt || '') || 0;
  const score = (i) => {
    let s = 0;
    if ((i.topics || []).some((id) => interests.includes(id))) s += 2;
    if (homeCityId && (i.places || []).includes(homeCityId)) s += 3;
    else if (county && (i.counties || []).includes(county)) s += 1;
    return s;
  };
  const scored = list.map((i) => ({ i, s: score(i) }));
  const any = scored.some((x) => x.s > 0);
  return scored
    .filter((x) => !any || x.s > 0)
    .sort((a, b) => b.s - a.s || time(b.i) - time(a.i))
    .slice(0, limit)
    .map((x) => x.i);
}

/** The one community post Home features: the student's city first, then most helpful, then newest. */
export function pickPost(posts, { homeCityId = null } = {}) {
  const list = (posts || []).filter((p) => p && p.title);
  list.sort(
    (a, b) =>
      Number(Boolean(homeCityId) && b.cityId === homeCityId) - Number(Boolean(homeCityId) && a.cityId === homeCityId) ||
      (b.helpful || 0) - (a.helpful || 0) ||
      String(b.postedAt || '').localeCompare(String(a.postedAt || '')),
  );
  return list[0] || null;
}
