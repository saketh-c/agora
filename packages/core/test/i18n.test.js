import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { LOCALES, DICTIONARIES, t, tn, tList, joinList, setLocale, getLocale, isLocale, detectLocale, isPluralForms, pluralCategoriesFor } from '../src/i18n/index.js';
import { compareLocale, units, getPath } from '../../../scripts/lib/i18n-tools.mjs';
import { collectCityStrings, localizeCity, localizeCities, translationCoverage } from '../src/i18n/data.js';
import { getTopic, topicList } from '../src/topics.js';
import { formatDate, formatTime, relativeDays, describeRecurrence } from '../src/format.js';
import { buildComment } from '../src/civics.js';
import { matchMeetings } from '../src/match.js';

afterEach(() => setLocale('en'));

const city = {
  cityId: 'garland',
  name: 'Garland',
  county: 'Dallas',
  website: 'https://www.garlandtx.gov',
  cityHall: { address: '200 N Fifth St', lat: 32.9126, lng: -96.6389 },
  notes: 'Council notes here.',
  council: { structure: 'mayor at large plus 8 districts' },
  meetings: [{ type: 'regular', label: 'City Council Regular Meeting', notes: 'Voting meeting.', openToPublicComment: true, recurrence: { kind: 'nth-weekday', weekday: 2, ordinals: [1, 3], time: '19:00' } }],
  scheduleExceptions: [{ date: '2026-11-03', status: 'cancelled', note: 'Election Day.' }],
  publicComment: { summary: 'Fill out a speaker card.', howToRegister: 'Hand it to the City Secretary.', virtualAllowed: false, timeLimitMinutes: 3 },
  youthPrograms: [{ name: 'Garland Youth Council', description: 'High school students advise the council.', ages: 'Grades 9 to 12' }],
  agendaItems: [{ title: 'Rezoning on Miller Road', summary: 'A developer wants to build homes.', topics: ['zoning-development'], meetingDate: '2026-11-17' }],
  confidence: 'high',
  sources: [],
};

test('every locale mirrors the English dictionary: same keys, list lengths, plural forms, params, no dashes', () => {
  for (const { code } of LOCALES) {
    const r = compareLocale(code);
    assert.deepEqual(r.missing, [], `${code} is missing keys`);
    assert.deepEqual(r.extra, [], `${code} has keys English does not`);
    assert.deepEqual(r.problems, [], `${code} problems`);
  }
});

test('no locale uses an em dash or en dash', () => {
  for (const { code } of LOCALES) {
    const walk = (node, path) => {
      if (typeof node === 'string') assert.ok(!/\u2014|\u2013/.test(node), `${code} ${path} contains a dash character`);
      else if (Array.isArray(node)) node.forEach((v, i) => walk(v, `${path}[${i}]`));
      else if (node && typeof node === 'object') for (const [k, v] of Object.entries(node)) walk(v, `${path}.${k}`);
    };
    walk(DICTIONARIES[code], code);
  }
});

test('every plural object has the forms its language uses', () => {
  const expected = { en: ['one', 'other'], es: ['one', 'other'], vi: ['other'], zh: ['other'], hi: ['one', 'other'], te: ['one', 'other'], ar: ['zero', 'one', 'two', 'few', 'many', 'other'] };
  for (const [code, forms] of Object.entries(expected)) {
    assert.deepEqual(pluralCategoriesFor(code), forms, code);
    for (const { path, value } of units(DICTIONARIES.en)) {
      if (!isPluralForms(value)) continue;
      const theirs = getPath(DICTIONARIES[code], path);
      for (const c of forms) assert.equal(typeof theirs[c], 'string', `${code} ${path}.${c}`);
    }
  }
});

test('locale selection and detection', () => {
  assert.equal(isLocale('es'), true);
  assert.equal(isLocale('de'), false);
  assert.equal(detectLocale(['de-DE', 'vi-VN', 'en']), 'vi');
  assert.equal(detectLocale(['de', 'fr']), 'en');
  assert.equal(detectLocale([]), 'en');
  assert.equal(setLocale('es'), 'es');
  assert.equal(getLocale(), 'es');
  assert.equal(setLocale('klingon'), 'en', 'an unknown code falls back to English');
});

test('translate, pluralize, and list joining follow the locale', () => {
  assert.equal(t('common.today'), 'Today');
  assert.equal(tn('common.agendaItems', 1), '1 agenda item');
  assert.equal(tn('common.agendaItems', 4), '4 agenda items');
  assert.equal(joinList(['a', 'b', 'c']), 'a, b and c');
  assert.equal(t('city.councilTitle', { city: 'Plano' }), 'Plano City Council');
  assert.equal(t('nothing.here.at.all'), 'nothing.here.at.all', 'an unknown key returns the key');
  setLocale('es');
  assert.notEqual(t('common.today'), 'Today');
  assert.equal(tList('format.weekdays').length, 7);
});

test('dates, times, and recurrence render in the active locale', () => {
  const en = { date: formatDate('2026-09-14'), rel: relativeDays('2026-09-16', '2026-09-14'), rec: describeRecurrence({ kind: 'nth-weekday', weekday: 1, ordinals: [2, 4], time: '19:00' }) };
  assert.equal(en.date, 'Mon, Sep 14');
  assert.equal(en.rel, 'In 2 days');
  assert.match(en.rec, /2nd and 4th Mondays at 7:00 PM/);
  for (const code of ['es', 'vi']) {
    setLocale(code);
    assert.notEqual(formatDate('2026-09-14'), en.date, `${code} date should differ from English`);
    assert.notEqual(relativeDays('2026-09-16', '2026-09-14'), en.rel, `${code} relative day should differ`);
    // Each locale keeps its own clock: 12-hour in Spanish, 24-hour in Vietnamese (format.test.js has the details).
    const clock = code === 'vi' ? '19:00' : '7:00 p.m.';
    assert.ok(describeRecurrence({ kind: 'nth-weekday', weekday: 1, ordinals: [2, 4], time: '19:00' }).includes(clock), 'the time stays readable');
    assert.equal(formatTime('19:00'), clock);
  }
});

