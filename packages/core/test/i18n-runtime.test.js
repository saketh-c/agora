/**
 * The translation runtime on its own, as the web app's build uses it: English is built in,
 * other languages load on demand. (This file never imports ../src/i18n/index.js, which
 * registers every language up front for Node.)
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { getLocale, hasLocale, isLocale, LOCALES, loadLocale, setLocale, t } from '../src/i18n/runtime.js';

test('only English is loaded until another language is asked for; t() falls back to English meanwhile', async () => {
  assert.deepEqual(
    LOCALES.map((l) => l.code),
    ['en', 'es', 'vi'],
  );
  assert.equal(isLocale('es'), true, 'a language the app speaks');
  assert.equal(hasLocale('en'), true);
  assert.equal(hasLocale('es'), false, 'not downloaded yet');
  assert.equal(t('nav.meetings', undefined, 'es'), 'Meetings');

  assert.equal(await loadLocale('es'), true);
  assert.equal(hasLocale('es'), true);
  assert.equal(t('nav.meetings', undefined, 'es'), 'Reuniones');
  assert.equal(await loadLocale('es'), true, 'loading again is a no-op');
  assert.equal(await loadLocale('xx'), false, 'an unknown language never loads');

  setLocale('es');
  assert.equal(getLocale(), 'es');
  assert.equal(t('nav.meetings'), 'Reuniones');
  setLocale('en');
});
