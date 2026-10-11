import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  AGENDA_SOURCES,
  AGENDA_USER_AGENT,
  applyLivePlan,
  applyLivePlans,
  buildAgendaSnapshot,
  cleanLabel,
  combineSourceMeetings,
  createPoliteFetch,
  datePostings,
  failingAgendaSources,
  isAgendaSnapshot,
  isCouncilTitle,
  itemTopics,
  liveMeetingFor,
  makeItem,
  parseAgendaCenter,
  parseCivicClerkEvents,
  parseCivicClerkMeeting,
  parseDocsPublishedDocument,
  parseDocsPublishedList,
  parseIcal,
  parseLegistarEvents,
  parseLegistarItems,
  parseMunicodeAda,
  parseMunicodePublish,
  parseOnBaseAgenda,
  parseOnBaseList,
  planLiveAgenda,
  planLiveAgendas,
  sentenceCase,
  snapshotCounts,
  to24h,
  utcToCentral,
} from '../src/agendas.js';
import { calendarThrough, expandCityMeetings } from '../src/schedule.js';
// Every language's dictionary (the merge writes its notes in Spanish below).
import '../src/i18n/index.js';
import { validateCity } from '../src/validate.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const FIX = path.join(here, 'fixtures', 'agendas');
const json = (f) => JSON.parse(readFileSync(path.join(FIX, f), 'utf8'));
const text = (f) => readFileSync(path.join(FIX, f), 'utf8');

/* ----------------------------------------------------------------------------------------- */
/* Helpers                                                                                   */
/* ----------------------------------------------------------------------------------------- */

test('times and dates: 12-hour times, and UTC instants read as Central wall time across DST', () => {
  assert.equal(to24h('5:45 PM'), '17:45');
  assert.equal(to24h('12:00 PM'), '12:00');
  assert.equal(to24h('12:30 AM'), '00:30');
  assert.equal(to24h('9:00:00 AM'), '09:00');
  assert.equal(to24h('noon'), null);
  // CDT (UTC-5) in October, CST (UTC-6) in December.
  assert.deepEqual(utcToCentral('2026-10-13T23:00:00'), { date: '2026-10-13', time: '18:00' });
  assert.deepEqual(utcToCentral('2026-12-09T00:30:00Z'), { date: '2026-12-08', time: '18:30' });
  assert.deepEqual(utcToCentral('2026-10-08T04:22:09.343'), { date: '2026-10-07', time: '23:22' });
  assert.equal(utcToCentral(''), null);
  assert.equal(utcToCentral('not a date'), null);
});

test('meeting names lose dates, cancel markers and ordinal tails; ALL CAPS becomes sentence case', () => {
  assert.equal(cleanLabel('10/26/26 Regular City Council Meeting'), 'Regular City Council Meeting');
  assert.equal(cleanLabel('11/9/26 2:00 p.m. Regular City Council Meeting'), 'Regular City Council Meeting');
  assert.equal(cleanLabel('December 6, 2027, City Council Meeting '), 'City Council Meeting');
  assert.equal(cleanLabel('CANCELED - Town Council Meeting'), 'Town Council Meeting');
  assert.equal(cleanLabel('City Council Meeting - Cancelled'), 'City Council Meeting');
  assert.equal(cleanLabel('City Council Meeting - 2nd'), 'City Council Meeting');
  assert.equal(sentenceCase('HOLD A PUBLIC HEARING FOR SPECIFIC USE PERMIT CASE NO. 26-08-SUP'), 'Hold a public hearing for specific use permit case no. 26-08-SUP');
  assert.equal(sentenceCase('Consider An Ordinance Amending The Tree Preservation Ordinance'), 'Consider An Ordinance Amending The Tree Preservation Ordinance', 'Title Case is the city’s choice and is kept');
  assert.equal(sentenceCase('PURCHASE FOR DART AND ISD'), 'Purchase for DART and ISD');
});

test('only the council’s own meetings count, not boards, quorum notices or the arts council', () => {
  for (const yes of ['City Council Meeting', 'Regular City Council Meeting', 'Joint City Council and Planning and Zoning Commission Meeting', 'Town Council Meeting and Study Session', 'City Council Special Meeting', 'Special City Council Meeting']) {
    assert.equal(isCouncilTitle(yes), true, yes);
  }
  for (const no of ['Southlake Arts Council Meeting', 'Planning and Zoning Commission', 'Notice of Possible Quorum - City Council', 'Youth Council Meeting', 'City Council Candidate Forum', 'Library Board']) {
    assert.equal(isCouncilTitle(no), false, no);
  }
});

test('agenda items: procedural rows and cost tails are dropped, topics avoid false alarms', () => {
  assert.equal(makeItem({ title: 'Call to Order' }), null);
  assert.equal(makeItem({ title: 'Approval of Minutes of the September 23, 2026 City Council Meeting' }), null);
  assert.equal(makeItem({ title: 'Invocation - Minutes Placeholder' }), null);
  for (const closed of ['Approval of the September 15, 2026 City Council minutes', 'A. Presentation of a Proclamation proclaiming October 2026 as Fire Prevention Month', 'Section 551.074: Personnel Matters', 'A. To deliberate the appointment, employment, evaluation, reassignment, duties, discipline, or dismissal of a public officer', 'Approve the following bids:', 'Consider action to approve the minutes.', 'Personnel · City Attorney', 'October 15 - Joint Work Session with Environmental Conservation Commission (ECC)']) {
    assert.equal(makeItem({ title: closed }), null, closed);
  }
  assert.equal(makeItem({ title: 'A public hearing to consider a zoning change for 12 acres' }).title, 'A public hearing to consider a zoning change for 12 acres', 'an article is not a list letter');
  const dallas = makeItem({ title: 'Authorize a construction services contract for traffic signal upgrades on Main Street - Group 7 Project - Not to exceed $709,126.18 - Financing: Street and Transportation Improvements Fund', url: 'https://cityofdallas.legistar.com/x' });
  assert.equal(dallas.title, 'Authorize a construction services contract for traffic signal upgrades on Main Street - Group 7 Project');
  assert.equal(dallas.summary, undefined, 'the cost and funding tail is dropped');
  assert.ok(!dallas.topics.includes('budget-taxes'), 'a fund name is not a budget item');
  assert.ok(itemTopics('ZC-26-119 (CD 6) 6345 Altamesa Boulevard', '', 'Zoning Hearing').includes('zoning-development'));
  assert.ok(!itemTopics('ZC-26-017 (CD 6) (Address 5332 Sycamore School Road)').includes('education-libraries'));
  assert.ok(!itemTopics('Consider and act upon adoption of an Ordinance to amend the sign code').includes('animal-services'));
  assert.ok(itemTopics('Ordinance amending the animal shelter adoption fees').includes('animal-services'));
  assert.ok(itemTopics('Adopt the FY 2027 budget and tax rate').includes('budget-taxes'));
  // A generic headline falls back to its detail for topics.
  assert.deepEqual(itemTopics('Consider authorizing the purchase of digital library materials'), ['education-libraries', 'technology']);
});

