import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { expandCityMeetings } from '@agora/core';
import { buildIcs, eventDetails, foldLine, googleCalendarUrl, outlookUrl } from '../src/lib/ics.js';

const cities = JSON.parse(readFileSync(new URL('../../../data/cities.json', import.meta.url))).cities;
const plano = cities.find((c) => c.cityId === 'plano');
const meeting = expandCityMeetings(plano, '2026-10-12', '2026-10-12').find((m) => m.time === '19:00');
const deadline = { date: '2026-10-12', time: '16:00', passed: false };
const now = new Date('2026-10-11T15:00:00Z');
const unfold = (text) => text.replace(/\r\n /g, '');
const octets = (s) => new TextEncoder().encode(s).length;

test('long lines are folded at 75 octets without splitting characters', () => {
  assert.equal(foldLine('SHORT:x'), 'SHORT:x');
  const long = `DESCRIPTION:${'Tiếng Việt có dấu, '.repeat(12)}`;
  const folded = foldLine(long);
  const parts = folded.split('\r\n');
  assert.ok(parts.length > 1);
  for (const p of parts) assert.ok(octets(p) <= 75, `${octets(p)} octets`);
  for (const p of parts.slice(1)) assert.ok(p.startsWith(' '));
  assert.equal(unfold(folded), long);
});

test('the .ics file: folded lines, CRLF, two reminders, correct Central times', () => {
  const ics = buildIcs(meeting, plano, { deadline: null, now });
  assert.ok(ics.endsWith('\r\n'));
  for (const line of ics.split('\r\n')) assert.ok(octets(line) <= 75, line);
  const flat = unfold(ics);
  assert.match(flat, /DTSTART:20261013T000000Z/); // 7 PM CDT
  assert.match(flat, /UID:plano:2026-10-12:.*@agora/);
  assert.equal((flat.match(/BEGIN:VALARM/g) || []).length, 2);
  assert.match(flat, /TRIGGER:-P1D/);
  assert.match(flat, /TRIGGER:-PT2H/);
  assert.equal((flat.match(/BEGIN:VEVENT/g) || []).length, 1, 'no deadline, no second event');
});

test('a sign-up deadline adds its own event with a reminder and a link', () => {
  const flat = unfold(buildIcs(meeting, plano, { deadline, now }));
  assert.equal((flat.match(/BEGIN:VEVENT/g) || []).length, 2);
  assert.match(flat, /UID:.*-signup@agora/);
  assert.match(flat, /DTSTART:20261012T210000Z/); // 4 PM CDT
  assert.match(flat, /SUMMARY:Sign-up to speak closes: Plano City Council/);
  assert.match(flat, /URL:https:\/\/forms\.plano\.gov/);
  assert.match(flat, /Sign-up closes Mon\\, Oct 12\\, 4:00\\u00a0PM|Sign-up closes Mon\\, Oct 12\\, 4:00.PM/);
  // A deadline that has passed adds nothing.
  assert.equal((unfold(buildIcs(meeting, plano, { deadline: { ...deadline, passed: true }, now })).match(/BEGIN:VEVENT/g) || []).length, 1);
});

test('Google Calendar and Outlook links carry the times, place and details', () => {
  const g = new URL(googleCalendarUrl(meeting, plano, { deadline }));
  assert.equal(g.hostname, 'calendar.google.com');
  assert.equal(g.searchParams.get('action'), 'TEMPLATE');
  assert.equal(g.searchParams.get('dates'), '20261013T000000Z/20261013T020000Z');
  assert.match(g.searchParams.get('text'), /^Plano /);
  assert.match(g.searchParams.get('details'), /Sign-up closes/);
  assert.equal(g.searchParams.get('location'), meeting.location);

  const o = new URL(outlookUrl(meeting, plano, { deadline: null }));
  assert.equal(o.hostname, 'outlook.live.com');
  assert.equal(o.searchParams.get('startdt'), '2026-10-13T00:00:00Z');
  assert.equal(o.searchParams.get('enddt'), '2026-10-13T02:00:00Z');
  assert.equal(o.searchParams.get('rru'), 'addevent');
  assert.doesNotMatch(o.searchParams.get('body'), /Sign-up closes/);
  assert.equal(new URL(outlookUrl(meeting, plano, { work: true })).hostname, 'outlook.office.com');
});

test('details mention the sign-up link only while sign-up is open', () => {
  assert.match(eventDetails(meeting, plano, { deadline }), /Sign up: https:\/\/forms\.plano\.gov/);
  assert.doesNotMatch(eventDetails(meeting, plano, { deadline: { ...deadline, passed: true } }), /Sign up:/);
});
