/**
 * The server in Chinese, Hindi, Telugu and Arabic: the request language from ?lang= (any
 * language) and Accept-Language (ready languages only), the Content-Language tag, API messages
 * from core's `api` namespace as plain text, and the AI prompts and checks for each language
 * (named precisely, judged in its own script and units, with private names hidden even where
 * words have no spaces).
 */
import { test, before, after, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { DICTIONARIES, LOCALES } from '@agora/core';
import { createApp, requestLang } from '../src/app.js';
import { apiMessage, API_MESSAGES } from '../src/messages.js';
import { draftComment, explainAgendaItem, privacyPattern, setAiClient, soundsLike, NAME_PLACEHOLDER } from '../src/ai.js';

const cities = [
  {
    cityId: 'plano',
    name: 'Plano',
    county: 'Collin',
    website: 'https://www.plano.gov',
    cityHall: { address: '1520 K Ave, Plano, TX 75074', lat: 33.0198, lng: -96.6989 },
    meetings: [{ type: 'regular', label: 'City Council meeting', openToPublicComment: true, recurrence: { kind: 'nth-weekday', weekday: 1, ordinals: [2, 4], time: '19:00' } }],
    publicComment: { summary: 'Fill out a card.', howToRegister: 'Speaker card at the door.', virtualAllowed: false, timeLimitMinutes: 3 },
    youthPrograms: [],
    agendaItems: [],
    confidence: 'high',
    sources: [],
  },
];

const savedEnv = {};
let server;
let base;
before(async () => {
  for (const k of ['ANTHROPIC_API_KEY', 'ANTHROPIC_AUTH_TOKEN', 'TRUST_PROXY']) {
    savedEnv[k] = process.env[k];
    delete process.env[k];
  }
  const app = createApp({ cities, news: { sources: [], topicLinks: [] }, webDist: 'C:/not/here', now: () => new Date('2026-10-11T15:00:00Z'), translations: () => null });
  await new Promise((resolve) => {
    server = app.listen(0, resolve);
  });
  base = `http://127.0.0.1:${server.address().port}`;
});
after(() => {
  if (server) server.close();
  for (const [k, v] of Object.entries(savedEnv)) if (v !== undefined) process.env[k] = v;
});
afterEach(() => setAiClient(null));

function stubClient(reply) {
  const calls = [];
  setAiClient({
    beta: {
      messages: {
        create: async (params) => {
          calls.push(params);
          return { stop_reason: 'end_turn', content: [{ type: 'text', text: await reply(params) }] };
        },
      },
    },
  });
  return calls;
}

test('the request language: ?lang=, then Accept-Language, with region and script subtags', () => {
  const req = (query, header) => ({ query: query ? { lang: query } : {}, body: {}, headers: header ? { 'accept-language': header } : {} });
  // The app's own choice is any language it has, ready or not.
  assert.equal(requestLang(req('zh-TW', 'en')), 'zh');
  assert.equal(requestLang(req('zh-Hant-HK')), 'zh');
  assert.equal(requestLang(req('hi-IN')), 'hi');
  assert.equal(requestLang(req('te_IN')), 'te');
  assert.equal(requestLang(req('ar-EG', 'es')), 'ar');
  assert.equal(requestLang(req('te', 'ar')), 'te', 'the app language wins');
  assert.equal(requestLang(req('xx', 'de, fr')), 'en');
  // Accept-Language only finds a language the app offers (ready), like the app's detection.
  assert.equal(requestLang(req(null, 'es-MX,es;q=0.9')), 'es');
  for (const l of LOCALES) assert.equal(requestLang(req(null, `${l.code}-XX,vi;q=0.5`)), l.ready ? l.code : 'vi', l.code);
});

test('responses say their language with a BCP 47 tag, and errors come in it', async () => {
  const zh = await fetch(`${base}/api/health?lang=zh-CN`);
  assert.equal(zh.headers.get('content-language'), 'zh-Hans');
  const health = await zh.json();
  assert.equal(health.lang, 'zh');
  assert.deepEqual(health.languages.map((l) => l.code), ['en', 'es', 'vi', 'zh', 'hi', 'te', 'ar']);
  assert.equal(health.languages.find((l) => l.code === 'ar').dir, 'rtl');
  assert.deepEqual(health.languages.map((l) => typeof l.ready), LOCALES.map(() => 'boolean'), 'clients can tell which languages are offered');
  const ar = await fetch(`${base}/api/nothing-here?lang=ar`);
  assert.equal(ar.headers.get('content-language'), 'ar');
  assert.equal((await ar.json()).error, apiMessage('notFound', null, 'ar'));
});

test('an Arabic error in JSON is plain text, with no bidi controls', async () => {
  const res = await fetch(`${base}/api/comment?lang=ar`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ useAi: 'yes' }) });
  assert.equal(res.status, 400);
  const body = await res.json();
  assert.equal(body.field, 'useAi');
  assert.match(body.error, /useAi/);
  assert.doesNotMatch(body.error, /[\u2066-\u2069]/);
});

