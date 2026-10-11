import { test } from 'node:test';
import assert from 'node:assert/strict';
import { youthApplyState, youthApplyRank, APPLY_STATUSES, CLOSING_SOON_DAYS } from '../src/youth.js';
import { validateCity } from '../src/validate.js';
import { loadCities } from '../src/load-node.js';

const TODAY = '2026-10-11';

test('application state: open windows count down, passed deadlines close, rolling stays open', () => {
  assert.deepEqual(youthApplyState({ applyStatus: 'open', applyBy: '2026-10-15' }, TODAY), { state: 'closing', applyBy: '2026-10-15', applyOpens: null, daysLeft: 4, canApply: true });
  assert.equal(youthApplyState({ applyStatus: 'open', applyBy: '2026-11-30' }, TODAY).state, 'open');
  assert.equal(youthApplyState({ applyStatus: 'open', applyBy: `2026-10-${11 + CLOSING_SOON_DAYS}` }, TODAY).state, 'closing');
  assert.deepEqual(youthApplyState({ applyStatus: 'open', applyBy: '2026-10-10' }, TODAY), { state: 'closed', applyBy: '2026-10-10', applyOpens: null, daysLeft: null, canApply: false });
  assert.equal(youthApplyState({ applyStatus: 'open' }, TODAY).state, 'open', 'no deadline: still open');
  assert.equal(youthApplyState({ applyStatus: 'rolling' }, TODAY).canApply, true);
  assert.equal(youthApplyState({ applyStatus: 'closed', applyBy: '2026-09-24' }, TODAY).canApply, false);
});

test('application state: a closed program whose next window should have opened is unknown, not closed', () => {
  assert.equal(youthApplyState({ applyStatus: 'closed', applyOpens: '2026-11' }, TODAY).state, 'closed');
  assert.equal(youthApplyState({ applyStatus: 'closed', applyOpens: '2026-11' }, '2026-11-01').state, 'unknown');
  assert.equal(youthApplyState({ applyStatus: 'closed', applyOpens: '2027-05-03' }, '2027-05-03').state, 'unknown');
  assert.equal(youthApplyState({}, TODAY).state, 'unknown');
  assert.equal(youthApplyState({ applyStatus: 'maybe', applyBy: 'soon' }, TODAY).state, 'unknown');
});

test('programs you can apply to sort first', () => {
  const states = ['closed', 'rolling', 'unknown', 'open', 'closing'];
  assert.deepEqual(states.slice().sort((a, b) => youthApplyRank(a) - youthApplyRank(b)), ['closing', 'open', 'rolling', 'unknown', 'closed']);
});

test('validation rejects malformed application fields', () => {
  const city = {
    cityId: 'x',
    name: 'X',
    county: 'Dallas',
    website: 'https://x.example.gov',
    cityHall: { address: '1 Main', lat: 32.9, lng: -96.8 },
    meetings: [{ type: 'regular', label: 'Council', recurrence: { kind: 'weekly', weekday: 1, time: '18:00' } }],
    publicComment: { summary: 's', howToRegister: 'h' },
    confidence: 'high',
    youthPrograms: [{ name: 'Teen council', applyStatus: 'soon', applyBy: '2026-13-01', applyOpens: 'spring' }],
  };
  const errors = validateCity(city);
  assert.ok(errors.some((e) => /applyStatus "soon"/.test(e)));
  assert.ok(errors.some((e) => /applyBy must be YYYY-MM-DD/.test(e)));
  assert.ok(errors.some((e) => /applyOpens must be YYYY-MM or YYYY-MM-DD/.test(e)));
  city.youthPrograms = [{ name: 'Teen council', applyStatus: 'closed', applyBy: '2026-09-24', applyOpens: '2027-03' }];
  assert.deepEqual(validateCity(city), []);
});

test('every youth program in the data says whether it is taking applications', () => {
  const programs = loadCities().flatMap((c) => (c.youthPrograms || []).map((p) => ({ ...p, cityId: c.cityId })));
  assert.ok(programs.length > 0);
  for (const p of programs) assert.ok(APPLY_STATUSES.includes(p.applyStatus), `${p.cityId}: ${p.name}`);
  // The link audit found Carrollton's Youth in Government application closed on Sept 24, 2026.
  const ygc = programs.find((p) => p.cityId === 'carrollton' && /Youth in Government/.test(p.name));
  assert.equal(youthApplyState(ygc, TODAY).state, 'closed');
  // Rowlett's junior board seats close Oct 15: four days left on Oct 11.
  const rowlett = programs.find((p) => p.cityId === 'rowlett' && /Junior Alternate/.test(p.name));
  assert.equal(youthApplyState(rowlett, TODAY).state, 'closing');
});
