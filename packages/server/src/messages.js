import { DICTIONARIES, LOCALES, isLocale, stripIsolates, t } from '@agora/core';

/**
 * Human-readable text for API responses, in every language the app speaks.
 *
 * The words live in core's dictionaries, in the `api` namespace
 * (packages/core/src/i18n/locales/<code>/api.js), so they are translated, checked and
 * counted with every other string (scripts/i18n-check.mjs, i18n-todo.mjs, i18n-apply.mjs).
 * They describe the API itself (a rate limit, an address lookup that found nothing) to any
 * client, and every error response also carries a stable `code`, so the web app can show its
 * own dictionary text instead of this one.
 */
export const API_MESSAGES = Object.freeze(Object.fromEntries(LOCALES.map(({ code }) => [code, (DICTIONARIES[code] && DICTIONARIES[code].api) || DICTIONARIES.en.api])));

/**
 * An API message in the given language (English when the language or key is unknown), with
 * {param} placeholders filled in. Plain text without bidi isolates: it goes out as JSON.
 * @param {keyof API_MESSAGES['en']} key
 * @param {Record<string, string|number>} [params]
 * @param {string} [lang]
 */
export function apiMessage(key, params, lang) {
  const known = DICTIONARIES.en.api && Object.prototype.hasOwnProperty.call(DICTIONARIES.en.api, key);
  if (!known) return key;
  return stripIsolates(t(`api.${key}`, params || undefined, isLocale(lang) ? lang : 'en'));
}
