/**
 * Regression tests for translation quality: dictionary wording that was wrong or awkward,
 * plural-safe Spanish, standard time styles, and the city-data translation memories
 * (data/i18n/es.json and vi.json) checked against the built data the app loads.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { DICTIONARIES, t, tn } from '../src/i18n/index.js';
import { translationCoverage } from '../src/i18n/data.js';
import { buildComment } from '../src/civics.js';
import { loadCities, loadTranslations, REPO_ROOT } from '../src/load-node.js';
import { looksLikeUntranslatedEnglish, dataResidue } from '../../../scripts/i18n-check.mjs';
import { extractReport, cityFieldValues } from '../../../scripts/i18n-extract.mjs';

/** Every string in a dictionary, with its dotted path. */
function strings(node, at = '') {
  if (typeof node === 'string') return [[at, node]];
  if (Array.isArray(node)) return node.flatMap((v, i) => strings(v, `${at}[${i}]`));
  if (node && typeof node === 'object') return Object.entries(node).flatMap(([k, v]) => strings(v, at ? `${at}.${k}` : k));
  return [];
}

test('Spanish dictionary errors from the audit stay fixed', () => {
  // Three DFW mayors are women; the label must not assign a gender to {name}.
  for (const key of ['city.mayor', 'cli.mayor']) {
    const text = t(key, { name: 'Mattie Parker' }, 'es');
    assert.doesNotMatch(text, /\balcalde\b|\bAlcalde\b/, `${key}: ${text}`);
    assert.match(text, /Mattie Parker/);
  }
  // "Punto y aparte" is a paragraph break; the drill means a full stop between sentences.
  assert.doesNotMatch(t('rehearse.findings.pace_fast.drill', undefined, 'es'), /punto y aparte/);
});

test('Spanish count strings read correctly when the count is 1', () => {
  const one = [
    t('rehearse.findings.over_time.title', { over: 1, limit: 3 }, 'es'),
    t('rehearse.strengths.few_fillers', { total: 1 }, 'es'),
    t('rehearse.findings.script_skipped.detail', { skipped: 1 }, 'es'),
    tn('news.headlinesShown', 1, undefined, 'es'),
    tn('rehearse.historyTitle', 1, undefined, 'es'),
  ];
  for (const text of one) assert.doesNotMatch(text, /\b1 (segundos|muletillas|líneas|titulares|puntos|intentos)\b/, text);
  assert.equal(tn('rehearse.historyTitle', 1, undefined, 'es'), 'Tu intento (1)');
  assert.equal(tn('rehearse.historyTitle', 3, undefined, 'es'), 'Tus intentos (3)');
});

test('the Vietnamese comment opens with one greeting, not two', () => {
  for (const timeOfDay of ['morning', 'afternoon', 'evening']) {
    for (const school of ['', 'Plano East Senior High']) {
      const first = buildComment({ name: 'An', school, cityName: 'Plano', topicId: 'housing', timeOfDay, locale: 'vi' }).split('\n')[0];
      assert.equal((first.match(/chào/gi) || []).length, 1, first);
      assert.match(first, /An/);
    }
  }
});

test('es and vi dictionaries write times the way each language does', () => {
  for (const code of ['es', 'vi']) {
    for (const [key, value] of strings(DICTIONARIES[code])) {
      assert.doesNotMatch(value, /\b\d{1,2}(:\d{2})?\s?(AM|PM)\b/, `${code} ${key} uses English AM/PM: ${value}`);
      if (code === 'vi') assert.doesNotMatch(value, /\b\d{1,2}(:\d{2})?\s?[ap]\.m\./, `vi ${key} uses a 12-hour time: ${value}`);
    }
  }
  assert.equal(t('format.pm', undefined, 'es'), 'p.m.');
});

