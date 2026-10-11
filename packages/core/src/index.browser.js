/**
 * @agora/core for the browser build: the same API as ./index.js, with only the English
 * dictionary bundled. Call loadLocale(code) before switching to another language; each one
 * is its own chunk, fetched once (see i18n/runtime.js).
 */
export * from './api.js';
