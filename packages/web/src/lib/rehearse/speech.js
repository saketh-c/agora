/**
 * What was said: pace, fillers, repetition, and how much of the script actually made it
 * out loud. Pure functions, so they run in the Node test suite.
 *
 * Every language is measured in its own units (core's SPEECH_PACE): words, except Chinese,
 * which has no spaces between words and is paced in characters per minute (each character is
 * a syllable). Words are found with Intl.Segmenter where the runtime has it; Devanagari,
 * Telugu and Arabic words keep their vowel signs and marks, and Arabic spellings are unified
 * (alef forms, optional vowel marks) so a transcript matches its script.
 */
import { SPEECH_PACE, searchFold, wordsOf } from '@agora/core';

// Words that are often a stall rather than content. "so" and "right" are left out because
// they carry meaning too often to flag. Some of these are also ordinary words ("like",
// "este", "bueno", "那个", "मतलब", "అంటే", "طيب"); those only count in a context where they
// cannot carry meaning, see AMBIGUOUS below. A filler of several words lists them with spaces
// (for Chinese, the pieces Intl.Segmenter cuts it into).
export const FILLERS = Object.freeze({
  en: ['um', 'umm', 'uh', 'uhh', 'er', 'erm', 'hmm', 'like', 'you know', 'i mean', 'sort of', 'kind of', 'basically', 'literally', 'actually', 'okay so'],
  es: ['este', 'esta', 'eh', 'em', 'o sea', 'pues', 'bueno', 'tipo', 'como que', 'digamos', 'nada'],
  vi: ['ừm', 'ờ', 'à', 'ừ', 'kiểu như', 'nói chung là', 'cái kiểu', 'thế thì'],
  // Hesitation sounds, and the discourse fillers Mandarin speakers lean on (那个, 这个, 就是, 然后).
  zh: ['嗯', '呃', '额', '啊', '唔', '那个', '这个', '就是', '就是说', '然后', '怎么 说 呢', '对 吧'],
  // Hesitation sounds, and मतलब ("I mean"), यानी ("that is"), है ना ("isn't it").
  hi: ['अं', 'उम', 'उम्म', 'हम्म', 'अह', 'मतलब', 'यानी', 'है ना', 'क्या कहते हैं'],
  // Hesitation sounds, and అంటే ("that is"), ఏంటంటే ("what it is"), మరి ("so").
  te: ['ఉమ్', 'హ్మ్', 'అమ్మ్', 'అంటే', 'ఏంటంటే', 'మరి', 'కదా'],
  // يعني ("I mean"), the classic Arabic filler, hesitation sounds, and طيب ("okay").
  ar: ['يعني', 'ممم', 'امم', 'اممم', 'اه', 'هاه', 'طيب', 'ايه'],
});

/**
 * Units a minute that read as steady in a council chamber (words; characters for Chinese).
 * Vietnamese counts syllables, which is what its spaces separate, so its band sits higher.
 * The table and its sources live in core (SPEECH_PACE), next to the speaking-time estimate.
 */
export const PACE_TARGET = Object.freeze(Object.fromEntries(Object.entries(SPEECH_PACE).map(([lang, p]) => [lang, p.band])));

/** The unit pace is counted in: 'word', or 'character' (Chinese). */
export function paceUnit(lang) {
  return (SPEECH_PACE[lang] || SPEECH_PACE.en).unit;
}

const words = (s) => new Set(s.split(' '));

