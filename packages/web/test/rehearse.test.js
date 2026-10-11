import { test } from 'node:test';
import assert from 'node:assert/strict';
import { analyzeTranscript, markFillers, paceSeries, tokenize } from '../src/lib/rehearse/speech.js';
import { summarizeEnvelope, pitchStats, estimateSyllables, detectPitch, loudnessSeries, paceEstimateSeries, speechMask, onGrid, LONG_PAUSE_SEC } from '../src/lib/rehearse/audio.js';
import { headPoseFromLandmarks, isEyeContact, summarizeBody } from '../src/lib/rehearse/vision.js';
import { buildFindings, timedSeconds, MAX_FINDINGS } from '../src/lib/rehearse/coach.js';
import { clock, coachParams, takeWhen, numberText, secondsPhrase } from '../src/lib/rehearse/format.js';
import { setLocale } from '@agora/core';

test('fillers are counted, including two word ones, without double counting', () => {
  const marked = markFillers('So um I think, you know, the park is like closed um early.', 'en');
  const hits = marked.filter((m) => m.filler).map((m) => m.filler);
  assert.deepEqual(hits, ['um', 'you know', 'like', 'um']);
  const es = markFillers('Este, o sea, pues el parque cierra temprano.', 'es');
  assert.deepEqual(es.filter((m) => m.filler).map((m) => m.filler), ['este', 'o sea', 'pues']);
});

test('pace, script coverage, and whether the key elements landed', () => {
  const script = 'Good evening, my name is Ana Reyes and I am a student at Garland High School. I am here about the sidewalk on Park Boulevard. I am asking you to fund the sidewalk gap in this budget. Thank you for listening.';
  const said = 'good evening my name is ana reyes student at garland high school um the sidewalk on park boulevard is dangerous i am asking you to fund the sidewalk gap in this budget';
  const r = analyzeTranscript(said, { lang: 'en', durationSec: 15, script, fields: { name: 'Ana Reyes', school: 'Garland High School', itemTitle: 'Sidewalk on Park Boulevard', ask: 'fund the sidewalk gap in this budget' } });
  assert.equal(r.words, tokenize(said).length);
  assert.equal(r.wpm, Math.round((r.words / 15) * 60));
  assert.equal(r.script.sentences, 4);
  assert.equal(r.script.spokenCount, 3, 'the thank-you line was skipped');
  assert.deepEqual(r.script.skipped, ['Thank you for listening.']);
  assert.deepEqual(r.elements, { name: true, school: true, itemTitle: true, ask: true });
  assert.equal(r.fillerTotal, 1);
});

test('pace over time comes from the cumulative word timeline', () => {
  const series = paceSeries([{ t: 0, words: 0 }, { t: 15, words: 40 }, { t: 30, words: 60 }], 30, 15);
  assert.deepEqual(series.map((p) => p.v), [160, 80]);
});

test('pauses only count between the first and last speech, and trailing off is detected', () => {
  const dt = 0.05;
  const frames = [];
  const push = (sec, rms) => { for (let i = 0; i < sec / dt; i += 1) frames.push({ t: frames.length * dt, rms, pitchHz: 0 }); };
  push(1, 0.001); // silence before speaking: not a pause
  push(2, 0.2); // phrase
  push(1.0, 0.001); // a real pause, 1.0 s
  push(1.5, 0.2); // phrase that trails off:
  push(0.5, 0.02); // ... quiet tail
  push(2.0, 0.001); // long pause, 2.0 s
  push(2, 0.2);
  push(1, 0.001); // silence after: not a pause
  const e = summarizeEnvelope(frames, dt);
  assert.equal(e.pauses.length, 2);
  assert.equal(e.longPauses, 1);
  assert.ok(e.speakingSec > 5 && e.speakingSec < 7, `speaking ${e.speakingSec}`);
  assert.ok(e.loudness.trailOff > 0, 'one phrase trailed off');
});

