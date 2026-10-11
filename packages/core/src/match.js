import { upcomingMeetings, daysBetween, hourOf, agendaFor, parseDate, compareDates } from './schedule.js';
import { haversineMiles, cityPoint } from './geo.js';
import { getTopic, isTopicId } from './topics.js';
import { milesText, formatDate, formatTime } from './format.js';
import { t, tn, tList, joinList, isLocale, lowerFirst } from './i18n/runtime.js';

/**
 * User preferences. No account needed: the web app keeps these in localStorage and
 * the CLI keeps them in a small JSON file.
 */
export function defaultPrefs() {
  return {
    lang: null,
    interests: [],
    availability: { evenings: true, daytime: false, weekends: true },
    location: null,
    locationLabel: '',
    homeCityId: null,
    maxMiles: 15,
    virtualOk: true,
    canSpeakOnly: false,
    student: true,
  };
}

export function normalizePrefs(input) {
  const base = defaultPrefs();
  const p = { ...base, ...(input || {}) };
  p.lang = isLocale(p.lang) ? p.lang : null;
  p.interests = Array.isArray(p.interests) ? p.interests.filter(isTopicId) : [];
  p.availability = { ...base.availability, ...(p.availability || {}) };
  // NaN or Infinity (for example from ?lat=abc) would make every distance meaningless, so such a location is dropped.
  if (p.location && !(Number.isFinite(p.location.lat) && Number.isFinite(p.location.lng))) p.location = null;
  // null means "any distance": no limit, no penalty, nothing dropped.
  p.maxMiles = p.maxMiles === null ? null : Number.isFinite(Number(p.maxMiles)) && Number(p.maxMiles) > 0 ? Number(p.maxMiles) : base.maxMiles;
  p.virtualOk = p.virtualOk !== false;
  p.canSpeakOnly = p.canSpeakOnly === true;
  p.student = p.student !== false;
  return p;
}

function itemMatches(item, interests) {
  return (item.topics || []).some((t) => interests.includes(t));
}

/** Points for a meeting's own agenda touching the student's topics: 3 per topic it touches, at most 6. */
export const TOPIC_POINTS = 3;
export const TOPIC_POINTS_MAX = 6;

/**
 * Points for distance. Close by counts for a meeting (5 mi +4, 10 mi +2); past 15 mi, within the
 * student's limit or with no limit, each further 5 mi started costs a point, down to the same -5
 * as a meeting past the limit (from 35 mi on). So "Any distance" still lists nearer councils
 * first: even the most topic points (+6) never lift a council 35 mi or more away above an
 * otherwise equal one within 10 mi.
 */
export function distancePoints(miles, maxMiles) {
  if (maxMiles != null && miles > maxMiles) return -5;
  if (miles <= 5) return 4;
  if (miles <= 10) return 2;
  if (miles <= 15) return 0;
  return -Math.min(5, Math.ceil((miles - 15) / 5));
}

/** Short names of the user's topics that a set of agenda items touches (at most two), joined for a sentence. */
function topicsPhrase(items, interests) {
  const ids = [...new Set(items.flatMap((it) => (it.topics || []).filter((id) => interests.includes(id))))];
  return joinList(
    ids.slice(0, 2).map((id) => {
      const topic = getTopic(id);
      return topic.short || lowerFirst(topic.label);
    }),
  );
}

/**
 * Score one meeting occurrence for a user. Returns the score plus plain-language reasons so
 * the UI can show why something was recommended. Reasons come strongest first (by points,
 * ignoring sign), so a page that shows the first one or two shows the ones that mattered.
 */
