import { createContext, useContext, useEffect, useMemo, useState } from 'react';
import { localizeCities } from '@agora/core';
import { CITIES as RAW_CITIES } from './data.js';
import { useStore } from './store.jsx';

const Ctx = createContext(null);

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
 */
export function DataProvider({ children }) {
  const { lang } = useStore();
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

  const value = useMemo(() => {
    const cities = localizeCities(RAW_CITIES, strings);
    const byId = new Map(cities.map((c) => [c.cityId, c]));
    return { cities, cityById: (id) => byId.get(id) || null, translated, lang };
    // lang is a dependency on purpose: dictionary labels inside localized data change with it.
  }, [strings, translated, lang]);

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useCities() {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error('useCities must be used inside DataProvider');
  return ctx;
}
