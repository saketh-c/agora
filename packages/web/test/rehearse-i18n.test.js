/**
 * Practice in Chinese, Hindi, Telugu and Arabic: words without spaces, marks that are vowels,
 * fillers and stop words per language, pace in each language's unit, and the coaching text.
 */
import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { setLocale, speechLang } from '@agora/core';
import { analyzeTranscript, countUnits, markFillers, PACE_TARGET, paceUnit, tokenize } from '../src/lib/rehearse/speech.js';
import { SYLLABLES_PER_WORD } from '../src/lib/rehearse/audio.js';
import { buildFindings } from '../src/lib/rehearse/coach.js';
import { coachParams, localeTag, numberText, takeWhen } from '../src/lib/rehearse/format.js';
import { formatDate, formatTime } from '@agora/core';

afterEach(() => setLocale('en'));

const fillersIn = (text, lang) => markFillers(text, lang).filter((m) => m.filler).map((m) => m.filler);

test('every language has a pace band, a syllable rate and a recognizer tag', () => {
  for (const code of ['en', 'es', 'vi', 'zh', 'hi', 'te', 'ar']) {
    assert.equal(PACE_TARGET[code].length, 2, code);
    assert.ok(SYLLABLES_PER_WORD[code] >= 1, code);
  }
  assert.deepEqual(PACE_TARGET.en, [120, 160], 'English keeps its band');
  assert.equal(paceUnit('zh'), 'character');
  assert.equal(paceUnit('hi'), 'word');
  assert.deepEqual(['zh', 'hi', 'te', 'ar'].map(speechLang), ['zh-CN', 'hi-IN', 'te-IN', 'ar-SA']);
});

test('tokens: Chinese by character, Devanagari and Telugu with their vowel signs, Arabic unified', () => {
  assert.deepEqual(tokenize('我们学校在Plano', 'zh'), ['我', '们', '学', '校', '在', 'plano']);
  assert.deepEqual(tokenize('नमस्ते, मेरा नाम अना है।', 'hi'), ['नमस्ते', 'मेरा', 'नाम', 'अना', 'है']);
  assert.deepEqual(tokenize('నమస్కారం, నా పేరు శ్రీనివాస్.', 'te'), ['నమస్కారం', 'నా', 'పేరు', 'శ్రీనివాస్']);
  assert.deepEqual(tokenize('أنا أحمد', 'ar'), tokenize('انا احمد', 'ar'), 'hamza forms match');
  assert.deepEqual(tokenize("We'd like this park", 'en'), ["we'd", 'like', 'this', 'park'], 'English is unchanged');
  assert.equal(countUnits('我想请市议会延长公交车的运行时间', 'zh'), 16);
  assert.equal(countUnits('नमस्ते मेरा नाम अना है', 'hi'), 5);
});

test('fillers in each language, and ordinary words that only look like them', () => {
  assert.deepEqual(fillersIn('嗯，那个，我想说的是这个公园很重要。', 'zh'), ['嗯', '那个'], '"这个公园" is "this park"');
  assert.deepEqual(fillersIn('然后然后我们需要更多的公交车。', 'zh'), ['然后', '然后'], 'a word said twice in a row is a stall');
  assert.deepEqual(fillersIn('मतलब, मैं यह कहना चाहती हूँ। उम्म यह पार्क ज़रूरी है।', 'hi'), ['मतलब', 'उम्म']);
  assert.deepEqual(fillersIn('इसका मतलब है कि पार्क खुला रहे।', 'hi'), [], 'मतलब as "meaning"');
  assert.deepEqual(fillersIn('అంటే, నేను ప్లానోలో ఉంటాను. ఈ పార్కు అంటే నాకు ఇష్టం.', 'te'), ['అంటే']);
  assert.deepEqual(fillersIn('يعني أنا طالب في مدرسة. هذا يعني أن الحديقة مهمة. اممم شكرا', 'ar'), ['يعني', 'اممم'], '"هذا يعني" is "this means"');
  // Chinese tokens keep their own spacing: nothing is inserted between words.
  assert.equal(markFillers('嗯，我们学校', 'zh').map((m) => m.text + m.sep).join(''), '嗯，我们学校');
});

test('Chinese pace is in characters a minute; coverage and names work without spaces', () => {
  const r = analyzeTranscript('嗯，我叫李明，我是普莱诺高中的学生。我请求市议会延长公交车的运行时间。', {
    lang: 'zh',
    durationSec: 10,
    script: '大家好，我叫李明。我请求市议会延长公交车的运行时间。谢谢。',
    fields: { name: '李明', ask: '延长公交车的运行时间' },
  });
  assert.equal(r.unit, 'character');
  assert.equal(r.words, 31);
  assert.equal(r.wpm, 186);
  assert.equal(r.fillerTotal, 1);
  assert.equal(r.script.sentences, 3);
  assert.deepEqual(r.script.skipped, ['谢谢。']);
  assert.deepEqual(r.elements, { name: true, ask: true });
  // A name is two characters together, not each character anywhere.
  const apart = analyzeTranscript('李老师说明天开会', { lang: 'zh', durationSec: 5, script: 'x', fields: { name: '李明' } });
  assert.equal(apart.elements.name, false);
});