test('i18n-check warns about English left in a translation, not about names or codes', () => {
  assert.equal(looksLikeUntranslatedEnglish('Show all {n}'), true);
  assert.equal(looksLikeUntranslatedEnglish('Remote comment'), true);
  for (const legit of ['Dallas-Fort Worth', 'Plano East Senior High', '{city} Senior High', '{city}, Texas', 'Plano, Fort Worth, Garland', 'Video', 'Agendas', 'id', 'PPM', 'a.m.', '']) {
    assert.equal(looksLikeUntranslatedEnglish(legit), false, legit);
  }
  assert.deepEqual(dataResidue('se cambia al Tuesday, Nov 10', 'es'), ['English month', 'English weekday']);
  assert.deepEqual(dataResidue('lúc 6 p.m.', 'vi'), ['12-hour a.m./p.m. time']);
  assert.deepEqual(dataResidue("con el asunto 'Public Comment - Tuesday, [date]'", 'es'), [], 'a required English email subject is quoted and allowed');
  assert.deepEqual(dataResidue("antes del punto Citizens' Input, asunto 'Public Comment - Tuesday, [date]'", 'vi'), [], 'a possessive apostrophe does not open a quote');
});

test('every meeting label the app shows is translated', () => {
  const cities = loadCities();
  for (const code of ['es', 'vi']) {
    const memory = loadTranslations(code);
    const missing = [...new Set(cities.flatMap((c) => (c.meetings || []).map((m) => m.label)))].filter((label) => !memory[label]);
    assert.deepEqual(missing, [], `${code} meeting labels without a translation`);
  }
});

test('city-data translations carry no English month names, weekdays, or 12-hour times', () => {
  for (const code of ['es', 'vi']) {
    const memory = loadTranslations(code);
    const residue = Object.entries(memory).filter(([, tr]) => dataResidue(tr, code).length).map(([en]) => en.slice(0, 80));
    assert.deepEqual(residue, [], `${code} translations with English dates or times`);
  }
});

test('i18n-extract counts what the app shows: built labels in, raw long labels out', () => {
  const cities = loadCities();
  const memories = { es: loadTranslations('es'), vi: loadTranslations('vi') };
  const report = extractReport(cities, memories);
  const shown = new Set(report.strings);
  for (const city of cities) for (const m of city.meetings || []) assert.ok(shown.has(m.label), `${city.cityId}: ${m.label}`);
  for (const code of ['es', 'vi']) {
    const coverage = translationCoverage(cities, memories[code]);
    assert.equal(report.locales[code].total, coverage.total, 'same strings as the runtime localizer');
    assert.equal(report.locales[code].translated, coverage.translated);
  }

  // A shortened label with no translation is reported, field by field.
  const city = {
    cityId: 'x',
    meetings: [{ label: 'Pre-Council Meeting', notes: 'Watch only.' }],
    publicComment: { summary: 'Fill out a card.' },
    scheduleExceptions: [],
    youthPrograms: [],
    agendaItems: [],
  };
  assert.deepEqual(cityFieldValues(city), [
    ['publicComment.summary', 'Fill out a card.'],
    ['meetings[].label', 'Pre-Council Meeting'],
    ['meetings[].notes', 'Watch only.'],
  ]);
  const partial = extractReport([city], { es: { 'Fill out a card.': 'Llena una tarjeta.', 'Watch only.': 'Solo para ver.' } }).locales.es;
  assert.deepEqual(partial.missing, ['Pre-Council Meeting']);
  assert.deepEqual(partial.fields['meetings[].label'], { total: 1, missing: 1 });
  assert.equal(partial.translated, 2);
  assert.equal(partial.valuesTotal, 3);
});

test('i18n-extract --check is read-only and its exit code reports untranslated strings', () => {
  const sourceFile = path.join(REPO_ROOT, 'data', 'i18n', 'source-strings.json');
  const before = existsSync(sourceFile) ? readFileSync(sourceFile, 'utf8') : null;
  const run = spawnSync(process.execPath, [path.join(REPO_ROOT, 'scripts', 'i18n-extract.mjs'), '--check', '--json'], { encoding: 'utf8' });
  const report = JSON.parse(run.stdout);
  assert.equal(report.source, 'data/cities.json');
  const incomplete = Object.values(report.locales).some((l) => l.missing.length);
  assert.equal(run.status, incomplete ? 1 : 0, run.stderr);
  assert.equal(existsSync(sourceFile) ? readFileSync(sourceFile, 'utf8') : null, before, '--check never writes');
});
