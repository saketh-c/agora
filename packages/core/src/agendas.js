/**
 * Live agendas: upcoming council meetings and their posted agenda items, read from each city's
 * own agenda platform and merged on top of the curated city data.
 *
 * Three parts, all free of Node-only APIs so the web app can use the merge:
 *  1. Parsers, one per platform, that turn a saved response into plain meeting records
 *     ({ date, time, label, type, cancelled, special, agendaUrl, agendaPostedOn, items }).
 *     They are pure, so tests run them on saved responses.
 *  2. buildAgendaSnapshot(): fetches every configured source politely (the app's user agent,
 *     one request at a time per host with a gap, a timeout, one retry, a run budget) and
 *     returns the snapshot the web app and the server read. A city whose source fails keeps
 *     its previous entry (marked stale) for up to 14 days; nothing here ever throws.
 *  3. planLiveAgendas() / applyLivePlans(): merge a snapshot into city records. Only positive
 *     evidence changes a schedule: a meeting the source marks cancelled shows as cancelled; a
 *     meeting our data cancelled that the source lists again comes back at its usual time; a
 *     council meeting on a date our rules do not cover is added like the council's other
 *     meetings of that kind (a special or called one under the source's own name); and posted
 *     agenda items attach to the meeting they belong to. A meeting is never cancelled because
 *     a source does not list it: most platforms only publish a week or two ahead.
 *
 * Only sources that answer without keys, logins or bot challenges are used, and hosts whose
 * robots.txt asks automated tools to stay away are left out (see AGENDA_SOURCES).
 */
import { inferTopics, isTopicId } from './topics.js';
import { addDays, compareDates, expandCityMeetings, isDateStr, isTimeStr, toDateStr } from './schedule.js';
import { isUrl, validateCity } from './validate.js';
import { t } from './i18n/runtime.js';

/** Same identity as the news and geocoding clients, so city IT staff can see who is asking. */
export const AGENDA_USER_AGENT = 'Agora civic app (student project; +https://github.com/saketh-c/agora)';
export const AGENDA_SNAPSHOT_SCHEMA = 1;
/**
 * Bump when a parser changes what it extracts: agenda items from a snapshot made by another
 * version are fetched again instead of being reused.
 */
export const AGENDA_PARSER_VERSION = 1;
/** How far ahead and back a run looks. Past meetings keep their items as "recently on the agenda". */
export const AGENDA_HORIZON_DAYS = 60;
export const AGENDA_LOOKBACK_DAYS = 14;
/** How long items from past meetings are carried from one snapshot to the next. */
export const AGENDA_KEEP_DAYS = 60;
/** A city whose source keeps failing shows its last good entry for this long, then nothing. */
export const AGENDA_STALE_DAYS = 14;
/** Agenda item fetches per city per run (soonest meetings first); the rest come on later runs. */
const ITEM_FETCHES_PER_CITY = 3;
/** Items kept per meeting, ranked by how much a student is likely to care. */
const ITEMS_PER_MEETING = 12;
const TITLE_MAX = 180;
const SUMMARY_MAX = 300;
const DAY_MS = 86400000;
const MEETING_TYPES = new Set(['regular', 'work-session', 'briefing', 'town-hall', 'committee', 'other']);

/**
 * Where each city's agenda lives and how to read it. A city can have more than one source:
 * the first is the main one, later ones add what it lacks (a full-year calendar, or the date
 * an agenda was posted). `platform: 'none'` records why a city has no automatic source:
 * 'robots' (its agenda host's robots.txt asks automated tools to stay away), 'token' (the API
 * needs a login token), 'blocked' (bot protection, or a firewall that refuses this app's user
 * agent) or 'none' (no list of upcoming meetings to read).
 *  - legistar: Legistar Web API (public, documented, no key). `bodies` maps the council's body
 *    ids to a meeting type; every other body (boards, committees, quorum notices) is skipped.
 *  - civicclerk: the CivicClerk public API. Its times end in "Z" but are local wall times.
 *  - ical: a CivicPlus calendar feed for the council's calendar category.
 *  - docspublished: the DocsPublished (docassembler) API Fort Worth publishes agendas with.
 *  - onbase: Hyland OnBase Agenda Online's public meeting list and HTML agendas.
 *  - agendacenter: a CivicPlus Agenda Center category (agenda posting dates only; no times).
 *  - municode: a Municode Meetings publish page (posted agendas only, newest first) and its
 *    accessible HTML agendas. (Wylie's municodemeetings.com site refuses this app's user agent.)
 */
export const AGENDA_SOURCES = Object.freeze({
  addison: [{ platform: 'none', reason: 'robots' }],
  allen: [{ platform: 'none', reason: 'token' }],
  arlington: [{ platform: 'none', reason: 'none' }],
  bedford: [
    { platform: 'ical', url: 'https://bedfordtx.gov/common/modules/iCalendar/iCalendar.aspx?catID=14&feed=calendar' },
    { platform: 'agendacenter', host: 'bedfordtx.gov', path: '/AgendaCenter/City-Council-2/' },
  ],
  carrollton: [{ platform: 'legistar', client: 'carrolltontx', bodies: { 138: 'regular' } }],
  'cedar-hill': [{ platform: 'ical', url: 'https://www.cedarhilltx.com/common/modules/iCalendar/iCalendar.aspx?catID=29&feed=calendar' }],
  colleyville: [{ platform: 'civicclerk', tenant: 'colleyvilletx' }],
  coppell: [{ platform: 'legistar', client: 'coppell', bodies: { 138: 'regular' } }],
  dallas: [{ platform: 'legistar', client: 'cityofdallas', bodies: { 138: 'regular', 182: 'briefing', 252: 'briefing' } }],
  denton: [{ platform: 'legistar', client: 'denton-tx', bodies: { 138: 'regular' } }],
  desoto: [{ platform: 'ical', url: 'https://www.desototexas.gov/common/modules/iCalendar/iCalendar.aspx?catID=24&feed=calendar' }],
  duncanville: [{ platform: 'civicclerk', tenant: 'duncanvilletx' }],
  euless: [{ platform: 'civicclerk', tenant: 'eulesstx' }],
  'farmers-branch': [{ platform: 'legistar', client: 'farmersbranch', bodies: { 138: 'regular' } }],
  'flower-mound': [{ platform: 'civicclerk', tenant: 'flowermoundtx' }],
  'fort-worth': [
    {
      platform: 'docspublished',
      org: 'fortworthtexas',
      types: { 'City Council Meeting': 'regular', 'City Council Work Session': 'work-session', 'Special Called Council Meeting': 'other' },
    },
  ],
  frisco: [
    {
      platform: 'onbase',
      host: 'agenda.friscotexas.gov',
      types: { 'City Council': 'regular', 'City Council Work Session': 'work-session', 'City Council Summer-Winter Work Session': 'work-session' },
    },
  ],
  garland: [{ platform: 'civicclerk', tenant: 'garlandtx' }],
  'grand-prairie': [{ platform: 'municode', cid: 'GPTX', ppid: '0a01ee0f-2750-46df-ae4f-bb7135af7019' }],
  grapevine: [{ platform: 'ical', url: 'https://www.grapevinetexas.gov/common/modules/iCalendar/iCalendar.aspx?catID=26&feed=calendar' }],
  'highland-park': [{ platform: 'ical', url: 'https://www.hptx.org/common/modules/iCalendar/iCalendar.aspx?catID=14&feed=calendar' }],
  hurst: [{ platform: 'none', reason: 'blocked' }],
  irving: [{ platform: 'none', reason: 'blocked' }],
  keller: [{ platform: 'legistar', client: 'cityofkeller', bodies: { 138: 'regular' } }],
  lewisville: [{ platform: 'legistar', client: 'cityoflewisville', bodies: { 138: 'regular' } }],
  'little-elm': [{ platform: 'none', reason: 'robots' }],
  mansfield: [{ platform: 'civicclerk', tenant: 'mansfieldtx' }],
  mckinney: [{ platform: 'legistar', client: 'mckinney', bodies: { 138: 'regular', 189: 'work-session', 208: 'other' } }],
  mesquite: [
    { platform: 'legistar', client: 'mesquite', bodies: { 138: 'regular' } },
    { platform: 'ical', url: 'https://www.cityofmesquite.com/common/modules/iCalendar/iCalendar.aspx?catID=31&feed=calendar' },
  ],
  murphy: [{ platform: 'ical', url: 'https://www.murphytx.org/common/modules/iCalendar/iCalendar.aspx?catID=23&feed=calendar' }],
  'north-richland-hills': [{ platform: 'legistar', client: 'nrhtx', bodies: { 138: 'regular', 172: 'work-session', 173: 'other' } }],
  plano: [{ platform: 'legistar', client: 'plano', bodies: { 138: 'regular', 184: 'briefing', 211: 'other' } }],
  richardson: [{ platform: 'none', reason: 'blocked' }],
  rowlett: [{ platform: 'civicclerk', tenant: 'rowletttx' }],
  sachse: [{ platform: 'civicclerk', tenant: 'sachsetx' }],
  southlake: [{ platform: 'agendacenter', host: 'www.cityofsouthlake.com', path: '/AgendaCenter/City-Council-2/' }],
  'the-colony': [{ platform: 'ical', url: 'https://www.thecolonytx.gov/common/modules/iCalendar/iCalendar.aspx?catID=33&feed=calendar' }],
  'university-park': [
    { platform: 'legistar', client: 'uptexas', bodies: { 138: 'regular' } },
    { platform: 'ical', url: 'https://www.uptexas.org/common/modules/iCalendar/iCalendar.aspx?catID=14&feed=calendar' },
  ],
  // Municode Meetings rejects this app's user agent and asks crawlers for a 15-second delay.
  wylie: [{ platform: 'none', reason: 'blocked' }],
});

/* ------------------------------------------------------------------------------------------ */
/* Text helpers                                                                               */
/* ------------------------------------------------------------------------------------------ */

const NAMED_ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', ndash: '-', mdash: '-', rsquo: "'", lsquo: "'", rdquo: '"', ldquo: '"', hellip: '...', thinsp: ' ', ensp: ' ', emsp: ' ', bull: '', middot: '' };