test('pitch variety separates a monotone from a lively delivery, and detectPitch finds a tone', () => {
  const flat = Array.from({ length: 100 }, () => ({ rms: 0.2, pitchHz: 120 }));
  const lively = Array.from({ length: 100 }, (_, i) => ({ rms: 0.2, pitchHz: 110 + 40 * Math.sin(i / 6) }));
  assert.equal(pitchStats(flat).monotone, true);
  assert.equal(pitchStats(lively).monotone, false);
  const rate = 16000;
  const buf = new Float32Array(1024);
  for (let i = 0; i < buf.length; i += 1) buf[i] = Math.sin((2 * Math.PI * 200 * i) / rate);
  const hz = detectPitch(buf, rate);
  assert.ok(Math.abs(hz - 200) < 6, `detected ${hz}`);
});

test('syllable estimate and loudness series behave on a pulsed signal', () => {
  const dt = 0.05;
  const frames = [];
  for (let i = 0; i < 200; i += 1) frames.push({ t: i * dt, rms: i % 4 === 0 ? 0.3 : 0.05, pitchHz: 0 });
  const syl = estimateSyllables(frames, dt);
  assert.ok(syl >= 40 && syl <= 50, `syllables ${syl}`);
  const series = loudnessSeries(frames, dt, 5);
  assert.equal(series.length, 2);
  assert.equal(Math.max(...series.map((p) => p.v)), 100);
});

test('head pose from landmarks: centered face is eye contact, nose dropped is looking down', () => {
  const lm = [];
  lm[1] = { x: 0.5, y: 0.55 };
  lm[10] = { x: 0.5, y: 0.2 };
  lm[152] = { x: 0.5, y: 0.8 };
  lm[234] = { x: 0.3, y: 0.5 };
  lm[454] = { x: 0.7, y: 0.5 };
  lm[33] = { x: 0.4, y: 0.4 };
  lm[263] = { x: 0.6, y: 0.4 };
  const centered = headPoseFromLandmarks(lm.map((p) => ({ ...p })));
  assert.ok(Math.abs(centered.yaw) < 1 && Math.abs(centered.pitch) < 3, JSON.stringify(centered));
  assert.equal(isEyeContact(centered), true);
  const withNose = (nose) => lm.map((p, i) => (i === 1 ? nose : p));
  assert.ok(Math.abs(headPoseFromLandmarks(withNose({ x: 0.64, y: 0.55 })).yaw) > 18);
  const down = withNose({ x: 0.5, y: 0.7 });
  assert.ok(headPoseFromLandmarks(down).pitch < -14);
  assert.equal(isEyeContact(headPoseFromLandmarks(down)), false);
});

test('body summary: shares, sway, hands, and the per second timeline', () => {
  const samples = [];
  for (let i = 0; i < 100; i += 1) {
    const t = i / 10;
    samples.push({ t, faceFound: true, yaw: i < 60 ? 0 : 30, pitch: 0, poseFound: true, shoulderMidX: 0.5 + (i % 2 ? 0.05 : -0.05), handsVisible: i < 50, handNearFace: i < 30, wristMove: 0.01 });
  }
  const b = summarizeBody(samples, { fps: 10, durationSec: 10 });
  assert.equal(b.faceShare, 1);
  assert.equal(Math.round(b.eyeContactShare * 100), 60);
  assert.ok(b.swayStd > 0.035, `sway ${b.swayStd}`);
  assert.equal(b.handsVisibleShare, 0.5);
  assert.equal(b.handsNearFaceShare, 0.3);
  assert.equal(b.timeline.length, 10);
  assert.deepEqual(b.timeline.slice(0, 6), [true, true, true, true, true, true]);
  assert.deepEqual(b.timeline.slice(6), [false, false, false, false]);
});


/** Frames of {t, rms} at dt: each segment is [seconds, rms]. */
function framesOf(segments, dt = 0.05) {
  const frames = [];
  for (const [sec, rms] of segments) for (let i = 0; i < Math.round(sec / dt); i += 1) frames.push({ t: frames.length * dt, rms, pitchHz: 0 });
  return frames;
}

const SPOKEN = { speakingSec: 120, firstSpeechSec: 0.5, lastSpeechSec: 150, phrases: 8, longPauses: 1, pauses: [], loudness: { trailOff: 0.1, cv: 0.2 } };