test('topics, match reasons, and the comment draft follow the locale', () => {
  const cities = [city];
  const prefs = { interests: ['zoning-development'], availability: { evenings: true, daytime: false, weekends: true }, homeCityId: 'garland' };
  const enTopic = getTopic('housing').label;
  const enReason = matchMeetings(cities, prefs, { today: '2026-11-10', days: 30 })[0].reasons[0].text;
  const enDraft = buildComment({ name: 'Ana', cityName: 'Garland', topicId: 'housing', position: 'support' });
  assert.match(enDraft, /Good evening/);
  for (const code of ['es', 'vi']) {
    setLocale(code);
    assert.notEqual(getTopic('housing').label, enTopic, `${code} topic label should differ`);
    assert.equal(topicList().length, 18);
    assert.notEqual(matchMeetings(cities, prefs, { today: '2026-11-10', days: 30 })[0].reasons[0].text, enReason, `${code} match reason should differ`);
    const draft = buildComment({ name: 'Ana', cityName: 'Garland', topicId: 'housing', position: 'support' });
    assert.ok(!draft.includes('Good evening'), `${code} draft should not be English`);
    assert.match(draft, /Ana/, 'the name survives translation');
  }
  // An explicit locale argument overrides the active one.
  setLocale('en');
  assert.notEqual(buildComment({ name: 'Ana', cityName: 'Garland', topicId: 'housing', locale: 'es' }), enDraft);
});

test('city data localization swaps only known strings and only exact matches', () => {
  const strings = {
    'Fill out a speaker card.': 'Llene una tarjeta de orador.',
    'Rezoning on Miller Road': 'Rezonificación en Miller Road',
    'High school students advise the council.': 'Estudiantes de preparatoria asesoran al concejo.',
    'Election Day.': 'Día de elecciones.',
  };
  const out = localizeCity(city, strings);
  assert.equal(out.publicComment.summary, 'Llene una tarjeta de orador.');
  assert.equal(out.agendaItems[0].title, 'Rezonificación en Miller Road');
  assert.equal(out.youthPrograms[0].description, 'Estudiantes de preparatoria asesoran al concejo.');
  assert.equal(out.scheduleExceptions[0].note, 'Día de elecciones.');
  assert.equal(out.publicComment.howToRegister, 'Hand it to the City Secretary.', 'an untranslated string stays English');
  assert.equal(out.cityHall.address, '200 N Fifth St', 'addresses are never translated');
  assert.equal(out.website, 'https://www.garlandtx.gov', 'URLs are never translated');
  assert.equal(out.name, 'Garland', 'city names are never translated');
  assert.equal(out.agendaItems[0].topics[0], 'zoning-development', 'topic ids are untouched');
  assert.equal(city.publicComment.summary, 'Fill out a speaker card.', 'the source record is not mutated');
  assert.deepEqual(localizeCity(city, null), city, 'no memory means no change');
  assert.equal(localizeCities([city], strings)[0].publicComment.summary, 'Llene una tarjeta de orador.');
});

test('translation coverage reports what is still English', () => {
  const all = [...collectCityStrings(city)];
  assert.ok(all.includes('Fill out a speaker card.'));
  assert.ok(all.includes('Rezoning on Miller Road'));
  assert.ok(!all.includes('https://www.garlandtx.gov'), 'URLs are not offered for translation');
  assert.ok(!all.includes('Garland'), 'the city name is not offered for translation');
  const coverage = translationCoverage([city], { 'Fill out a speaker card.': 'x' });
  assert.equal(coverage.total, all.length);
  assert.equal(coverage.translated, 1);
  assert.equal(coverage.missing.length, all.length - 1);
});

test('localized records keep the English source of the fields the engine reads', () => {
  const strings = {
    'City Council Regular Meeting': 'Reunión regular del concejo municipal',
    'Election Day.': 'Día de elecciones.',
    'Rezoning on Miller Road': 'Rezonificación en Miller Road',
    'Voting meeting.': 'Reunión con votación.',
  };
  const out = localizeCity(city, strings);
  assert.equal(out.meetings[0].label, 'Reunión regular del concejo municipal');
  assert.equal(out.meetings[0].labelSource, 'City Council Regular Meeting');
  assert.equal(out.meetings[0].notesSource, undefined, 'notes are display-only, so no source is kept');
  assert.equal(out.scheduleExceptions[0].noteSource, 'Election Day.');
  assert.equal(out.agendaItems[0].titleSource, 'Rezoning on Miller Road');
  assert.equal(out.agendaItems[0].summarySource, undefined);
  assert.equal(localizeCity(out, strings).meetings[0].labelSource, 'City Council Regular Meeting', 'localizing twice keeps the English source');
  const untranslated = localizeCity(city, { 'Fill out a speaker card.': 'x' });
  assert.equal(untranslated.meetings[0].labelSource, undefined, 'an untranslated field is already English');
  assert.equal(city.meetings[0].labelSource, undefined, 'the source record is not mutated');
});