test('Hindi, Telugu and Arabic transcripts match their scripts', () => {
  const hi = analyzeTranscript('नमस्ते मेरा नाम अना है मैं परिषद से पार्क खुला रखने का अनुरोध करती हूँ', {
    lang: 'hi',
    durationSec: 10,
    script: 'नमस्ते, मेरा नाम अना है। मैं परिषद से पार्क खुला रखने का अनुरोध करती हूँ। धन्यवाद।',
    fields: { name: 'अना' },
  });
  assert.equal(hi.script.sentences, 3, 'the danda ends a sentence');
  assert.equal(hi.script.spokenCount, 2);
  assert.equal(hi.elements.name, true);
  const te = analyzeTranscript('నమస్కారం నా పేరు శ్రీనివాస్ పార్కు తెరిచి ఉంచాలని కోరుతున్నాను', { lang: 'te', durationSec: 6, script: 'నమస్కారం, నా పేరు శ్రీనివాస్. పార్కు తెరిచి ఉంచాలని కోరుతున్నాను.', fields: { name: 'శ్రీనివాస్' } });
  assert.equal(te.script.spokenCount, 2);
  assert.equal(te.elements.name, true);
  const ar = analyzeTranscript('مساء الخير اسمي احمد اطلب من المجلس ابقاء الحديقة مفتوحة', { lang: 'ar', durationSec: 10, script: 'مساء الخير، اسمي أحمد. أطلب من المجلس إبقاء الحديقة مفتوحة. شكرا لكم.', fields: { name: 'أحمد' } });
  assert.equal(ar.script.sentences, 3);
  assert.equal(ar.script.spokenCount, 2);
  assert.equal(ar.elements.name, true, 'احمد said, أحمد written');
});

test('long sentences and pace are judged against each language', () => {
  const longZh = `${'我们'.repeat(30)}。${'公园'.repeat(30)}。`;
  assert.equal(analyzeTranscript(longZh, { lang: 'zh', durationSec: 30 }).longSentences, 2, '60 characters is long in Chinese');
  const sixty = Array.from({ length: 60 }, () => '字').join('');
  assert.equal(analyzeTranscript(sixty.slice(0, 40), { lang: 'zh', durationSec: 30 }).longSentences, 0);
  // 200 characters a minute is steady Chinese; it would be fast English.
  const envelope = { speakingSec: 60, firstSpeechSec: 0, lastSpeechSec: 60, pauses: [], longPauses: 0, loudness: { mean: 0.1, cv: 0.1, trailOff: 0 }, phrases: 10 };
  const coach = buildFindings({ speech: null, envelope, pitch: null, body: null, seconds: 60, limitSec: 180, wpm: 200, lang: 'zh' });
  assert.ok(coach.strengths.some((s) => s.id === 'pace_good'), 'steady in Chinese');
  const fast = buildFindings({ speech: null, envelope, pitch: null, body: null, seconds: 60, limitSec: 180, wpm: 200, lang: 'en' });
  assert.ok(fast.findings.some((f) => f.id === 'pace_fast'));
  const te = buildFindings({ speech: null, envelope, pitch: null, body: null, seconds: 60, limitSec: 180, wpm: 90, lang: 'te' });
  assert.ok(te.strengths.some((s) => s.id === 'pace_good'), '90 words a minute is steady Telugu');
});

test('coaching numbers and quoted words follow the language', () => {
  assert.equal(localeTag('ar'), 'ar-u-ca-gregory-nu-latn');
  assert.equal(localeTag('xx'), 'en-US');
  assert.equal(numberText(1.5, 'ar'), '1.5', 'Latin digits in Arabic');
  assert.equal(coachParams({ list: ['um', 'like'] }, 'en').list, '"um", "like"', 'English is unchanged');
  assert.equal(coachParams({ list: ['嗯', '那个'] }, 'zh').list, '“嗯”和“那个”', 'Chinese joins with its own "and" and its own quotes');
});

test('when a take happened, in Central time and each language', () => {
  // 22:06 UTC on Oct 10 is 5:06 PM in Dallas.
  for (const code of ['zh', 'hi', 'te', 'ar']) {
    const when = takeWhen('2026-10-10T22:06:00Z', code);
    assert.equal(when.date, formatDate('2026-10-10', { locale: code }), code);
    assert.equal(when.time, formatTime('17:06', code), code);
  }
  assert.equal(takeWhen('2026-10-10T22:06:00Z', 'zh').time, '17:06');
  assert.deepEqual(takeWhen('not a date', 'ar'), { date: '', time: '' });
});