test('coach ranks the worst problems first, keeps the top three, and names what went well', () => {
  const bad = buildFindings({
    speech: { words: 200, wpm: 190, fillerRate: 6, fillers: [{ word: 'um', count: 9 }, { word: 'like', count: 3 }], fillerTotal: 12, repeats: [], longSentences: 0, script: { coverage: 0.5, skipped: ['a', 'b'], skippedCount: 5 }, elements: { name: true, ask: false } },
    envelope: { ...SPOKEN, longPauses: 4, loudness: { trailOff: 0.5, cv: 0.2 } },
    pitch: { enough: true, monotone: true, stdSemitones: 0.8 },
    body: { frames: 300, faceShare: 0.9, eyeContactShare: 0.2, lookingDownShare: 0.5, poseShare: 0.9, swayStd: 0.01, handsNearFaceShare: 0.3, handsVisibleShare: 0.8, gestureActivity: 0.05, headMovement: 10 },
    seconds: 230, limitSec: 180, wpm: 190, lang: 'en', hasScript: true,
  });
  const ids = bad.findings.map((f) => f.id);
  assert.equal(bad.heard, true);
  assert.equal(ids.length, MAX_FINDINGS, 'capped at three');
  assert.equal(MAX_FINDINGS, 3);
  assert.equal(ids[0], 'over_time', 'running long is the one rule the chamber enforces');
  assert.deepEqual(bad.findings[0].params, { over: 50 });
  assert.ok(bad.findings.every((f, i, a) => i === 0 || a[i - 1].severity >= f.severity), 'sorted by severity');

  const good = buildFindings({
    speech: { words: 300, wpm: 140, fillerRate: 1, fillers: [{ word: 'um', count: 3 }], fillerTotal: 3, repeats: [], longSentences: 0, script: { coverage: 0.9, skipped: [], skippedCount: 0 }, elements: { name: true, itemTitle: true, ask: true } },
    envelope: SPOKEN,
    pitch: { enough: true, monotone: false, stdSemitones: 3.2 },
    body: { frames: 300, faceShare: 0.95, eyeContactShare: 0.8, lookingDownShare: 0.1, poseShare: 0.9, swayStd: 0.01, handsNearFaceShare: 0.05, handsVisibleShare: 0.7, gestureActivity: 0.1, headMovement: 6 },
    seconds: 150, limitSec: 180, wpm: 140, lang: 'en', hasScript: true,
  });
  assert.equal(good.findings.length, 0);
  const s = good.strengths.map((x) => x.id);
  for (const id of ['on_time', 'pace_good', 'few_fillers', 'script_covered', 'eye_contact_good', 'elements_landed']) assert.ok(s.includes(id), `missing strength ${id} in ${s.join(',')}`);
  assert.deepEqual(good.strengths.find((x) => x.id === 'on_time').params, { left: 30 });
  assert.deepEqual(good.strengths.find((x) => x.id === 'elements_landed').params.landed, ['name', 'itemTitle', 'ask']);
});

test('a silent take is not graded: one "we barely heard you" and no praise', () => {
  const silence = framesOf([[120, 0.004]]);
  const envelope = summarizeEnvelope(silence, 0.05);
  assert.equal(envelope.speakingSec, 0);
  const r = buildFindings({ speech: null, envelope, pitch: pitchStats(silence), body: null, seconds: 120, limitSec: 180, wpm: 0, lang: 'en' });
  assert.equal(r.heard, false);
  assert.deepEqual(r.findings.map((f) => f.id), ['not_heard']);
  assert.deepEqual(r.strengths, []);
  assert.deepEqual(loudnessSeries(silence, 0.05, 5), [], 'room noise is not scaled up to a healthy-looking line');
});

test('a very short take gets "too short" instead of pace praise', () => {
  const r = buildFindings({ speech: null, envelope: { ...SPOKEN, speakingSec: 5 }, pitch: null, body: null, seconds: 8, limitSec: 180, wpm: 60, lang: 'en' });
  assert.deepEqual(r.findings.map((f) => f.id), ['too_short']);
  assert.deepEqual(r.findings[0].params, { used: 8 });
  assert.equal(r.strengths.length, 0);
});

