import { isDateStr, isTimeStr, weekdayOf } from './schedule.js';
import { isInDfw } from './geo.js';
import { isTopicId } from './topics.js';

const KINDS = new Set(['nth-weekday', 'weekly', 'biweekly', 'custom']);
const MEETING_TYPES = new Set(['regular', 'work-session', 'briefing', 'town-hall', 'committee', 'other']);
/**
 * Exception statuses (see expandCityMeetings): cancelled and recess cancel a date's meetings,
 * rescheduled moves or retimes them, special marks or adds a special session, and note only
 * attaches information without changing the meeting.
 */
const EXCEPTION_STATUS = new Set(['cancelled', 'rescheduled', 'special', 'recess', 'note']);
/** Fields that describe the separate meeting a special exception adds. */
const SPECIAL_ONLY = ['label', 'type', 'openToPublicComment'];

export function isUrl(u) {
  return typeof u === 'string' && /^https?:\/\/\S+$/i.test(u);
}

/**
 * Visit every URL-bearing field of a city record as fn(value, path, owner, key), skipping empty
 * ones. Pages render all of these as links, so each must be http(s); build-data uses this to
 * drop any that is not.
 */
export function forEachCityUrl(city, fn) {
  if (!city || typeof city !== 'object') return;
  const visit = (owner, key, path) => {
    const v = owner[key];
    if (v !== undefined && v !== null && v !== '') fn(v, path, owner, key);
  };
  visit(city, 'website', 'website');
  visit(city, 'councilPageUrl', 'councilPageUrl');
  const nested = { council: ['findMyDistrictUrl', 'districtMapUrl'], publicComment: ['registrationUrl', 'source'], agendaPortal: ['url', 'source'], liveStream: ['url', 'source'] };
  for (const [obj, keys] of Object.entries(nested)) {
    const owner = city[obj];
    if (owner && typeof owner === 'object') for (const k of keys) visit(owner, k, `${obj}.${k}`);
  }
  const arrays = { meetings: ['virtualUrl', 'source'], scheduleExceptions: ['source'], youthPrograms: ['url', 'source'], agendaItems: ['url'] };
  for (const [arr, keys] of Object.entries(arrays)) {
    if (!Array.isArray(city[arr])) continue;
    city[arr].forEach((item, i) => {
      if (item && typeof item === 'object') for (const k of keys) visit(item, k, `${arr}[${i}].${k}`);
    });
  }
  if (Array.isArray(city.sources)) city.sources.forEach((_, i) => visit(city.sources, i, `sources[${i}]`));
}