const STOP = {
  en: words('a an the and or but of to in on at for with by from as is are was were be been being it its this that these those i you he she we they me him her us them my your our their his hers ours theirs so if then than too very just not no yes do does did have has had will would can could should may might about into over after before up down out off here there when where why how all any each more most some such only own same'),
  es: words('el la los las un una unos unas y o pero de del a al en con por para que se su sus es son era eran fue fueron ser estar está están yo tú él ella nosotros ustedes ellos ellas me te le nos les mi mis tu tus lo como más muy ya también sí no si esto eso ese esa este esta hay'),
  vi: words('và là của có được cho với để này đó các những một không tôi bạn chúng ta anh chị em họ thì mà ở về từ đến đã sẽ đang rất cũng nhưng vì nên như khi nào'),
  // Chinese is matched character by character, so these are function characters.
  zh: words('的 了 是 在 我 你 他 她 它 们 这 那 和 与 也 都 就 要 会 有 不 没 很 对 吧 呢 吗 啊 一 个 为 被 把 给 让 到 从 向 以 及 等 而 但 并 或 还 又 才 只 所 着 过 地 得 说 嗯'),
  hi: words('का की के है हैं में को से और या पर भी तो यह वह ये वे मैं हम आप तुम एक था थी थे हो कि जो ने लिए साथ नहीं हाँ हां इस उस इन उन कर करने करना रहा रही रहे गया गई गए जा जाता जाती होता होती होते अपने अपना अपनी कुछ सब बहुत अब जब तब यहाँ वहाँ क्या क्यों कैसे मेरा मेरी मेरे हमारा हमारी हमारे'),
  te: words('ఈ ఆ ఒక మరియు లో కి కు ని నేను మేము మనం మీరు నువ్వు వారు వాళ్ళు అది ఇది అవి ఇవి కూడా అని ఉంది ఉన్న ఉన్నాయి చాలా కానీ లేదా గురించి కోసం తో నుండి వరకు ఏ ఎందుకు ఎలా ఏమి నా మా మీ'),
  ar: words('في من على الى عن ان هذا هذه ذلك تلك التي الذي الذين و او ثم لا ما لم لن هو هي هم نحن انا انت انتم كان كانت يكون قد مع كل بعض عند كما لكن بل حتى اذا هل قبل بعد اي غير بين لدى منذ ايضا جدا فقط'),
};

const LATIN = new Set(['en', 'es', 'vi']);
const HAN = /\p{Script=Han}/u;

/**
 * Lowercase word tokens of a text in a language, for counting and matching. English, Spanish
 * and Vietnamese split on spaces (apostrophes stay inside words: "we'd"). Chinese yields each
 * character as a token (its pace unit, and robust to how a recognizer groups words), plus
 * any Latin word or number whole. Hindi, Telugu and Arabic keep the marks that are their
 * vowels; Arabic spellings are unified so "أحمد" and "احمد" match.
 */