test('pace is praised only inside the band; slow is flagged at any length past the minimum', () => {
  const at = (wpm) => buildFindings({ speech: null, envelope: SPOKEN, pitch: null, body: null, seconds: 60, limitSec: 180, wpm, lang: 'en' });
  assert.ok(at(60).findings.some((f) => f.id === 'pace_slow'));
  assert.ok(!at(60).strengths.some((x) => x.id === 'pace_good'));
  assert.ok(at(140).strengths.some((x) => x.id === 'pace_good'));
  assert.ok(at(200).findings.some((f) => f.id === 'pace_fast'));
  const est = (wpm) => buildFindings({ speech: null, envelope: SPOKEN, pitch: null, body: null, seconds: 60, limitSec: 180, wpm, wpmEstimated: true, lang: 'en' });
  assert.ok(!est(115).findings.some((f) => f.id.startsWith('pace')), 'an estimate just under the band is not called slow');
  assert.ok(!est(115).strengths.some((x) => x.id === 'pace_good'), 'nor praised as steady');
  assert.ok(est(100).findings.some((f) => f.id === 'pace_slow'));
});

test('time is whole seconds to the end of speech: reaching for Stop is not running over', () => {
  // Speech ends at 179.6 s; Stop is pressed at 181 s.
  assert.equal(timedSeconds(181, { lastSpeechSec: 179.6 }), 180);
  const r = buildFindings({ speech: null, envelope: SPOKEN, pitch: null, body: null, seconds: timedSeconds(181, { lastSpeechSec: 179.6 }), limitSec: 180, wpm: 140, lang: 'en' });
  assert.ok(!r.findings.some((f) => f.id === 'over_time'));
  assert.equal(timedSeconds(6.6, null), 7, 'one rounding rule everywhere');
  assert.equal(clock(7), '0:07');
  assert.equal(clock(185), '3:05');
});

test('long pauses quote the real threshold, and skipped lines are counted, not the preview', () => {
  const r = buildFindings({ speech: null, envelope: { ...SPOKEN, longPauses: 4 }, pitch: null, body: null, seconds: 120, limitSec: 180, wpm: 140, lang: 'en' });
  const lp = r.findings.find((f) => f.id === 'long_pauses');
  assert.deepEqual(lp.params, { n: 4, sec: LONG_PAUSE_SEC });
  assert.equal(LONG_PAUSE_SEC, 1.5);

  const script = Array.from({ length: 10 }, (_, i) => `Sentence number ${i + 1} talks about the library hours.`).join(' ');
  const a = analyzeTranscript('hello council', { lang: 'en', durationSec: 30, script });
  assert.equal(a.script.skippedCount, 10);
  assert.equal(a.script.skipped.length, 6, 'the preview stays short');
});

test('name, school, item and ask are only checked against the script they came with', () => {
  const speech = { words: 60, wpm: 140, fillerRate: 0, fillers: [], fillerTotal: 0, repeats: [], longSentences: 0, script: null, elements: { name: false, school: false } };
  const noScript = buildFindings({ speech, envelope: SPOKEN, pitch: null, body: null, seconds: 60, limitSec: 180, wpm: 140, lang: 'en', hasScript: false });
  assert.ok(!noScript.findings.some((f) => f.id === 'missing_elements'), 'no script, no leftover draft fields');
  assert.ok(!noScript.strengths.some((x) => x.id === 'elements_landed'));
  const withScript = buildFindings({ speech, envelope: SPOKEN, pitch: null, body: null, seconds: 60, limitSec: 180, wpm: 140, lang: 'en', hasScript: true });
  assert.deepEqual(withScript.findings.find((f) => f.id === 'missing_elements').params.missing, ['name', 'school']);
});

test('short names land; an ask only lands when it was said in one place', () => {
  const r = analyzeTranscript('hi I am al wu from plano east', { lang: 'en', durationSec: 10, script: 'x', fields: { name: 'Al Wu' } });
  assert.equal(r.elements.name, true);
  const vi = analyzeTranscript('xin chào tôi là anh học sinh trường plano', { lang: 'vi', durationSec: 10, script: 'x', fields: { name: 'Anh' } });
  assert.equal(vi.elements.name, true, 'a name in the stop list still counts');
  const scattered = 'the late bus is how i get home from practice every day. this is about the bus route change the city wants to make';
  const ask = analyzeTranscript(scattered, { lang: 'en', durationSec: 20, script: 'x', fields: { ask: 'Keep the late bus on route 41' } });
  assert.equal(ask.elements.ask, false, 'words from two different sentences are not the ask');
  const said = analyzeTranscript('so please keep the late bus on route 41 for students', { lang: 'en', durationSec: 20, script: 'x', fields: { ask: 'Keep the late bus on route 41' } });
  assert.equal(said.elements.ask, true);
});

