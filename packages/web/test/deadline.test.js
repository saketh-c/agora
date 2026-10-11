import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { clockFromText, parseDeadlineRule, signupDeadline } from '../src/lib/deadline.js';

const cities = JSON.parse(readFileSync(new URL('../../../data/cities.json', import.meta.url))).cities;
const byId = (id) => cities.find((c) => c.cityId === id);
const meeting = (date, time, extra = {}) => ({ date, time, openToPublicComment: true, status: 'scheduled', ...extra });

test('clock times', () => {
  assert.equal(clockFromText('4 p.m.'), '16:00');
  assert.equal(clockFromText('4:30 pm'), '16:30');
  assert.equal(clockFromText('noon'), '12:00');
  assert.equal(clockFromText('12 a.m.'), '00:00');
  assert.equal(clockFromText('soon'), null);
});

test('only advance deadlines with no at-the-meeting option produce a rule', () => {
  assert.deepEqual(parseDeadlineRule(byId('plano').publicComment.deadline), { kind: 'sameDay', time: '16:00' });
  assert.deepEqual(parseDeadlineRule(byId('fort-worth').publicComment.deadline), { kind: 'hoursBefore', minutes: 120 });
  assert.deepEqual(parseDeadlineRule(byId('dallas').publicComment.deadline), { kind: 'businessDayBefore', time: '17:00' });
  // A card at the meeting (or in-person sign-up) means there is nothing to warn about.
  for (const id of ['sachse', 'richardson', 'mesquite', 'carrollton', 'irving', 'mansfield']) assert.equal(parseDeadlineRule(byId(id).publicComment.deadline), null, id);
  const flagged = cities.filter((c) => parseDeadlineRule(c.publicComment && c.publicComment.deadline)).map((c) => c.cityId);
  assert.deepEqual(flagged.sort(), ['dallas', 'fort-worth', 'plano']);
});

test('deadlines resolve against the meeting and now (Central time)', () => {
  const plano = byId('plano').publicComment.deadline;
  const m = meeting('2026-10-12', '19:00');
  assert.deepEqual(signupDeadline(plano, m, '2026-10-12T20:00:00Z'), { date: '2026-10-12', time: '16:00', passed: false }); // 3 PM CDT
  assert.equal(signupDeadline(plano, m, '2026-10-12T21:30:00Z').passed, true); // 4:30 PM CDT
  assert.deepEqual(signupDeadline(byId('fort-worth').publicComment.deadline, meeting('2026-10-13', '10:00')), { date: '2026-10-13', time: '08:00', passed: false });
  // Dallas meets Wednesdays; the deadline is the Tuesday before. A Monday meeting reaches back to Friday.
  assert.equal(signupDeadline(byId('dallas').publicComment.deadline, meeting('2026-10-14', '09:00')).date, '2026-10-13');
  assert.equal(signupDeadline(byId('dallas').publicComment.deadline, meeting('2026-10-12', '09:00')).date, '2026-10-09');
  // Watch-only and cancelled meetings have no sign-up.
  assert.equal(signupDeadline(plano, meeting('2026-10-12', '17:00', { openToPublicComment: false })), null);
  assert.equal(signupDeadline(plano, meeting('2026-10-12', '19:00', { status: 'cancelled' })), null);
  // A "deadline" at or after the start is not an advance deadline.
  assert.equal(signupDeadline(plano, meeting('2026-10-12', '15:00')), null);
});