export function scoreMeeting(meeting, city, prefs, { today } = {}) {
  const reasons = [];
  let score = 0;
  const add = (points, text, kind) => {
    score += points;
    reasons.push({ text, kind, points });
  };

  // Topics. An item on this meeting's own agenda is the strongest signal; it counts by topic, not
  // by item, so a long posted agenda (a city site lists up to 12) does not outweigh distance.
  // Without one, a recent agenda at this council that touched the user's topics is a weak hint,
  // dated so it reads as past.
  const matchedItems = (meeting.agendaItems || []).filter((it) => itemMatches(it, prefs.interests));
  if (matchedItems.length) {
    const touched = new Set(matchedItems.flatMap((it) => (it.topics || []).filter((id) => prefs.interests.includes(id))));
    add(Math.min(TOPIC_POINTS_MAX, touched.size * TOPIC_POINTS), tn('match.itemsOn', matchedItems.length, { topics: topicsPhrase(matchedItems, prefs.interests) }), 'topic');
  } else if (prefs.interests.length && city && today) {
    const recent = agendaFor(city, today).recent.filter((it) => itemMatches(it, prefs.interests));
    if (recent.length) {
      const latest = recent[0].meetingDate;
      const { m, d } = parseDate(latest);
      const topics = topicsPhrase(
        recent.filter((it) => it.meetingDate === latest),
        prefs.interests,
      );
      add(1, t('match.recentAgenda', { topics, month: tList('format.monthsShort')[m - 1], day: d }), 'topic');
    }
  }

  // Time of day and day of week.
  const hour = hourOf(meeting.time);
  const weekend = meeting.weekday === 0 || meeting.weekday === 6;
  if (weekend) {
    if (prefs.availability.weekends) add(2, t('match.weekendMeeting'), 'time');
    else add(-2, t('match.weekendMeeting'), 'time');
  } else if (hour >= 17) {
    if (prefs.availability.evenings) add(3, t('match.eveningAfterSchool'), 'time');
    else add(-1, t('match.eveningMeeting'), 'time');
  } else if (meeting.isSchoolHours && prefs.student) {
    if (prefs.availability.daytime) add(0, t('match.duringSchool'), 'time');
    else if (meeting.virtualUrl && prefs.virtualOk) add(-2, t('match.duringSchoolStream'), 'time');
    else add(-4, t('match.duringSchool'), 'time');
  } else if (prefs.availability.daytime) {
    add(1, t('match.daytimeMeeting'), 'time');
  } else {
    add(-1, t('match.daytimeMeeting'), 'time');
  }

  // Distance and home city. Past the user's own limit always counts against a meeting, even
  // when the limit is under the 5 and 10 mile tiers; across the region (a wide limit or none),
  // nearer still ranks higher (see distancePoints).
  let distanceMiles = null;
  if (prefs.location) {
    distanceMiles = haversineMiles(prefs.location, cityPoint(city));
    if (distanceMiles != null) {
      const distance = milesText(distanceMiles);
      const past = prefs.maxMiles != null && distanceMiles > prefs.maxMiles;
      add(distancePoints(distanceMiles, prefs.maxMiles), past ? t('match.awayPastLimit', { distance, max: prefs.maxMiles }) : t('match.away', { distance }), 'distance');
    }
  }
  if (prefs.homeCityId && city && prefs.homeCityId === city.cityId) add(3, t('match.yourCity'), 'distance');

  // Ability to participate. Remote comment only matters where the public may comment at all.
  if (meeting.openToPublicComment) {
    add(2, t('match.canSignUp'), 'speak');
    if (city && city.publicComment && city.publicComment.virtualAllowed && prefs.virtualOk) add(1, t('match.remoteAllowed'), 'speak');
  }

  // Timing.
  const days = daysBetween(today, meeting.date);
  if (days <= 3) add(2, t('match.thisWeek'), 'soon');
  else if (days <= 7) add(1, t('match.withinWeek'), 'soon');

  if (city && (city.youthPrograms || []).length) add(1, t('match.youthPrograms'), 'youth');
  if (meeting.status === 'rescheduled' || meeting.status === 'special') add(0, t('match.scheduleChange'), 'note');

  // Stable sort: equal strengths keep the order above.
  reasons.sort((a, b) => Math.abs(b.points) - Math.abs(a.points));
  return { score, reasons, distanceMiles, matchedItems };
}

/**
 * Rank upcoming meetings for a user over the `days` calendar days starting `today`.
 * `now` (an ISO string) drops meetings that already ended today. `perCity` caps how many
 * meetings one council may contribute, so a ranked list is not one city's calendar
 * (default: no cap). Meetings farther than twice the distance limit are dropped unless
 * `keepFar` is true (they still rank below nearer ones through the distance penalty).
 */