test('ordinary words are not counted as fillers', () => {
  const hits = (text, lang) => markFillers(text, lang).filter((m) => m.filler).map((m) => m.filler);
  assert.deepEqual(hits('I would like to ask the council to fund the sidewalk. I would like you to vote yes.', 'en'), []);
  assert.deepEqual(hits("We'd like this park open. It feels like home.", 'en'), []);
  assert.deepEqual(hits('I care about this kind of traffic and that sort of thing.', 'en'), []);
  assert.deepEqual(hits('It was, like, closed. It is kind of broken.', 'en'), ['like', 'kind of']);
  assert.deepEqual(hits('Estoy aquí por este parque. Este presupuesto no tiene nada para los jóvenes y es bueno para todos.', 'es'), []);
  assert.deepEqual(hits('Bueno, este, el parque cierra temprano.', 'es'), ['bueno', 'este']);
});

test('the noise floor holds for a fluent speaker with little silence', () => {
  // Syllable-like speech with only 10% silence: the old 20th percentile floor hid it all.
  const frames = [];
  for (let i = 0; i < 1200; i += 1) {
    const silent = i % 100 < 10;
    frames.push({ t: i * 0.05, rms: silent ? 0.003 : 0.08 + 0.06 * Math.abs(Math.sin(i / 2)), pitchHz: 0 });
  }
  const { mask } = speechMask(frames);
  const speechShare = mask.filter(Boolean).length / mask.length;
  assert.ok(speechShare > 0.85, `speech share ${speechShare}`);
  const e = summarizeEnvelope(frames, 0.05);
  assert.ok(e.speakingSec > 50, `speaking ${e.speakingSec}`);
  assert.ok(paceEstimateSeries(frames, 0.05, 15).every((p) => p.v > 0));
});

test('dropped frames do not shrink pauses: durations come from the timestamps', () => {
  const dense = framesOf([[2, 0.2], [2, 0.002], [2, 0.2]]);
  // Keep one frame in three, as a busy main thread would.
  const sparse = dense.filter((_, i) => i % 3 === 0);
  assert.equal(onGrid(sparse, 0.05).length, Math.round((sparse[sparse.length - 1].t - sparse[0].t) / 0.05) + 1);
  const e = summarizeEnvelope(sparse, 0.05);
  assert.equal(e.longPauses, 1, 'the 2 second pause is still long');
  assert.ok(Math.abs(e.pauses[0].dur - 2) < 0.2, `pause ${e.pauses[0].dur}`);
});

test('practice numbers and dates follow the app language and Central time', () => {
  setLocale('es');
  try {
    // US and Mexican Spanish write 1.5 (CLDR es-US); Vietnamese writes 1,5.
    assert.equal(numberText(1.5, 'es'), '1.5');
    assert.equal(numberText(1.5, 'vi'), '1,5');
    assert.equal(secondsPhrase(1), '1 segundo');
    const when = takeWhen('2026-10-11T01:30:00Z', 'es');
    assert.match(when.date, /10/, 'Saturday evening in Dallas, not Sunday in UTC');
    assert.doesNotMatch(when.time, /PM/);
    const p = coachParams({ over: 12, sec: 1.5, missing: ['school', 'ask'] }, 'es');
    assert.equal(p.over, '12 segundos');
    assert.equal(p.sec, '1.5');
    assert.equal(p.missing, 'tu escuela y tu petición');
  } finally {
    setLocale('en');
  }
  assert.equal(takeWhen('2026-10-11T01:30:00Z', 'en').time, '8:30 PM');
  assert.equal(secondsPhrase(75), '1:15');
});

// ---- Round 2: which runs count, and which script Practice starts with ----
import { countsAsPractice } from '../src/lib/rehearse/coach.js';
import { initialScript, isFromDraft, latestDraft, scriptParagraphs } from '../src/lib/rehearse/script.js';

