/**
 * Which meeting Prepare, Write and Practice get ready for, and what the picker offers, as pure
 * functions over the core engine (tested in Node, no React or bundled data).
 *
 * One meeting is shared by Home ("Your next meeting") and every Prepare page:
 *  1. ?meeting=<id> in the address (from "Prepare to speak" or Home's Continue), or 'practice';
 *  2. ?city=<id> (old /learn?tab=comment&city= links): that council's next meeting you can speak at;
 *  3. the meeting saved in the profile (ui.prepMeeting), while it is at most 14 days old;
 *  4. otherwise exactly the meeting Home's card shows (homeData.pickNextMeeting), so steps
 *     marked on either page count for the same meeting. With no place set it is "Just practicing".
 * The page saves the meeting to ui.prepMeeting the first time the student acts on it.
 */
import { addDays, cityPoint, haversineMiles, nextMeetingFor, normalizePrefs, upcomingMeetings } from '@agora/core';
import { findMeeting, fitsTimes, pickNextMeeting } from '../home/homeData.js';
import { PRACTICE_ONLY } from '../../lib/prep.js';

/** A saved meeting stays selected this many days after it happened (for "share how it went"). */
export const KEEP_PAST_DAYS = 14;
/** Meetings the picker lists at a time, and how far ahead it looks. */
export const PICKER_PAGE = 10;
export const PICKER_DAYS = 60;
/** The home council's next dates shown at the top of the picker. */
export const PICKER_HOME_DATES = 3;

const noDeadline = () => null;

/** Open to public comment, not cancelled, and sign-up still open. */
export function canSpeakAt(meeting, deadlineOf = noDeadline) {
  if (!meeting || !meeting.openToPublicComment || meeting.status === 'cancelled') return false;
  const dl = deadlineOf(meeting);
  return !(dl && dl.passed);
}

/**
 * Resolve the meeting being prepared for.
 * Returns { meeting, practicing, problem: null | 'notFound' | 'cancelled', askedId, source,
 * pending } where source is 'address' | 'saved' | 'default'. `liveReady` is false until the
 * live agendas have answered: a meeting in the address that only a city's agenda site lists
 * cannot be found before then, so it is `pending` (no "not found" yet) instead.
 */
export function resolvePrepMeeting({ cities, cityById, prefs = {}, today, now, urlId = null, cityParam = null, savedId = null, deadlineOf = noDeadline, liveReady = true }) {
  let fromCity = null;
  if (!urlId && cityParam) {
    const city = cityById(cityParam);
    fromCity = city ? nextMeetingFor(city, today, { publicCommentOnly: true, now }) : null;
  }
  const askedId = urlId || (fromCity && fromCity.id) || null;
  const wanted = askedId || savedId || null;
  let meeting = null;
  let practicing = wanted === PRACTICE_ONLY;
  let problem = null;
  let pending = false;
  let source = practicing ? (askedId ? 'address' : 'saved') : 'default';

  if (!practicing && wanted) {
    const found = findMeeting(cityById, wanted);
    const cancelled = Boolean(found && found.status === 'cancelled');
    const tooOld = !found || found.date < addDays(today, -KEEP_PAST_DAYS);
    if (found && !tooOld && !cancelled) {
      meeting = found;
      source = askedId ? 'address' : 'saved';
    } else if (!found && !liveReady) pending = true;
    else if (askedId === wanted || cancelled) problem = cancelled ? 'cancelled' : 'notFound';
  }
  if (!meeting && !practicing) {
    const hasPlace = Boolean(prefs && (prefs.homeCityId || prefs.location));
    meeting = hasPlace ? pickNextMeeting(cities, cityById, prefs, { today, now, deadlineOf }) : null;
    practicing = !meeting;
    source = 'default';
  }
  return { meeting, practicing, problem, askedId, source, pending };
}

