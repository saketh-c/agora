/**
 * Text in every script: search folding, graphemes for initials, words without spaces,
 * speaking pace per language, collation, and the comment builder's speaking-time estimate.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import '../src/i18n/index.js';
import { SPEECH_PACE, compareText, firstGrapheme, graphemes, hasHan, searchFold, speechPace, speechUnits, wordsOf } from '../src/text.js';
import { buildComment, estimateSpeakingSeconds, speakingRate } from '../src/civics.js';

test('search folding drops Latin accents and width but keeps the marks other scripts need', () => {
  assert.equal(searchFold('  Español  '), 'espanol');
  assert.equal(searchFold('Đà Nẵng'), 'da nang');
  assert.equal(searchFold('Ｐｌａｎｏ'), 'plano', 'full-width letters typed on a Chinese keyboard');
  // Devanagari and Telugu vowel signs are letters there: they must survive.
  assert.equal(searchFold('दिल्ली'), 'दिल्ली');
  assert.notEqual(searchFold('दिल्ली'), searchFold('दलल'));
  assert.equal(searchFold('తెలుగు'), 'తెలుగు');
  // ...except the Hindi nukta and moon-dot, written both ways.
  assert.equal(searchFold('ज़रूरी'), searchFold('जरूरी'));
  assert.equal(searchFold('हाँ'), searchFold('हां'));
  // Arabic: alef and hamza forms, optional vowel marks, tatweel and alef maqsura are unified.
  assert.equal(searchFold('أحمد'), searchFold('احمد'));
  assert.equal(searchFold('إبراهيم'), searchFold('ابراهيم'));
  assert.equal(searchFold('آمنة'), searchFold('امنة'));
  assert.equal(searchFold('مُحَمَّد'), searchFold('محمد'));
  assert.equal(searchFold('م\u0640\u0640\u0640درسة'), searchFold('مدرسة'));
  assert.equal(searchFold('مستشفى'), searchFold('مستشفي'));
  assert.equal(searchFold('学校'), '学校');
});

test('graphemes keep conjuncts, accents and emoji whole, so an initial is one character', () => {
  assert.equal(firstGrapheme('Ana'), 'A');
  assert.equal(firstGrapheme('राहुल'), 'रा');
  assert.equal(firstGrapheme('शर्मा'), 'श');
  assert.equal(firstGrapheme('శ్రీనివాస్'), 'శ్రీ');
  assert.equal(firstGrapheme('李明'), '李');
  assert.equal(firstGrapheme('أحمد'), 'أ');
  assert.equal(firstGrapheme('Émile'.normalize('NFD')), 'É'.normalize('NFD'));
  assert.equal(firstGrapheme('👍🏽 team'), '👍🏽');
  assert.equal(firstGrapheme('   '), '');
  assert.deepEqual(graphemes('क्षत्रिय'), ['क्ष', 'त्रि', 'य']);
});

test('words are found without spaces in Chinese and with their marks elsewhere', () => {
  const zh = wordsOf('我们学校在Plano East，离车站很远。', 'zh');
  assert.ok(zh.includes('Plano') && zh.includes('East'), zh.join('|'));
  assert.ok(zh.join('').startsWith('我们学校'), 'every character is in some word');
  assert.deepEqual(wordsOf('नमस्ते, मेरा नाम अना है।', 'hi'), ['नमस्ते', 'मेरा', 'नाम', 'अना', 'है']);
  assert.deepEqual(wordsOf('మా పాఠశాల ప్లానోలో ఉంది.', 'te'), ['మా', 'పాఠశాల', 'ప్లానోలో', 'ఉంది']);
  assert.deepEqual(wordsOf('مساء الخير، اسمي أحمد.', 'ar'), ['مساء', 'الخير', 'اسمي', 'أحمد']);
  assert.equal(hasHan('Plano 学校'), true);
  assert.equal(hasHan('Plano'), false);
});

test('pace is counted per language: words, or characters in Chinese', () => {
  for (const code of ['en', 'es', 'vi', 'zh', 'hi', 'te', 'ar']) {
    const p = SPEECH_PACE[code];
    assert.ok(p, code);
    assert.ok(p.band[0] < p.estimate && p.estimate < p.band[1], `${code}: the estimate sits inside the band`);
    assert.ok(p.syllables >= 1 && p.longSentence >= 20, code);
  }
  assert.equal(speechPace('zh').unit, 'character');
  assert.equal(speechPace('ar').unit, 'word');
  assert.equal(speechUnits('我想请市议会延长公交车的运行时间。', 'zh'), 16, 'one unit per character');
  assert.equal(speechUnits('我们学校在Plano East', 'zh'), 7, 'five characters and two English words');
  assert.equal(speechUnits('नमस्ते, मेरा नाम अना है।', 'hi'), 5);
  assert.equal(speechUnits('Good evening, my name is Ana.', 'en'), 6);
});

test('the speaking-time estimate uses each language rate and unit', () => {
  const minuteOf = (code, unit) => Array.from({ length: speakingRate(code) }, () => unit).join(code === 'zh' ? '' : ' ');
  assert.equal(estimateSpeakingSeconds(minuteOf('en', 'word'), 'en'), 60);
  assert.equal(estimateSpeakingSeconds(minuteOf('zh', '字'), 'zh'), 60, '200 characters a minute');
  assert.equal(estimateSpeakingSeconds(minuteOf('te', 'పదం'), 'te'), 60);
  assert.equal(estimateSpeakingSeconds(minuteOf('ar', 'كلمة'), 'ar'), 60);
  assert.equal(speakingRate('en'), 130, 'English keeps its 130 words a minute');
  // Chinese text has no spaces, so counting spaces would have called it one word.
  assert.ok(estimateSpeakingSeconds('我想请市议会延长公交车的运行时间，因为很多学生放学后要坐公交车回家。', 'zh') > 5);
});

test('a comment draft carries no bidi isolates, even in Arabic', () => {
  const draft = buildComment({ name: 'Ana', cityName: 'Plano', topicId: 'housing', position: 'support', locale: 'ar' });
  assert.doesNotMatch(draft, /[\u2066-\u2069]/);
  assert.match(draft, /Ana/);
});

test('sorting follows each language collation', () => {
  const names = ['Plano', 'allen', 'Éclair', 'Dallas', 'arlington'];
  assert.deepEqual([...names].sort((a, b) => compareText(a, b, 'en')), ['allen', 'arlington', 'Dallas', 'Éclair', 'Plano']);
  assert.deepEqual(['ب', 'أ', 'ت'].sort((a, b) => compareText(a, b, 'ar')), ['أ', 'ب', 'ت']);
  assert.deepEqual(['ग', 'क', 'ख'].sort((a, b) => compareText(a, b, 'hi')), ['क', 'ख', 'ग']);
  assert.ok(compareText('item 2', 'item 10', 'zh') < 0, 'numbers sort as numbers');
});