/* ----------------------------------------------------------------------------------------- */
/* Parsers on saved responses (scratch probes from 2026-10-11)                              */
/* ----------------------------------------------------------------------------------------- */

test('Legistar: only council bodies, hidden agendas skipped, posted date in Central time', () => {
  const dallas = parseLegistarEvents(json('legistar-events-cityofdallas.json'), AGENDA_SOURCES.dallas[0]);
  assert.equal(dallas.length, 1, 'committees and commissions are left out');
  assert.deepEqual(
    { date: dallas[0].date, time: dallas[0].time, label: dallas[0].label, type: dallas[0].type, posted: dallas[0].agendaPostedOn, cancelled: dallas[0].cancelled },
    { date: '2026-10-14', time: '09:00', label: 'City Council', type: 'regular', posted: '2026-10-07', cancelled: false },
  );
  assert.match(dallas[0].agendaUrl, /^https:\/\/.*\.pdf$/);
  assert.match(dallas[0].detailUrl, /^https:\/\/cityofdallas\.legistar\.com\/MeetingDetail\.aspx/);
  assert.deepEqual(dallas[0].fetchItems, { kind: 'legistar', eventId: 4349 });

  const plano = parseLegistarEvents(json('legistar-events-plano.json'), AGENDA_SOURCES.plano[0]);
  assert.deepEqual(plano.map((m) => [m.time, m.type]).sort(), [['17:00', 'briefing'], ['19:00', 'regular']], 'the Hidden P&Z placeholder is skipped');

  const denton = parseLegistarEvents(json('legistar-events-denton-tx.json'), AGENDA_SOURCES.denton[0]);
  assert.equal(denton.length, 2);
  assert.ok(denton.every((m) => m.special && !m.cancelled));
  assert.deepEqual(denton.map((m) => m.label).sort(), ['City Council special called meeting', 'Joint Special Called Meeting with Denton ISD Board of Directors']);
});

test('Legistar items: matters only, minutes and closed session out, zoning tagged, links to the legislation page', () => {
  const items = parseLegistarItems(json('legistar-items-cityofdallas.json'), { client: 'cityofdallas', detailUrl: 'https://cityofdallas.legistar.com/MeetingDetail.aspx?ID=1' });
  assert.ok(items.length > 0 && items.length <= 12);
  assert.ok(items.every((i) => i.url.startsWith('https://cityofdallas.legistar.com/LegislationDetail.aspx?ID=')));
  assert.ok(!items.some((i) => /^approval of minutes|trinity bible church/i.test(i.title)));
  assert.ok(items.some((i) => i.topics.includes('zoning-development')));
  assert.ok(items.every((i) => i.title.length <= 183 && !/- Financing:/.test(i.title) && !i.summary));
});

test('CivicClerk: local times, cancellations, placeholder duplicates, quorum notices, posted agendas', () => {
  const sachse = parseCivicClerkEvents(json('civicclerk-events-sachsetx.json'), { tenant: 'sachsetx' });
  assert.deepEqual(
    sachse.map((m) => [m.date, m.time, m.cancelled]),
    [
      ['2026-10-19', '18:30', true],
      ['2026-11-02', '18:30', false],
      ['2026-11-16', '18:30', false],
    ],
  );
  assert.equal(sachse[0].label, 'City Council Meeting');
  assert.equal(sachse[0].fetchItems, null, 'a cancelled meeting has no items to fetch');

  const colleyville = parseCivicClerkEvents(json('civicclerk-events-colleyvilletx.json'), { tenant: 'colleyvilletx' });
  assert.equal(colleyville.length, 5, 'agendaId 0 placeholders at the same start are dropped');
  assert.ok(colleyville.every((m) => m.time === '17:30'));

  const flowerMound = parseCivicClerkEvents(json('civicclerk-events-flowermoundtx.json'), { tenant: 'flowermoundtx' });
  const dec21 = flowerMound.find((m) => m.date === '2026-12-21');
  assert.equal(dec21.cancelled, true);
  assert.equal(dec21.label, 'Town Council Meeting');
  const oct15 = flowerMound.find((m) => m.date === '2026-10-15');
  assert.equal(oct15.type, 'work-session');
  assert.equal(oct15.agendaPostedOn, '2026-10-09');

  const mansfield = parseCivicClerkEvents(json('civicclerk-events-mansfieldtx.json'), { tenant: 'mansfieldtx' });
  assert.deepEqual(
    mansfield.filter((m) => m.date === '2026-11-09').map((m) => [m.time, m.label]),
    [
      ['14:00', 'Regular City Council Meeting'],
      ['18:00', 'Regular City Council Meeting'],
    ],
  );

  const euless = parseCivicClerkEvents(json('civicclerk-events-eulesstx.json'), { tenant: 'eulesstx' });
  assert.equal(euless[0].agendaPostedOn, '2026-10-07');
  assert.equal(euless[0].agendaUrl, 'https://eulesstx.api.civicclerk.com/v1/Meetings/GetMeetingFileStream(fileId=3241,plainText=false)');
  assert.equal(euless[0].detailUrl, 'https://eulesstx.portal.civicclerk.com/event/1281/overview');
  assert.deepEqual(euless[0].fetchItems, { kind: 'civicclerk', agendaId: 2186 });
});