export function matchMeetings(cities, prefsInput, { today, days = 45, limit = 25, now, perCity, keepFar = false } = {}) {
  const prefs = normalizePrefs(prefsInput);
  const byId = new Map(cities.map((c) => [c.cityId, c]));
  const meetings = upcomingMeetings(cities, { from: today, days, now });
  const scored = [];
  for (const m of meetings) {
    if (prefs.canSpeakOnly && !m.openToPublicComment) continue;
    const city = byId.get(m.cityId);
    const { score, reasons, distanceMiles, matchedItems } = scoreMeeting(m, city, prefs, { today });
    if (!keepFar && prefs.location && prefs.maxMiles != null && distanceMiles != null && distanceMiles > prefs.maxMiles * 2) continue;
    scored.push({ ...m, score, reasons, distanceMiles, matchedItems });
  }
  scored.sort((a, b) => b.score - a.score || compareDates(a.date, b.date) || a.time.localeCompare(b.time) || a.cityName.localeCompare(b.cityName));
  const cap = Number.isInteger(perCity) && perCity > 0 ? perCity : Infinity;
  const perCityCount = new Map();
  const out = [];
  for (const m of scored) {
    if (out.length >= limit) break;
    const n = perCityCount.get(m.cityId) || 0;
    if (n >= cap) continue;
    perCityCount.set(m.cityId, n + 1);
    out.push(m);
  }
  return out;
}

/**
 * Agenda items across all cities that touch the user's interests. By default the upcoming
 * ones (dated today or later, or undated), soonest first among equal scores; with
 * `recent: true` the ones from the last 60 days, newest first.
 */
export function matchAgendaItems(cities, prefsInput, { today, limit = 30, recent = false } = {}) {
  const prefs = normalizePrefs(prefsInput);
  const out = [];
  for (const city of cities) {
    const distanceMiles = prefs.location ? haversineMiles(prefs.location, cityPoint(city)) : null;
    if (distanceMiles != null && prefs.maxMiles != null && distanceMiles > prefs.maxMiles * 2) continue;
    const split = agendaFor(city, today);
    for (const item of recent ? split.recent : split.upcoming) {
      const hits = (item.topics || []).filter((t) => prefs.interests.includes(t));
      if (!hits.length && prefs.interests.length) continue;
      out.push({
        ...item,
        cityId: city.cityId,
        cityName: city.name,
        matchedTopics: hits,
        distanceMiles,
        score: hits.length * 3 + (prefs.homeCityId === city.cityId ? 3 : 0) + (distanceMiles != null && distanceMiles <= 10 ? 2 : 0),
      });
    }
  }
  const when = (x) => String(x.meetingDate || '9');
  out.sort((a, b) => b.score - a.score || (recent ? when(b).localeCompare(when(a)) : when(a).localeCompare(when(b))));
  return out.slice(0, limit);
}

/** Youth councils and commissions, nearest first when a location is known. */
export function matchYouthPrograms(cities, prefsInput) {
  const prefs = normalizePrefs(prefsInput);
  const out = [];
  for (const city of cities) {
    const distanceMiles = prefs.location ? haversineMiles(prefs.location, cityPoint(city)) : null;
    for (const p of city.youthPrograms || []) {
      out.push({ ...p, cityId: city.cityId, cityName: city.name, distanceMiles, home: prefs.homeCityId === city.cityId });
    }
  }
  out.sort((a, b) => Number(b.home) - Number(a.home) || (a.distanceMiles ?? 999) - (b.distanceMiles ?? 999) || a.cityName.localeCompare(b.cityName));
  return out;
}

/**
 * Everything the "Your plan" screen needs, in one call. The ranked meetings hold at most two
 * per council. `recentAgendaItems` lists matching items from the last 60 days, for when
 * nothing on the user's topics is on an upcoming agenda yet.
 */
export function buildPlan(cities, prefsInput, { today, days = 45, now } = {}) {
  const prefs = normalizePrefs(prefsInput);
  const meetings = matchMeetings(cities, prefs, { today, days, limit: 12, now, perCity: 2 });
  const agendaItems = matchAgendaItems(cities, prefs, { today, limit: 12 });
  const recentAgendaItems = matchAgendaItems(cities, prefs, { today, limit: 12, recent: true });
  const youthPrograms = matchYouthPrograms(cities, prefs).slice(0, 8);
  const top = meetings[0] || null;
  const why = top
    ? top.reasons
        .filter((r) => r.points > 0)
        .slice(0, 2)
        .map((r) => lowerFirst(r.text))
    : [];
  const summary = top
    ? t('match.summary', { city: top.cityName, label: top.label, date: formatDate(top.date), time: formatTime(top.time), why: why.length ? ` (${why.join('; ')})` : '' })
    : t('match.noMatches');
  return { prefs, meetings, agendaItems, recentAgendaItems, youthPrograms, summary };
}