const fold = (s) =>
  String(s || '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();

/**
 * How well a typed search names this meeting's city: 0 by name (or initials like "fw"),
 * 1 by county ("dallas", "collin county"), or -1 for no match.
 */
export function queryRank(meeting, city, query) {
  const q = fold(query).replace(/\s+county$/, '');
  if (!q) return 0;
  const name = fold((city && city.name) || meeting.cityName);
  const words = name.split(/[\s-]+/).filter(Boolean);
  const initials = words.length > 1 ? words.map((w) => w[0]).join('') : '';
  if (name.includes(q) || (city && city.cityId === q)) return 0;
  if (initials && initials === q.replace(/\s+/g, '')) return 0;
  return city && city.county && fold(city.county).startsWith(q) ? 1 : -1;
}

/** Does a typed search name this meeting's city or county? */
export function meetingMatchesQuery(meeting, city, query) {
  return queryRank(meeting, city, query) >= 0;
}

/**
 * What the meeting picker lists, on Home ("Pick another meeting") and in Prepare (Change), so
 * both offer the same meetings.
 * - With a search: every upcoming meeting you can speak at in a matching city, soonest
 *   first, then those elsewhere in a matching county.
 * - Without: the home council's next dates (those at times the student said work, when it has
 *   any), then the next meetings at other councils at those times (fitsTimes) and within the
 *   distance limit, soonest first, two per council (all councils when no place or no limit is
 *   set). Councils past the limit come after those, nearest first, each with `pastLimit: true`
 *   so the row can say so.
 * Every meeting carries `distanceMiles` when there is a place. Returns { home, others, more }
 * where `more` says another page exists.
 */
export function pickerMeetings({ cities, cityById, prefs = {}, today, now, deadlineOf = noDeadline, query = '', limit = PICKER_PAGE, days = PICKER_DAYS }) {
  const all = upcomingMeetings(cities, { from: today, days, now }).filter((m) => canSpeakAt(m, deadlineOf));
  if (fold(query)) {
    // Cities named in the search come first ("dallas" is Dallas before Dallas County), soonest first.
    const hits = all
      .map((m, i) => ({ m, i, rank: queryRank(m, cityById(m.cityId), query) }))
      .filter((x) => x.rank >= 0)
      .sort((a, b) => a.rank - b.rank || a.i - b.i)
      .map((x) => x.m);
    return { home: [], others: hits.slice(0, limit), more: hits.length > limit };
  }
  const p = normalizePrefs(prefs);
  const homeId = p.homeCityId || null;
  const origin = p.location;
  const milesOf = (m) => {
    const city = origin ? cityById(m.cityId) : null;
    return city ? haversineMiles(origin, cityPoint(city)) : null;
  };
  const withMiles = (m) => ({ ...m, distanceMiles: milesOf(m) });
  const fits = (m) => fitsTimes(m, p);
  const atHome = homeId ? all.filter((m) => m.cityId === homeId) : [];
  const home = (atHome.some(fits) ? atHome.filter(fits) : atHome).slice(0, PICKER_HOME_DATES).map(withMiles);
  // Two dates per council, so one council's calendar does not fill the list.
  const twoEach = (list) => {
    const seen = new Map();
    return list.filter((m) => {
      const n = seen.get(m.cityId) || 0;
      seen.set(m.cityId, n + 1);
      return n < 2;
    });
  };
  const others = all.filter((m) => m.cityId !== homeId && fits(m)).map(withMiles);
  if (!origin || p.maxMiles == null) {
    const rest = twoEach(others);
    return { home, others: rest.slice(0, limit), more: rest.length > limit };
  }
  const near = twoEach(others.filter((m) => m.distanceMiles != null && m.distanceMiles <= p.maxMiles));
  const far = twoEach(
    others
      .filter((m) => !(m.distanceMiles <= p.maxMiles))
      .sort((a, b) => (a.distanceMiles ?? Infinity) - (b.distanceMiles ?? Infinity) || a.date.localeCompare(b.date) || a.time.localeCompare(b.time)),
  ).map((m) => ({ ...m, pastLimit: true }));
  const rest = [...near, ...far];
  return { home, others: rest.slice(0, limit), more: rest.length > limit };
}
