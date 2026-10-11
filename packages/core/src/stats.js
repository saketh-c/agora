import { upcomingMeetings, addDays, hourOf, agendaFor, isDateStr } from './schedule.js';
import { TOPICS } from './topics.js';

/** Days of agenda history that count as "recent" (matches agendaFor's default). */
const RECENT_AGENDA_DAYS = 60;

/** [{ topicId, count }] for a list of agenda items, most common first, empty topics left out. */
function countTopics(items) {
  const counts = new Map(TOPICS.map((t) => [t.id, 0]));
  for (const item of items) for (const id of item.topics || []) counts.set(id, (counts.get(id) || 0) + 1);
  return [...counts.entries()]
    .map(([topicId, count]) => ({ topicId, count }))
    .filter((x) => x.count > 0)
    .sort((a, b) => b.count - a.count);
}

/**
 * Aggregates for the Insights charts and the CLI summary. Pure function of the data.
 * Windows hold exactly `days` calendar days starting `today`; `now` (an ISO string) leaves out
 * meetings that already ended today from the headline counts.
 *
 * Agenda fields: `topicCounts` and `totals.agendaItems` count every item in the data, whatever
 * its date (kept for older callers). `upcomingTopicCounts` / `totals.upcomingAgendaItems` count
 * items dated today or later (or undated); `recentTopicCounts` / `totals.recentAgendaItems`
 * count items from `recentAgendaSince` up to yesterday.
 */
export function computeStats(cities, { today, days = 30, now } = {}) {
  const meetings = upcomingMeetings(cities, { from: today, days, now });
  const evening = meetings.filter((m) => m.isEvening).length;
  const speakable = meetings.filter((m) => m.openToPublicComment).length;
  const schoolHours = meetings.filter((m) => m.isSchoolHours).length;

  // Weekday x hour grid built from the next 90 days of occurrences (a full cycle for every rule).
  const grid = Array.from({ length: 7 }, () => Array(24).fill(0));
  const cycle = upcomingMeetings(cities, { from: today, days: 90 });
  for (const m of cycle) grid[m.weekday][hourOf(m.time)] += 1;

  // Per city: meetings per month that start after 5 PM vs during the day, from the same 90 days
  // of real occurrences, so cancellations, holiday moves and new times are all counted.
  const perCityCounts = new Map();
  for (const m of cycle) {
    const c = perCityCounts.get(m.cityId) || { evening: 0, daytime: 0 };
    if (m.isEvening) c.evening += 1;
    else c.daytime += 1;
    perCityCounts.set(m.cityId, c);
  }
  const perMonth = (n) => Math.round((n / 3) * 10) / 10;
  const perCity = cities.map((city) => {
    const c = perCityCounts.get(city.cityId) || { evening: 0, daytime: 0 };
    return {
      cityId: city.cityId,
      name: city.name,
      county: city.county,
      evening: perMonth(c.evening),
      daytime: perMonth(c.daytime),
      virtualComment: !!(city.publicComment && city.publicComment.virtualAllowed),
      youthPrograms: (city.youthPrograms || []).length,
      timeLimitMinutes: (city.publicComment && city.publicComment.timeLimitMinutes) || null,
    };
  });

  const allItems = [];
  const upcomingItems = [];
  const recentItems = [];
  for (const city of cities) {
    allItems.push(...(city.agendaItems || []));
    const split = agendaFor(city, today, { recentDays: RECENT_AGENDA_DAYS });
    upcomingItems.push(...split.upcoming);
    recentItems.push(...split.recent);
  }

  const byCounty = new Map();
  for (const c of cities) byCounty.set(c.county, (byCounty.get(c.county) || 0) + 1);

  return {
    today,
    windowDays: days,
    totals: {
      cities: cities.length,
      meetings: meetings.length,
      eveningShare: meetings.length ? evening / meetings.length : 0,
      speakableShare: meetings.length ? speakable / meetings.length : 0,
      schoolHoursShare: meetings.length ? schoolHours / meetings.length : 0,
      citiesWithYouthPrograms: cities.filter((c) => (c.youthPrograms || []).length).length,
      citiesWithVirtualComment: cities.filter((c) => c.publicComment && c.publicComment.virtualAllowed).length,
      agendaItems: allItems.length,
      upcomingAgendaItems: upcomingItems.length,
      recentAgendaItems: recentItems.length,
    },
    byWeekdayHour: grid,
    perCity: perCity.sort((a, b) => b.evening - a.evening || a.name.localeCompare(b.name)),
    topicCounts: countTopics(allItems),
    upcomingTopicCounts: countTopics(upcomingItems),
    recentTopicCounts: countTopics(recentItems),
    recentAgendaSince: isDateStr(today) ? addDays(today, -RECENT_AGENDA_DAYS) : null,
    byCounty: [...byCounty.entries()].map(([county, count]) => ({ county, count })).sort((a, b) => b.count - a.count),
  };
}