/** Decode the HTML entities agenda platforms use, and turn long dashes into hyphens. */
export function decodeEntities(s) {
  return String(s || '')
    .replace(/&#x([0-9a-f]+);/gi, (m, h) => safeChar(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (m, d) => safeChar(Number(d)))
    .replace(/&([a-z]+);/gi, (m, name) => (name.toLowerCase() in NAMED_ENTITIES ? NAMED_ENTITIES[name.toLowerCase()] : m))
    .replace(/[\u2012-\u2015]/g, '-');
}

function safeChar(code) {
  try {
    return Number.isFinite(code) && code > 0 ? String.fromCodePoint(code) : '';
  } catch {
    return '';
  }
}

/** Plain text from a fragment of HTML: tags dropped, entities decoded, whitespace collapsed. */
export function plainText(html) {
  return decodeEntities(
    String(html || '')
      .replace(/<(script|style)[\s\S]*?<\/\1>/gi, ' ')
      .replace(/<br\s*\/?>/gi, ' ')
      .replace(/<[^>]+>/g, ' '),
  )
    .replace(/\s+/g, ' ')
    .trim();
}

/** Short words that stay capitalized when an ALL-CAPS title is sentence-cased. */
const ACRONYMS = new Set('ADA ARPA CDBG CIP CO DART EDC EMS FM FY HOA HUD ISD LLC LP NCTCOG PD PID SUP TIF TIRZ TX TXDOT US USA'.split(' '));

/** "CONSIDER APPROVAL OF A CONTRACT" -> "Consider approval of a contract" (other casing is kept). */
export function sentenceCase(s) {
  const text = String(s || '').trim();
  const letters = text.replace(/[^A-Za-z]/g, '');
  if (letters.length < 6 || letters.replace(/[^A-Z]/g, '').length / letters.length < 0.8) return text;
  const lower = text
    .split(/(\s+)/)
    .map((w) => {
      const core = w.replace(/[^A-Za-z0-9]/g, '');
      if (/\d/.test(core) || ACRONYMS.has(core)) return w;
      return w.toLowerCase();
    })
    .join('');
  return lower.charAt(0).toUpperCase() + lower.slice(1);
}

/** Cut long text at a word boundary. */
function clip(s, max) {
  const text = String(s || '').trim();
  if (text.length <= max) return text;
  const cut = text.slice(0, max - 1);
  const at = cut.lastIndexOf(' ');
  return `${(at > max * 0.6 ? cut.slice(0, at) : cut).replace(/[\s,;:.-]+$/, '')}...`;
}

const MONTHS = ['january', 'february', 'march', 'april', 'may', 'june', 'july', 'august', 'september', 'october', 'november', 'december'];
const MONTH_RE = MONTHS.map((m) => `${m.charAt(0).toUpperCase()}${m.slice(1, 3)}[a-z]*\\.?`).join('|');

/**
 * A meeting's own name, without the date or time some platforms put in front ("10/26/26
 * Regular City Council Meeting", "December 6, 2027, City Council Meeting") or the cancel
 * marker ("CANCELED - Town Council Meeting").
 */
export function cleanLabel(s) {
  let label = decodeEntities(s).replace(/\s+/g, ' ').trim();
  label = label.replace(/^\d{1,2}\/\d{1,2}\/\d{2,4},?\s+(?:\d{1,2}(?::\d{2})?\s*[ap]\.?\s?m\.?\s+)?/i, '');
  label = label.replace(new RegExp(`^(?:${MONTH_RE})\\s+\\d{1,2},?\\s+\\d{4},?\\s+`, 'i'), '');
  label = label.replace(/^(?:cancell?ed|postponed)\s*[-:]\s*/i, '').replace(/\s*[-:(]\s*(?:cancell?ed|postponed)\)?\s*$/i, '');
  label = label.replace(/\s*-\s*(?:1st|2nd|3rd|4th)$/i, '').replace(/\s*-\s*\d{1,2}\/\d{1,2}\/\d{2,4}$/, '').trim();
  return sentenceCase(label);
}

/** Whether a source's meeting name reads as a meeting of the council itself (not a board, a quorum notice or a social event). */
export function isCouncilTitle(s) {
  const label = cleanLabel(s);
  if (!/\b(?:city|town) council\b/i.test(label)) return false;
  if (/\b(?:arts|youth|teen|student) council\b|\bcommittee\b|\bquorum\b|\bnotice of\b|\bcandidate|\bforum\b|\breception\b|\bluncheon\b|\bbanquet\b|\bretreat\b|\borientation\b|\btraining\b/i.test(label)) return false;
  return (
    /^(?:joint |regular |special |special[- ]called |called |emergency )*(?:city|town) council\b/i.test(label) ||
    /\b(?:city|town) council (?:regular |special |called |special called )*(?:meeting|work ?session|workshop|briefing|study session|session)\b/i.test(label)
  );
}

/** 'work-session' | 'briefing' | 'regular' from a meeting's name. */
export function typeFromLabel(label) {
  const s = String(label || '');
  if (/\bwork ?session|\bworkshop|\bstudy session/i.test(s)) return 'work-session';
  if (/\bbriefing|\bpre-?council|\bpreliminary/i.test(s)) return 'briefing';
  return 'regular';
}

const isSpecialLabel = (s) => /\bspecial\b|\bcalled\b|\bemergency\b/i.test(String(s || ''));
/** Council calendar entries that are not meetings the public can attend and speak at. */
const NOT_A_MEETING = /\btraining\b|\borientation\b|\bretreat\b|\breception\b|\bluncheon\b|\bbanquet\b|\bcandidate|\btour\b|\bphoto\b|\bparade\b|\bquorum\b/i;
/** A posting date after the meeting is a later revision, not when the agenda was posted. */
const postedBefore = (posted, date) => (posted && posted.date <= date ? posted.date : null);
const isCancelText = (s) => /\bcancel/i.test(String(s || ''));

/** "5:45 PM" -> "17:45"; null for anything else. */
export function to24h(s) {
  const m = /^\s*(\d{1,2})(?::(\d{2}))?(?::\d{2})?\s*([ap])\.?\s?m\.?\s*$/i.exec(String(s || ''));
  if (!m) return null;
  let h = Number(m[1]) % 12;
  if (m[3].toLowerCase() === 'p') h += 12;
  const time = `${String(h).padStart(2, '0')}:${m[2] || '00'}`;
  return isTimeStr(time) ? time : null;
}

const CENTRAL = (() => {
  try {
    return new Intl.DateTimeFormat('en-US', { timeZone: 'America/Chicago', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });
  } catch {
    return null;
  }
})();

/** A UTC instant ("2026-10-13T23:00:00", with or without Z) as Central wall time { date, time }. */
export function utcToCentral(iso) {
  const raw = String(iso || '').trim();
  if (!raw) return null;
  const ms = Date.parse(/[zZ]|[+-]\d{2}:?\d{2}$/.test(raw) ? raw : `${raw}Z`);
  if (!Number.isFinite(ms) || !CENTRAL) return null;
  const parts = Object.fromEntries(CENTRAL.formatToParts(new Date(ms)).map((p) => [p.type, p.value]));
  const date = `${parts.year}-${parts.month}-${parts.day}`;
  const time = `${parts.hour === '24' ? '00' : parts.hour}:${parts.minute}`;
  return isDateStr(date) ? { date, time } : null;
}

const absUrl = (href, base) => {
  try {
    const url = new URL(decodeEntities(href), base).href;
    return isUrl(url) ? url : null;
  } catch {
    return null;
  }
};

/* ------------------------------------------------------------------------------------------ */
/* Agenda items                                                                               */
/* ------------------------------------------------------------------------------------------ */

/** Rows that are part of every meeting and say nothing about what the council will decide. */
const PROCEDURAL =
  /^(?:\d+\.?\s*)?(?:call(?:ed)? to order|invocation|pledges?\b|roll call|quorum|adjourn|recess|reconvene|approv\w* (?:of )?(?:the )?minutes|consider approval of (?:the )?(?:city council |regular |special )*(?:meeting )?minutes|minutes\b|(?:consent agenda )?preamble|.*placeholder|front page|executive session|closed session|public comments?\b|citizens?(?:'s)? (?:comments?|input|forum)|open (?:microphone|forum)|public forum|announcements?\b|items? of community interest|recent events|mayor and (?:city )?council reports|council (?:member )?(?:reports|comments|announcements)|(?:staff |city manager(?:'s)? |city attorney(?:'s)? )?reports?\b|city (?:manager|attorney|council)$|staff report|review agenda items|agenda review|council discussion with city staff|discussion on governance|items to be (?:continued|withdrawn)|consideration of reduction to registered speakers|presentations?$|proclamations?\b|presentation of (?:a )?(?:proclamation|recognition)|recognitions?\b|.*\bservice pins?\b|certification|legal advice\b|personnel\b|consideration and action resulting from|consent and regular agendas|council items for discussion|(?:future )?agenda items? (?:request|for future)|page break)/i;

/**
 * Rows about a closed (executive) session, which the public cannot attend or speak at, and
 * rows that only introduce a list ("Approve the following bids:").
 */
const CLOSED_OR_HEADER = /\b(?:closed|executive) session\b|\bsection 551\.\d{3}\b|^to deliberate\b|:\s*$|^(?:\w+ ){0,3}approv\w*\b.{0,80}\bminutes\b|^discussion of (?:the )?consent|^discuss items from\b|^city manager or authorized representative|^update from the city council and management|^(?:jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\.? \d{1,2}\s+-\s/i;

/**
 * Matter types or sections that never hold a decision worth showing, wherever they appear in
 * the name ("POM - Executive Session", "CLOSED SESSION - Deliberation authorized by ...").
 */
const SKIP_SECTIONS = /(?:^|[\s-])(?:minutes|closed session|executive session|public comments?|invocation|pledges?|call to order|adjournment|front page|announcements|proclamations|recognitions|presentations by the city council|special presentations)\b/i;

const YOUTH_TOPICS = new Set(['youth', 'education-libraries', 'parks-recreation', 'transit', 'housing', 'environment']);
const ROUTINE = /\brenewal options?\b|\bpurchase orders?\b|\bchange order\b|\bsupplemental agreement\b|\bamendment no\.|\bprice agreement\b|\bmaster agreement\b|\bcooperative purchas|\binterlocal\b|\bsole source\b/i;

/**
 * Topic ids for an agenda item, from its title and the platform's own section or matter type
 * ("ZONING CASES", "Zoning Hearing"); the summary is only read when those say nothing (a
 * headline like "Consider approval of a contract"). Common false alarms are dropped:
 * budget-taxes on any contract that mentions a fund or a fee, education on a street named
 * School Road or a purchase through an "Education Service Center", and animal services on
 * "adoption of an ordinance".
 */
export function itemTopics(title, summary = '', hint = '') {
  const head = `${hint} ${title}`;
  let text = head;
  let topics = inferTopics(text, 3).filter((id) => id !== 'other');
  if (!topics.length && summary) {
    text = `${head} ${summary}`;
    topics = inferTopics(text, 3).filter((id) => id !== 'other');
  }
  if (/\bzon(?:ing|ed)\b|\brezon|\bplanned development\b|\bspecific use permit\b|\bspecial use permit\b|\bplat\b|(?:^|\s)ZC-\d/i.test(head) && !topics.includes('zoning-development')) {
    topics.unshift('zoning-development');
  }
  const drop = (id, keepIf) => {
    if (topics.includes(id) && !keepIf.test(text)) topics = topics.filter((x) => x !== id);
  };
  drop('budget-taxes', /\b(?:budget|tax(?:es)?|tax rate|bonds?|levy|appropriations?|fiscal year|millage)\b/i);
  drop('animal-services', /\b(?:animals?|pets?|dogs?|cats?|wildlife|shelters?)\b/i);
  if (/\bschool\s+(?:road|rd|drive|dr|street|st|lane|ln|blvd|boulevard|avenue|ave)\b|\beducation service center\b|\b(?:omnia|buyboard|sourcewell|choice partners)\b|\bpurchasing cooperative\b|\bcooperative purchasing\b/i.test(text)) {
    drop('education-libraries', /\blibrar|\bisd\b|\bstudents?\b|\btutoring\b|\bliteracy\b/i);
  }
  topics = topics.filter(isTopicId).slice(0, 3);
  return topics.length ? topics : ['other'];
}

/**
 * One agenda item from a platform row, or null when the row is procedural or empty.
 * The cost and funding tail some platforms append to a title ("- Not to exceed $709,126 -
 * Financing: General Fund") is dropped: it says nothing a student can act on.
 */
export function makeItem({ title, summary = '', url = null, hint = '' }) {
  let head = plainText(title);
  const rest = plainText(summary);
  if (!head) return null;
  const tail = /\s+-\s+(?=(?:Total|Financing|Estimated|Not to exceed|Est\.)\b)/i.exec(head);
  if (tail) head = head.slice(0, tail.index);
  // A middle dot or bullet some clerks type between words ("Personnel, City Attorney") reads as a comma.
  head = sentenceCase(head.replace(/^\s*(?:\*?\(?[0-9]+[A-Z]?\.?\)?|[A-Z]{1,2}\d+\.|[A-Za-z]\.)\s+/, '').replace(/\s+[\u00b7\u2022]\s+/g, ', ').trim());
  if (head.length < 12 || PROCEDURAL.test(head) || CLOSED_OR_HEADER.test(head)) return null;
  const item = { title: clip(head, TITLE_MAX), topics: itemTopics(head, rest, hint) };
  if (rest && rest !== head) item.summary = clip(sentenceCase(rest), SUMMARY_MAX);
  if (url && isUrl(url)) item.url = url;
  return item;
}

/** Keep the items a student is most likely to care about, in agenda order. */
export function rankItems(items, max = ITEMS_PER_MEETING) {
  const seen = new Set();
  const unique = items.filter((it) => {
    if (!it) return false;
    const key = normTitle(it.title);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
  if (unique.length <= max) return unique;
  const score = (it) => {
    let s = 0;
    if (it.topics[0] !== 'other') s += 2;
    if (it.topics.some((id) => YOUTH_TOPICS.has(id))) s += 2;
    if (it.topics.includes('zoning-development') || /\bpublic hearing\b|\bordinance\b/i.test(it.title)) s += 1;
    if (ROUTINE.test(it.title)) s -= 1;
    return s;
  };
  const keep = new Set(
    unique
      .map((it, i) => ({ i, s: score(it) }))
      .sort((a, b) => b.s - a.s || a.i - b.i)
      .slice(0, max)
      .map((x) => x.i),
  );
  return unique.filter((_, i) => keep.has(i));
}

const normTitle = (s) =>
  String(s || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();

/* ------------------------------------------------------------------------------------------ */
/* Parsers, one per platform                                                                  */
/* ------------------------------------------------------------------------------------------ */

const HIDDEN_AGENDA = /^(?:hidden|draft|not viewable by the public)$/i;

/** Legistar /events rows -> meetings of the council's bodies. */
export function parseLegistarEvents(rows, cfg = {}) {
  const bodies = cfg.bodies || {};
  const out = [];
  for (const e of Array.isArray(rows) ? rows : []) {
    if (!e || !Object.prototype.hasOwnProperty.call(bodies, String(e.EventBodyId))) continue;
    if (HIDDEN_AGENDA.test(String(e.EventAgendaStatusName || '').trim())) continue;
    const date = String(e.EventDate || '').slice(0, 10);
    if (!isDateStr(date)) continue;
    const comment = String(e.EventComment || '');
    const cancelled = isCancelText(comment) || /cancel/i.test(String(e.EventAgendaStatusName || ''));
    const special = !cancelled && isSpecialLabel(comment);
    const name = cleanLabel(e.EventBodyName || 'City Council');
    // "Joint Special Called Meeting with Denton ISD Board of Directors" names the meeting
    // better than the body does; a bare "SPECIAL CALLED" only says what kind it is.
    const named = special && /\bmeeting\b/i.test(comment) && comment.length <= 90 ? cleanLabel(comment) : '';
    const label = named || (special && !isSpecialLabel(name) ? `${name} special called meeting` : name);
    const posted = e.EventAgendaFile ? postedBefore(utcToCentral(e.EventAgendaLastPublishedUTC), date) : null;
    out.push({
      key: `legistar:${e.EventId}`,
      date,
      time: to24h(e.EventTime),
      label,
      type: bodies[String(e.EventBodyId)] || 'regular',
      cancelled,
      special,
      agendaUrl: e.EventAgendaFile && isUrl(e.EventAgendaFile) ? e.EventAgendaFile : null,
      detailUrl: isUrl(e.EventInSiteURL) ? e.EventInSiteURL : null,
      agendaPostedOn: posted,
      stamp: String(e.EventAgendaLastPublishedUTC || e.EventLastModifiedUtc || ''),
      fetchItems: Boolean(e.EventAgendaFile) && !cancelled ? { kind: 'legistar', eventId: e.EventId } : null,
    });
  }
  return out;
}

/** Legistar /events/{id}/eventitems -> agenda items (only rows tied to a matter). */
export function parseLegistarItems(rows, { client, detailUrl } = {}) {
  const host = (() => {
    try {
      return detailUrl ? new URL(detailUrl).host : `${client}.legistar.com`;
    } catch {
      return `${client}.legistar.com`;
    }
  })();
  const sorted = (Array.isArray(rows) ? rows : []).slice().sort((a, b) => (a.EventItemAgendaSequence || 0) - (b.EventItemAgendaSequence || 0));
  const items = [];
  for (const row of sorted) {
    if (!row || !row.EventItemMatterFile || !row.EventItemTitle) continue;
    const type = String(row.EventItemMatterType || '');
    if (SKIP_SECTIONS.test(type)) continue;
    const url = row.EventItemMatterId && row.EventItemMatterGuid ? `https://${host}/LegislationDetail.aspx?ID=${row.EventItemMatterId}&GUID=${row.EventItemMatterGuid}` : detailUrl;
    const item = makeItem({ title: row.EventItemTitle, url, hint: type });
    if (item) items.push(item);
  }
  return rankItems(items);
}

const QUORUM = /\bquorum\b|\bnotice of\b/i;

/** CivicClerk /v1/Events -> council meetings (placeholder duplicates with agendaId 0 dropped). */
export function parseCivicClerkEvents(body, cfg = {}) {
  const tenant = cfg.tenant;
  const categories = (cfg.categories || ['City Council', 'Town Council']).map((c) => c.toLowerCase());
  const rows = Array.isArray(body) ? body : body && Array.isArray(body.value) ? body.value : [];
  const byStart = new Map();
  for (const e of rows) {
    if (!e || !categories.includes(String(e.categoryName || '').toLowerCase())) continue;
    if (QUORUM.test(String(e.eventName || '')) || NOT_A_MEETING.test(String(e.eventName || ''))) continue;
    const start = String(e.startDateTime || e.eventDate || '');
    const date = start.slice(0, 10);
    // The trailing Z is not UTC: CivicClerk stores the city's local wall time.
    const time = start.slice(11, 16);
    if (!isDateStr(date)) continue;
    const prev = byStart.get(start);
    if (prev && (prev.agendaId > 0 || !(e.agendaId > 0))) continue;
    byStart.set(start, e);
  }
  const out = [];
  for (const [start, e] of byStart) {
    const files = Array.isArray(e.publishedFiles) ? e.publishedFiles : [];
    const agenda = files.find((f) => f && /^agenda$/i.test(String(f.type || ''))) || files.find((f) => f && /agenda/i.test(String(f.type || '')));
    const posted = agenda ? postedBefore(utcToCentral(agenda.publishOn), start.slice(0, 10)) : null;
    const cancelled = isCancelText(e.eventName);
    const label = cleanLabel(e.eventName || e.categoryName || 'City Council');
    out.push({
      key: `civicclerk:${e.id}`,
      date: start.slice(0, 10),
      time: isTimeStr(start.slice(11, 16)) ? start.slice(11, 16) : null,
      label,
      type: typeFromLabel(label),
      cancelled,
      special: !cancelled && isSpecialLabel(label),
      agendaUrl: agenda && agenda.fileId ? `https://${tenant}.api.civicclerk.com/v1/Meetings/GetMeetingFileStream(fileId=${agenda.fileId},plainText=false)` : null,
      detailUrl: `https://${tenant}.portal.civicclerk.com/event/${e.id}/overview`,
      agendaPostedOn: posted,
      stamp: agenda ? String(agenda.publishOn || agenda.fileId) : '',
      fetchItems: agenda && e.agendaId > 0 && !cancelled ? { kind: 'civicclerk', agendaId: e.agendaId } : null,
    });
  }
  return out.sort((a, b) => compareDates(a.date, b.date) || String(a.time).localeCompare(String(b.time)));
}

/**
 * CivicClerk /v1/Meetings/{agendaId} -> agenda items. Item names are HTML, usually an
 * ALL-CAPS headline, a <br>, then the detail: the headline becomes the title, the detail the
 * summary, and the parent section is the topic hint.
 */
export function parseCivicClerkMeeting(body, { detailUrl } = {}) {
  const items = [];
  const walk = (list, section) => {
    for (const node of Array.isArray(list) ? list : []) {
      if (!node) continue;
      const name = String(node.agendaObjectItemName || '');
      const heading = plainText(name);
      if (node.isSection || !String(node.agendaObjectItemOutlineNumber || '').trim()) {
        walk(node.childItems, heading || section);
        continue;
      }
      if (!SKIP_SECTIONS.test(section || '')) {
        const [head, ...detail] = name.split(/<br\s*\/?>/i);
        const item = makeItem({ title: head, summary: detail.join(' '), url: detailUrl, hint: section });
        if (item) items.push(item);
      }
      // Lettered sub-items (a., b.) repeat or split their parent; the parent is enough.
    }
  };
  walk(body && body.items, '');
  return rankItems(items);
}

/** Unfolded content lines of an iCalendar file. */
function icalLines(text) {
  return String(text || '')
    .replace(/\r\n/g, '\n')
    .replace(/\n[ \t]/g, '')
    .split('\n');
}

const icalText = (s) =>
  String(s || '')
    .replace(/\\n/gi, ' ')
    .replace(/\\([,;\\])/g, '$1')
    .trim();

/**
 * A CivicPlus calendar feed -> council meetings in [from, to]. All-day placeholders get no
 * time, so they can confirm or cancel a meeting but never add one.
 */
export function parseIcal(text, { from, to } = {}) {
  const out = [];
  let ev = null;
  for (const line of icalLines(text)) {
    if (line === 'BEGIN:VEVENT') ev = {};
    else if (line === 'END:VEVENT') {
      if (ev) out.push(ev);
      ev = null;
    } else if (ev) {
      const at = line.indexOf(':');
      if (at < 0) continue;
      const [name] = line.slice(0, at).split(';');
      ev[name.toUpperCase()] = line.slice(at + 1);
    }
  }
  const meetings = [];
  for (const ev of out) {
    const summary = icalText(ev.SUMMARY);
    if (!isCouncilTitle(summary.replace(/\bcancell?ed\b[\s:-]*/gi, ''))) continue;
    const m = /^(\d{4})(\d{2})(\d{2})(?:T(\d{2})(\d{2}))?/.exec(String(ev.DTSTART || ''));
    if (!m) continue;
    const date = `${m[1]}-${m[2]}-${m[3]}`;
    if (!isDateStr(date) || (from && date < from) || (to && date > to)) continue;
    const time = m[4] ? `${m[4]}:${m[5]}` : null;
    const label = cleanLabel(summary);
    const detail = /https?:\/\/\S+/.exec(icalText(ev.DESCRIPTION));
    const cancelled = isCancelText(summary);
    meetings.push({
      key: `ical:${ev.UID || `${date}T${time}`}`,
      date,
      time: time && isTimeStr(time) && time !== '00:00' ? time : null,
      label,
      type: typeFromLabel(label),
      cancelled,
      special: !cancelled && isSpecialLabel(label),
      agendaUrl: null,
      detailUrl: detail && isUrl(detail[0]) ? detail[0] : null,
      agendaPostedOn: null,
      stamp: String(ev['LAST-MODIFIED'] || ''),
      fetchItems: null,
    });
  }
  return meetings.sort((a, b) => compareDates(a.date, b.date) || String(a.time).localeCompare(String(b.time)));
}

/** DocsPublished /api/documents/{org id} -> council meetings with a posted agenda. */
export function parseDocsPublishedList(rows, cfg = {}) {
  const types = cfg.types || {};
  const out = [];
  for (const d of Array.isArray(rows) ? rows : []) {
    if (!d || d.IsArchived || !Object.prototype.hasOwnProperty.call(types, d.MeetingType)) continue;
    const when = utcToCentral(d.MeetingDate);
    if (!when) continue;
    const id = d.AgendaDocumentId;
    const label = cleanLabel(d.MeetingType);
    out.push({
      key: `docspublished:${id || d.PlaceholderDocumentId || `${when.date}-${label}`}`,
      date: when.date,
      time: when.time,
      label,
      type: types[d.MeetingType],
      cancelled: isCancelText(d.DocumentTitle),
      special: isSpecialLabel(label),
      agendaUrl: id ? `https://docspublished.io/${cfg.org}/document/${id}` : null,
      detailUrl: null,
      agendaPostedOn: null,
      stamp: String(id || ''),
      fetchItems: id && !isCancelText(d.DocumentTitle) ? { kind: 'docspublished', documentId: id } : null,
    });
  }
  return out.sort((a, b) => compareDates(a.date, b.date) || a.time.localeCompare(b.time));
}

/** DocsPublished /api/document/{id} -> { items, postedOn }. Sections come unordered. */
export function parseDocsPublishedDocument(doc, { agendaUrl } = {}) {
  const sections = (doc && Array.isArray(doc.WP_Sections) ? doc.WP_Sections : []).slice().sort((a, b) => Number(a.Number) - Number(b.Number));
  const items = [];
  for (const section of sections) {
    const hint = plainText(section.Title);
    if (SKIP_SECTIONS.test(hint) || /^(?:invocation|pledges? of allegiance|consideration of reduction)/i.test(hint)) continue;
    const rows = (Array.isArray(section.WP_Items) ? section.WP_Items : []).slice().sort((a, b) => Number(a.Number) - Number(b.Number));
    for (const row of rows) {
      const item = makeItem({ title: row.Title, url: agendaUrl, hint });
      if (item) items.push(item);
    }
  }
  const created = utcToCentral(doc && doc.CreateTimeUtc);
  const meeting = utcToCentral(doc && doc.MeetingDate);
  return { items: rankItems(items), postedOn: created && (!meeting || created.date <= meeting.date) ? created.date : null };
}

/** The meeting list on an OnBase Agenda Online home page -> council meetings. */
export function parseOnBaseList(html, cfg = {}) {
  const types = cfg.types || {};
  const base = `https://${cfg.host}/OnBaseAgendaOnline/`;
  const seen = new Set();
  const out = [];
  for (const m of String(html || '').matchAll(/<tr id="meeting-(\d+)-row"[^>]*>([\s\S]*?)<\/tr>/g)) {
    const [, id, row] = m;
    const cell = (type) => {
      const c = new RegExp(`data-sortable-type="${type}"[^>]*>([\\s\\S]*?)</td>`).exec(row);
      return c ? plainText(c[1]) : '';
    };
    const type = cell('mtgType');
    if (!Object.prototype.hasOwnProperty.call(types, type)) continue;
    const when = /(\d{1,2})\/(\d{1,2})\/(\d{4})\s+(\d{1,2}:\d{2})(?::\d{2})?\s*([AP]M)/i.exec(cell('mtgTime'));
    if (!when) continue;
    const date = toDateStr(Number(when[3]), Number(when[1]), Number(when[2]));
    const time = to24h(`${when[4]} ${when[5]}`);
    const name = cell('mtgName');
    if (!isDateStr(date) || /^supplemental agenda/i.test(name) || NOT_A_MEETING.test(name) || seen.has(`${date} ${time}`)) continue;
    seen.add(`${date} ${time}`);
    const hasAgenda = /ViewMeeting\?id=\d+/.test(row);
    const label = cleanLabel(name);
    out.push({
      key: `onbase:${id}`,
      date,
      time,
      label,
      type: types[type],
      cancelled: isCancelText(name),
      special: isSpecialLabel(name),
      agendaUrl: hasAgenda ? `${base}Meetings/ViewMeeting?id=${id}&doctype=1` : null,
      detailUrl: null,
      agendaPostedOn: null,
      stamp: hasAgenda ? `onbase:${id}` : '',
      fetchItems: hasAgenda && !isCancelText(name) ? { kind: 'onbase', meetingId: id } : null,
    });
  }
  return out;
}

/** An OnBase HTML agenda -> { items, postedOn }. Items are the top-level numbered paragraphs. */
export function parseOnBaseAgenda(html, { agendaUrl } = {}) {
  const lines = decodeEntities(
    String(html || '')
      .replace(/<(script|style)[\s\S]*?<\/\1>/gi, ' ')
      .replace(/<[^>]+>/g, '\n'),
  )
    .split('\n')
    .map((l) => l.replace(/\s+/g, ' ').trim())
    .filter(Boolean);
  const items = [];
  let section = '';
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i];
    if (/^certification$/i.test(line)) break;
    if (/^[A-Z][A-Z &/,'-]{4,}$/.test(line)) section = line;
    if (!/^\d{1,3}\.$/.test(line) || !lines[i + 1]) continue;
    const item = makeItem({ title: lines[i + 1], url: agendaUrl, hint: section });
    if (item && !SKIP_SECTIONS.test(section)) items.push(item);
  }
  const posted = new RegExp(`\\bBy\\s+(?:[A-Z][a-z]+day,\\s+)?((?:${MONTH_RE}))\\s+(\\d{1,2}),\\s+(\\d{4})`).exec(lines.join(' '));
  let postedOn = null;
  if (posted) {
    const month = MONTHS.findIndex((m) => posted[1].toLowerCase().startsWith(m.slice(0, 3))) + 1;
    const date = toDateStr(Number(posted[3]), month, Number(posted[2]));
    postedOn = isDateStr(date) ? date : null;
  }
  return { items: rankItems(items), postedOn };
}

/**
 * A CivicPlus Agenda Center category -> agenda postings: the meeting date, when it was posted
 * and a link to the agenda. There is no start time, so these only add "Agenda posted" to a
 * meeting we already have. Quorum notices and packet rows are skipped.
 */
export function parseAgendaCenter(html, cfg = {}) {
  const base = `https://${cfg.host}/`;
  const out = [];
  for (const m of String(html || '').matchAll(/<tr[^>]*class="catAgendaRow"[^>]*>([\s\S]*?)<\/tr>/g)) {
    const row = m[1];
    const id = /href="(\/AgendaCenter\/ViewFile\/Agenda\/_(\d{2})(\d{2})(\d{4})-(\d+))"/.exec(row);
    if (!id) continue;
    const date = toDateStr(Number(id[4]), Number(id[2]), Number(id[3]));
    const title = plainText((/<a [^>]*aria-describedby="[^"]*"[^>]*>([\s\S]*?)<\/a>/.exec(row) || [])[1] || '');
    if (!isDateStr(date) || QUORUM.test(title) || /\bpacket\b|\bminutes\b/i.test(title)) continue;
    const posted = new RegExp(`Posted\\s+(?:<abbr[^>]*>)?(${MONTH_RE})(?:<\\/abbr>)?\\s+(\\d{1,2}),\\s+(\\d{4})`, 'i').exec(row);
    let postedOn = null;
    if (posted) {
      const month = MONTHS.findIndex((mo) => posted[1].toLowerCase().startsWith(mo.slice(0, 3))) + 1;
      const d = toDateStr(Number(posted[3]), month, Number(posted[2]));
      postedOn = isDateStr(d) && d <= date ? d : null;
    }
    const label = /^agenda$/i.test(title) ? 'City Council' : cleanLabel(title);
    out.push({
      key: `agendacenter:${id[5]}`,
      date,
      time: null,
      label,
      type: typeFromLabel(label),
      cancelled: isCancelText(title),
      special: isSpecialLabel(title),
      agendaUrl: absUrl(id[1], base),
      detailUrl: null,
      agendaPostedOn: postedOn,
      stamp: id[5],
      fetchItems: null,
      postingOnly: true,
    });
  }
  return out;
}

/**
 * A Municode Meetings publish page -> council meetings with a posted agenda. Each row links the
 * agenda PDF, whose file name carries the meeting's id; the accessible HTML version of the
 * same agenda is the link students get.
 */
export function parseMunicodePublish(html, cfg = {}) {
  const out = [];
  for (const m of String(html || '').matchAll(/<tr>([\s\S]*?)<\/tr>/g)) {
    const row = m[1];
    const cell = (name) => {
      const c = new RegExp(`class="div-table-col ${name}[^"]*"\\s*>([\\s\\S]*?)</td>`).exec(row);
      return c ? plainText(c[1]) : '';
    };
    const name = cell('meeting');
    if (!name || !isCouncilTitle(name)) continue;
    const day = /(\d{1,2})\/(\d{1,2})\/(\d{4})/.exec(cell('date'));
    if (!day) continue;
    const date = toDateStr(Number(day[3]), Number(day[1]), Number(day[2]));
    const id = /MEET-Agenda-([0-9a-f]{32})/i.exec(row);
    const label = cleanLabel(name);
    if (!isDateStr(date)) continue;
    out.push({
      key: `municode:${id ? id[1] : `${date}-${label}`}`,
      date,
      time: to24h(cell('time')),
      label,
      type: typeFromLabel(label),
      cancelled: isCancelText(name),
      special: isSpecialLabel(name),
      agendaUrl: id ? `https://meetings.municode.com/adaHtmlDocument/index?cc=${cfg.cid}&me=${id[1].toLowerCase()}&ip=False` : null,
      detailUrl: null,
      agendaPostedOn: null,
      stamp: id ? id[1].toLowerCase() : '',
      fetchItems: id && !isCancelText(name) ? { kind: 'municode', id: id[1].toLowerCase() } : null,
    });
  }
  return out;
}

/** A Municode accessible HTML agenda -> { items }: each numbered item under its section heading. */
export function parseMunicodeAda(html, { agendaUrl } = {}) {
  const items = [];
  for (const sec of String(html || '').matchAll(/<section class="agenda-section">([\s\S]*?)<\/section>/g)) {
    const body = sec[1];
    const heading = plainText((/<h2 class="section-header">([\s\S]*?)<\/h2>/.exec(body) || [])[1] || '');
    if (SKIP_SECTIONS.test(heading)) continue;
    for (const li of body.matchAll(/<li>([\s\S]*?)<\/li>/g)) {
      const paragraphs = [...li[1].matchAll(/<p[^>]*>([\s\S]*?)<\/p>/g)].map((p) => plainText(p[1].replace(/<num[^>]*>[\s\S]*?<\/num>/g, ''))).filter(Boolean);
      if (!paragraphs.length) continue;
      const detail = paragraphs.slice(1).filter((p) => !/^\(reviewed by /i.test(p)).join(' ');
      const item = makeItem({ title: paragraphs[0], summary: detail, url: agendaUrl, hint: heading.slice(0, 60) });
      if (item) items.push(item);
    }
  }
  return { items: rankItems(items) };
}

/* ------------------------------------------------------------------------------------------ */
/* Fetching                                                                                   */
/* ------------------------------------------------------------------------------------------ */

class FetchError extends Error {
  constructor(message, status = 0) {
    super(message);
    this.name = 'FetchError';
    this.status = status;
  }
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * A fetch wrapper that is polite to city servers: requests to one host run one at a time
 * with at least `gapMs` between them, each has a timeout, a failure is retried once (after
 * the server's Retry-After when it is short), and nothing starts after the run's deadline.
 */
export function createPoliteFetch({ fetch: fetchImpl, userAgent = AGENDA_USER_AGENT, gapMs = 1000, timeoutMs = 15000, retries = 1, retryDelayMs = 2000, deadline = Infinity, maxBytes = 8 * 1024 * 1024 } = {}) {
  const doFetch = fetchImpl || ((...args) => globalThis.fetch(...args));
  const queues = new Map();
  let requests = 0;

  async function once(url, accept) {
    if (Date.now() > deadline) {
      const err = new FetchError('Run budget used up');
      err.final = true;
      throw err;
    }
    const controller = typeof AbortController === 'function' ? new AbortController() : null;
    const timer = controller ? setTimeout(() => controller.abort(), timeoutMs) : null;
    requests += 1;
    try {
      const res = await doFetch(url, { headers: { 'User-Agent': userAgent, Accept: accept }, signal: controller ? controller.signal : undefined, redirect: 'follow' });
      const length = Number(res.headers && typeof res.headers.get === 'function' ? res.headers.get('content-length') : 0);
      if (length > maxBytes) throw new FetchError(`Response too large (${length} bytes)`, res.status);
      const text = await res.text();
      if (!res.ok) {
        const retryAfter = Number(res.headers && typeof res.headers.get === 'function' ? res.headers.get('retry-after') : NaN);
        const err = new FetchError(`HTTP ${res.status}`, res.status);
        err.retryAfter = Number.isFinite(retryAfter) ? retryAfter : null;
        throw err;
      }
      return text;
    } catch (e) {
      if (e instanceof FetchError) throw e;
      throw new FetchError(controller && controller.signal.aborted ? 'Timed out' : `Network error: ${(e && e.message) || e}`);
    } finally {
      if (timer) clearTimeout(timer);
    }
  }

  async function attempt(url, accept) {
    let lastError;
    for (let i = 0; i <= retries; i += 1) {
      try {
        return await once(url, accept);
      } catch (e) {
        lastError = e;
        // Client errors other than rate limits will not change on a retry.
        if (e.final || (e.status && e.status < 500 && e.status !== 429)) break;
        if (i < retries) await sleep(e.retryAfter ? Math.min(30, e.retryAfter) * 1000 : retryDelayMs);
      }
    }
    throw lastError;
  }

  function get(url, { accept = 'application/json' } = {}) {
    let host;
    try {
      host = new URL(url).host;
    } catch {
      return Promise.reject(new FetchError(`Bad URL ${url}`));
    }
    const prev = queues.get(host) || Promise.resolve(0);
    const run = prev.then(async (lastEnd) => {
      const wait = lastEnd + gapMs - Date.now();
      if (wait > 0) await sleep(wait);
      try {
        return { ok: true, value: await attempt(url, accept) };
      } catch (e) {
        return { ok: false, error: e };
      }
    });
    queues.set(
      host,
      run.then(() => Date.now()),
    );
    return run.then((r) => {
      if (!r.ok) throw r.error;
      return r.value;
    });
  }

  async function json(url) {
    const text = await get(url, { accept: 'application/json' });
    try {
      return JSON.parse(text);
    } catch {
      throw new FetchError('Not JSON');
    }
  }

  return { get, json, text: (url, accept = 'text/html, text/calendar, */*') => get(url, { accept }), requests: () => requests };
}

const enc = (s) => encodeURIComponent(s).replace(/%20/g, '+').replace(/%27/g, "'");

/** Meetings (and, within the item budget, their agenda items) for one source. */
async function fetchSource(src, { http, from, to, previous, itemBudget }) {
  if (src.platform === 'legistar') {
    const filter = `EventDate ge datetime'${from}' and EventDate lt datetime'${to}'`;
    const rows = await http.json(`https://webapi.legistar.com/v1/${src.client}/events?$filter=${enc(filter)}&$orderby=EventDate`);
    if (!Array.isArray(rows)) throw new FetchError('Unexpected Legistar answer');
    const meetings = parseLegistarEvents(rows, src);
    await fillItems(meetings, previous, itemBudget, async (m) => {
      const items = await http.json(`https://webapi.legistar.com/v1/${src.client}/events/${m.fetchItems.eventId}/eventitems?AgendaNote=1&MinutesNote=0&Attachments=0`);
      return { items: parseLegistarItems(items, { client: src.client, detailUrl: m.detailUrl }) };
    });
    return { meetings, sourceUrl: `https://${src.client}.legistar.com/Calendar.aspx` };
  }
  if (src.platform === 'civicclerk') {
    const categories = src.categories || ['City Council', 'Town Council'];
    const filter = `startDateTime ge ${from}T00:00:00Z and startDateTime lt ${to}T00:00:00Z and (${categories.map((c) => `categoryName eq '${c}'`).join(' or ')})`;
    let url = `https://${src.tenant}.api.civicclerk.com/v1/Events?$filter=${enc(filter)}&$orderby=startDateTime`;
    const rows = [];
    for (let page = 0; url && page < 4; page += 1) {
      const body = await http.json(url);
      if (!body || !Array.isArray(body.value)) throw new FetchError('Unexpected CivicClerk answer');
      rows.push(...body.value);
      const next = body['@odata.nextLink'];
      url = typeof next === 'string' && next.startsWith(`https://${src.tenant}.api.civicclerk.com/`) ? next : null;
    }
    const meetings = parseCivicClerkEvents(rows, src);
    await fillItems(meetings, previous, itemBudget, async (m) => {
      const body = await http.json(`https://${src.tenant}.api.civicclerk.com/v1/Meetings/${m.fetchItems.agendaId}`);
      return { items: parseCivicClerkMeeting(body, { detailUrl: m.detailUrl }) };
    });
    return { meetings, sourceUrl: `https://${src.tenant}.portal.civicclerk.com/` };
  }
  if (src.platform === 'ical') {
    const text = await http.text(src.url, 'text/calendar, text/plain, */*');
    if (!/BEGIN:VCALENDAR/.test(text)) throw new FetchError('Not a calendar');
    return { meetings: parseIcal(text, { from, to }), sourceUrl: src.url.replace(/\/common\/modules\/iCalendar.*$/, '/Calendar.aspx') };
  }
  if (src.platform === 'docspublished') {
    const org = await http.json(`https://api.docassembler.io/api/organisation/${src.org}`);
    if (!org || !org.Id) throw new FetchError('Unexpected DocsPublished answer');
    const rows = await http.json(`https://api.docassembler.io/api/documents/${org.Id}`);
    const meetings = parseDocsPublishedList(rows, src).filter((m) => m.date >= from && m.date < to);
    await fillItems(meetings, previous, itemBudget, async (m) => {
      const doc = await http.json(`https://api.docassembler.io/api/document/${m.fetchItems.documentId}`);
      return parseDocsPublishedDocument(doc, { agendaUrl: m.agendaUrl });
    });
    return { meetings, sourceUrl: `https://docspublished.io/${src.org}` };
  }
  if (src.platform === 'onbase') {
    const html = await http.text(`https://${src.host}/OnBaseAgendaOnline/`);
    const meetings = parseOnBaseList(html, src).filter((m) => m.date >= from && m.date < to);
    await fillItems(meetings, previous, itemBudget, async (m) => {
      const page = await http.text(`https://${src.host}/OnBaseAgendaOnline/Documents/ViewAgenda?meetingId=${m.fetchItems.meetingId}&type=agenda&doctype=1`);
      return parseOnBaseAgenda(page, { agendaUrl: m.agendaUrl });
    });
    return { meetings, sourceUrl: `https://${src.host}/OnBaseAgendaOnline/` };
  }
  if (src.platform === 'municode') {
    const page = (n) => `https://meetings.municode.com/PublishPage/index?cid=${src.cid}&ppid=${src.ppid}&p=${n}`;
    // Newest first, five rows a page: two pages reach back far enough for the next meetings.
    const meetings = [];
    for (const n of [1, 2]) meetings.push(...parseMunicodePublish(await http.text(page(n)), src));
    const inWindow = meetings.filter((m) => m.date >= from && m.date < to);
    await fillItems(inWindow, previous, itemBudget, async (m) => parseMunicodeAda(await http.text(m.agendaUrl), { agendaUrl: m.agendaUrl }));
    return { meetings: inWindow, sourceUrl: page(1) };
  }
  if (src.platform === 'agendacenter') {
    const html = await http.text(`https://${src.host}${src.path}`);
    return { meetings: parseAgendaCenter(html, src).filter((m) => m.date >= from && m.date < to), sourceUrl: `https://${src.host}${src.path}` };
  }
  throw new FetchError(`Unknown platform ${src.platform}`);
}

/**
 * Agenda items for meetings with a posted agenda: reused from the previous snapshot when the
 * agenda has not changed, otherwise fetched, soonest meeting first, within the city's budget.
 */
async function fillItems(meetings, previous, budget, fetchOne) {
  const prevByKey = new Map((previous || []).map((m) => [m.key, m]));
  const today = budget.today;
  const upcoming = (m) => Number(m.date >= today);
  // Upcoming meetings first, soonest first; then past ones, most recent first.
  const wanting = meetings
    .filter((m) => m.fetchItems)
    .sort((a, b) => upcoming(b) - upcoming(a) || (upcoming(a) ? compareDates(a.date, b.date) : compareDates(b.date, a.date)));
  for (const m of wanting) {
    const prev = prevByKey.get(m.key);
    if (prev && Array.isArray(prev.items) && prev.stamp === m.stamp) {
      m.items = prev.items;
      if (!m.agendaPostedOn && prev.agendaPostedOn) m.agendaPostedOn = prev.agendaPostedOn;
      continue;
    }
    if (budget.left > 0) {
      budget.left -= 1;
      try {
        const got = await fetchOne(m);
        m.items = got.items || [];
        if (got.postedOn && !m.agendaPostedOn && got.postedOn <= m.date) m.agendaPostedOn = got.postedOn;
        continue;
      } catch (e) {
        budget.errors.push(`${m.date} items: ${e.message}`);
      }
    }
    // Not fetched this run: keep what an earlier run found, even for an older version.
    if (prev && Array.isArray(prev.items)) m.items = prev.items;
    if (prev && !m.agendaPostedOn && prev.agendaPostedOn) m.agendaPostedOn = prev.agendaPostedOn;
  }
}

/** Snapshot-ready meeting record (internal fetch hints dropped). */
function publicMeeting(m) {
  const out = { key: m.key, date: m.date, time: m.time || null, label: m.label, type: MEETING_TYPES.has(m.type) ? m.type : 'regular' };
  if (m.cancelled) out.cancelled = true;
  if (m.special) out.special = true;
  if (m.postingOnly) out.postingOnly = true;
  if (m.agendaUrl) out.agendaUrl = m.agendaUrl;
  if (m.detailUrl) out.detailUrl = m.detailUrl;
  if (m.agendaPostedOn) out.agendaPostedOn = m.agendaPostedOn;
  if (m.stamp) out.stamp = m.stamp;
  if (Array.isArray(m.items) && m.items.length) out.items = m.items;
  return out;
}

/**
 * Combine what a city's sources report. The first source is the main one and is kept as it
 * is. A later source's meeting on the same date at the same time, or of the same kind, is the
 * same meeting and only fills what is missing (a calendar feed adds dates far ahead, an agenda
 * center adds the posted agenda); anything else it lists is added.
 */
export function combineSourceMeetings(lists) {
  const [first = [], ...rest] = lists;
  const out = first.map((m) => ({ ...m }));
  for (const list of rest) {
    const fromEarlier = out.slice();
    for (const m of list) {
      const sameDay = fromEarlier.filter((o) => o.date === m.date);
      const same = sameDay.find((o) => m.time && o.time === m.time) || sameDay.find((o) => o.type === m.type) || (m.postingOnly ? sameDay.find((o) => o.type === 'regular') : null);
      if (!same) {
        out.push({ ...m });
        continue;
      }
      // A later source that says cancelled wins over one that is silent, unless the main
      // source has an agenda posted for the meeting. Its notice is not that agenda.
      if (m.cancelled) {
        if (!same.agendaUrl) same.cancelled = true;
        continue;
      }
      for (const field of ['time', 'agendaUrl', 'detailUrl', 'agendaPostedOn', 'items']) if (!same[field] && m[field]) same[field] = m[field];
      if (same.postingOnly && !m.postingOnly) same.postingOnly = false;
    }
  }
  return out.sort((a, b) => compareDates(a.date, b.date) || String(a.time || '').localeCompare(String(b.time || '')));
}

const daysAgo = (iso, nowMs) => (nowMs - Date.parse(iso)) / DAY_MS;

/**
 * "Agenda posted" dates for platforms that do not publish one. A date found earlier is kept.
 * Otherwise, when the previous run (at most two days ago) saw the meeting without an agenda,
 * or did not list it at all, the agenda appeared since then: today, to within one run. With
 * no recent run to compare against, the date stays unknown rather than guessed.
 */
export function datePostings(meetings, prevEntry, { today, nowMs }) {
  const prevMeetings = prevEntry && Array.isArray(prevEntry.meetings) ? prevEntry.meetings : [];
  const before = new Map(prevMeetings.map((m) => [m && m.key, m]));
  const watched = Boolean(prevEntry && prevEntry.lastSuccessAt && daysAgo(prevEntry.lastSuccessAt, nowMs) <= 2);
  for (const m of meetings) {
    if (!m.agendaUrl || m.agendaPostedOn) continue;
    const seen = before.get(m.key);
    if (seen && isDateStr(seen.agendaPostedOn) && seen.agendaPostedOn <= m.date) m.agendaPostedOn = seen.agendaPostedOn;
    else if (watched && (!seen || !seen.agendaUrl) && m.date >= today) m.agendaPostedOn = today;
  }
  return meetings;
}

/**
 * Fetch every configured source and return a new snapshot. `previous` is the last snapshot
 * (from the deployed site or a local file): a city whose sources fail keeps its previous
 * meetings, marked stale, for up to AGENDA_STALE_DAYS. Past meetings already in `previous`
 * are carried for AGENDA_KEEP_DAYS so their items still count as "recently on the agenda".
 * Never rejects.
 * @param {{fetch?: typeof fetch, previous?: object|null, now?: Date, cityIds?: string[], budgetMs?: number, gapMs?: number, timeoutMs?: number, retryDelayMs?: number, concurrency?: number, log?: (line: string) => void, sources?: object}} [options]
 */
export async function buildAgendaSnapshot({ fetch: fetchImpl, previous = null, now = new Date(), cityIds, budgetMs = 6 * 60 * 1000, gapMs = 1000, timeoutMs = 15000, retryDelayMs = 2000, concurrency = 4, log = () => {}, sources = AGENDA_SOURCES } = {}) {
  const nowMs = now.getTime();
  const nowIso = new Date(nowMs).toISOString();
  const today = utcToCentral(nowIso).date;
  const from = addDays(today, -AGENDA_LOOKBACK_DAYS);
  const to = addDays(today, AGENDA_HORIZON_DAYS);
  const keepFrom = addDays(today, -AGENDA_KEEP_DAYS);
  const http = createPoliteFetch({ fetch: fetchImpl, gapMs, timeoutMs, retryDelayMs, deadline: Date.now() + budgetMs });
  const prevCities = (previous && previous.cities) || {};
  const reuseItems = Boolean(previous && previous.parserVersion === AGENDA_PARSER_VERSION);
  const ids = (cityIds && cityIds.length ? cityIds : Object.keys(sources)).filter((id) => sources[id]);
  const cities = {};

  const runCity = async (cityId) => {
    const list = sources[cityId];
    const prev = prevCities[cityId] || null;
    const prevMeetings = prev && Array.isArray(prev.meetings) ? prev.meetings : [];
    const usable = list.filter((s) => s.platform !== 'none');
    if (!usable.length) {
      cities[cityId] = { status: 'unsupported', reason: list[0].reason || 'none', fetchedAt: nowIso };
      return;
    }
    const budget = { left: ITEM_FETCHES_PER_CITY, errors: [], today };
    try {
      const results = [];
      for (const src of usable) {
        try {
          results.push(await fetchSource(src, { http, from, to, previous: reuseItems ? prevMeetings : [], itemBudget: budget }));
        } catch (e) {
          // A later source failing is not fatal when the main one answered.
          if (!results.length) throw e;
          budget.errors.push(`${src.platform}: ${e.message}`);
        }
      }
      const fresh = combineSourceMeetings(results.map((r) => r.meetings)).map(publicMeeting);
      datePostings(fresh, prev, { today, nowMs });
      const freshKeys = new Set(fresh.map((m) => m.key));
      // Meetings that fell out of the fetch window keep their items as recent history.
      const carried = prevMeetings.filter((m) => m && isDateStr(m.date) && m.date < from && m.date >= keepFrom && !freshKeys.has(m.key));
      cities[cityId] = {
        status: 'ok',
        platform: usable[0].platform,
        sourceUrl: results[0].sourceUrl,
        fetchedAt: nowIso,
        lastSuccessAt: nowIso,
        meetings: [...carried, ...fresh],
        ...(budget.errors.length ? { warnings: budget.errors.slice(0, 5) } : {}),
      };
      log(`${cityId}: ${fresh.length} meetings, ${fresh.reduce((n, m) => n + (m.items ? m.items.length : 0), 0)} items`);
    } catch (e) {
      const message = (e && e.message) || String(e);
      const lastSuccessAt = prev && prev.lastSuccessAt ? prev.lastSuccessAt : null;
      if (prev && lastSuccessAt && daysAgo(lastSuccessAt, nowMs) <= AGENDA_STALE_DAYS && prevMeetings.length) {
        cities[cityId] = { ...prev, status: 'stale', fetchedAt: nowIso, error: message, meetings: prevMeetings.filter((m) => m && m.date >= keepFrom) };
      } else {
        cities[cityId] = { status: 'error', platform: usable[0].platform, fetchedAt: nowIso, lastSuccessAt, error: message, meetings: [] };
      }
      log(`${cityId}: failed (${message})`);
    }
  };

  const queue = ids.slice();
  const workers = Array.from({ length: Math.max(1, Math.min(concurrency, queue.length)) }, async () => {
    while (queue.length) {
      const id = queue.shift();
      try {
        await runCity(id);
      } catch (e) {
        cities[id] = { status: 'error', fetchedAt: nowIso, error: (e && e.message) || String(e), meetings: [] };
      }
    }
  });
  await Promise.all(workers);

  // Cities outside this run (a partial --only run) keep their previous entries untouched.
  for (const [id, entry] of Object.entries(prevCities)) if (!cities[id] && sources[id]) cities[id] = entry;

  const ordered = {};
  for (const id of Object.keys(cities).sort()) ordered[id] = cities[id];
  return { schema: AGENDA_SNAPSHOT_SCHEMA, parserVersion: AGENDA_PARSER_VERSION, generatedAt: nowIso, horizonDays: AGENDA_HORIZON_DAYS, requests: http.requests(), cities: ordered };
}

/** Counts of city entries by status: { ok, stale, error, unsupported }. */
export function snapshotCounts(snapshot) {
  const counts = { ok: 0, stale: 0, error: 0, unsupported: 0 };
  for (const entry of Object.values((snapshot && snapshot.cities) || {})) if (entry && entry.status in counts) counts[entry.status] += 1;
  return counts;
}

/** True when a value looks like a snapshot this code can merge. */
export function isAgendaSnapshot(snap) {
  return Boolean(snap && typeof snap === 'object' && snap.schema === AGENDA_SNAPSHOT_SCHEMA && snap.cities && typeof snap.cities === 'object');
}

/* ------------------------------------------------------------------------------------------ */
/* Merging into city records                                                                  */
/* ------------------------------------------------------------------------------------------ */

function slug(s) {
  return String(s || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
}

const minutesOf = (time) => (isTimeStr(time) ? Number(time.slice(0, 2)) * 60 + Number(time.slice(3)) : null);

/**
 * How well a curated meeting matches a source's meeting: the same kind of meeting that day
 * counts most (a portal that lists one 5:30 PM "City Council Meeting" for a work session and
 * the 7 PM regular meeting means the regular one), then the same start time; closer in time is
 * better. A special-called meeting only matches a meeting at its exact time, so it is never
 * folded into the regular one. 0 means no match.
 */
function matchScore(o, live) {
  const sameTime = Boolean(live.time) && o.time === live.time;
  const sameType = o.type === live.type || (live.type === 'regular' && o.type === 'other');
  let score = 0;
  if (sameType && !live.special) score += 4;
  if (sameTime) score += 3;
  if (!score && !live.time && live.postingOnly && o.type === 'regular') score = 1;
  if (!score) return 0;
  const gap = live.time && minutesOf(o.time) !== null ? Math.abs(minutesOf(o.time) - minutesOf(live.time)) : 0;
  return score * 10000 - Math.min(gap, 9999);
}

/**
 * Pair a day's source meetings with that day's curated meetings, one to one, best pairs
 * first. Returns a Map from each source meeting to its curated meeting (or nothing).
 */
function pairDay(occurrences, lives) {
  const pairs = [];
  lives.forEach((live, li) => occurrences.forEach((o, oi) => {
    const s = matchScore(o, live);
    if (s > 0) pairs.push({ li, oi, s });
  }));
  pairs.sort((a, b) => b.s - a.s || a.li - b.li || a.oi - b.oi);
  const out = new Map();
  const taken = new Set();
  for (const p of pairs) {
    if (out.has(lives[p.li]) || taken.has(p.oi)) continue;
    out.set(lives[p.li], occurrences[p.oi]);
    taken.add(p.oi);
  }
  return out;
}

/** Whether the public may speak at a meeting the source adds: as at the council's own meeting of that kind. */
function openToCommentFor(city, type, live) {
  if (live.special) return false;
  const rule = (city.meetings || []).find((r) => r && r.type === type);
  return rule ? rule.openToPublicComment !== false : false;
}

/** The same kind of meeting: a source's "regular" meeting also covers a council's 'other' one. */
const sameKind = (o, live) => o.type === live.type || (live.type === 'regular' && o.type === 'other');

const isCancellation = (ex) => Boolean(ex) && (ex.status === 'cancelled' || ex.status === 'recess');
/** Identifies a curated cancellation in the English record and in every localized copy of it. */
const cancellationKey = (ex) => `${ex.date}|${ex.status}|${isTimeStr(ex.time) ? ex.time : ''}`;
const withoutLifted = (list, keys) => list.filter((ex) => !(isCancellation(ex) && keys.has(cancellationKey(ex))));

/** The curated cancellations that take a meeting off the calendar: that day's, for every meeting or for its time. */
function cancellationsOf(city, occ) {
  const list = Array.isArray(city.scheduleExceptions) ? city.scheduleExceptions : [];
  return list.filter((ex) => isCancellation(ex) && ex.date === occ.date && (!isTimeStr(ex.time) || ex.time === occ.time));
}

/**
 * Meetings our data cancelled that a source lists again that day: a source meeting with a start
 * time, not cancelled, not special, that pairs with none of the day's live meetings but with a
 * cancelled meeting of the same kind. A meeting that was moved to another date is not one.
 */
function cancelledButListed(occurrences, lives) {
  const open = occurrences.filter((o) => o.status !== 'cancelled');
  const paired = pairDay(open, lives);
  const listed = lives.filter((m) => !paired.has(m) && !m.cancelled && !m.special && !m.postingOnly && m.time);
  const closed = occurrences.filter((o) => o.status === 'cancelled' && !o.movedTo);
  if (!listed.length || !closed.length) return [];
  const pairs = [];
  listed.forEach((live) => closed.forEach((o) => {
    if (sameKind(o, live)) pairs.push({ live, o, s: matchScore(o, live) });
  }));
  pairs.sort((a, b) => b.s - a.s);
  const out = [];
  const used = new Set();
  for (const p of pairs) {
    if (used.has(p.live) || out.includes(p.o)) continue;
    used.add(p.live);
    out.push(p.o);
  }
  return out;
}

/** The council's rule for meetings of this kind, nearest in start time: the template an added meeting copies. */
function ruleFor(city, live) {
  let best = null;
  for (const rule of Array.isArray(city.meetings) ? city.meetings : []) {
    if (!rule || rule.type !== live.type || !rule.label || !rule.recurrence || !isTimeStr(rule.recurrence.time)) continue;
    const gap = live.time ? Math.abs(minutesOf(rule.recurrence.time) - minutesOf(live.time)) : 0;
    if (!best || gap < best.gap) best = { rule, gap };
  }
  return best ? best.rule : null;
}

/**
 * Work out, from the English city record and one city's snapshot entry, what the source adds:
 * schedule exceptions (cancellations, meetings listed again, added council meetings), agenda
 * items attached to their meetings, and per-meeting facts for the meeting sheet. Locale-free;
 * the result goes through applyLivePlan() for each language. Returns null when there is nothing
 * to merge or the merged record would not validate.
 *
 * A source meeting on a date our data cancelled (a recess, or "no meeting appears on the
 * portal") that is of the same kind as the cancelled meeting lifts that curated cancellation:
 * the meeting comes back with its own time, name and comment rules and a "listed again" note,
 * instead of a second meeting at the source's time. (Portals often list one start time for a
 * whole evening, such as a 2 PM work session followed by the 6 PM public session.)
 * A meeting on a date the rules do not cover, past the end of a published calendar or on an
 * extra date, is added as one of the council's ordinary meetings of that kind (status
 * 'scheduled', the rule's time, name and comment rules). Only a meeting the source itself
 * marks special or called is added as a special meeting, under its own name and time.
 */
export function planLiveAgenda(city, entry) {
  if (!city || !entry || (entry.status !== 'ok' && entry.status !== 'stale') || !Array.isArray(entry.meetings) || !entry.meetings.length) return null;
  const exceptions = [];
  const items = [];
  const live = [];
  const ids = new Set();
  const lifted = new Set();
  // The record with every curated cancellation the source contradicts lifted so far.
  let base = city;
  const curated = new Set((city.agendaItems || []).map((a) => `${a.meetingDate || ''}|${normTitle(a.title)}`));
  const byDate = new Map();
  for (const raw of entry.meetings) {
    const m = sanitizeMeeting(raw);
    if (!m) continue;
    if (!byDate.has(m.date)) byDate.set(m.date, []);
    byDate.get(m.date).push(m);
  }
  for (const [date, lives] of [...byDate].sort((a, b) => compareDates(a[0], b[0]))) {
    let occurrences = expandCityMeetings(base, date, date);
    const reinstated = new Set();
    const back = cancelledButListed(occurrences, lives);
    if (back.length) {
      const keys = new Set(back.flatMap((o) => cancellationsOf(base, o).map(cancellationKey)));
      const next = { ...base, scheduleExceptions: withoutLifted(base.scheduleExceptions || [], keys) };
      const after = expandCityMeetings(next, date, date);
      const restored = back.filter((o) => after.some((a) => a.id === o.id && a.status !== 'cancelled'));
      // Only when lifting really brings the meeting back (a meeting moved away stays moved).
      if (restored.length) {
        base = next;
        occurrences = after;
        for (const k of keys) lifted.add(k);
        for (const o of restored) reinstated.add(o.id);
      }
    }
    const pairs = pairDay(
      occurrences.filter((o) => o.status !== 'cancelled'),
      lives,
    );
    for (const m of lives) {
      const match = pairs.get(m) || null;
      let target = match;
      if (m.cancelled) {
        // Only a meeting we show can be cancelled; a cancelled one we never had is left out.
        if (match) {
          exceptions.push({ date, status: 'cancelled', time: match.time, live: true });
          live.push(liveRecord(match.id, m, 'cancelled'));
          ids.add(match.id);
        }
        continue;
      }
      if (!match) {
        // Added only with a start time (adapters keep only the council's meetings); a posting
        // with no time never invents a meeting.
        if (m.postingOnly || !m.time) continue;
        const taken = (id) => occurrences.some((o) => o.id === id) || ids.has(id);
        const type = MEETING_TYPES.has(m.type) ? m.type : 'other';
        const rule = m.special ? null : ruleFor(city, m);
        if (rule) {
          const id = `${city.cityId}:${date}:${slug(rule.label)}`;
          if (taken(id)) continue;
          exceptions.push({ date, status: 'added', type: rule.type, label: rule.label, live: true });
          target = { id, label: rule.label };
        } else if (m.special) {
          // Meeting ids come from the name, so a special meeting named like a curated meeting
          // that day takes the engine's generic "Special council meeting" name instead, and
          // never shares an id.
          const generic = t('schedule.specialMeeting', undefined, 'en');
          const name = taken(`${city.cityId}:${date}:${slug(m.label)}`) ? null : m.label;
          const id = `${city.cityId}:${date}:${slug(name || generic)}`;
          if (taken(id)) continue;
          exceptions.push({ date, status: 'special', time: m.time, ...(name ? { label: name } : {}), type, openToPublicComment: openToCommentFor(city, type, m), live: true });
          target = { id, label: name || generic };
        } else {
          // A kind of meeting the council's rules do not have: the source's own name and time,
          // and no public comment, because nothing says the public may speak.
          const id = `${city.cityId}:${date}:${slug(m.label)}`;
          if (taken(id)) continue;
          exceptions.push({ date, status: 'added', time: m.time, label: m.label, type, openToPublicComment: false, live: true });
          target = { id, label: m.label };
        }
      }
      if (ids.has(target.id)) continue;
      ids.add(target.id);
      const listedAgain = Boolean(match) && reinstated.has(match.id);
      if (listedAgain) exceptions.push({ date, status: 'note', time: match.time, live: true });
      live.push(liveRecord(target.id, m, !match ? 'added' : listedAgain ? 'reinstated' : 'matched'));
      for (const it of m.items) {
        const key = `${date}|${normTitle(it.title)}`;
        if (curated.has(key)) continue;
        curated.add(key);
        // meetingLabel is the curated meeting's English name, so the engine puts the item on it.
        items.push({ title: it.title, ...(it.summary ? { summary: it.summary } : {}), ...(it.url ? { url: it.url } : {}), topics: it.topics, meetingDate: date, meetingLabel: target.label, auto: true });
      }
    }
  }
  if (!exceptions.length && !items.length && !live.length) return null;
  const instant = (s) => (typeof s === 'string' && Number.isFinite(Date.parse(s)) ? s : null);
  const plan = { exceptions, lifted: [...lifted], items, live, fetchedAt: instant(entry.fetchedAt), lastSuccessAt: instant(entry.lastSuccessAt), status: entry.status, sourceUrl: isUrl(entry.sourceUrl) ? entry.sourceUrl : null };
  // A plan that would break the record is dropped: the curated data still stands.
  if (validateCity(mergeRecord(city, plan, null, 'en')).length) return null;
  return plan;
}

function liveRecord(id, m, kind) {
  // A cancelled meeting's document is the cancellation notice, not an agenda.
  const agenda = kind !== 'cancelled';
  return {
    id,
    date: m.date,
    time: m.time,
    label: m.label,
    kind,
    ...(agenda && m.agendaUrl ? { agendaUrl: m.agendaUrl } : {}),
    ...(m.detailUrl ? { detailUrl: m.detailUrl } : {}),
    ...(agenda && m.agendaPostedOn ? { agendaPostedOn: m.agendaPostedOn } : {}),
    itemCount: agenda ? m.items.length : 0,
  };
}

/** A snapshot meeting with every field checked, or null. Snapshot files are data from the network. */
function sanitizeMeeting(raw) {
  if (!raw || typeof raw !== 'object' || !isDateStr(raw.date)) return null;
  const label = typeof raw.label === 'string' && raw.label.trim() ? raw.label.trim().slice(0, 120) : null;
  if (!label) return null;
  const items = (Array.isArray(raw.items) ? raw.items : [])
    .filter((it) => it && typeof it.title === 'string' && it.title.trim() && Array.isArray(it.topics) && it.topics.length && it.topics.every(isTopicId))
    .slice(0, ITEMS_PER_MEETING)
    .map((it) => ({ title: it.title.trim().slice(0, TITLE_MAX + 3), ...(typeof it.summary === 'string' && it.summary.trim() ? { summary: it.summary.trim().slice(0, SUMMARY_MAX + 3) } : {}), ...(isUrl(it.url) ? { url: it.url } : {}), topics: it.topics.slice(0, 3) }));
  return {
    date: raw.date,
    time: isTimeStr(raw.time) ? raw.time : null,
    label,
    type: MEETING_TYPES.has(raw.type) ? raw.type : 'regular',
    cancelled: raw.cancelled === true,
    special: raw.special === true,
    postingOnly: raw.postingOnly === true,
    agendaUrl: isUrl(raw.agendaUrl) ? raw.agendaUrl : null,
    detailUrl: isUrl(raw.detailUrl) ? raw.detailUrl : null,
    agendaPostedOn: isDateStr(raw.agendaPostedOn) ? raw.agendaPostedOn : null,
    items,
  };
}

/** Plans for every city that has something to merge: Map cityId -> plan. */
export function planLiveAgendas(cities, snapshot) {
  const plans = new Map();
  if (!isAgendaSnapshot(snapshot)) return plans;
  for (const city of cities || []) {
    const entry = snapshot.cities[city && city.cityId];
    if (!entry) continue;
    try {
      const plan = planLiveAgenda(city, entry);
      if (plan) plans.set(city.cityId, plan);
    } catch {
      // One malformed entry never takes the other cities down.
    }
  }
  return plans;
}

/** The note each kind of exception a plan adds carries, by status. */
const LIVE_NOTES = { cancelled: 'live.cancelledNote', note: 'live.reinstatedNote', special: 'live.addedNote', added: 'live.addedNote' };

function mergeRecord(city, plan, strings, locale) {
  const exceptions = plan.exceptions.map((ex) => {
    const out = { ...ex };
    const key = LIVE_NOTES[ex.status] || 'live.addedNote';
    out.note = t(key, undefined, locale);
    out.noteSource = t(key, undefined, 'en');
    if (typeof ex.label === 'string' && strings && typeof strings[ex.label] === 'string') {
      out.labelSource = ex.label;
      out.label = strings[ex.label];
    }
    return out;
  });
  const items = plan.items.map((it) => (strings && typeof strings[it.title] === 'string' ? { ...it, titleSource: it.title, title: strings[it.title] } : { ...it }));
  const own = Array.isArray(city.scheduleExceptions) ? city.scheduleExceptions : [];
  const lifted = new Set(Array.isArray(plan.lifted) ? plan.lifted : []);
  return {
    ...city,
    // Curated cancellations the source contradicts are lifted (dates and statuses are the
    // same in every language, so the localized copies match too).
    scheduleExceptions: [...(lifted.size ? withoutLifted(own, lifted) : own), ...exceptions],
    agendaItems: [...(Array.isArray(city.agendaItems) ? city.agendaItems : []), ...items],
    liveAgenda: { fetchedAt: plan.fetchedAt, lastSuccessAt: plan.lastSuccessAt, status: plan.status, sourceUrl: plan.sourceUrl, meetings: plan.live },
  };
}

/**
 * Apply one city's plan to a (possibly localized) city record. Notes are written in `locale`;
 * a label the source gave is translated when the city-data memory (`strings`) knows it, and
 * keeps its English original as labelSource so meeting ids stay the same in every language.
 * Agenda items from a source keep their English titles unless the memory knows them.
 */
export function applyLivePlan(city, plan, { strings = null, locale } = {}) {
  if (!city || !plan) return city;
  return mergeRecord(city, plan, strings, locale);
}

/** applyLivePlan over a list: cities without a plan come back unchanged (same object). */
export function applyLivePlans(cities, plans, options = {}) {
  if (!plans || !plans.size) return cities;
  return cities.map((c) => (plans.has(c.cityId) ? applyLivePlan(c, plans.get(c.cityId), options) : c));
}

/**
 * What the city's agenda site says about one meeting, or null: { agendaUrl, agendaPostedOn,
 * detailUrl, time (as posted), kind ('matched' | 'added' | 'cancelled' | 'reinstated': listed
 * again after our data cancelled it), itemCount, fetchedAt }.
 */
export function liveMeetingFor(city, occurrence) {
  const info = city && city.liveAgenda;
  if (!info || !occurrence || !Array.isArray(info.meetings)) return null;
  const rec = info.meetings.find((m) => m.id === occurrence.id);
  return rec ? { ...rec, fetchedAt: info.fetchedAt || null, sourceUrl: info.sourceUrl || null } : null;
}

/* ------------------------------------------------------------------------------------------ */
/* Health                                                                                     */
/* ------------------------------------------------------------------------------------------ */

/**
 * Cities whose agenda source is failing: [{ cityId, status, error, lastSuccessAt }], worst
 * first. Unsupported cities are not failures and are left out.
 */
export function failingAgendaSources(snapshot) {
  const out = [];
  for (const [cityId, entry] of Object.entries((snapshot && snapshot.cities) || {})) {
    if (!entry || (entry.status !== 'error' && entry.status !== 'stale')) continue;
    out.push({ cityId, status: entry.status, error: entry.error || '', lastSuccessAt: entry.lastSuccessAt || null });
  }
  return out.sort((a, b) => (a.status === b.status ? a.cityId.localeCompare(b.cityId) : a.status === 'error' ? -1 : 1));
}
