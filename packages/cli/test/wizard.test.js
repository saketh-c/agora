import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PassThrough } from 'node:stream';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, statSync, existsSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { setLocale, cityPoint } from '@agora/core';
import { loadCities } from '@agora/core/node';
import { runWizard } from '../src/wizard.js';
import { setColorEnabled } from '../src/ui.js';

setColorEnabled(false);
const cities = loadCities();
const hall = (id) => cityPoint(cities.find((c) => c.cityId === id));
const here = path.dirname(fileURLToPath(import.meta.url));
const bin = path.join(here, '..', 'bin', 'agora.js');

/** Streams standing in for a terminal or a pipe, with everything written collected. */
function streams({ tty = false } = {}) {
  const input = new PassThrough();
  const output = new PassThrough();
  let text = '';
  output.on('data', (d) => (text += d));
  if (tty) {
    input.isTTY = true;
    input.setRawMode = () => input;
    output.isTTY = true;
    output.columns = 100;
  }
  return { input, output, text: () => text };
}

/**
 * Run the wizard with answers arriving all at once, as when they are pasted or piped in.
 * Nothing touches the network or the real preferences file.
 */
async function wizard(answers, { existing = {}, lang = 'en', geocode = async () => null, end = true, save } = {}) {
  const s = streams();
  const saved = [];
  const calls = [];
  const result = runWizard(cities, existing, lang, {
    input: s.input,
    output: s.output,
    geocode: async (q, list) => {
      calls.push(q);
      return geocode(q, list);
    },
    save:
      save ||
      ((p) => {
        saved.push(JSON.parse(JSON.stringify(p)));
        return '/fake/.agora.json';
      }),
  });
  s.input.write(answers.map((a) => `${a}\n`).join(''));
  if (end) s.input.end();
  const r = await result;
  setLocale('en');
  return { ...r, saved, geocodeCalls: calls, out: s.text() };
}

const ANSWERS = ['en', '1,2', 'y', 'n', 'y', 'y', 'Plano', '', '10', 'n', 'y'];

test('answers piped in all at once are used in order and saved', async () => {
  const r = await wizard(ANSWERS);
  assert.equal(r.code, 0);
  assert.equal(r.saved.length, 1);
  const p = r.saved[0];
  assert.deepEqual(p.interests, ['housing', 'transit']);
  assert.deepEqual(p.availability, { evenings: true, daytime: false, weekends: true });
  assert.equal(p.student, true);
  assert.equal(p.homeCityId, 'plano');
  assert.deepEqual(p.location, hall('plano'));
  assert.equal(p.maxMiles, 10);
  assert.equal(p.canSpeakOnly, false);
  assert.equal(p.virtualOk, true);
  assert.match(r.out, /Saved\./);
  // Piped answers are echoed so the transcript reads like a conversation.
  assert.match(r.out, /\[15\] 10\n/);
});

test('yes and no work in Spanish and Vietnamese', async () => {
  const es = await wizard(['es', '1', 's', 'no', 'sí', 'S', 'Plano', '', '15', 'n', 's'], { lang: 'es' });
  assert.equal(es.code, 0);
  assert.deepEqual(es.saved[0].availability, { evenings: true, daytime: false, weekends: true });
  assert.equal(es.saved[0].student, true);
  assert.equal(es.saved[0].canSpeakOnly, false);
  assert.equal(es.saved[0].virtualOk, true);
  assert.equal(es.saved[0].lang, 'es');
  assert.match(es.out, /\(s\/n\)/);

  const vi = await wizard(['vi', '1', 'c', 'k', 'có', 'không', 'Plano', '', '15', 'co', 'khong'], { lang: 'vi' });
  assert.equal(vi.code, 0);
  assert.deepEqual(vi.saved[0].availability, { evenings: true, daytime: false, weekends: true });
  assert.equal(vi.saved[0].student, false);
  assert.equal(vi.saved[0].canSpeakOnly, true);
  assert.equal(vi.saved[0].virtualOk, false);
  assert.match(vi.out, /\(c\/k\)/);

  // English y/n still works after choosing another language.
  const mixed = await wizard(['es', '1', 'y', 'n', 'y', 'n', 'Plano', '', '15', 'y', 'n']);
  assert.deepEqual(mixed.saved[0].availability, { evenings: true, daytime: false, weekends: true });
  assert.equal(mixed.saved[0].student, false);
});

test('an unclear answer is asked again instead of counting as no', async () => {
  const r = await wizard(['fr', 'en', '99', '1', 'maybe', 'y', 'n', 'y', 'y', 'park', 'Plno', 'Plano', '', 'far', '12', 'n', 'y']);
  assert.equal(r.code, 0);
  assert.match(r.out, /Type en, es, or vi\./);
  assert.match(r.out, /Use numbers from 1 to 17/);
  assert.match(r.out, /Please answer y \(yes\) or n \(no\)\./);
  assert.match(r.out, /"park" matches more than one city: Highland Park, University Park/);
  assert.match(r.out, /Did you mean Plano\?/);
  assert.match(r.out, /Type a number of miles/);
  assert.equal(r.saved[0].availability.evenings, true);
  assert.equal(r.saved[0].maxMiles, 12);
});

test('input that ends early cancels without saving', async () => {
  const r = await wizard(['en', '1', 'y']);
  assert.equal(r.code, 1);
  assert.equal(r.saved.length, 0);
  assert.match(r.out, /Setup cancelled\. Nothing was saved\./);
});