test('API messages live in core dictionaries for every language', () => {
  for (const code of ['zh', 'hi', 'te', 'ar']) {
    assert.deepEqual(Object.keys(API_MESSAGES[code]).sort(), Object.keys(API_MESSAGES.en).sort(), code);
    assert.equal(API_MESSAGES[code], DICTIONARIES[code].api);
  }
  assert.match(apiMessage('rateLimited', { n: 42 }, 'es'), /42 segundos/);
  // JSON leaves the app: plain text, without the bidi isolates the screen uses.
  assert.match(apiMessage('rateLimited', { n: 42 }, 'ar'), /\b42\b/);
  assert.doesNotMatch(apiMessage('rateLimited', { n: 42 }, 'ar'), /[\u2066-\u2069]/);
  assert.doesNotMatch(apiMessage('invalidField', { field: 'name' }, 'ar'), /[\u2066-\u2069]/);
  assert.equal(apiMessage('noSuchMessage', null, 'ar'), 'noSuchMessage');
});

test('answers are judged in their own script', () => {
  assert.equal(soundsLike('这个议程项目会改变学生放学回家坐公交车的路线，影响很多家庭。', 'zh'), true);
  assert.equal(soundsLike('This agenda item changes the bus route students take home.', 'zh'), false);
  assert.equal(soundsLike('यह एजेंडा आइटम उस बस मार्ग को बदलता है जिससे छात्र घर जाते हैं।', 'hi'), true);
  assert.equal(soundsLike('ఈ అజెండా అంశం విద్యార్థులు ఇంటికి వెళ్ళే బస్సు మార్గాన్ని మారుస్తుంది.', 'te'), true);
  assert.equal(soundsLike('هذا البند يغير مسار الحافلة الذي يستخدمه الطلاب للعودة إلى منازلهم', 'ar'), true);
  assert.equal(soundsLike('This item is about the bus route that students take home every day.', 'ar'), false);
  assert.equal(soundsLike('Plano', 'ar'), true, 'too short to judge');
});

test('private names are hidden in every script, Chinese without spaces and Arabic with prefixes', () => {
  assert.equal('我叫李明，在学校'.replace(privacyPattern('李明'), 'X'), '我叫X，在学校');
  assert.equal('Also Al came'.replace(privacyPattern('Al'), 'X'), 'Also X came', 'not inside a longer word');
  assert.equal('मेरा नाम राम है, रामायण'.replace(privacyPattern('राम'), 'X'), 'मेरा नाम X है, रामायण');
  assert.equal('اسمي أحمد ولأحمد وأحمدي'.replace(privacyPattern('أحمد'), 'X'), 'اسمي X ولX وأحمدي');
});

test('prompts name each language precisely and ask for Latin digits', async () => {
  const calls = stubClient(() => '这个议程项目会改变学生放学回家坐公交车的路线。它影响很多家庭和学生。你可以在会议当天下午4点前在网上报名发言。');
  const r = await explainAgendaItem({ title: 'Bus route change', summary: 'A new route.', city: cities[0], topics: ['transit'], locale: 'zh' });
  assert.equal(r.source, 'claude');
  const prompt = calls[0].messages[0].content;
  assert.match(prompt, /Simplified Chinese/);
  assert.match(prompt, /Latin digits/);
  for (const [code, name] of [['hi', 'Devanagari'], ['te', 'Telugu script'], ['ar', 'Modern Standard Arabic']]) {
    const c = stubClient(() => 'x');
    await explainAgendaItem({ title: 'Item', locale: code });
    assert.match(c[0].messages[0].content, new RegExp(name), code);
  }
});

test('a Chinese comment is measured in characters, and the name comes back', async () => {
  const long = '我'.repeat(600);
  stubClient(() => long);
  const tooLong = await draftComment({ name: '李明', cityName: 'Plano', topicId: 'transit', position: 'support', locale: 'zh' }, 'template');
  assert.equal(tooLong.source, 'template');
  assert.equal(tooLong.aiError, 'declined');
  const calls = stubClient((params) => {
    assert.doesNotMatch(params.messages[0].content, /李明/, 'the name never leaves the server');
    return `大家好，我叫${NAME_PLACEHOLDER}，我住在普莱诺。我支持延长公交车的运行时间，因为很多学生放学后要坐公交车回家。谢谢大家。`;
  });
  const ok = await draftComment({ name: '李明', cityName: 'Plano', topicId: 'transit', position: 'support', locale: 'zh' }, 'template', { cityName: 'Plano' });
  assert.equal(ok.source, 'claude');
  assert.match(ok.text, /我叫李明/);
  assert.match(calls[0].messages[0].content, /under \d+ Chinese characters/);
});
