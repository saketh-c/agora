/**
 * Translation memory for city data. A locale file maps exact English strings to their
 * translation. Only the fields listed here are ever localized (addresses, URLs, names of
 * people, and proper names of programs stay in English), and a string is only replaced
 * when the English source still matches, so a data update never shows a stale translation.
 */

/** Dotted paths to plain string fields on a city record. */
export const CITY_TEXT_FIELDS = Object.freeze([
  'notes',
  'council.structure',
  'council.termNote',
  'publicComment.summary',
  'publicComment.howToRegister',
  'publicComment.deadline',
  'publicComment.writtenCommentMethod',
  'publicComment.notes',
]);

/** Array fields and the string fields inside each element that get localized. */
export const CITY_ARRAY_FIELDS = Object.freeze({
  meetings: ['label', 'notes'],
  scheduleExceptions: ['note', 'label'],
  youthPrograms: ['description', 'ages', 'applyWindow'],
  agendaItems: ['title', 'summary'],
});

/**
 * Translated fields whose English original stays next to the translation as `<field>Source`
 * (for example `scheduleExceptions[i].noteSource`). The schedule engine reads meaning from
 * them: it parses exception notes and builds meeting ids and agenda matches from labels, so a
 * localized city expands to exactly the same meetings, times and ids as the English one.
 * Agenda titles keep theirs so an item can be looked up in the English data.
 */
export const CITY_SOURCE_FIELDS = Object.freeze({
  meetings: ['label'],
  scheduleExceptions: ['note', 'label'],
  agendaItems: ['title'],
});

function getPath(obj, path) {
  return path.split('.').reduce((o, k) => (o == null ? undefined : o[k]), obj);
}

function setPath(obj, path, value) {
  const parts = path.split('.');
  let node = obj;
  for (const part of parts.slice(0, -1)) {
    if (node[part] == null || typeof node[part] !== 'object') return;
    node[part] = { ...node[part] };
    node = node[part];
  }
  node[parts[parts.length - 1]] = value;
}

/** Every English string in a city record that a translator should see. */
export function collectCityStrings(city, into = new Set()) {
  for (const path of CITY_TEXT_FIELDS) {
    const v = getPath(city, path);
    if (typeof v === 'string' && v.trim()) into.add(v);
  }
  for (const [arrayKey, fields] of Object.entries(CITY_ARRAY_FIELDS)) {
    for (const item of city[arrayKey] || []) {
      for (const f of fields) if (typeof item[f] === 'string' && item[f].trim()) into.add(item[f]);
    }
  }
  return into;
}

/**
 * Apply a translation memory ({ english: translated }) to one city. Returns a new object.
 * Fields listed in CITY_SOURCE_FIELDS keep their English original as `<field>Source` whenever
 * they are replaced.
 */
export function localizeCity(city, strings) {
  if (!strings || !city) return city;
  const out = { ...city };
  for (const path of CITY_TEXT_FIELDS) {
    const v = getPath(out, path);
    if (typeof v === 'string' && strings[v]) setPath(out, path, strings[v]);
  }
  for (const [arrayKey, fields] of Object.entries(CITY_ARRAY_FIELDS)) {
    if (!Array.isArray(out[arrayKey])) continue;
    const keep = CITY_SOURCE_FIELDS[arrayKey] || [];
    out[arrayKey] = out[arrayKey].map((item) => {
      const copy = { ...item };
      for (const f of fields) {
        const v = copy[f];
        if (typeof v !== 'string' || !strings[v]) continue;
        if (keep.includes(f) && typeof copy[`${f}Source`] !== 'string') copy[`${f}Source`] = v;
        copy[f] = strings[v];
      }
      return copy;
    });
  }
  return out;
}

export function localizeCities(cities, strings) {
  if (!strings) return cities;
  return cities.map((c) => localizeCity(c, strings));
}

/** Coverage of a translation memory against a set of cities: how many strings are still English. */
export function translationCoverage(cities, strings) {
  const all = new Set();
  for (const c of cities) collectCityStrings(c, all);
  const missing = [...all].filter((s) => !strings || !strings[s]);
  return { total: all.size, translated: all.size - missing.length, missing };
}