/** Returns a list of human-readable problems; empty means the city record is usable. */
export function validateCity(city) {
  const errors = [];
  const where = (city && city.cityId) || (city && city.name) || 'unknown city';
  const err = (msg) => errors.push(`${where}: ${msg}`);

  if (!city || typeof city !== 'object') return ['city record is not an object'];
  if (!city.cityId || !/^[a-z0-9-]+$/.test(city.cityId)) err('cityId must be a lowercase kebab-case slug');
  if (!city.name) err('name is required');
  if (!city.county) err('county is required');
  if (!isUrl(city.website)) err('website must be an http(s) URL');

  const hall = city.cityHall;
  if (!hall || typeof hall !== 'object') err('cityHall is required');
  else {
    if (!hall.address) err('cityHall.address is required');
    if (typeof hall.lat !== 'number' || typeof hall.lng !== 'number') err('cityHall.lat/lng must be numbers');
    else if (!isInDfw(hall)) err(`cityHall coordinates (${hall.lat}, ${hall.lng}) fall outside Dallas-Fort Worth`);
  }

  if (!Array.isArray(city.meetings) || !city.meetings.length) err('at least one meeting rule is required');
  else {
    city.meetings.forEach((m, i) => {
      const tag = `meetings[${i}]`;
      if (!MEETING_TYPES.has(m.type)) err(`${tag}.type "${m.type}" is not a known meeting type`);
      if (!m.label) err(`${tag}.label is required`);
      const r = m.recurrence;
      if (!r || typeof r !== 'object') return err(`${tag}.recurrence is required`);
      if (!KINDS.has(r.kind)) err(`${tag}.recurrence.kind "${r.kind}" is not valid`);
      if (!Number.isInteger(r.weekday) || r.weekday < 0 || r.weekday > 6) err(`${tag}.recurrence.weekday must be 0..6`);
      if (!isTimeStr(r.time)) err(`${tag}.recurrence.time "${r.time}" must be HH:MM (24-hour)`);
      if (r.kind === 'nth-weekday') {
        if (!Array.isArray(r.ordinals) || !r.ordinals.length) err(`${tag}.recurrence.ordinals is required for nth-weekday`);
        else if (r.ordinals.some((n) => !Number.isInteger(n) || n < 1 || n > 5)) err(`${tag}.recurrence.ordinals must be integers 1..5`);
      }
      if (r.kind === 'biweekly') {
        if (!isDateStr(r.anchorDate)) err(`${tag}.recurrence.anchorDate (a known meeting date, YYYY-MM-DD) is required for biweekly`);
        else if (weekdayOf(r.anchorDate) !== r.weekday) err(`${tag}.recurrence.anchorDate falls on a different weekday than recurrence.weekday`);
      }
      if (m.openToPublicComment !== undefined && typeof m.openToPublicComment !== 'boolean') err(`${tag}.openToPublicComment must be true or false`);
      if (r.kind === 'custom') {
        if (!Array.isArray(r.dates) || !r.dates.length) err(`${tag}.recurrence.dates is required for custom`);
        else if (r.dates.some((d) => !isDateStr(d))) err(`${tag}.recurrence.dates must all be YYYY-MM-DD`);
      }
    });
  }

  for (const key of ['scheduleExceptions', 'youthPrograms', 'agendaItems', 'sources']) {
    if (city[key] !== undefined && !Array.isArray(city[key])) err(`${key} must be an array`);
  }
  const arr = (key) => (Array.isArray(city[key]) ? city[key] : []);

  arr('scheduleExceptions').forEach((ex, i) => {
    const tag = `scheduleExceptions[${i}]`;
    if (!isDateStr(ex.date)) err(`${tag}.date must be YYYY-MM-DD`);
    if (!EXCEPTION_STATUS.has(ex.status)) err(`${tag}.status "${ex.status}" is not valid`);
    for (const f of ['movedFrom', 'movedTo']) {
      if (ex[f] !== undefined && !isDateStr(ex[f])) err(`${tag}.${f} must be YYYY-MM-DD`);
      if (ex[f] && ex.status !== 'rescheduled') err(`${tag}.${f} only applies to rescheduled exceptions`);
    }
    if (ex.time !== undefined && !isTimeStr(ex.time)) err(`${tag}.time "${ex.time}" must be HH:MM (24-hour)`);
    for (const f of SPECIAL_ONLY) if (ex[f] !== undefined && ex.status !== 'special') err(`${tag}.${f} only applies to special exceptions`);
    if (ex.label !== undefined && (typeof ex.label !== 'string' || !ex.label.trim())) err(`${tag}.label must be a non-empty string`);
    if (ex.type !== undefined && !MEETING_TYPES.has(ex.type)) err(`${tag}.type "${ex.type}" is not a known meeting type`);
    if (ex.openToPublicComment !== undefined && typeof ex.openToPublicComment !== 'boolean') err(`${tag}.openToPublicComment must be true or false`);
    if (ex.status === 'note' && !ex.note) err(`${tag}.note is required for a note exception`);
  });

  const pc = city.publicComment;
  if (!pc || typeof pc !== 'object') err('publicComment is required');
  else {
    if (!pc.summary) err('publicComment.summary is required');
    if (!pc.howToRegister) err('publicComment.howToRegister is required');
  }

  forEachCityUrl(city, (value, path) => {
    if (path !== 'website' && !isUrl(value)) err(`${path} is not a URL`);
  });

  arr('youthPrograms').forEach((p, i) => {
    if (!p.name) err(`youthPrograms[${i}].name is required`);
  });

  arr('agendaItems').forEach((a, i) => {
    if (!a.title) err(`agendaItems[${i}].title is required`);
    if (!Array.isArray(a.topics) || !a.topics.length) err(`agendaItems[${i}].topics is required`);
    else for (const t of a.topics) if (!isTopicId(t)) err(`agendaItems[${i}] has unknown topic "${t}"`);
    if (a.meetingDate && !isDateStr(a.meetingDate)) err(`agendaItems[${i}].meetingDate must be YYYY-MM-DD`);
  });

  if (!['high', 'medium', 'low'].includes(city.confidence)) err('confidence must be high, medium, or low');
  return errors;
}

export function validateCities(cities) {
  const errors = [];
  const seen = new Set();
  for (const c of cities) {
    errors.push(...validateCity(c));
    if (c && c.cityId) {
      if (seen.has(c.cityId)) errors.push(`${c.cityId}: duplicate cityId`);
      seen.add(c.cityId);
    }
  }
  return errors;
}

/**
 * Schedule smells that still produce a usable city, reported by build-data as warnings:
 *  - a rescheduled exception with no movedFrom, movedTo or time, which the engine can only
 *    resolve by reading its English note;
 *  - the same date listed by two published-date rules at the same time, which shows one
 *    meeting twice.
 */
export function scheduleWarnings(city) {
  const out = [];
  const where = (city && city.cityId) || 'unknown city';
  (Array.isArray(city && city.scheduleExceptions) ? city.scheduleExceptions : []).forEach((ex, i) => {
    if (ex.status === 'rescheduled' && !ex.movedFrom && !ex.movedTo && !ex.time) {
      out.push(`${where}: scheduleExceptions[${i}] (${ex.date}) is rescheduled without movedFrom, movedTo or time, so only its note says what changed`);
    }
  });
  const listed = new Map();
  (Array.isArray(city && city.meetings) ? city.meetings : []).forEach((m, i) => {
    const r = m && m.recurrence;
    if (!r || r.kind !== 'custom') return;
    for (const d of r.dates || []) {
      const key = `${d} ${r.time}`;
      if (listed.has(key)) out.push(`${where}: ${d} at ${r.time} is listed by both meetings[${listed.get(key)}] and meetings[${i}]`);
      else listed.set(key, i);
    }
  });
  return out;
}
