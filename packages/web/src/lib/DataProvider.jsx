import { createContext, useContext, useEffect, useMemo, useState } from 'react';
import { applyLivePlans, isAgendaSnapshot, localizeCities, planLiveAgendas } from '@agora/core';
import { CITIES as RAW_CITIES } from './data.js';
import { API_BASE, STATIC_ONLY } from './api.js';
import { useStore } from './store.jsx';

const Ctx = createContext(null);

/** How often an open tab looks for newer agendas (the site rebuilds 4 times a day, the API every 6 hours). */
const LIVE_REFRESH_MS = 60 * 60 * 1000;

async function fetchSnapshot(url) {
  const res = await fetch(url, { headers: { Accept: 'application/json' }, cache: 'no-cache' });
  const type = (res.headers && res.headers.get('content-type')) || '';
  if (!res.ok || !/json/i.test(type)) throw new Error(`No agenda snapshot at ${url} (${res.status})`);
  const data = await res.json();
  if (!isAgendaSnapshot(data)) throw new Error('Not an agenda snapshot');
  return data;
}

/**
 * Meetings and agendas read from each city's own agenda site (core/src/agendas.js): the API's
 * copy when there is a server (it refreshes every 6 hours), else the snapshot the static build
 * shipped. Resolves to null when neither answers; the curated data then stands alone.
 */
function loadLiveAgendas() {
  const base = (import.meta.env && import.meta.env.BASE_URL) || '/';
  const file = `${base.endsWith('/') ? base : `${base}/`}agendas-snapshot.json`;
  const fromFile = () => fetchSnapshot(file);
  return (STATIC_ONLY || !API_BASE ? fromFile() : fetchSnapshot(`${API_BASE}/agendas`).catch(fromFile)).catch(() => null);
}

/**
 * The live snapshot, loaded once and then again every LIVE_REFRESH_MS while the tab is visible
 * (and when it becomes visible after that long), so a tab left open picks up new agendas.
 * Returns { snapshot, ready }: `ready` turns true once the first load has answered, with a
 * snapshot or without one, so a page can tell "not loaded yet" from "not there".
 */
function useLiveAgendas() {
  const [snapshot, setSnapshot] = useState(null);
  const [ready, setReady] = useState(false);
  useEffect(() => {
    let alive = true;
    let loadedAt = 0;
    const load = () => {
      loadedAt = Date.now();
      loadLiveAgendas().then((next) => {
        if (!alive) return;
        if (next) setSnapshot((prev) => (prev && prev.generatedAt === next.generatedAt ? prev : next));
        setReady(true);
      });
    };
    load();
    const visible = () => typeof document === 'undefined' || document.visibilityState === 'visible';
    const onVisible = () => {
      if (visible() && Date.now() - loadedAt >= LIVE_REFRESH_MS) load();
    };
    document.addEventListener('visibilitychange', onVisible);
    const timer = setInterval(onVisible, LIVE_REFRESH_MS);
    return () => {
      alive = false;
      document.removeEventListener('visibilitychange', onVisible);
      clearInterval(timer);
    };
  }, []);
  return { snapshot, ready };
}

/** Translation memories are loaded on demand so English users never download them. */
const LOADERS = {
  es: () => import('@data/i18n/es.json'),
  vi: () => import('@data/i18n/vi.json'),
};

/** Memories already loaded in this tab, so switching back is instant. */
const LOADED = new Map();

/**
 * Provides the city records in the active language.
 *
 * A memory is only applied to the language it belongs to: while the Vietnamese memory loads
 * after a switch from Spanish, the cities show in English (the source) rather than in the
 * previous language under a Vietnamese interface. `translated` is true once the data is in
 * the interface language. `cities` changes identity on every language change, so memos that
 * depend on it recompute with the new language's labels.
 *
 * Live agendas are merged on top (core/src/agendas.js): posted agenda items on their meetings,
 * meetings the city's site cancels shown as cancelled, and council meetings it adds. The merge
 * is planned once per snapshot from the English records and applied in each language.
 * `liveAgendasAt` is when the snapshot was made (null without one). `liveReady` is true once
 * the snapshot has loaded or failed: a meeting id that only a city's agenda site knows (from a
 * shared link) is unknown before that, and should not be dropped as gone until then.
 */
export function DataProvider({ children }) {
  const { lang } = useStore();
  const { snapshot: live, ready: liveReady } = useLiveAgendas();
  const plans = useMemo(() => planLiveAgendas(RAW_CITIES, live), [live]);
  const [loaded, setLoaded] = useState(() => ({ lang, strings: LOADED.get(lang) || null }));

  useEffect(() => {
    const loader = LOADERS[lang];
    if (!loader) return undefined;
    if (LOADED.has(lang)) {
      setLoaded({ lang, strings: LOADED.get(lang) });
      return undefined;
    }
    let alive = true;
    loader()
      .then((mod) => {
        const data = mod.default || mod;
        const strings = data.strings || null;
        LOADED.set(lang, strings);
        if (alive) setLoaded({ lang, strings });
      })
      .catch(() => {
        if (alive) setLoaded({ lang, strings: null });
      });
    return () => {
      alive = false;
    };
  }, [lang]);

  const strings = LOADERS[lang] && loaded.lang === lang ? loaded.strings : null;
  const translated = !LOADERS[lang] || (loaded.lang === lang && Boolean(loaded.strings));

  const liveAgendasAt = live ? live.generatedAt : null;
  const value = useMemo(() => {
    const cities = applyLivePlans(localizeCities(RAW_CITIES, strings), plans, { strings, locale: lang });
    const byId = new Map(cities.map((c) => [c.cityId, c]));
    return { cities, cityById: (id) => byId.get(id) || null, translated, lang, liveAgendasAt, liveReady };
    // lang is a dependency on purpose: dictionary labels inside localized data change with it.
  }, [strings, translated, lang, plans, liveAgendasAt, liveReady]);

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useCities() {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error('useCities must be used inside DataProvider');
  return ctx;
}
