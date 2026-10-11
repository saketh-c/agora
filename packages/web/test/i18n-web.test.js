/**
 * The web app's pieces that assume a script or a direction: calendar files in UTF-8, phone
 * numbers kept left to right, search folding, units that never wrap away from their number in
 * Arabic, dates from core in every language, and the community issue link cut on graphemes.
 */
import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { expandCityMeetings, formatMiles, formatMonthDay, setBidiIsolation, setLocale, t, weekdayName } from '@agora/core';
import { buildIcs, foldLine, googleCalendarUrl } from '../src/lib/ics.js';
import { PHONE_RE } from '../src/components/ui/cityText.js';
import { keepUnit, meetingTitle } from '../src/components/ui/meetingText.js';
import { fold as filterFold, queryVocab } from '../src/lib/meetingFilters.js';
import { fold as cityFold } from '../src/lib/cityMatch.js';
import { buildIssueUrl } from '../src/lib/community.js';

const cities = JSON.parse(readFileSync(new URL('../../../data/cities.json', import.meta.url))).cities;
const plano = cities.find((c) => c.cityId === 'plano');
const meeting = expandCityMeetings(plano, '2026-10-12', '2026-10-12').find((m) => m.time === '19:00');
const octets = (s) => new TextEncoder().encode(s).length;
const unfold = (text) => text.replace(/\r\n /g, '');

afterEach(() => {
  setLocale('en');
  setBidiIsolation(true);
});

test('calendar lines in Chinese, Hindi and Arabic fold at 75 octets without breaking a character', () => {
  for (const text of ['市议会会议，请提前报名发言。'.repeat(6), 'नगर परिषद की बैठक में बोलने के लिए पहले से पंजीकरण करें। '.repeat(3), 'اجتماع مجلس المدينة، سجّل للتحدث مسبقًا. '.repeat(4)]) {
    const line = `DESCRIPTION:${text}`;
    const folded = foldLine(line);
    for (const part of folded.split('\r\n')) assert.ok(octets(part) <= 75, `${octets(part)} octets`);
    assert.equal(unfold(folded), line, 'unfolding gives the text back');
    assert.doesNotMatch(folded, /�/);
  }
});

test('the calendar file is plain UTF-8 text without bidi isolates, also in Arabic', () => {
  setLocale('ar');
  const ics = buildIcs(meeting, plano, { deadline: { date: '2026-10-12', time: '16:00', passed: false }, now: new Date('2026-10-11T15:00:00Z') });
  assert.doesNotMatch(ics, /[\u2066-\u2069]/);
  for (const line of ics.split('\r\n')) assert.ok(octets(line) <= 75);
  assert.doesNotMatch(decodeURIComponent(googleCalendarUrl(meeting, plano)), /[\u2066-\u2069]/);
});

test('US phone numbers are found so they can be kept left to right', () => {
  const find = (s) => [...s.matchAll(PHONE_RE)].map((m) => m[0]);
  assert.deepEqual(find('call 214-670-3738 or (972) 205-2000, or +1 817-392-6150.'), ['214-670-3738', '(972) 205-2000', '+1 817-392-6150']);
  assert.deepEqual(find('Agenda item 2026-10-12, room 101, 2024-25 budget'), []);
});

test('search folding keeps Devanagari and Telugu vowel signs and unifies Arabic spellings', () => {
  for (const fold of [filterFold, cityFold]) {
    assert.equal(fold('Español'), 'espanol');
    assert.notEqual(fold('दिल्ली'), fold('दलल'));
    assert.equal(fold('أحمد'), fold('احمد'));
  }
  // Weekday and month words from Intl join the search vocabulary in the new languages.
  const vocab = queryVocab('zh');
  assert.ok(vocab.weekdays[1].includes('星期一'), vocab.weekdays[1].join('|'));
  assert.ok(queryVocab('hi').weekdays[1].includes(filterFold('सोमवार')));
});

test('dates and distances in rows come from core in every language', () => {
  assert.equal(formatMonthDay('2026-10-12'), 'Oct 12');
  setLocale('zh');
  assert.equal(formatMonthDay('2026-10-12'), '10月12日');
  assert.equal(weekdayName('2026-10-12', { short: true }), '周一');
  setLocale('ar');
  // The unit stays with its number even when the number is isolated in an Arabic sentence.
  const away = keepUnit(t('ui.milesShort', { n: formatMiles(2.66) }));
  assert.match(away, /2\.7\u2069?\u00a0/);
  assert.doesNotMatch(away, /\d\u2069? /, 'no breaking space after the number');
  assert.equal(keepUnit('3 min'), '3\u00a0min');
});

test('an English meeting label is tidied the English way until its language translates it', () => {
  setLocale('ar');
  assert.equal(meetingTitle({ label: 'City Council Regular Meeting', cityName: 'Plano' }, 'ar'), 'Regular meeting');
  assert.equal(meetingTitle({ label: 'اجتماع المجلس العادي', labelSource: 'City Council Regular Meeting', cityName: 'Plano' }, 'ar'), 'اجتماع المجلس العادي');
  assert.equal(meetingTitle({ label: 'reunión regular', labelSource: 'City Council Regular Meeting', cityName: 'Plano' }, 'es'), 'Reunión regular');
});

test('a long community post is cut between graphemes and its link carries no isolates', () => {
  const body = 'क्षत्रिय '.repeat(2000);
  const url = buildIssueUrl('https://github.com/x/y', { kind: 'tip', title: 'टिप', body, author: { name: '' } }, { kindLabel: '\u2068Tip\u2069', maxLength: 3000 });
  assert.ok(url.length <= 3000);
  const text = new URL(url).searchParams.get('body');
  assert.doesNotMatch(text, /[\u2066-\u2069]/);
  const cut = text.split('\n').find((line) => line.endsWith('…'));
  assert.ok(cut, 'the body was shortened');
  assert.doesNotMatch(cut, /्…$/, 'never ends on a dangling virama');
});
