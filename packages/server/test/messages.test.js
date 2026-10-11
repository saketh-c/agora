import { test } from 'node:test';
import assert from 'node:assert/strict';
import { LOCALES, exactPluralCategories, isPluralForms } from '@agora/core';
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
      // A message that counts ({n}) may be plural forms in a language that has them (Arabic
      // "rateLimited"); each form is checked. A form for a category only one number reaches
      // may leave that number out ("ثانية واحدة", one second).
      const value = dict[key];
      const forms = isPluralForms(value) ? Object.entries(value) : [['', value]];
      if (isPluralForms(value)) assert.match(API_MESSAGES.en[key], /\{(?:n|count)\}/, `${code}.${key} has plural forms but counts nothing`);
      const exact = exactPluralCategories(code);
      for (const [category, text] of forms) {
        const label = category ? `${code}.${key}.${category}` : `${code}.${key}`;
        assert.equal(typeof text, 'string', label);
        assert.ok(text.trim(), `${label} is empty`);
        const optional = exact.includes(category) ? ['n', 'count'] : [];
        const drop = (list) => list.split(',').filter((p) => p && !optional.includes(p)).join(',');
        assert.equal(drop(params(text)), drop(params(API_MESSAGES.en[key])), `${label} params`);
        assert.doesNotMatch(text, /[\u2013\u2014]/, `${label} has a dash`);
      }
    }
  }
});

test('apiMessage fills parameters and falls back to English', () => {
  assert.match(apiMessage('rateLimited', { n: 42 }, 'es'), /42 segundos/);
  assert.match(apiMessage('rateLimited', { n: 42 }, 'klingon'), /42 seconds/);
  assert.equal(apiMessage('geoOutside', { place: 'Houston, TX' }, 'vi').startsWith('Houston, TX nằm ngoài'), true);
  // Arabic picks the plural form by the number, and the JSON text carries no bidi isolates.
  assert.match(apiMessage('rateLimited', { n: 1 }, 'ar'), /ثانية واحدة\.$/);
  assert.match(apiMessage('rateLimited', { n: 5 }, 'ar'), /5 ثوانٍ\.$/);
  assert.doesNotMatch(apiMessage('rateLimited', { n: 42 }, 'ar'), /[\u2066-\u2069]/);
});
