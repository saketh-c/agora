import { test } from 'node:test';
import assert from 'node:assert/strict';
import { normalizeState, normalizeProfile, normalizeUi, makeProfile, cleanName, displayName, isSetupComplete, exportPayload, readImport } from '../src/lib/profiles.js';
import { setLocale } from '@agora/core';

const stored = {
  activeId: 'p_b',
  profiles: [
    { id: 'p_a', name: 'My setup', lang: 'es', onboarded: true, prefs: { homeCityId: 'plano', location: { lat: 33, lng: -96.7 } }, ui: { checklist: [1, 2], rehearsals: [{ at: '2026-10-01', seconds: 100 }], lastDraft: { text: 'Hola' }, prep: { 'plano:2026-10-12:x': { write: true, at: '2026-10-09T00:00:00.000Z' } }, prepMeeting: 'plano:2026-10-12:x', custom: { kept: true } } },
    { id: 'p_b', name: 'Debate team', lang: 'vi', onboarded: false, prefs: {}, ui: {} },
  ],
};

test('every ui field survives normalization (reload), unknown keys included', () => {
  const s = normalizeState(stored);
  const a = s.profiles[0];
  assert.deepEqual(a.ui.checklist, [1, 2]);
  assert.equal(a.ui.rehearsals.length, 1);
  assert.deepEqual(a.ui.lastDraft, { text: 'Hola' });
  assert.equal(a.ui.prep['plano:2026-10-12:x'].write, true);
  assert.equal(a.ui.prepMeeting, 'plano:2026-10-12:x');
  assert.deepEqual(a.ui.custom, { kept: true });
  assert.equal(s.activeId, 'p_b');
  // normalizing twice changes nothing
  assert.deepEqual(normalizeState(s), s);
});

test('default names are never stored: older English (or translated) defaults migrate to empty', () => {
  assert.equal(normalizeState(stored).profiles[0].name, '');
  assert.equal(cleanName('Mi configuración'), '');
  assert.equal(cleanName('  Ana  '), 'Ana');
  setLocale('es');
  assert.equal(displayName({ name: '' }), 'Mi configuración');
  assert.equal(displayName({ name: 'Ana' }), 'Ana');
  setLocale('en');
  assert.equal(displayName({ name: '' }), 'My setup');
});

test('a new profile takes the language being read, not the device language', () => {
  assert.equal(makeProfile({}, 'vi').lang, 'vi');
  assert.equal(makeProfile({ lang: 'es' }, 'vi').lang, 'es');
  assert.equal(makeProfile({ lang: 'xx' }, 'en').lang, 'en');
});

test('setup is complete only with a place', () => {
  assert.equal(isSetupComplete({ onboarded: true, prefs: { homeCityId: 'plano' } }), true);
  assert.equal(isSetupComplete({ onboarded: true, prefs: {} }), false);
  assert.equal(isSetupComplete({ onboarded: false, prefs: { homeCityId: 'plano' } }), false);
});

test('export and import keep ui', () => {
  const p = normalizeProfile(stored.profiles[0]);
  const file = JSON.parse(JSON.stringify(exportPayload(p)));
  const back = makeProfile(readImport(file), 'en');
  assert.deepEqual(back.ui.rehearsals, p.ui.rehearsals);
  assert.deepEqual(back.ui.lastDraft, p.ui.lastDraft);
  assert.deepEqual(back.ui.prep, p.ui.prep);
  assert.throws(() => readImport({ nope: 1 }), /not an Agora profile/);
});

test('ui repairs bad shapes instead of trusting them', () => {
  const ui = normalizeUi({ checklist: 'x', rehearsals: 'y', lastDraft: [1], prep: { m: { write: 'yes', bogus: true } }, lang: 'es' });
  assert.deepEqual(ui.checklist, []);
  assert.deepEqual(ui.rehearsals, []);
  assert.equal(ui.lastDraft, null);
  assert.deepEqual(ui.prep, {});
  assert.equal('lang' in ui, false);
});

test('duplicate ids and an unknown active id are repaired', () => {
  const s = normalizeState({ activeId: 'gone', profiles: [{ id: 'same' }, { id: 'same' }] });
  assert.notEqual(s.profiles[0].id, s.profiles[1].id);
  assert.equal(s.activeId, s.profiles[0].id);
  assert.equal(normalizeState({ profiles: [] }), null);
  assert.equal(normalizeState('garbage'), null);
});
