/**
 * Everything the package exports. ./index.js (Node) adds every language's dictionary up front;
 * ./index.browser.js (the web app's build) leaves languages other than English to loadLocale().
 */
export { BRAND } from './brand.js';
export { TOPICS, TOPIC_IDS, getTopic, topicList, topicLabel, isTopicId, inferTopics } from './topics.js';
export { LOCALES, DICTIONARIES, t, tn, tList, joinList, lowerFirst, setLocale, getLocale, isLocale, hasLocale, loadLocale, registerLocale, detectLocale, onLocaleChange, dictionaryKeys } from './i18n/runtime.js';
export { CITY_TEXT_FIELDS, CITY_ARRAY_FIELDS, CITY_SOURCE_FIELDS, collectCityStrings, localizeCity, localizeCities, translationCoverage } from './i18n/data.js';
export {
  isDateStr,
  isTimeStr,
  parseDate,
  toDateStr,
  addDays,
  daysBetween,
  windowEnd,
  weekdayOf,
  daysInMonth,
  nthWeekdayOfMonth,
  compareDates,
  todayStr,
  nowTimeStr,
  isDst,
  centralOffset,
  toISO,
  hourOf,
  isEvening,
  isSchoolHours,
  DEFAULT_MEETING_MINUTES,
  hasEnded,
  occurrencesForRule,
  expandCityMeetings,
  upcomingMeetings,
  nextMeetingFor,
  agendaFor,
  calendarThrough,
  timeFromNote,
  timesFromNote,
  dateFromNote,
} from './schedule.js';
export { WEEKDAY_NAMES, WEEKDAY_SHORT, weekdayNames, weekdayShortNames, formatTime, formatDate, relativeDays, milesText, describeRecurrence, ordinalWord, pluralize } from './format.js';
export { DFW_BOUNDS, DFW_CENTER, haversineMiles, isInDfw, cityPoint, nearestCity, citiesWithin, cardinal, findCity } from './geo.js';
export { PLACE_QUERY_MAX, DFW_ZIP_PREFIXES, DFW_VIEWBOX, NOMINATIM_SEARCH_URL, normalizePlaceQuery, zipOf, isDfwZip, localCityFor, nominatimRequest, judgeNominatim, resolveLocally, placeLabel, round3 } from './place.js';
export { defaultPrefs, normalizePrefs, scoreMeeting, matchMeetings, matchAgendaItems, matchYouthPrograms, buildPlan } from './match.js';
export { GLOSSARY, FIRST_MEETING_CHECKLIST, SPEAKING_TIPS, glossary, checklist, speakingTips, buildComment, estimateSpeakingSeconds, timeOfDayFor } from './civics.js';
export { validateCity, validateCities, scheduleWarnings, isUrl, forEachCityUrl } from './validate.js';
export { computeStats } from './stats.js';
export { APPLY_STATUSES, CLOSING_SOON_DAYS, youthApplyState, youthApplyRank } from './youth.js';
export { AGENDA_SOURCES, AGENDA_USER_AGENT, buildAgendaSnapshot, isAgendaSnapshot, snapshotCounts, failingAgendaSources, planLiveAgendas, applyLivePlans, liveMeetingFor } from './agendas.js';
