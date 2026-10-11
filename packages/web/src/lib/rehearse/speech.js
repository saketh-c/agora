/**
 * What was said: pace, fillers, repetition, and how much of the script actually made it
 * out loud. Pure functions, so they run in the Node test suite.
 */

// Words that are often a stall rather than content. "so" and "right" are left out because
// they carry meaning too often to flag. Some of these are also ordinary words ("like",
// "este", "bueno"); those only count in a context where they cannot carry meaning, see
// AMBIGUOUS below.
export const FILLERS = Object.freeze({
  en: ['um', 'umm', 'uh', 'uhh', 'er', 'erm', 'hmm', 'like', 'you know', 'i mean', 'sort of', 'kind of', 'basically', 'literally', 'actually', 'okay so'],
  es: ['este', 'esta', 'eh', 'em', 'o sea', 'pues', 'bueno', 'tipo', 'como que', 'digamos', 'nada'],
  vi: ['ừm', 'ờ', 'à', 'ừ', 'kiểu như', 'nói chung là', 'cái kiểu', 'thế thì'],
});

// Words per minute that read as steady in a council chamber. Vietnamese counts syllables,
// which is what its spaces separate, so its band sits higher.
export const PACE_TARGET = Object.freeze({ en: [120, 160], es: [125, 170], vi: [140, 190] });

const STOP = {
  en: new Set('a an the and or but of to in on at for with by from as is are was were be been being it its this that these those i you he she we they me him her us them my your our their his hers ours theirs so if then than too very just not no yes do does did have has had will would can could should may might about into over after before up down out off here there when where why how all any each more most some such only own same'.split(' ')),
  es: new Set('el la los las un una unos unas y o pero de del a al en con por para que se su sus es son era eran fue fueron ser estar está están yo tú él ella nosotros ustedes ellos ellas me te le nos les mi mis tu tus lo como más muy ya también sí no si esto eso ese esa este esta hay'.split(' ')),
  vi: new Set('và là của có được cho với để này đó các những một không tôi bạn chúng ta anh chị em họ thì mà ở về từ đến đã sẽ đang rất cũng nhưng vì nên như khi nào'.split(' ')),
};

export function tokenize(text) {
  return String(text || '')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}'’\s]/gu, ' ')
    .split(/\s+/)
    .filter(Boolean);
}

/** Words that carry the meaning of a phrase. Numbers always count ("route 41"). */
function contentWords(text, lang) {
  const stop = STOP[lang] || STOP.en;
  const min = lang === 'vi' ? 2 : 3;
  return tokenize(text).filter((w) => /\p{N}/u.test(w) || (w.length >= min && !stop.has(w)));
}

