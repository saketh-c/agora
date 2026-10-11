import { t } from './i18n/runtime.js';

/**
 * Fixed topic taxonomy. Agenda items and news links are tagged with these ids.
 * Keywords drive lightweight matching against English agenda and headline text; the
 * matching icon for each id lives in the web app's TopicIcon component.
 * Display text (label, short, youthAngle) comes from the active locale dictionary.
 */
const TOPIC_DEFS = Object.freeze([
  { id: 'housing', keywords: ['housing', 'apartment', 'affordable', 'rent', 'rental', 'renter', 'homeless', 'shelter', 'residential', 'multifamily', 'tenant', 'landlord'] },
  { id: 'transit', keywords: ['transit', 'dart', 'bus', 'rail', 'bike', 'bicycle', 'trail', 'pedestrian', 'sidewalk', 'trinity metro', 'crosswalk'] },
  { id: 'roads-traffic', keywords: ['road', 'street', 'traffic', 'intersection', 'paving', 'signal', 'speed', 'highway', 'thoroughfare', 'pavement', 'parking'] },
  { id: 'parks-recreation', keywords: ['park', 'recreation', 'trail', 'pool', 'aquatic', 'playground', 'sports', 'field', 'rec center', 'skate'] },
  { id: 'public-safety', keywords: ['police', 'fire', 'firefighter', 'safety', 'emergency', 'crime', 'ems', 'ambulance', 'officer', 'camera', 'curfew'] },
  { id: 'environment', keywords: ['environment', 'climate', 'sustainable', 'sustainability', 'recycle', 'recycling', 'tree', 'solar', 'air quality', 'green', 'flood', 'flooding', 'stormwater', 'energy'] },
  { id: 'budget-taxes', keywords: ['budget', 'tax', 'fiscal', 'appropriation', 'fund', 'funding', 'bond', 'revenue', 'rate', 'fee', 'levy'] },
  { id: 'zoning-development', keywords: ['zoning', 'rezoning', 'development', 'planned development', 'plat', 'land use', 'variance', 'specific use', 'comprehensive zoning'] },
  { id: 'education-libraries', keywords: ['library', 'libraries', 'education', 'school', 'isd', 'literacy', 'tutoring', 'after-school', 'learning'] },
  { id: 'youth', keywords: ['youth', 'teen', 'student', 'young', 'summer job', 'internship', 'mentor', 'mentoring', 'juvenile'] },
  { id: 'arts-culture', keywords: ['art', 'culture', 'museum', 'music', 'festival', 'theater', 'theatre', 'mural', 'cultural', 'heritage'] },
  { id: 'health', keywords: ['health', 'mental', 'clinic', 'wellness', 'food', 'nutrition', 'hospital', 'vaccine', 'opioid'] },
  { id: 'economic-development', keywords: ['economic', 'business', 'incentive', 'chapter 380', 'employer', 'jobs', 'workforce', 'retail', 'corporate'] },
  { id: 'utilities-water', keywords: ['water', 'wastewater', 'sewer', 'utility', 'utilities', 'electric', 'gas', 'trash', 'solid waste', 'sanitation', 'drainage'] },
  { id: 'animal-services', keywords: ['animal', 'pet', 'shelter', 'adoption', 'dog', 'cat', 'wildlife'] },
  { id: 'technology', keywords: ['technology', 'broadband', 'internet', 'wifi', 'software', 'data', 'digital', 'cyber', 'artificial intelligence'] },
  { id: 'governance-elections', keywords: ['election', 'charter', 'redistrict', 'board', 'commission', 'appointment', 'ethics', 'governance', 'canvass'] },
  { id: 'other', keywords: [] },
]);

export const TOPIC_IDS = Object.freeze(TOPIC_DEFS.map((d) => d.id));
const byId = new Map(TOPIC_DEFS.map((d) => [d.id, d]));

function withText(def, locale) {
  return {
    ...def,
    label: t(`topics.${def.id}.label`, undefined, locale),
    short: t(`topics.${def.id}.short`, undefined, locale),
    youthAngle: t(`topics.${def.id}.youthAngle`, undefined, locale),
  };
}

/** A topic with its display text in the active (or given) locale. Unknown ids resolve to "other". */
export function getTopic(id, locale) {
  return withText(byId.get(id) || byId.get('other'), locale);
}

/** All topics with display text in the active (or given) locale. */
export function topicList(locale) {
  return TOPIC_DEFS.map((d) => withText(d, locale));
}

/** English topic list, kept for callers that need a stable reference. */
export const TOPICS = Object.freeze(TOPIC_DEFS.map((d) => withText(d, 'en')));

export function topicLabel(id, locale) {
  return getTopic(id, locale).label;
}

export function isTopicId(id) {
  return byId.has(id);
}

const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/**
 * Keywords up to 7 letters must match a whole word or its plural (so "bus" never hits
 * "business", "park" never hits "parking", and "transit" never hits "transitions"); longer
 * keywords match at a word start so forms like "environmental" and "apartments" still count.
 */
const KEYWORD_PATTERNS = new Map(
  TOPIC_DEFS.map((d) => [
    d.id,
    d.keywords.map((kw) => ({
      kw,
      re: kw.length <= 7 ? new RegExp(`\\b${escapeRe(kw)}(?:s|es)?\\b`, 'i') : new RegExp(`\\b${escapeRe(kw)}`, 'i'),
      weight: kw.length > 6 ? 2 : 1,
    })),
  ]),
);

/**
 * Guess topic ids from free English text using the keyword lists. Used as a fallback
 * when an agenda item arrives without tags, and by the news filter.
 * @param {string} text
 * @param {number} max most topics to return
 * @param {{minScore?: number}} opts raise minScore (default 1) for precision over recall
 */
export function inferTopics(text, max = 3, { minScore = 1 } = {}) {
  const input = String(text || '');
  const hits = [];
  for (const d of TOPIC_DEFS) {
    if (d.id === 'other') continue;
    let score = 0;
    for (const p of KEYWORD_PATTERNS.get(d.id)) if (p.re.test(input)) score += p.weight;
    if (score >= minScore) hits.push({ id: d.id, score });
  }
  hits.sort((a, b) => b.score - a.score);
  const ids = hits.slice(0, max).map((h) => h.id);
  return ids.length ? ids : ['other'];
}
