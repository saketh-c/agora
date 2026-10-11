/**
 * Bundled data plus the core engine, so the app works even with no API server.
 * Network-only features (news, geocoding, AI) live in api.js and degrade gracefully.
 *
 * Pages read cities through useCities() (lib/DataProvider.jsx), which localizes them. The
 * raw English records here are only for parsing English source text (see rawCity()).
 */
import citiesFile from '@data/cities.json';
import { todayStr } from '@agora/core';

export const CITIES = Object.freeze(citiesFile.cities);
export const DATA_GENERATED_AT = citiesFile.generatedAt;
const RAW_BY_ID = new Map(CITIES.map((c) => [c.cityId, c]));

/**
 * The oldest "last verified" date across every city ('YYYY-MM-DD'), so a footer line such as
 * "Schedules verified Sep 10, 2026" never claims more than the data supports.
 */
export const SCHEDULES_VERIFIED_ON = CITIES.map((c) => c.lastVerified).filter(Boolean).sort()[0] || null;

/** Central-time calendar date, refreshed on every call so long-open tabs stay correct. */
export function today() {
  return todayStr('America/Chicago');
}

/** The current instant as an ISO string: pass it as `now` to the engine so ended meetings drop out. */
export function nowIso() {
  return new Date().toISOString();
}

/** The untranslated (English) record for a city id. Use it to parse English source text only. */
export function rawCity(id) {
  return RAW_BY_ID.get(id) || null;
}