test('only a heard run long enough to coach counts as practice', () => {
  assert.equal(countsAsPractice({ heard: false, findings: [{ id: 'not_heard' }] }), false);
  assert.equal(countsAsPractice({ heard: true, findings: [{ id: 'too_short' }] }), false);
  assert.equal(countsAsPractice({ heard: true, findings: [{ id: 'pace_fast' }] }), true);
  assert.equal(countsAsPractice({ heard: true, findings: [] }), true);
  assert.equal(countsAsPractice(null), false);
  // Straight from the coach: a 9 second run does not count, a 40 second one does.
  const env = (speakingSec) => ({ speakingSec, longPauses: 0, pauses: [], trailOff: false, loudnessCv: 0.3, firstSpeechSec: 0, lastSpeechSec: speakingSec });
  const short = buildFindings({ speech: null, envelope: env(9), pitch: { varied: true }, body: null, seconds: 9, limitSec: 180, wpm: 140 });
  assert.equal(countsAsPractice(short), false);
  const full = buildFindings({ speech: null, envelope: env(40), pitch: { varied: true }, body: null, seconds: 40, limitSec: 180, wpm: 140 });
  assert.equal(countsAsPractice(full), true);
});

test('Practice picks up the newest Write draft, but keeps a script the student typed or cleared', () => {
  const cd = { name: 'Ana', school: 'Plano East', itemTitle: '', ask: 'Keep the bus', at: '2026-10-11T07:00:00.000Z' };
  const write = 'Good evening. Keep the bus.';
  let d = latestDraft({ commentDraft: cd, writeText: write });
  assert.equal(d.text, write);
  assert.equal(d.at, cd.at);
  assert.equal(d.fields.ask, 'Keep the bus');
  // a newer hand-over from the Practice button wins; an older one does not
  d = latestDraft({ commentDraft: cd, writeText: write, lastDraft: { text: 'Polished text.', at: '2026-10-11T08:00:00.000Z', fields: { name: 'Ana' } } });
  assert.equal(d.text, 'Polished text.');
  d = latestDraft({ commentDraft: cd, writeText: write, lastDraft: { text: 'Old text.', at: '2026-10-10T08:00:00.000Z' } });
  assert.equal(d.text, write);
  assert.equal(latestDraft({}), null);
  assert.equal(latestDraft({ lastDraft: { text: 'Only this.', at: 'x' } }).text, 'Only this.');

  const draft = latestDraft({ commentDraft: cd, writeText: write });
  // first visit: the draft
  assert.deepEqual(initialScript({ saved: {}, draft }), { script: write, scriptFrom: 'draft', draftAt: cd.at });
  // typed their own after seeing this draft: kept
  assert.deepEqual(initialScript({ saved: { script: 'My own words.', draftAt: cd.at }, draft }), { script: 'My own words.', scriptFrom: 'own', draftAt: cd.at });
  // cleared: stays cleared until Write changes
  assert.equal(initialScript({ saved: { script: '', draftAt: cd.at }, draft }).script, '');
  // Write changed since: the new draft replaces it
  const newer = { ...draft, at: '2026-10-11T09:00:00.000Z', text: 'Good evening. Run the 7 PM bus.' };
  assert.deepEqual(initialScript({ saved: { script: 'My own words.', draftAt: cd.at }, draft: newer }), { script: newer.text, scriptFrom: 'draft', draftAt: newer.at });
  // no draft at all: whatever was saved
  assert.equal(initialScript({ saved: { script: 'Pasted.' }, draft: null }).script, 'Pasted.');
  // older saves without draftAt compare the text
  assert.equal(initialScript({ saved: { script: 'Mine.', draftText: write }, draft }).script, 'Mine.');
  assert.equal(isFromDraft(` ${write} `, draft), true);
  assert.equal(isFromDraft('Something else', draft), false);
});

test('the on-screen script keeps paragraphs and line breaks', () => {
  assert.deepEqual(scriptParagraphs('Good evening.\n\nI am Ana.\nI live here.\r\n\r\nThank you.'), ['Good evening.', 'I am Ana.\nI live here.', 'Thank you.']);
  assert.deepEqual(scriptParagraphs('   '), []);
  assert.deepEqual(scriptParagraphs(null), []);
});
