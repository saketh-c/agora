import { test } from 'node:test';
import assert from 'node:assert/strict';
import { LOCALES } from '@agora/core';
import { API_MESSAGES, apiMessage } from '../src/messages.js';

const params = (s) =>
  [...String(s).matchAll(/\{(\w+)\}/g)]
    .map((m) => m[1])
    .sort()
    .join(',');

test('API messages exist in every language with the same parameters and no em or en dashes', () => {
  const keys = Object.keys(API_MESSAGES.en).sort();
  for (const { code } of LOCALES) {
    const dict = API_MESSAGES[code];
    assert.ok(dict, `missing ${code}`);
    assert.deepEqual(Object.keys(dict).sort(), keys, `${code} has the same keys as en`);
    for (const key of keys) {
      assert.ok(dict[key].trim(), `${code}.${key} is empty`);
      assert.equal(params(dict[key]), params(API_MESSAGES.en[key]), `${code}.${key} params`);
      assert.doesNotMatch(dict[key], /[\u2013\u2014]/, `${code}.${key} has a dash`);
    }
  }
});

test('apiMessage fills parameters and falls back to English', () => {
  assert.match(apiMessage('rateLimited', { seconds: 42 }, 'es'), /42 segundos/);
  assert.match(apiMessage('rateLimited', { seconds: 42 }, 'klingon'), /42 seconds/);
  assert.equal(apiMessage('geoOutside', { place: 'Houston, TX' }, 'vi').startsWith('Houston, TX nằm ngoài'), true);
});