test('Ctrl+C in a terminal cancels without saving or a stack trace', async () => {
  const s = streams({ tty: true });
  const saved = [];
  const result = runWizard(cities, {}, 'es', { input: s.input, output: s.output, geocode: async () => null, save: (p) => saved.push(p) });
  s.input.write('es\r1\r');
  await new Promise((r) => setTimeout(r, 50));
  s.input.write('\u0003');
  const r = await result;
  setLocale('en');
  assert.equal(r.code, 130);
  assert.equal(saved.length, 0);
  assert.match(s.text(), /Se canceló la configuración\. No se guardó nada\./);
  assert.doesNotMatch(s.text(), /AbortError|\n\s+at /);
});

test('Ctrl+D on an empty line in a terminal cancels', async () => {
  const s = streams({ tty: true });
  const result = runWizard(cities, {}, 'en', { input: s.input, output: s.output, geocode: async () => null, save: () => assert.fail('must not save') });
  s.input.write('en\r');
  await new Promise((r) => setTimeout(r, 50));
  s.input.write('\u0004');
  const r = await result;
  assert.equal(r.code, 1);
  assert.match(s.text(), /Setup cancelled/);
});

test('a new home city replaces the old location instead of keeping it', async () => {
  const existing = { homeCityId: 'plano', location: hall('plano'), locationLabel: 'Plano City Hall' };
  const r = await wizard(['en', '1', 'y', 'n', 'y', 'y', 'Dallas', '', '15', 'n', 'y'], { existing });
  assert.equal(r.saved[0].homeCityId, 'dallas');
  assert.deepEqual(r.saved[0].location, hall('dallas'));
  assert.equal(r.saved[0].locationLabel, 'Dallas City Hall');
  assert.deepEqual(r.geocodeCalls, [], 'Enter means city hall, not the old label sent to the geocoder');
  assert.doesNotMatch(r.out, /\[Plano City Hall\]/);
});

test('an earlier bad save (another city hall for this home city) heals on the next run', async () => {
  const existing = { homeCityId: 'dallas', location: hall('plano'), locationLabel: 'Plano City Hall' };
  const r = await wizard(['en', '1', 'y', 'n', 'y', 'y', 'Dallas', '', '15', 'n', 'y'], { existing });
  assert.deepEqual(r.saved[0].location, hall('dallas'));
});

test('the same home city keeps a saved address when you press Enter', async () => {
  const spot = { lat: 33.05, lng: -96.75 };
  const existing = { homeCityId: 'plano', location: spot, locationLabel: 'Preston Road, Plano' };
  const r = await wizard(['en', '1', 'y', 'n', 'y', 'y', 'Plano', '', '15', 'n', 'y'], { existing });
  assert.match(r.out, /\[Preston Road, Plano\]/);
  assert.deepEqual(r.saved[0].location, spot);
  assert.equal(r.saved[0].locationLabel, 'Preston Road, Plano');
  assert.deepEqual(r.geocodeCalls, []);
});

test('a geocoder miss or failure falls back to city hall, and found labels are cleaned', async () => {
  const miss = await wizard(['en', '1', 'y', 'n', 'y', 'y', 'Dallas', '75201', '15', 'n', 'y'], { existing: { homeCityId: 'dallas', location: { lat: 32.9, lng: -96.8 }, locationLabel: 'Old spot' } });
  assert.match(miss.out, /No match inside DFW, using city hall instead\./);
  assert.deepEqual(miss.saved[0].location, hall('dallas'));

  const down = await wizard(['en', '1', 'y', 'n', 'y', 'y', 'Dallas', '75201', '15', 'n', 'y'], {
    geocode: async () => {
      throw new Error('ENOTFOUND');
    },
  });
  assert.match(down.out, /Could not reach the map service, using city hall instead\./);
  assert.deepEqual(down.saved[0].location, hall('dallas'));

  const found = await wizard(['en', '1', 'y', 'n', 'y', 'y', 'Dallas', '75201', '15', 'n', 'y'], { geocode: async () => ({ lat: 32.79, lng: -96.8, label: 'Main St\u001b[2J, Dallas' }) });
  assert.deepEqual(found.saved[0].location, { lat: 32.79, lng: -96.8 });
  assert.equal(found.saved[0].locationLabel, 'Main St, Dallas');
});

test('a file that cannot be written is reported', async () => {
  const r = await wizard(ANSWERS, {
    save: () => {
      throw new Error('EACCES: permission denied');
    },
  });
  assert.equal(r.code, 1);
  assert.match(r.out, /Could not save your preferences: EACCES/);
});

test('agora setup reads piped answers and saves a file only its owner can read', () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'agora-setup-test-'));
  const file = path.join(dir, 'prefs.json');
  const env = { ...process.env, NO_COLOR: '1', AGORA_PREFS: file };
  delete env.AGORA_LANG;
  const r = spawnSync(process.execPath, [bin, 'setup'], { env, input: `${ANSWERS.join('\n')}\n`, encoding: 'utf8' });
  assert.equal(r.status, 0, r.stderr);
  assert.ok(existsSync(file));
  if (process.platform !== 'win32') assert.equal(statSync(file).mode & 0o777, 0o600);
  const saved = JSON.parse(readFileSync(file, 'utf8'));
  assert.equal(saved.homeCityId, 'plano');
  assert.deepEqual(saved.availability, { evenings: true, daytime: false, weekends: true });

  const short = spawnSync(process.execPath, [bin, 'setup'], { env: { ...env, AGORA_PREFS: path.join(dir, 'other.json') }, input: 'en\n1\n', encoding: 'utf8' });
  assert.equal(short.status, 1);
  assert.match(short.stdout, /Setup cancelled/);
  assert.doesNotMatch(short.stderr, /\n\s+at /);
  assert.ok(!existsSync(path.join(dir, 'other.json')));
});
