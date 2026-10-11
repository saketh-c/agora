import { getTopic } from './topics.js';
import { t, tList, lowerFirst, stripIsolates, getLocale, isLocale } from './i18n/runtime.js';
import { speechPace, speechUnits } from './text.js';

/** English glossary, kept for callers that need a stable reference. Prefer glossary() for display. */
export const GLOSSARY = Object.freeze(tList('civics.glossary', 'en'));
export const FIRST_MEETING_CHECKLIST = Object.freeze(tList('civics.checklist', 'en'));
export const SPEAKING_TIPS = Object.freeze(tList('civics.tips', 'en'));

/** Localized versions for display. */
export function glossary(locale) {
  return tList('civics.glossary', locale);
}

export function checklist(locale) {
  return tList('civics.checklist', locale);
}

export function speakingTips(locale) {
  return tList('civics.tips', locale);
}

/** Greeting bucket for a meeting start time ('HH:MM'). */
export function timeOfDayFor(time) {
  const hour = Number(String(time || '18:00').split(':')[0]);
  if (hour < 12) return 'morning';
  if (hour < 17) return 'afternoon';
  return 'evening';
}

const HAN = /\p{Script=Han}/u;
const escapeRe = (v) => v.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/**
 * Chinese templates put one space where a {name}, {school} or {city} meets a Chinese character,
 * since those usually hold English names ("我叫 Ana"). A value typed in Chinese closes that gap
 * up again ("我叫李明", not "我叫 李明"), since Chinese puts no space between two characters.
 */
function closeHanGaps(text, values) {
  let out = text;
  for (const v of values) {
    if (!v) continue;
    const chars = [...v];
    if (HAN.test(chars[0])) out = out.replace(new RegExp(`(\\p{Script=Han}) (?=${escapeRe(v)})`, 'gu'), '$1');
    if (HAN.test(chars[chars.length - 1])) out = out.replace(new RegExp(`(${escapeRe(v)}) (?=\\p{Script=Han})`, 'gu'), '$1');
  }
  return out;
}

/**
 * Build a first-draft public comment from a few inputs. Deterministic, no AI needed,
 * in the active (or given) locale.
 * @param {{name?: string, school?: string, cityName?: string, topicId?: string, itemTitle?: string, position?: 'support'|'oppose'|'concerned'|'ask', story?: string, ask?: string, timeOfDay?: 'morning'|'afternoon'|'evening', locale?: string}} input
 */
export function buildComment(input = {}) {
  const locale = input.locale;
  const tr = (key, params) => t(key, params, locale);
  const str = (v) => (typeof v === 'string' ? v.trim() : '');
  const name = str(input.name) || tr('civics.comment.myName');
  const school = str(input.school);
  const city = str(input.cityName) || tr('civics.comment.thisCity');
  const topic = getTopic(input.topicId || 'other', locale);
  const generic = topic.id === 'other';
  const topicPhrase = generic ? tr('civics.comment.genericTopic') : topic.short || lowerFirst(topic.label);
  const item = str(input.itemTitle);
  const story = str(input.story);
  const ask = str(input.ask);
  const position = ['support', 'oppose', 'concerned', 'ask'].includes(input.position) ? input.position : 'ask';
  const greeting = { morning: tr('civics.comment.greetingMorning'), afternoon: tr('civics.comment.greetingAfternoon'), evening: tr('civics.comment.greetingEvening') }[input.timeOfDay] || tr('civics.comment.greetingEvening');

  const intro = closeHanGaps(school ? tr('civics.comment.introSchool', { greeting, name, school, city }) : tr('civics.comment.introLive', { greeting, name, city }), [name, school, city]);
  const subject = item ? tr('civics.comment.subjectItem', { item }) : tr('civics.comment.subjectTopic', { topic: topicPhrase });
  // Optional keys: a dictionary without them falls back to the older wording.
  const has = (key) => tr(key) !== key;
  // With no agenda item there is no "this item" to vote on, so the stance names the topic.
  const onTopic = (key) => (!item && !generic && has(`${key}Topic`) ? tr(`${key}Topic`, { topic: topicPhrase }) : tr(key));
  const stance = {
    support: onTopic('civics.comment.stanceSupport'),
    oppose: onTopic('civics.comment.stanceOppose'),
    concerned: onTopic('civics.comment.stanceConcerned'),
    ask: generic ? tr('civics.comment.stanceAskGeneric') : tr('civics.comment.stanceAskTopic', { topic: topicPhrase }),
  }[position];

  // The angle is spoken by the student, so it uses the first-person version when there is one
  // (the topic's youthAngle talks to the student as "you"). It continues a sentence, so only its
  // first letter drops to lowercase: "DART, bus routes" stays as written.
  const angleKey = `civics.comment.angles.${topic.id}`;
  const angle = lowerFirst((has(angleKey) ? tr(angleKey) : topic.youthAngle).replace(/\.$/, ''));
  const why = story ? story : generic ? tr('civics.comment.whyGeneric') : tr('civics.comment.whyTopic', { angle });
  // The ask continues "I am asking you to ...", so "Keep the bus" reads "keep the bus" (acronyms stay).
  const close = ask ? tr('civics.comment.closeAsk', { ask: lowerFirst(ask.replace(/\.$/, '')) }) : tr('civics.comment.closeDefault');

  // The draft is the student's own text (copied, edited, spoken), so it carries no bidi
  // isolates: in Arabic the bidi algorithm lays out a name or a city on its own.
  return stripIsolates([intro, subject, stance, why, close].join('\n\n'));
}

/**
 * Rough spoken length of a text in the language it is written in: words (or, in Chinese,
 * characters) at that language's steady speaking rate, SPEECH_PACE[lang].estimate (130 words a
 * minute in English, 200 characters a minute in Chinese).
 */
export function estimateSpeakingSeconds(text, locale) {
  const lang = locale && isLocale(locale) ? locale : getLocale();
  return Math.round((speechUnits(text, lang) / speechPace(lang).estimate) * 60);
}

/** The speaking rate estimateSpeakingSeconds() assumes, in units (words or characters) a minute. */
export function speakingRate(locale) {
  return speechPace(locale && isLocale(locale) ? locale : getLocale()).estimate;
}