test('CivicClerk agenda: ALL-CAPS headlines become sentence-case titles with the detail as summary', () => {
  const items = parseCivicClerkMeeting(json('civicclerk-meeting-eulesstx.json'), { detailUrl: 'https://eulesstx.portal.civicclerk.com/event/1281/overview' });
  const titles = items.map((i) => i.title);
  assert.ok(titles.includes('Consider authorizing the purchase of digital library materials'));
  assert.ok(!titles.some((tt) => /proclamation|minutes|adjourn|public comments|service pins/i.test(tt)));
  const sup = items.find((i) => /26-08-SUP/.test(i.title));
  assert.ok(sup.topics.includes('zoning-development'));
  assert.match(sup.summary, /^Receive public input/);
  assert.ok(items.every((i) => i.url === 'https://eulesstx.portal.civicclerk.com/event/1281/overview'));
});

test('iCal: council events in the window; all-day placeholders carry no time; date prefixes cleaned', () => {
  const desoto = parseIcal(text('ical-desoto.ics'), { from: '2026-10-12', to: '2026-11-30' });
  const special = desoto.find((m) => m.date === '2026-10-19');
  assert.equal(special.time, null);
  assert.equal(special.special, true);
  assert.ok(desoto.some((m) => m.date === '2026-10-20' && m.time === '18:00' && m.type === 'regular'));
  assert.ok(desoto.every((m) => m.date >= '2026-10-12' && m.date <= '2026-11-30'));

  const mesquite = parseIcal(text('ical-mesquite.ics'), { from: '2026-10-12', to: '2026-12-31' });
  assert.ok(mesquite.length >= 4);
  assert.ok(mesquite.every((m) => m.label === 'City Council Meeting' && m.time === '19:00'));

  const hp = parseIcal(text('ical-highlandpark.ics'), { from: '2026-10-12', to: '2026-12-31' });
  assert.deepEqual(hp.map((m) => [m.date, m.time]), [
    ['2026-10-20', '08:00'],
    ['2026-11-03', '08:00'],
    ['2026-12-01', '08:00'],
  ]);
  const cedarHill = parseIcal(text('ical-cedarhill.ics'), { from: '2026-10-12', to: '2026-10-31' });
  assert.match(cedarHill[0].detailUrl, /^https:\/\/www\.cedarhilltx\.com\/calendar\.aspx\?EID=/);
});

test('DocsPublished: UTC meeting dates become Central times; agenda sections are read in order', () => {
  const list = parseDocsPublishedList(json('docspublished-documents.json'), AGENDA_SOURCES['fort-worth'][0]);
  const oct13 = list.find((m) => m.date === '2026-10-13');
  assert.equal(oct13.time, '18:00');
  assert.equal(oct13.agendaUrl, 'https://docspublished.io/fortworthtexas/document/95175214-f833-4db3-8a77-0a8e49312ab9');
  assert.ok(!list.some((m) => /committee|corporation/i.test(m.label)), 'committees are not the council');
  const doc = parseDocsPublishedDocument(json('docspublished-document.json'), { agendaUrl: oct13.agendaUrl });
  assert.equal(doc.postedOn, '2026-10-07');
  assert.ok(doc.items.length > 0 && doc.items.length <= 12);
  assert.ok(!doc.items.some((i) => /placeholder|front page|public comments|adjournment/i.test(i.title)));
});

test('OnBase: upcoming council meetings with their times; agenda items and the posting date', () => {
  const list = parseOnBaseList(text('onbase-list.html'), AGENDA_SOURCES.frisco[0]);
  const oct20 = list.filter((m) => m.date === '2026-10-20');
  assert.deepEqual(
    oct20.map((m) => [m.time, m.type, Boolean(m.agendaUrl)]),
    [
      ['15:45', 'work-session', false],
      ['17:00', 'regular', false],
    ],
  );
  assert.ok(!list.some((m) => /zoning|hike/i.test(m.label)));
  const agenda = parseOnBaseAgenda(text('onbase-agenda.html'), { agendaUrl: 'https://agenda.friscotexas.gov/OnBaseAgendaOnline/Meetings/ViewMeeting?id=5699&doctype=1' });
  assert.equal(agenda.postedOn, '2026-08-26');
  assert.ok(agenda.items.some((i) => /Fiscal Year 2027 Annual Budget/.test(i.title)));
  assert.ok(!agenda.items.some((i) => /^roll call|^recess into closed session/i.test(i.title)));
});

test('Agenda Center: posting dates only, quorum notices and packets skipped', () => {
  const southlake = parseAgendaCenter(text('agendacenter-southlake.html'), AGENDA_SOURCES.southlake[0]);
  const oct6 = southlake.filter((m) => m.date === '2026-10-06');
  assert.equal(oct6.length, 1, 'the packet row is not a second agenda');
  assert.deepEqual({ label: oct6[0].label, time: oct6[0].time, posted: oct6[0].agendaPostedOn, postingOnly: oct6[0].postingOnly }, { label: 'City Council', time: null, posted: '2026-09-30', postingOnly: true });
  assert.equal(oct6[0].agendaUrl, 'https://www.cityofsouthlake.com/AgendaCenter/ViewFile/Agenda/_10062026-2333');
  assert.ok(!southlake.some((m) => m.date === '2026-10-12'), 'Oct 12 is only a quorum notice');
});