function splitSentences(text) {
  return String(text || '')
    .split(/(?<=[.!?])\s+|\n+/)
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

// ---------- Fillers that are also ordinary words ----------

/** The raw token ends with punctuation that sets it off: "Bueno," "este..." */
const SET_OFF = /[,;:…]$|\.\.\.$/;
const ENDS_SENTENCE = /[.!?]$/;

/**
 * True when the filler at raw[i .. i+len) stands on its own, set off by punctuation, which
 * is how a recognizer or a typed script marks a stall ("Bueno, ..."). Without that, "este
 * parque" or "es bueno para todos" is just a sentence.
 */
function standsAlone(raw, norm, i, len, lang) {
  const last = raw[i + len - 1];
  if (SET_OFF.test(last)) return true;
  const startsSentence = i === 0 || ENDS_SENTENCE.test(raw[i - 1]) || SET_OFF.test(raw[i - 1]);
  const endsSentence = i + len >= raw.length || ENDS_SENTENCE.test(last);
  const nextIsFiller = i + len < raw.length && (FILLERS[lang] || []).includes(norm[i + len]);
  return startsSentence && (endsSentence || nextIsFiller);
}

// "I would like", "we'd like", "they like", "feels like", "places like": a verb or a comparison.
const LIKE_NOT_AFTER = new Set("i you we they would i'd you'd we'd they'd i’d we’d also really don't didn't doesn't don’t didn’t doesn’t do does did look looks looked feel feels felt seem seems seemed sound sounds sounded something things places people students kids cities would've not nothing anything much more most".split(' '));
// "like to", "like this park", "like the library": wanting something, or an example.
const LIKE_NOT_BEFORE = new Set('to it this that these those them him her us me you a an the my our your their his its other everyone everybody how when what'.split(' '));
// "this kind of traffic", "what sort of plan": a real kind of something.
const KIND_NOT_AFTER = new Set('this that what the a any some every one these those which same other no each all different another'.split(' '));

const AMBIGUOUS = {
  en: {
    like: (raw, norm, i) => !LIKE_NOT_AFTER.has(norm[i - 1]) && (SET_OFF.test(raw[i]) || !LIKE_NOT_BEFORE.has(norm[i + 1])),
    'kind of': (raw, norm, i) => !KIND_NOT_AFTER.has(norm[i - 1]),
    'sort of': (raw, norm, i) => !KIND_NOT_AFTER.has(norm[i - 1]),
  },
  es: {
    este: (raw, norm, i) => standsAlone(raw, norm, i, 1, 'es'),
    esta: (raw, norm, i) => standsAlone(raw, norm, i, 1, 'es'),
    bueno: (raw, norm, i) => standsAlone(raw, norm, i, 1, 'es'),
    tipo: (raw, norm, i) => standsAlone(raw, norm, i, 1, 'es'),
    nada: (raw, norm, i) => standsAlone(raw, norm, i, 1, 'es'),
  },
  vi: {
    à: (raw, norm, i) => standsAlone(raw, norm, i, 1, 'vi'),
    ừ: (raw, norm, i) => standsAlone(raw, norm, i, 1, 'vi'),
  },
};

/**
 * Mark each token that is a filler, matching multi-word fillers first so "you know" is
 * one hit rather than a stray "know". Returns tokens with their original text.
 */
export function markFillers(text, lang = 'en') {
  const list = (FILLERS[lang] || FILLERS.en).map((f) => f.split(' '));
  const rules = AMBIGUOUS[lang] || AMBIGUOUS.en;
  const raw = String(text || '').split(/\s+/).filter(Boolean);
  const norm = raw.map((w) => tokenize(w)[0] || '');
  const out = [];
  for (let i = 0; i < raw.length; i += 1) {
    let hit = null;
    for (const f of list) {
      if (f.length > raw.length - i) continue;
      let ok = true;
      for (let k = 0; k < f.length; k += 1) if (norm[i + k] !== f[k]) { ok = false; break; }
      if (!ok) continue;
      const rule = rules[f.join(' ')];
      if (rule && !rule(raw, norm, i)) continue;
      if (!hit || f.length > hit.length) hit = f;
    }
    if (hit) {
      out.push({ text: raw.slice(i, i + hit.length).join(' '), filler: hit.join(' ') });
      i += hit.length - 1;
    } else {
      out.push({ text: raw[i], filler: null });
    }
  }
  return out;
}

// ---------- Did a phrase come out? ----------

/**
 * How much of a phrase was said in one place: the best share of its content words found
 * within a stretch of the transcript about as long as the phrase. Matching across the
 * whole transcript would count "the late bus" early on and "the route" much later as the
 * ask "keep the late bus on route 41", which nobody actually said.
 */
function phraseHit(phrase, tokens, lang) {
  const words = [...new Set(contentWords(phrase, lang))];
  if (!words.length || !tokens.length) return 0;
  const span = Math.max(8, Math.ceil(tokenize(phrase).length * 1.6));
  const wanted = new Set(words);
  let best = 0;
  for (let i = 0; i < tokens.length; i += 1) {
    if (!wanted.has(tokens[i])) continue;
    const seen = new Set();
    for (let k = i; k < Math.min(tokens.length, i + span); k += 1) if (wanted.has(tokens[k])) seen.add(tokens[k]);
    best = Math.max(best, seen.size / words.length);
    if (best === 1) break;
  }
  return best;
}

/** A name lands when any part of it was said, however short ("Al", "Vu", "Anh"). */
function nameHit(name, spoken) {
  return tokenize(name).some((w) => spoken.has(w));
}

const ELEMENT_BAR = { name: 1, school: 0.5, itemTitle: 0.5, ask: 0.6 };

/**
 * Compare the transcript against the script and against the fields the comment builder
 * asked for. Recognition drops and swaps words, so a sentence counts as spoken when half
 * its content words turned up together, not when it matched exactly.
 */
export function analyzeTranscript(transcript, { lang = 'en', durationSec = 0, script = '', fields = {} } = {}) {
  const tokens = tokenize(transcript);
  const words = tokens.length;
  const minutes = durationSec > 0 ? durationSec / 60 : 0;
  const wpm = minutes > 0 ? Math.round(words / minutes) : 0;

  const marked = markFillers(transcript, lang);
  const fillerCounts = new Map();
  for (const m of marked) if (m.filler) fillerCounts.set(m.filler, (fillerCounts.get(m.filler) || 0) + 1);
  const fillers = [...fillerCounts.entries()].map(([word, count]) => ({ word, count })).sort((a, b) => b.count - a.count);
  const fillerTotal = fillers.reduce((n, f) => n + f.count, 0);
  const fillerRate = words ? Math.round((fillerTotal / words) * 1000) / 10 : 0;

  const counts = new Map();
  for (const w of contentWords(transcript, lang)) counts.set(w, (counts.get(w) || 0) + 1);
  const repeats = [...counts.entries()]
    .filter(([, c]) => c >= 4)
    .map(([word, count]) => ({ word, count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 5);

  const sentences = splitSentences(transcript);
  const longSentences = sentences.filter((s) => tokenize(s).length > 30).length;

  const spoken = new Set(tokens);
  let scriptResult = null;
  if (script && script.trim()) {
    const lines = splitSentences(script);
    const said = lines.map((line) => phraseHit(line, tokens, lang) >= 0.5);
    const spokenCount = said.filter(Boolean).length;
    scriptResult = {
      sentences: lines.length,
      spokenCount,
      skippedCount: lines.length - spokenCount,
      coverage: lines.length ? spokenCount / lines.length : 0,
      // A preview for the report; counts always use skippedCount.
      skipped: lines.filter((_, i) => !said[i]).slice(0, 6),
    };
  }

  const elements = {};
  for (const [key, value] of Object.entries(fields || {})) {
    if (!(key in ELEMENT_BAR) || !value || !String(value).trim()) continue;
    elements[key] = key === 'name' ? nameHit(String(value), spoken) : phraseHit(String(value), tokens, lang) >= ELEMENT_BAR[key];
  }

  return { words, wpm, fillers, fillerTotal, fillerRate, repeats, longSentences, script: scriptResult, elements, marked };
}

/**
 * Pace over time from a timeline of cumulative word counts, bucketed so a rushed opening
 * and a slow finish show up as a shape rather than one average.
 */
export function paceSeries(timeline, durationSec, bucketSec = 15) {
  if (!durationSec || !timeline || !timeline.length) return [];
  const out = [];
  const at = (t) => {
    let words = 0;
    for (const p of timeline) if (p.t <= t) words = p.words;
    return words;
  };
  for (let start = 0; start < durationSec; start += bucketSec) {
    const end = Math.min(durationSec, start + bucketSec);
    const span = end - start;
    if (span < 3) break;
    const n = at(end) - at(start);
    out.push({ t: start + span / 2, v: Math.round((n / span) * 60) });
  }
  return out;
}
