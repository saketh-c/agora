/**
 * A profile's setup in words, for the Profile page: where distances are measured from, how
 * far, which times, which topics. Pure (no React), so the Node tests can run it.
 */
import { getTopic, joinList, lowerFirst, t, tn } from '@agora/core';

const TIMES = ['evenings', 'daytime', 'weekends'];
const TOPICS_SHOWN = 3;

/** "Within 15 mi", or "Any distance" when the profile has no limit (maxMiles null). */
export function distanceSummary(prefs) {
  const n = prefs && prefs.maxMiles;
  if (n === null) return t('profile.setup.anyDistance');
  const miles = Number(n) > 0 ? Number(n) : 15;
  return t('profile.setup.within', { n: miles });
}

/** "Weekday evenings and weekends", or a nudge when none is picked. */
export function timesSummary(prefs) {
  const a = (prefs && prefs.availability) || {};
  const labels = TIMES.filter((k) => a[k]).map((k, i) => (i === 0 ? t(`home.setup.${k}`) : lowerFirst(t(`home.setup.${k}`))));
  return labels.length ? joinList(labels) : t('profile.setup.noTimes');
}

/**
 * "Parks, transit, youth programs and the environment", "…, and 2 more", or "No topics yet".
 * The short names read as one phrase; the full labels carry commas of their own ("Buses,
 * trains, and biking") that would blur where one topic ends.
 */
export function topicsSummary(prefs) {
  const ids = ((prefs && prefs.interests) || []).filter((id) => id !== 'other');
  if (!ids.length) return t('profile.setup.noTopics');
  const names = ids.map((id) => {
    const topic = getTopic(id);
    return topic.short || lowerFirst(topic.label);
  });
  names[0] = upperFirst(names[0]);
  if (names.length <= TOPICS_SHOWN + 1) return joinList(names);
  return tn('profile.setup.topicsMore', names.length - TOPICS_SHOWN, { list: names.slice(0, TOPICS_SHOWN).join(', ') });
}

function upperFirst(s) {
  const text = String(s || '');
  return text.charAt(0).toLocaleUpperCase() + text.slice(1);
}

/** "Plano, 4 topics", "4 topics", "No topics yet" or "Setup not finished": one line under a profile's name. */
export function profileMeta(profile, city) {
  const prefs = profile.prefs || {};
  if (!profile.onboarded && !city) return t('profile.notSetUp');
  const n = (prefs.interests || []).filter((id) => id !== 'other').length;
  const topics = n ? tn('profile.topicsChosen', n) : t('profile.setup.noTopics');
  return city ? t('profile.meta', { city: city.name, topics: n ? topics : lowerFirst(topics) }) : topics;
}

/**
 * A file name any system accepts, from a profile's name: "Nguyễn Văn An" becomes
 * "agora-profile-nguyen-van-an.json". Letters with no Latin form (王小明, राम) are kept as
 * they are; a name with nothing usable falls back to the profile id, so two such profiles
 * never export to the same file name.
 */
export function profileFileName(name, id) {
  const slug = String(name || '')
    .normalize('NFD')
    // Accents come off Latin letters only; in Devanagari or Telugu the marks are the vowels.
    .replace(/([A-Za-z])\p{M}+/gu, '$1')
    .replace(/[đĐ]/g, 'd')
    .normalize('NFC')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\p{M}]+/gu, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60)
    .replace(/-+$/, '');
  const safeId = String(id || '').replace(/[^a-zA-Z0-9_-]+/g, '');
  return `agora-profile-${slug || safeId || 'profile'}.json`;
}