test('Municode: council meetings with a posted agenda link the accessible HTML agenda; committees are left out', () => {
  const list = parseMunicodePublish(text('municode-publish-gptx.html'), { cid: 'GPTX' });
  assert.deepEqual(
    list.map((m) => [m.date, m.time, m.label]),
    [['2026-09-15', '16:30', 'City Council Meeting']],
  );
  assert.equal(list[0].agendaUrl, 'https://meetings.municode.com/adaHtmlDocument/index?cc=GPTX&me=15087b7c10424fdfb8525026236bb13d&ip=False');
  const { items } = parseMunicodeAda(text('municode-ada-gptx.html'), { agendaUrl: list[0].agendaUrl });
  assert.ok(items.length > 0 && items.length <= 12);
  assert.ok(!items.some((i) => /^minutes of/i.test(i.title)), 'minutes are procedural');
  assert.ok(!items.some((i) => /reviewed by the city council/i.test(i.summary || '')), 'committee review notes are not summaries');
});

test('posting dates nobody published: kept from earlier runs, or "today" only when a recent run saw the change', () => {
  const now = { today: '2026-10-11', nowMs: Date.parse('2026-10-11T17:00:00Z') };
  const prev = { lastSuccessAt: '2026-10-11T11:00:00Z', meetings: [{ key: 'a', date: '2026-10-13', agendaUrl: null }, { key: 'b', date: '2026-10-14', agendaUrl: 'https://x.gov/b', agendaPostedOn: '2026-10-09' }] };
  const fresh = () => [
    { key: 'a', date: '2026-10-13', agendaUrl: 'https://x.gov/a' },
    { key: 'b', date: '2026-10-14', agendaUrl: 'https://x.gov/b' },
    { key: 'c', date: '2026-10-20', agendaUrl: 'https://x.gov/c' },
    { key: 'd', date: '2026-10-21', agendaUrl: null },
  ];
  assert.deepEqual(
    datePostings(fresh(), prev, now).map((m) => m.agendaPostedOn || null),
    ['2026-10-11', '2026-10-09', '2026-10-11', null],
  );
  // With no previous run, or one too old to compare with, the date stays unknown.
  assert.deepEqual(datePostings(fresh(), null, now).map((m) => m.agendaPostedOn || null), [null, null, null, null]);
  assert.deepEqual(
    datePostings(fresh(), { ...prev, lastSuccessAt: '2026-10-01T00:00:00Z' }, now).map((m) => m.agendaPostedOn || null),
    [null, '2026-10-09', null, null],
  );
});

test('combining sources: a later source fills gaps in the main one and never merges two meetings of one source', () => {
  const ical = parseIcal(text('ical-mesquite.ics'), { from: '2026-10-12', to: '2026-10-31' });
  const posting = { key: 'ac:1', date: '2026-10-19', time: null, label: 'City Council', type: 'regular', postingOnly: true, agendaUrl: 'https://example.gov/a.pdf', agendaPostedOn: '2026-10-14' };
  const combined = combineSourceMeetings([ical, [posting]]);
  const oct19 = combined.filter((m) => m.date === '2026-10-19');
  assert.equal(oct19.length, 1);
  assert.equal(oct19[0].agendaUrl, 'https://example.gov/a.pdf');
  assert.equal(oct19[0].time, '19:00');
  const mansfield = parseCivicClerkEvents(json('civicclerk-events-mansfieldtx.json'), { tenant: 'mansfieldtx' });
  assert.equal(combineSourceMeetings([mansfield]).filter((m) => m.date === '2026-11-09').length, 2);
  // A cancellation notice from a later source cancels the meeting; its PDF is not an agenda.
  const notice = { ...posting, key: 'ac:2', label: 'City Council Meeting - Cancelled', cancelled: true, agendaUrl: 'https://example.gov/notice.pdf' };
  const cancelled = combineSourceMeetings([ical, [notice]]).filter((m) => m.date === '2026-10-19');
  assert.equal(cancelled.length, 1);
  assert.equal(cancelled[0].cancelled, true);
  assert.equal(cancelled[0].agendaUrl, null);
});

/* ----------------------------------------------------------------------------------------- */
/* Fetching                                                                                  */
/* ----------------------------------------------------------------------------------------- */

/** A fake fetch serving fixtures by URL, recording every request. */
function fakeFetch(routes, log = []) {
  let active = 0;
  return async (url, init) => {
    const host = new URL(url).host;
    log.push({ url, host, ua: init.headers['User-Agent'], concurrentOnHost: log.filter((r) => r.host === host && r.open).length });
    const entry = log[log.length - 1];
    entry.open = true;
    active += 1;
    await new Promise((r) => setTimeout(r, 2));
    active -= 1;
    entry.open = false;
    const route = routes.find(([re]) => re.test(url));
    if (!route) return { ok: false, status: 404, headers: new Map(), text: async () => 'not found' };
    const [, body, status = 200] = route;
    if (body instanceof Error) throw body;
    return { ok: status < 400, status, headers: new Map(), text: async () => (typeof body === 'string' ? body : JSON.stringify(body)) };
  };
}

const SOURCES = {
  sachse: [{ platform: 'civicclerk', tenant: 'sachsetx' }],
  euless: [{ platform: 'civicclerk', tenant: 'eulesstx' }],
  dallas: [{ platform: 'legistar', client: 'cityofdallas', bodies: { 138: 'regular' } }],
  irving: [{ platform: 'none', reason: 'blocked' }],
  plano: [{ platform: 'legistar', client: 'plano', bodies: { 138: 'regular' } }],
};
const NOW = new Date('2026-10-11T12:00:00Z');

