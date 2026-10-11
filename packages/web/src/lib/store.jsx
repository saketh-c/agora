import { createContext, useCallback, useContext, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { defaultPrefs, normalizePrefs, setLocale, getLocale, detectLocale, isLocale, cityPoint } from '@agora/core';
import { PROFILES_KEY, makeProfile, normalizeState, normalizeUi, cleanName, cleanEmail, displayName, isSetupComplete, exportPayload, readImport } from './profiles.js';
import { prepSummary, withPrepStep } from './prep.js';

/**
 * Profiles, preferences, language, and small UI state.
 *
 * Everything here lives in this browser. A profile is not an account on a server: it is a
 * separate saved setup on this device, so a shared laptop can hold one for each person. The
 * model and its repairs live in lib/profiles.js (pure, tested); this file wires them to React
 * and localStorage:
 *  - one write path: every change goes through `commit`, and an effect persists the result;
 *  - other tabs: a `storage` listener adopts their writes, so two tabs never overwrite each
 *    other with stale copies;
 *  - language: applied synchronously during render (core's t() is module-global), so a
 *    switch re-renders in the new language without remounting anything.
 */

// Keys from before profiles existed, and from before the app was renamed. Anyone with a
// saved setup keeps it as their first profile rather than being sent back to setup.
const LEGACY_PREFS = ['agora.prefs.v1', 'takethefloor.prefs.v1'];
const LEGACY_UI = ['agora.ui.v1', 'takethefloor.ui.v1'];

const Ctx = createContext(null);

function readRaw(key) {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

function parse(raw) {
  if (raw == null) return null;
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

function readJson(keys) {
  for (const key of [].concat(keys)) {
    const value = parse(readRaw(key));
    if (value !== null) return value;
  }
  return null;
}

function write(key, value) {
  try {
    const raw = JSON.stringify(value);
    if (readRaw(key) !== raw) localStorage.setItem(key, raw);
  } catch {
    /* private mode or quota: state still lives in memory */
  }
}

function deviceLang() {
  return detectLocale(typeof navigator !== 'undefined' ? navigator.languages || [navigator.language] : []);
}

function initialState() {
  const stored = normalizeState(readJson(PROFILES_KEY), deviceLang());
  if (stored) return stored;

  // First run, or an upgrade from the single-setup version that came before profiles.
  const oldPrefs = readJson(LEGACY_PREFS);
  const oldUi = readJson(LEGACY_UI) || {};
  const profile = makeProfile({ prefs: oldPrefs || defaultPrefs(), ui: oldUi, lang: isLocale(oldUi.lang) ? oldUi.lang : undefined, onboarded: Boolean(oldPrefs) }, deviceLang());
  const next = { activeId: profile.id, profiles: [profile] };
  // Persist immediately, so a visitor who only reads a page is not migrated again (with a
  // new id) on every visit.
  write(PROFILES_KEY, next);
  if (oldPrefs) {
    for (const key of [...LEGACY_PREFS, ...LEGACY_UI]) {
      try {
        localStorage.removeItem(key);
      } catch {
        /* ignore */
      }
    }
  }
  return next;
}

/** Make the active profile's language the one core's t() uses. Idempotent. */
function applyLocale(lang) {
  if (getLocale() !== lang) setLocale(lang);
}

export function StoreProvider({ children }) {
  const [state, setState] = useState(initialState);
  const fromStorage = useRef(false);

  const active = state.profiles.find((p) => p.id === state.activeId) || state.profiles[0];
  // Synchronous on purpose: children rendered below in this same pass must translate in the
  // new language. setLocale is idempotent, so a repeated render is harmless.
  applyLocale(active.lang);

  useLayoutEffect(() => {
    document.documentElement.lang = active.lang;
  }, [active.lang]);

  // One place that persists. Changes that arrived from another tab are not written back.
  useEffect(() => {
    if (fromStorage.current) {
      fromStorage.current = false;
      return;
    }
    write(PROFILES_KEY, state);
  }, [state]);

  // Another tab changed the profiles: adopt its copy instead of overwriting it later.
  useEffect(() => {
    const onStorage = (e) => {
      if (e.storageArea && e.storageArea !== window.localStorage) return;
      if (e.key !== null && e.key !== PROFILES_KEY) return;
      const next = normalizeState(parse(e.newValue != null ? e.newValue : readRaw(PROFILES_KEY)), getLocale());
      if (!next) return;
      fromStorage.current = true;
      setState(next);
    };
    window.addEventListener('storage', onStorage);
    return () => window.removeEventListener('storage', onStorage);
  }, []);

  /** Apply a pure change to the whole state. */
  const commit = useCallback((fn) => {
    setState((prev) => {
      const next = fn(prev);
      return next && next !== prev ? next : prev;
    });
  }, []);

  /** Apply a change to the active profile. `patch` is an object or (profile) => object. */
  const patchActive = useCallback(
    (patch) =>
      commit((prev) => ({
        ...prev,
        profiles: prev.profiles.map((p) => (p.id === prev.activeId ? { ...p, ...(typeof patch === 'function' ? patch(p) : patch) } : p)),
      })),
    [commit],
  );

  /** Change preferences. Never changes whether setup is complete. */
  const setPrefs = useCallback(
    (updater) => patchActive((p) => ({ prefs: normalizePrefs(typeof updater === 'function' ? updater(p.prefs) : { ...p.prefs, ...updater }) })),
    [patchActive],
  );

  /**
   * Finish setup, optionally with a last preferences change. Setup only counts as complete
   * when the profile has a home city or a location; returns whether it is complete.
   */
  const completeSetup = useCallback(
    (updater) => {
      const resolve = (prefs) => (updater ? normalizePrefs(typeof updater === 'function' ? updater(prefs) : { ...prefs, ...updater }) : prefs);
      const hasPlace = (prefs) => Boolean(prefs.homeCityId || prefs.location);
      patchActive((p) => {
        const prefs = resolve(p.prefs);
        return { prefs, onboarded: hasPlace(prefs) || p.onboarded };
      });
      return hasPlace(resolve(active.prefs));
    },
    [patchActive, active.prefs],
  );

  /**
   * Make `city` (a city record) the home city: sets homeCityId and measures distance from its
   * city hall. With { complete: true } (the default) this also completes setup, because a
   * home city with a location is all setup needs.
   */
  const setHomeCity = useCallback(
    (city, { complete = true } = {}) => {
      if (!city || !city.cityId) return;
      const point = cityPoint(city);
      patchActive((p) => ({
        prefs: normalizePrefs({ ...p.prefs, homeCityId: city.cityId, location: point, locationLabel: city.name }),
        onboarded: complete ? true : p.onboarded,
      }));
    },
    [patchActive],
  );

  /** Start setup over: default preferences, not set up. Keeps name, language and ui. */
  const resetSetup = useCallback(() => patchActive({ prefs: defaultPrefs(), onboarded: false }), [patchActive]);

  const setLang = useCallback(
    (lang) => {
      if (!isLocale(lang)) return;
      applyLocale(lang);
      patchActive({ lang });
    },
    [patchActive],
  );

  /** Merge into the active profile's ui bag. `lang` is accepted for older callers. */
  const setUi = useCallback(
    (patch) => {
      const { lang, ...rest } = typeof patch === 'function' ? patch(active.ui) : patch || {};
      if (lang) setLang(lang);
      if (Object.keys(rest).length) patchActive((p) => ({ ui: normalizeUi({ ...p.ui, ...rest }) }));
    },
    [patchActive, setLang, active.ui],
  );

  /** Mark one prep step done (or not) for one meeting id. */
  const setPrepStep = useCallback(
    (meetingId, step, done = true) => patchActive((p) => ({ ui: { ...p.ui, prep: withPrepStep(p.ui.prep, meetingId, step, done) } })),
    [patchActive],
  );

  /** Remember which meeting Prepare is getting ready for ('practice' for just practicing). */
  const setPrepMeeting = useCallback((meetingId) => patchActive((p) => ({ ui: { ...p.ui, prepMeeting: meetingId || null } })), [patchActive]);

  const switchProfile = useCallback(
    (id) =>
      commit((prev) => {
        if (!prev.profiles.some((p) => p.id === id) || id === prev.activeId) return prev;
        return { ...prev, activeId: id };
      }),
    [commit],
  );

  /** Create a profile in the language being read now, and switch to it. Returns the new id. */
  const createProfile = useCallback(
    (patch = {}) => {
      const profile = makeProfile({ ...patch, lang: patch.lang || getLocale() }, getLocale());
      commit((prev) => ({ activeId: profile.id, profiles: [...prev.profiles, profile] }));
      return profile.id;
    },
    [commit],
  );

  const updateProfile = useCallback(
    (id, patch) =>
      commit((prev) => ({
        ...prev,
        profiles: prev.profiles.map((p) =>
          p.id === id
            ? {
                ...p,
                ...(patch.name !== undefined ? { name: cleanName(patch.name) } : {}),
                ...(patch.email !== undefined ? { email: cleanEmail(patch.email) } : {}),
              }
            : p,
        ),
      })),
    [commit],
  );

  /** Removing the last profile leaves a fresh one in the current language rather than none. */
  const deleteProfile = useCallback(
    (id) =>
      commit((prev) => {
        const remaining = prev.profiles.filter((p) => p.id !== id);
        const profiles = remaining.length ? remaining : [makeProfile({ lang: getLocale() }, getLocale())];
        const activeId = profiles.some((p) => p.id === prev.activeId) ? prev.activeId : profiles[0].id;
        return { activeId, profiles };
      }),
    [commit],
  );

  /** A portable copy of one profile, ui included. This is the only recovery with no server. */
  const exportProfile = useCallback((id) => exportPayload(state.profiles.find((x) => x.id === id) || active), [state.profiles, active]);

  /** Import a parsed profile file as a new profile and switch to it. Throws on a bad file. */
  const importProfile = useCallback((data) => createProfile(readImport(data)), [createProfile]);

  const prepFor = useCallback((meetingId) => prepSummary(active.ui.prep, meetingId), [active.ui.prep]);

  const value = useMemo(
    () => ({
      // preferences and setup
      prefs: active.prefs,
      setPrefs,
      onboarded: active.onboarded,
      setupComplete: isSetupComplete(active),
      completeSetup,
      setHomeCity,
      resetSetup,
      // language
      lang: active.lang,
      setLang,
      // ui bag
      ui: active.ui,
      setUi,
      prepFor,
      prepMeetingId: active.ui.prepMeeting || null,
      setPrepStep,
      setPrepMeeting,
      // profiles
      profile: active,
      profileName: displayName(active),
      profiles: state.profiles,
      switchProfile,
      createProfile,
      updateProfile,
      deleteProfile,
      exportProfile,
      importProfile,
    }),
    // active.lang is listed so the display name re-resolves in the new language.
    [active, setPrefs, completeSetup, setHomeCity, resetSetup, setLang, setUi, prepFor, setPrepStep, setPrepMeeting, state.profiles, switchProfile, createProfile, updateProfile, deleteProfile, exportProfile, importProfile],
  );

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useStore() {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error('useStore must be used inside StoreProvider');
  return ctx;
}

export { displayName };
