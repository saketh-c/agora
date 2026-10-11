import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PREP_STEPS, PREP_MAX_MEETINGS, normalizePrep, prepSummary, withPrepStep } from '../src/lib/prep.js';

test('steps toggle per meeting and summarize as N of 4 with the next step', () => {
  let prep = {};
  prep = withPrepStep(prep, 'plano:2026-10-12:x', 'write', true, '2026-10-09T00:00:00.000Z');
  let s = prepSummary(prep, 'plano:2026-10-12:x');
  assert.equal(s.done, 1);
  assert.equal(s.total, PREP_STEPS.length);
  assert.equal(s.next, 'signup');
  prep = withPrepStep(prep, 'plano:2026-10-12:x', 'signup', true);
  assert.equal(prepSummary(prep, 'plano:2026-10-12:x').next, 'practice');
  prep = withPrepStep(prep, 'plano:2026-10-12:x', 'after', true);
  assert.equal(prepSummary(prep, 'plano:2026-10-12:x').done, 2, 'the after step is tracked but not counted');
  prep = withPrepStep(prep, 'plano:2026-10-12:x', 'write', false);
  assert.equal(prepSummary(prep, 'plano:2026-10-12:x').steps.write, false);
  assert.deepEqual(prepSummary(prep, 'other').done, 0);
});

test('old entries are dropped beyond the cap, newest kept', () => {
  const raw = {};
  for (let i = 0; i < PREP_MAX_MEETINGS + 5; i++) raw[`m${i}`] = { write: true, at: new Date(Date.UTC(2026, 0, 1 + i)).toISOString() };
  const n = normalizePrep(raw);
  assert.equal(Object.keys(n).length, PREP_MAX_MEETINGS);
  assert.ok(n[`m${PREP_MAX_MEETINGS + 4}`]);
  assert.equal(n.m0, undefined);
});