test('buildAgendaSnapshot: polite requests, items fetched once, failures keep the previous entry, never rejects', async () => {
  const log = [];
  const routes = [
    [/sachsetx\.api\.civicclerk\.com\/v1\/Events/, json('civicclerk-events-sachsetx.json')],
    [/eulesstx\.api\.civicclerk\.com\/v1\/Events/, json('civicclerk-events-eulesstx.json')],
    [/eulesstx\.api\.civicclerk\.com\/v1\/Meetings\/2186/, json('civicclerk-meeting-eulesstx.json')],
    [/webapi\.legistar\.com\/v1\/cityofdallas\/events\?/, json('legistar-events-cityofdallas.json')],
    [/webapi\.legistar\.com\/v1\/cityofdallas\/events\/4349\/eventitems/, json('legistar-items-cityofdallas.json')],
    [/webapi\.legistar\.com\/v1\/plano\//, 'Server Error', 500],
  ];
  const previous = {
    schema: 1,
    cities: { plano: { status: 'ok', fetchedAt: '2026-10-10T12:00:00Z', lastSuccessAt: '2026-10-10T12:00:00Z', meetings: [{ key: 'legistar:1', date: '2026-10-12', time: '19:00', label: 'City Council', type: 'regular' }] } },
  };
  const snap = await buildAgendaSnapshot({ fetch: fakeFetch(routes, log), previous, now: NOW, sources: SOURCES, gapMs: 5, timeoutMs: 1000, retryDelayMs: 5 });
  assert.equal(isAgendaSnapshot(snap), true);
  assert.deepEqual(snapshotCounts(snap), { ok: 3, stale: 1, error: 0, unsupported: 1 });
  assert.ok(log.every((r) => r.ua === AGENDA_USER_AGENT), 'every request names the app');
  assert.ok(log.every((r) => r.concurrentOnHost === 0), 'one request at a time per host');
  // The Legistar filter is a date range around today.
  assert.ok(log.some((r) => /EventDate\+ge\+datetime'2026-09-27'\+and\+EventDate\+lt\+datetime'2026-12-10'/.test(r.url)));
  const euless = snap.cities.euless.meetings[0];
  assert.equal(euless.agendaPostedOn, '2026-10-07');
  assert.ok(euless.items.length > 0);
  assert.equal(snap.cities.sachse.meetings[0].cancelled, true);
  assert.equal(snap.cities.irving.status, 'unsupported');
  assert.equal(snap.cities.plano.status, 'stale');
  assert.equal(snap.cities.plano.meetings.length, 1, 'the failing city keeps what it had');
  assert.match(snap.cities.plano.error, /HTTP 500/);
  assert.deepEqual(failingAgendaSources(snap).map((f) => f.cityId), ['plano']);
  // Retried once, not hammered.
  assert.equal(log.filter((r) => r.host === 'webapi.legistar.com' && /plano/.test(r.url)).length, 2);

  // A second run reuses unchanged agenda items instead of fetching them again.
  const log2 = [];
  const again = await buildAgendaSnapshot({ fetch: fakeFetch(routes, log2), previous: snap, now: NOW, sources: SOURCES, gapMs: 5, timeoutMs: 1000, retryDelayMs: 5 });
  assert.ok(!log2.some((r) => /Meetings\/2186|eventitems/.test(r.url)));
  assert.deepEqual(again.cities.euless.meetings[0].items, euless.items);
  // Items from an older parser are fetched again.
  const log3 = [];
  await buildAgendaSnapshot({ fetch: fakeFetch(routes, log3), previous: { ...snap, parserVersion: 0 }, now: NOW, sources: SOURCES, gapMs: 5, timeoutMs: 1000, retryDelayMs: 5 });
  assert.ok(log3.some((r) => /Meetings\/2186/.test(r.url)));
});

test('buildAgendaSnapshot: a city failing for longer than two weeks is an error with no meetings; network errors never throw', async () => {
  const previous = { schema: 1, cities: { sachse: { status: 'stale', fetchedAt: '2026-09-01T00:00:00Z', lastSuccessAt: '2026-09-01T00:00:00Z', meetings: [{ key: 'x', date: '2026-10-19', time: '18:30', label: 'City Council Meeting', type: 'regular' }] } } };
  const snap = await buildAgendaSnapshot({ fetch: fakeFetch([[/./, new Error('getaddrinfo ENOTFOUND')]]), previous, now: NOW, sources: { sachse: SOURCES.sachse }, gapMs: 1, timeoutMs: 500, retryDelayMs: 5 });
  assert.equal(snap.cities.sachse.status, 'error');
  assert.deepEqual(snap.cities.sachse.meetings, []);
  assert.equal(snap.cities.sachse.lastSuccessAt, '2026-09-01T00:00:00Z');
});

test('createPoliteFetch: spaces requests to one host and gives up after the run deadline', async () => {
  const starts = [];
  const fetch = async (url) => {
    starts.push(Date.now());
    return { ok: true, status: 200, headers: new Map(), text: async () => '{}' };
  };
  const http = createPoliteFetch({ fetch, gapMs: 40 });
  await Promise.all([http.json('https://a.example/1'), http.json('https://a.example/2'), http.json('https://a.example/3')]);
  assert.ok(starts[1] - starts[0] >= 35 && starts[2] - starts[1] >= 35);
  const late = createPoliteFetch({ fetch, deadline: Date.now() - 1 });
  await assert.rejects(late.json('https://a.example/4'), /budget/);
});

/* ----------------------------------------------------------------------------------------- */
/* Merging                                                                                   */
/* ----------------------------------------------------------------------------------------- */

/** A small valid city: a Monday 6:30 PM regular meeting and a 5 PM work session before it. */
function testCity(extra = {}) {
  return {
    cityId: 'testville',
    name: 'Testville',
    county: 'Dallas',
    website: 'https://testville.example.gov',
    cityHall: { name: 'City Hall', address: '1 Main St', lat: 32.9, lng: -96.8 },
    meetings: [
      { type: 'work-session', label: 'City Council Work Session', recurrence: { kind: 'weekly', weekday: 1, time: '17:00' }, openToPublicComment: false },
      { type: 'regular', label: 'City Council Regular Meeting', recurrence: { kind: 'weekly', weekday: 1, time: '18:30' } },
    ],
    scheduleExceptions: [{ date: '2026-10-26', status: 'cancelled', note: 'Recess.' }],
    publicComment: { summary: 'Fill out a card.', howToRegister: 'Hand it to the clerk.' },
    agendaItems: [{ title: 'Adopt the parks master plan', topics: ['parks-recreation'], meetingDate: '2026-10-19', meetingLabel: 'City Council Regular Meeting' }],
    confidence: 'high',
    ...extra,
  };
}

function entry(meetings) {
  return { status: 'ok', fetchedAt: '2026-10-11T12:00:00Z', lastSuccessAt: '2026-10-11T12:00:00Z', sourceUrl: 'https://testville.legistar.com/Calendar.aspx', meetings };
}

test('merge: posted items attach to their meeting; a cancelled meeting shows as cancelled; nothing is cancelled for being missing', () => {
  const city = testCity();
  const live = entry([
    {
      key: 'l:1',
      date: '2026-10-19',
      time: '18:30',
      label: 'City Council',
      type: 'regular',
      agendaUrl: 'https://testville.legistar.com/a.pdf',
      detailUrl: 'https://testville.legistar.com/MeetingDetail.aspx?ID=1',
      agendaPostedOn: '2026-10-15',
      items: [
        { title: 'Adopt the parks master plan', topics: ['parks-recreation'] },
        { title: 'Approve a new bus shelter program', topics: ['transit'], url: 'https://testville.legistar.com/L.aspx?ID=2' },
      ],
    },
    { key: 'l:2', date: '2026-10-19', time: '17:00', label: 'City Council Work Session', type: 'work-session', items: [{ title: 'Briefing on the library expansion', topics: ['education-libraries'] }] },
    { key: 'l:3', date: '2026-11-02', time: '18:30', label: 'City Council', type: 'regular', cancelled: true, agendaUrl: 'https://testville.legistar.com/notice.pdf', agendaPostedOn: '2026-10-28' },
  ]);
  const plan = planLiveAgenda(city, live);
  assert.ok(plan);
  const merged = applyLivePlan(city, plan, { locale: 'en' });
  assert.deepEqual(validateCity(merged), []);
  const oct19 = expandCityMeetings(merged, '2026-10-19', '2026-10-19');
  const regular = oct19.find((o) => o.type === 'regular');
  const work = oct19.find((o) => o.type === 'work-session');
  assert.deepEqual(
    regular.agendaItems.map((i) => i.title),
    ['Adopt the parks master plan', 'Approve a new bus shelter program'],
    'the curated item is not duplicated',
  );
  assert.deepEqual(work.agendaItems.map((i) => i.title), ['Briefing on the library expansion']);
  assert.equal(regular.agendaItems[1].auto, true);
  const info = liveMeetingFor(merged, regular);
  assert.equal(info.agendaPostedOn, '2026-10-15');
  assert.equal(info.agendaUrl, 'https://testville.legistar.com/a.pdf');
  assert.equal(info.fetchedAt, '2026-10-11T12:00:00Z');

  const nov2 = expandCityMeetings(merged, '2026-11-02', '2026-11-02');
  assert.equal(liveMeetingFor(merged, nov2.find((o) => o.type === 'regular')).agendaUrl, undefined, 'a cancellation notice is not shown as an agenda');
  assert.equal(nov2.find((o) => o.type === 'regular').status, 'cancelled');
  assert.match(nov2.find((o) => o.type === 'regular').note, /cancelled/);
  assert.equal(nov2.find((o) => o.type === 'work-session').status, 'scheduled', 'only the meeting the source cancels');
  // Nov 9 is not in the source at all and stays scheduled.
  assert.ok(expandCityMeetings(merged, '2026-11-09', '2026-11-09').every((o) => o.status === 'scheduled'));
});

test('merge: special meetings our rules lack are added with the source’s name; postings without a time never add one', () => {
  const city = testCity();
  const live = entry([
    { key: 's:1', date: '2026-10-22', time: '12:00', label: 'Joint Special Called Meeting with Testville ISD', type: 'regular', special: true },
    { key: 's:2', date: '2026-10-23', time: null, label: 'City Council', type: 'regular', postingOnly: true, agendaUrl: 'https://testville.example.gov/a.pdf' },
    // A special meeting named like the council's own meeting that day takes the generic name.
    { key: 's:3', date: '2026-10-19', time: '12:00', label: 'City Council Regular Meeting', type: 'regular', special: true },
  ]);
  const merged = applyLivePlans([city], planLiveAgendas([city], { schema: 1, cities: { testville: live } }), { locale: 'en' })[0];
  const oct22 = expandCityMeetings(merged, '2026-10-22', '2026-10-22');
  assert.equal(oct22.length, 1);
  assert.deepEqual({ label: oct22[0].label, time: oct22[0].time, status: oct22[0].status, speak: oct22[0].openToPublicComment }, { label: 'Joint Special Called Meeting with Testville ISD', time: '12:00', status: 'special', speak: false });
  assert.equal(liveMeetingFor(merged, oct22[0]).kind, 'added');
  assert.equal(expandCityMeetings(merged, '2026-10-23', '2026-10-23').length, 0);
  const oct19 = expandCityMeetings(merged, '2026-10-19', '2026-10-19');
  const ids = oct19.map((o) => o.id);
  assert.equal(new Set(ids).size, ids.length, 'meeting ids stay unique');
  assert.deepEqual(oct19.map((o) => [o.time, o.status, o.label]), [
    ['12:00', 'special', 'Special council meeting'],
    ['17:00', 'scheduled', 'City Council Work Session'],
    ['18:30', 'scheduled', 'City Council Regular Meeting'],
  ]);
});

test('merge: a meeting our data cancelled that the source lists again comes back at its own time, never as a second meeting', () => {
  // Our data has a recess on Oct 26 (both meetings). The portal lists one 2 PM entry for the evening.
  const city = testCity();
  const live = entry([{ key: 'r:1', date: '2026-10-26', time: '14:00', label: 'City Council Meeting', type: 'regular', agendaUrl: 'https://testville.legistar.com/oct26.pdf', items: [{ title: 'Approve a new bus shelter program', topics: ['transit'] }] }]);
  const plan = planLiveAgenda(city, live);
  assert.ok(plan);
  const merged = applyLivePlan(city, plan, { locale: 'en' });
  assert.deepEqual(validateCity(merged), []);
  const oct26 = expandCityMeetings(merged, '2026-10-26', '2026-10-26');
  assert.deepEqual(
    oct26.map((o) => [o.time, o.status, o.label, o.openToPublicComment]),
    [
      ['17:00', 'scheduled', 'City Council Work Session', false],
      ['18:30', 'scheduled', 'City Council Regular Meeting', true],
    ],
    'the recess is lifted; no special meeting at the source’s 2 PM',
  );
  const regular = oct26[1];
  assert.match(regular.note, /listed again/i);
  assert.equal(regular.id, 'testville:2026-10-26:city-council-regular-meeting', 'the same id the meeting always had');
  assert.equal(liveMeetingFor(merged, regular).kind, 'reinstated');
  assert.equal(liveMeetingFor(merged, regular).agendaUrl, 'https://testville.legistar.com/oct26.pdf');
  assert.deepEqual(regular.agendaItems.map((i) => i.title), ['Approve a new bus shelter program']);
  // Other cancellations stay; in Spanish the note is translated and the ids are the same.
  const es = applyLivePlan(city, plan, { locale: 'es' });
  const esRegular = expandCityMeetings(es, '2026-10-26', '2026-10-26').find((o) => o.type === 'regular');
  assert.equal(esRegular.id, regular.id);
  assert.match(esRegular.note, /Volvió a aparecer/);
  // A source that lists the meeting as cancelled changes nothing, and a special meeting is not a reinstatement.
  assert.equal(planLiveAgenda(city, entry([{ date: '2026-10-26', time: '18:30', label: 'City Council', type: 'regular', cancelled: true }])), null);
  const special = applyLivePlan(city, planLiveAgenda(city, entry([{ date: '2026-10-26', time: '10:00', label: 'Special Called Meeting', type: 'regular', special: true }])), { locale: 'en' });
  assert.deepEqual(
    expandCityMeetings(special, '2026-10-26', '2026-10-26').map((o) => [o.time, o.status]),
    [
      ['10:00', 'special'],
      ['17:00', 'cancelled'],
      ['18:30', 'cancelled'],
    ],
  );
});

test('merge: meetings past the end of a published calendar read like the council’s own, not as special meetings', () => {
  const city = testCity({
    meetings: [
      { type: 'regular', label: 'City Council Day Meeting', recurrence: { kind: 'custom', weekday: 2, time: '13:00', dates: ['2026-10-27', '2026-12-08'] } },
      { type: 'regular', label: 'City Council Evening Meeting', recurrence: { kind: 'custom', weekday: 2, time: '18:00', dates: ['2026-10-13', '2026-11-10'] }, openToPublicComment: true },
      { type: 'work-session', label: 'City Council Work Session', recurrence: { kind: 'custom', weekday: 2, time: '14:00', dates: ['2026-11-03'] }, openToPublicComment: false },
    ],
    scheduleExceptions: [],
    agendaItems: [],
  });
  assert.equal(calendarThrough(city), '2026-12-08');
  const live = entry([
    { key: 'j:1', date: '2027-01-12', time: '17:00', label: 'City Council Meeting', type: 'regular', items: [{ title: 'Adopt the 2027 transit plan', topics: ['transit'] }] },
    { key: 'j:2', date: '2027-01-26', time: '10:00', label: 'City Council Meeting', type: 'regular' },
    { key: 'j:3', date: '2027-01-19', time: '09:00', label: 'City Council Work Session', type: 'work-session' },
    { key: 'j:4', date: '2027-01-21', time: '16:00', label: 'Budget Town Hall Meeting', type: 'town-hall' },
  ]);
  const merged = applyLivePlan(city, planLiveAgenda(city, live), { locale: 'en' });
  assert.deepEqual(validateCity(merged), []);
  const jan = expandCityMeetings(merged, '2027-01-01', '2027-01-31');
  assert.deepEqual(
    jan.map((o) => [o.date, o.time, o.status, o.label, o.openToPublicComment]),
    [
      ['2027-01-12', '18:00', 'scheduled', 'City Council Evening Meeting', true],
      ['2027-01-19', '14:00', 'scheduled', 'City Council Work Session', false],
      ['2027-01-21', '16:00', 'scheduled', 'Budget Town Hall Meeting', false],
      ['2027-01-26', '13:00', 'scheduled', 'City Council Day Meeting', true],
    ],
  );
  assert.equal(jan[0].id, 'testville:2027-01-12:city-council-evening-meeting');
  assert.match(jan[0].note, /Listed on the city/);
  assert.deepEqual(jan[0].agendaItems.map((i) => i.title), ['Adopt the 2027 transit plan']);
  assert.equal(liveMeetingFor(merged, jan[0]).kind, 'added');
  assert.equal(calendarThrough(merged), '2027-01-26', 'the calendar now reaches the added meetings');
  // A meeting already on the calendar is never added twice.
  const twice = planLiveAgenda(merged, entry([{ date: '2027-01-12', time: '18:00', label: 'City Council Meeting', type: 'regular' }]));
  assert.ok(twice.exceptions.every((ex) => ex.status !== 'added'));
});

test('merge: Mansfield’s CivicClerk entry for Oct 26 brings back the 6 PM meeting our data had as a recess', () => {
  // The curated record (labels as build-data cleans them) and the portal's saved response.
  const mansfield = {
    cityId: 'mansfield',
    name: 'Mansfield',
    county: 'Tarrant',
    website: 'https://www.mansfieldtexas.gov',
    cityHall: { name: 'Mansfield City Hall', address: '1200 E. Broad St.', lat: 32.5632, lng: -97.1417 },
    meetings: [
      { type: 'regular', label: 'Regular City Council Meeting', recurrence: { kind: 'nth-weekday', weekday: 1, ordinals: [2, 4], time: '18:00' }, openToPublicComment: true, notes: 'Citizen Comments comes right after the invocation.' },
      { type: 'work-session', label: 'Council Work Session and Executive Session', recurrence: { kind: 'nth-weekday', weekday: 1, ordinals: [2, 4], time: '14:00' }, openToPublicComment: false, notes: 'Posted on the same agenda as the regular meeting.' },
    ],
    scheduleExceptions: [
      { date: '2026-10-26', status: 'recess', note: 'No fourth-Monday meeting appears on the city calendar or the CivicClerk portal for October.' },
      { date: '2026-11-23', status: 'recess', note: 'Thanksgiving week.' },
    ],
    publicComment: { summary: 'Fill out the online speaker card.', howToRegister: 'Online or in person.', timeLimitMinutes: 5 },
    confidence: 'high',
  };
  const meetings = parseCivicClerkEvents(json('civicclerk-events-mansfieldtx.json'), { tenant: 'mansfieldtx' });
  assert.ok(meetings.some((m) => m.date === '2026-10-26' && m.time === '14:00' && !m.special), 'the portal lists one 2 PM entry for Oct 26');
  const plan = planLiveAgenda(mansfield, entry(meetings));
  const merged = applyLivePlan(mansfield, plan, { locale: 'en' });
  const oct26 = expandCityMeetings(merged, '2026-10-26', '2026-10-26');
  assert.deepEqual(
    oct26.map((o) => [o.time, o.status, o.label, o.openToPublicComment]),
    [
      ['14:00', 'scheduled', 'Council Work Session and Executive Session', false],
      ['18:00', 'scheduled', 'Regular City Council Meeting', true],
    ],
  );
  assert.ok(!oct26.some((o) => o.status === 'special'), 'no invented 2 PM special meeting');
  assert.match(oct26[1].note, /listed again/i);
  // The Thanksgiving recess is not on the portal and stays.
  assert.ok(expandCityMeetings(merged, '2026-11-23', '2026-11-23').every((o) => o.status === 'cancelled'));
  // Nov 9's two portal entries pair with the work session and the 6 PM meeting.
  assert.deepEqual(
    expandCityMeetings(merged, '2026-11-09', '2026-11-09').map((o) => [o.time, o.status, liveMeetingFor(merged, o).kind]),
    [
      ['14:00', 'scheduled', 'matched'],
      ['18:00', 'scheduled', 'matched'],
    ],
  );
});

test('merge in another language: notes are translated, ids and item placement stay the same', () => {
  const city = testCity();
  const live = entry([
    { key: 'a', date: '2026-10-19', time: '18:30', label: 'City Council', type: 'regular', items: [{ title: 'Approve a new bus shelter program', topics: ['transit'] }] },
    { key: 'b', date: '2026-11-02', time: '18:30', label: 'City Council', type: 'regular', cancelled: true },
    { key: 'c', date: '2026-10-21', time: '12:00', label: 'City Council Special Meeting', type: 'regular', special: true },
  ]);
  const plan = planLiveAgenda(city, live);
  const strings = { 'City Council Special Meeting': 'Sesión especial del Concejo Municipal' };
  const es = applyLivePlan(city, plan, { strings, locale: 'es' });
  const en = applyLivePlan(city, plan, { locale: 'en' });
  const cancelled = expandCityMeetings(es, '2026-11-02', '2026-11-02').find((o) => o.type === 'regular');
  assert.match(cancelled.note, /cancelada/);
  const special = expandCityMeetings(es, '2026-10-21', '2026-10-21')[0];
  assert.equal(special.label, 'Sesión especial del Concejo Municipal');
  assert.equal(special.id, expandCityMeetings(en, '2026-10-21', '2026-10-21')[0].id);
  assert.deepEqual(
    expandCityMeetings(es, '2026-10-19', '2026-10-19')
      .find((o) => o.type === 'regular')
      .agendaItems.map((i) => i.title),
    ['Adopt the parks master plan', 'Approve a new bus shelter program'],
  );
});

test('merge ignores what it cannot trust: bad snapshots, failed cities, malformed meetings', () => {
  const city = testCity();
  assert.equal(planLiveAgendas([city], null).size, 0);
  assert.equal(planLiveAgendas([city], { schema: 99, cities: {} }).size, 0);
  assert.equal(planLiveAgenda(city, { status: 'error', meetings: [{ date: '2026-10-19', time: '18:30', label: 'x' }] }), null);
  assert.equal(planLiveAgenda(city, entry([{ date: 'soon', label: 'City Council' }, { date: '2026-10-19', label: '' }])), null);
  const bad = entry([{ date: '2026-10-19', time: '18:30', label: 'City Council', type: 'regular', agendaUrl: 'javascript:alert(1)', items: [{ title: 'Approve', topics: ['not-a-topic'] }] }]);
  const plan = planLiveAgenda(city, bad);
  assert.equal(plan.items.length, 0);
  assert.equal(plan.live[0].agendaUrl, undefined);
  // Cities with no plan come back as the same object.
  const list = [city];
  assert.equal(applyLivePlans(list, new Map()), list);
});
