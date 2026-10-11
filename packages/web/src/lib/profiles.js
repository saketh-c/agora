/**
 * The profile model behind lib/store.jsx, as pure functions so it can be tested in Node.
 *
 * Stored under one localStorage key: { activeId, profiles: Profile[] }.
 * Profile: { id, name, email, lang, createdAt, onboarded, prefs, ui }.
 *  - name is '' until the person types one. The display name ("My setup", "Mi configuración")
 *    is resolved at display time with displayName(), so a default never leaks into drafts in
 *    another language.
 *  - onboarded means setup is complete: a home city (with its city hall as the location) was
 *    chosen. Only completeSetup / setHomeCity in the store set it.
 *  - ui keeps every field: checklist, rehearsals, lastDraft, prep, prepMeeting, plus any
 *    other plain JSON a page stores, so nothing is lost on reload, export or import.
 */
import { defaultPrefs, normalizePrefs, isLocale, LOCALES, t } from '@agora/core';
import { normalizePrep } from './prep.js';

export const PROFILES_KEY = 'agora.profiles.v1';
export const HISTORY_MAX = 20;
export const NAME_MAX = 40;

const isPlainObject = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);

/** Every language's default profile name, used to migrate names saved by older versions. */
function defaultNames() {
  return new Set(LOCALES.map((l) => String(t('profile.defaultName', undefined, l.code)).toLowerCase()));
}

export function cleanName(value) {
  const s = String(value == null ? '' : value).trim().slice(0, NAME_MAX);
  return defaultNames().has(s.toLowerCase()) ? '' : s;
}

/** An email is only ever kept to prefill your own drafts, so a loose shape check is enough. */
export function cleanEmail(value) {
  const s = String(value || '').trim().slice(0, 120);
  return s && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s) ? s : '';
}

/** The name to show for a profile, in the current language when it has none. */
export function displayName(profile) {
  return (profile && profile.name) || t('profile.defaultName');
}

/** Keep every ui field; validate the ones the app relies on. */
export function normalizeUi(raw) {
  const ui = isPlainObject(raw) ? raw : {};
  const out = {};
  // Unknown keys survive as long as they are plain JSON values (forward compatibility).
  for (const [k, v] of Object.entries(ui)) {
    if (k === 'lang') continue;
    if (v === undefined || typeof v === 'function') continue;
    out[k] = v;
  }
  out.checklist = Array.isArray(ui.checklist) ? ui.checklist.filter((x) => typeof x === 'number' || typeof x === 'string').slice(0, 50) : [];
  if ('rehearsals' in ui) out.rehearsals = Array.isArray(ui.rehearsals) ? ui.rehearsals.filter(isPlainObject).slice(0, HISTORY_MAX) : [];
  if ('lastDraft' in ui) out.lastDraft = isPlainObject(ui.lastDraft) ? ui.lastDraft : null;
  out.prep = normalizePrep(ui.prep);
  if ('prepMeeting' in ui) out.prepMeeting = typeof ui.prepMeeting === 'string' && ui.prepMeeting.length <= 200 ? ui.prepMeeting : null;
  return out;
}

export function newId() {
  try {
    if (typeof crypto !== 'undefined' && crypto.randomUUID) return `p_${crypto.randomUUID().slice(0, 8)}`;
  } catch {
    /* fall through */
  }
  return `p_${Math.random().toString(36).slice(2, 10)}`;
}

/** A new profile. `lang` should be the language the person is reading right now. */
export function makeProfile(patch = {}, fallbackLang = 'en') {
  return {
    id: newId(),
    name: cleanName(patch.name),
    email: cleanEmail(patch.email),
    lang: isLocale(patch.lang) ? patch.lang : isLocale(fallbackLang) ? fallbackLang : 'en',
    createdAt: new Date().toISOString(),
    onboarded: Boolean(patch.onboarded),
    prefs: normalizePrefs(isPlainObject(patch.prefs) ? patch.prefs : defaultPrefs()),
    ui: normalizeUi(patch.ui),
  };
}

/** Repair anything hand-edited, imported or written by an older version. */
export function normalizeProfile(p, fallbackLang = 'en') {
  const base = makeProfile(isPlainObject(p) ? p : {}, fallbackLang);
  const id = isPlainObject(p) && typeof p.id === 'string' && p.id ? p.id.slice(0, 40) : base.id;
  const createdAt = isPlainObject(p) && typeof p.createdAt === 'string' && !Number.isNaN(Date.parse(p.createdAt)) ? p.createdAt : base.createdAt;
  return { ...base, id, createdAt };
}

/** Repair a whole stored state; returns null when there is nothing usable. */
export function normalizeState(raw, fallbackLang = 'en') {
  if (!isPlainObject(raw) || !Array.isArray(raw.profiles) || !raw.profiles.length) return null;
  const seen = new Set();
  const profiles = [];
  for (const p of raw.profiles.slice(0, 50)) {
    const n = normalizeProfile(p, fallbackLang);
    if (seen.has(n.id)) n.id = newId();
    seen.add(n.id);
    profiles.push(n);
  }
  const activeId = profiles.some((p) => p.id === raw.activeId) ? raw.activeId : profiles[0].id;
  return { activeId, profiles };
}

/** True once a home city or a location is set and setup was completed. */
export function isSetupComplete(profile) {
  if (!profile || !profile.onboarded) return false;
  const prefs = profile.prefs || {};
  return Boolean(prefs.homeCityId || prefs.location);
}

/** The portable file for one profile. */
export function exportPayload(profile, now = new Date()) {
  const { name, email, lang, onboarded, prefs, ui } = profile;
  return { agoraProfile: 1, exportedAt: now.toISOString(), profile: { name, email, lang, onboarded, prefs, ui } };
}

/** Validate an imported file; returns the profile patch or throws. */
export function readImport(data) {
  if (!isPlainObject(data) || data.agoraProfile !== 1 || !isPlainObject(data.profile)) {
    const err = new Error('not an Agora profile');
    err.code = 'bad_file';
    throw err;
  }
  return data.profile;
}