export function tokenize(text, lang = 'en') {
  const s = String(text || '');
  if (LATIN.has(lang) || !SPEECH_PACE[lang]) {
    return s
      .toLowerCase()
      .replace(/[^\p{L}\p{M}\p{N}'’\s]/gu, ' ')
      .split(/\s+/)
      .filter(Boolean);
  }
  const folded = searchFold(s);
  if (lang === 'zh') return folded.match(/\p{Script=Han}|(?:(?!\p{Script=Han})[\p{L}\p{M}\p{N}'’])+/gu) || [];
  return wordsOf(folded, lang).map((w) => w.toLowerCase());
}

/** Words that carry the meaning of a phrase. Numbers always count ("route 41"). */
function contentWords(text, lang) {
  const stop = STOP[lang] || STOP.en;
  const min = lang === 'zh' ? 1 : lang === 'en' || lang === 'es' ? 3 : 2;
  return tokenize(text, lang).filter((w) => /\p{N}/u.test(w) || ([...w].length >= min && !stop.has(w)));
}

/** Sentence ends: . ! ? in Latin text (followed by a space), and 。！？ ؟ । ॥ anywhere. */
function splitSentences(text) {
  return String(text || '')
    .split(/(?<=[.!?])\s+|(?<=[。！？؟।॥])\s*|\n+/)
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

// ---------- Fillers that are also ordinary words ----------

/** The raw token ends with punctuation that sets it off: "Bueno," "este..." "那个，" "يعني،" */
const SET_OFF = /[,;:…，、；：،؛]$|\.\.\.$/;
const ENDS_SENTENCE = /[.!?。！？؟।॥]$/;

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

/** Said twice in a row ("那个那个", "అంటే అంటే"): a stall, whatever the word means elsewhere. */
function repeated(norm, i, len) {
  if (len !== 1) return false;
  return norm[i + 1] === norm[i] || norm[i - 1] === norm[i];
}

const aloneOrRepeated = (lang) => (raw, norm, i) => standsAlone(raw, norm, i, 1, lang) || repeated(norm, i, 1);

// "I would like", "we'd like", "they like", "feels like", "places like": a verb or a comparison.
const LIKE_NOT_AFTER = new Set("i you we they would i'd you'd we'd they'd i’d we’d also really don't didn't doesn't don’t didn’t doesn’t do does did look looks looked feel feels felt seem seems seemed sound sounds sounded something things places people students kids cities would've not nothing anything much more most".split(' '));
// "like to", "like this park", "like the library": wanting something, or an example.
const LIKE_NOT_BEFORE = new Set('to it this that these those them him her us me you a an the my our your their his its other everyone everybody how when what'.split(' '));
// "this kind of traffic", "what sort of plan": a real kind of something.
const KIND_NOT_AFTER = new Set('this that what the a any some every one these those which same other no each all different another'.split(' '));
// "هذا يعني" ("this means"), "ماذا يعني" ("what does it mean"): يعني as a verb, not a filler.
const YANI_NOT_AFTER = new Set('هذا هذه ذلك وهذا وهذه ماذا ما مما مما وهو هو هي وهي'.split(' ').map((w) => searchFold(w)));

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
  // 那个 "that", 这个 "this", 就是 "is exactly", 然后 "then", 啊 (a sentence particle).
  zh: { 那个: aloneOrRepeated('zh'), 这个: aloneOrRepeated('zh'), 就是: aloneOrRepeated('zh'), 然后: aloneOrRepeated('zh'), 啊: aloneOrRepeated('zh') },
  hi: { मतलब: aloneOrRepeated('hi'), यानी: aloneOrRepeated('hi') },
  te: { అంటే: aloneOrRepeated('te'), మరి: aloneOrRepeated('te'), కదా: aloneOrRepeated('te') },
  ar: {
    يعني: (raw, norm, i) => !YANI_NOT_AFTER.has(norm[i - 1]),
    طيب: aloneOrRepeated('ar'),
  },
};

/**
 * The text as raw tokens (with the punctuation that follows them, so a filler set off by a
 * comma can be seen) and what separated each from the next. Words are separated by spaces,
 * except in Chinese, which Intl.Segmenter cuts into words (each Han character without it).
 */
function rawTokens(text, lang) {
  const s = String(text || '');
  if (lang !== 'zh' || !HAN.test(s)) {
    const raw = s.split(/\s+/).filter(Boolean);
    return raw.map((t, i) => ({ text: t, sep: i < raw.length - 1 ? ' ' : '' }));
  }
  const pieces = [];
  const seg = typeof Intl.Segmenter === 'function' ? new Intl.Segmenter('zh', { granularity: 'word' }) : null;
  const parts = seg ? [...seg.segment(s)].map((x) => ({ text: x.segment, word: x.isWordLike })) : (s.match(/\p{Script=Han}|(?:(?!\p{Script=Han})[\p{L}\p{M}\p{N}'’])+|\s+|[^\p{L}\p{M}\p{N}\s]+/gu) || []).map((x) => ({ text: x, word: /[\p{L}\p{N}]/u.test(x) }));
  for (const p of parts) {
    if (p.word) pieces.push({ text: p.text, sep: '' });
    else if (/^\s+$/.test(p.text)) {
      if (pieces.length) pieces[pieces.length - 1].sep += p.text;
    } else if (pieces.length) pieces[pieces.length - 1].text += p.text;
    else pieces.push({ text: p.text, sep: '' });
  }
  return pieces;
}

/** One raw token, normalized the way the filler lists are written. */
function normToken(raw, lang) {
  if (LATIN.has(lang) || !SPEECH_PACE[lang]) return tokenize(raw, lang)[0] || '';
  return searchFold(raw.replace(/[^\p{L}\p{M}\p{N}'’]/gu, ''));
}

/**
 * Mark each token that is a filler, matching multi-word fillers first so "you know" is
 * one hit rather than a stray "know". Returns tokens with their original text and the
 * separator that followed them (a space, or nothing between Chinese words).
 */
export function markFillers(text, lang = 'en') {
  const list = (FILLERS[lang] || FILLERS.en).map((f) => f.split(' ').map((w) => (LATIN.has(lang) ? w : searchFold(w))));
  const rules = AMBIGUOUS[lang] || AMBIGUOUS.en;
  const tokens = rawTokens(text, lang);
  const raw = tokens.map((tk) => tk.text);
  const norm = raw.map((w) => normToken(w, lang));
  const out = [];
  for (let i = 0; i < raw.length; i += 1) {
    let hit = null;
    for (const f of list) {
      if (f.length > raw.length - i) continue;
      let ok = true;
      for (let k = 0; k < f.length; k += 1) if (norm[i + k] !== f[k]) { ok = false; break; }
      if (!ok) continue;
      const rule = rules[f.join(' ')] || rules[(FILLERS[lang] || [])[list.indexOf(f)]];
      if (rule && !rule(raw, norm, i)) continue;
      if (!hit || f.length > hit.length) hit = f;
    }
    if (hit) {
      const span = tokens.slice(i, i + hit.length);
      out.push({ text: span.map((tk, k) => tk.text + (k < span.length - 1 ? tk.sep : '')).join(''), filler: hit.join(' '), sep: span[span.length - 1].sep });
      i += hit.length - 1;
    } else {
      out.push({ text: raw[i], filler: null, sep: tokens[i].sep });
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
  const content = [...new Set(contentWords(phrase, lang))];
  if (!content.length || !tokens.length) return 0;
  const span = Math.max(8, Math.ceil(tokenize(phrase, lang).length * 1.6));
  const wanted = new Set(content);
  let best = 0;
  for (let i = 0; i < tokens.length; i += 1) {
    if (!wanted.has(tokens[i])) continue;
    const seen = new Set();
    for (let k = i; k < Math.min(tokens.length, i + span); k += 1) if (wanted.has(tokens[k])) seen.add(tokens[k]);
    best = Math.max(best, seen.size / content.length);
    if (best === 1) break;
  }
  return best;
}

/**
 * A name lands when any part of it was said, however short ("Al", "Vu", "Anh"). A Chinese name
 * is two or three characters with no spaces around it, so two of them must be said together
 * ("李明", not 李 in one word and 明 in another).
 */
function nameHit(name, spoken, lang, tokens = []) {
  const parts = tokenize(name, lang);
  if (lang === 'zh' && parts.length > 1 && parts.every((p) => HAN.test(p))) {
    const said = tokens.join('');
    return parts.some((p, i) => i < parts.length - 1 && said.includes(p + parts[i + 1]));
  }
  return parts.some((w) => spoken.has(w));
}

const ELEMENT_BAR = { name: 1, school: 0.5, itemTitle: 0.5, ask: 0.6 };

/**
 * Compare the transcript against the script and against the fields the comment builder
 * asked for. Recognition drops and swaps words, so a sentence counts as spoken when half
 * its content words turned up together, not when it matched exactly. `words` and `wpm`
 * are in the language's pace unit (characters for Chinese).
 */
export function analyzeTranscript(transcript, { lang = 'en', durationSec = 0, script = '', fields = {} } = {}) {
  const tokens = tokenize(transcript, lang);
  const count = tokens.length;
  const minutes = durationSec > 0 ? durationSec / 60 : 0;
  const wpm = minutes > 0 ? Math.round(count / minutes) : 0;

  const marked = markFillers(transcript, lang);
  const fillerCounts = new Map();
  for (const m of marked) if (m.filler) fillerCounts.set(m.filler, (fillerCounts.get(m.filler) || 0) + 1);
  const fillers = [...fillerCounts.entries()].map(([word, n]) => ({ word: word.replace(/ /g, lang === 'zh' ? '' : ' '), count: n })).sort((a, b) => b.count - a.count);
  const fillerTotal = fillers.reduce((n, f) => n + f.count, 0);
  const fillerRate = count ? Math.round((fillerTotal / count) * 1000) / 10 : 0;

  const counts = new Map();
  // Repeated words: in Chinese, whole words (from the segmenter), since single characters repeat by nature.
  const repeatable = lang === 'zh' ? wordsOf(searchFold(transcript), 'zh').filter((w) => [...w].length >= 2 && !(STOP.zh.has(w))) : contentWords(transcript, lang);
  for (const w of repeatable) counts.set(w, (counts.get(w) || 0) + 1);
  const repeats = [...counts.entries()]
    .filter(([, c]) => c >= 4)
    .map(([word, c]) => ({ word, count: c }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 5);

  const sentences = splitSentences(transcript);
  const longAt = (SPEECH_PACE[lang] || SPEECH_PACE.en).longSentence;
  const longSentences = sentences.filter((s) => tokenize(s, lang).length > longAt).length;

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
    elements[key] = key === 'name' ? nameHit(String(value), spoken, lang, tokens) : phraseHit(String(value), tokens, lang) >= ELEMENT_BAR[key];
  }

  return { words: count, wpm, unit: paceUnit(lang), fillers, fillerTotal, fillerRate, repeats, longSentences, longSentenceAt: longAt, script: scriptResult, elements, marked };
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

/** Live count of a recognizer's text in the language's pace unit (words, or Chinese characters). */
export function countUnits(text, lang = 'en') {
  return tokenize(text, lang).length;
}
