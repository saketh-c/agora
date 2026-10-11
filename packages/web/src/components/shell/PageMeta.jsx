import { createContext, useContext, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { useLocation, useNavigationType } from 'react-router-dom';
import { documentTitle } from './nav.js';

/**
 * Per-route chrome: document titles, the polite route announcer, focus on navigation, scroll
 * restoration, and whether the shell shows its footer.
 *
 * Pages call:
 *   usePageTitle('Plano')   -> document.title "Plano | Agora" (default comes from nav.js)
 *   useHideFooter()         -> the shell skips its footer (render <AppFooter inline /> yourself)
 */
const Ctx = createContext({ setName: () => {}, setFooterHidden: () => {} });

export function usePageTitle(name) {
  const { setName } = useContext(Ctx);
  const { pathname } = useLocation();
  useEffect(() => {
    if (name) setName({ pathname, name });
  }, [name, pathname, setName]);
}

export function useHideFooter() {
  const { setFooterHidden } = useContext(Ctx);
  useEffect(() => {
    setFooterHidden((n) => n + 1);
    return () => setFooterHidden((n) => n - 1);
  }, [setFooterHidden]);
}

export function PageMetaProvider({ children }) {
  const [named, setName] = useState({ pathname: null, name: '' });
  const [footerHidden, setFooterHidden] = useState(0);
  const value = useMemo(() => ({ setName, setFooterHidden, named, footerHidden: footerHidden > 0 }), [named, footerHidden]);
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useShellChrome() {
  return useContext(Ctx);
}

const STORE_KEY = 'agora.scroll.v1';

function readPositions() {
  try {
    return new Map(JSON.parse(sessionStorage.getItem(STORE_KEY) || '[]'));
  } catch {
    return new Map();
  }
}

function savePositions(map) {
  try {
    sessionStorage.setItem(STORE_KEY, JSON.stringify([...map].slice(-50)));
  } catch {
    /* ignore */
  }
}

/** Run `fn` on each frame until it returns true or `ms` pass (lazy pages render late). */
function untilReady(fn, ms = 2500) {
  const start = performance.now();
  let raf = 0;
  const tick = () => {
    if (fn() || performance.now() - start > ms) return;
    raf = requestAnimationFrame(tick);
  };
  raf = requestAnimationFrame(tick);
  return () => cancelAnimationFrame(raf);
}

/**
 * Title, announcer, focus and scroll for each navigation. Renders the visually hidden live
 * region. Focus moves to the new page's h1 on navigation (never on the first load, and not
 * when only the query string changes, such as a List | Map toggle).
 */
export function RouteEffects({ languageKey }) {
  const location = useLocation();
  const navType = useNavigationType();
  const { named } = useContext(Ctx);
  const [announcement, setAnnouncement] = useState('');
  const firstPath = useRef(true);
  const lastPath = useRef(location.pathname);
  const positions = useRef(null);
  if (positions.current === null) positions.current = typeof window === 'undefined' ? new Map() : readPositions();

  const name = named.pathname === location.pathname ? named.name : '';
  const title = documentTitle(name, location.pathname);

  useEffect(() => {
    document.title = title;
    // languageKey re-runs this when the language changes and the name stays the same.
  }, [title, languageKey]);

  // The browser's own restoration fights a client-rendered page; do it here instead.
  useEffect(() => {
    if ('scrollRestoration' in window.history) window.history.scrollRestoration = 'manual';
  }, []);

  // Remember where each history entry was scrolled to. The key is switched to the new entry
  // (below) before the new page scrolls, so its scroll events never overwrite the old entry.
  const keyRef = useRef(location.key);
  useEffect(() => {
    const onScroll = () => positions.current.set(keyRef.current, Math.round(window.scrollY));
    const onHide = () => savePositions(positions.current);
    window.addEventListener('scroll', onScroll, { passive: true });
    window.addEventListener('pagehide', onHide);
    return () => {
      window.removeEventListener('scroll', onScroll);
      window.removeEventListener('pagehide', onHide);
    };
  }, []);

  // Scroll: back/forward restores; a hash scrolls to its target; a new page starts at the top.
  useLayoutEffect(() => {
    keyRef.current = location.key;
    savePositions(positions.current);
    const pathChanged = lastPath.current !== location.pathname;
    if (navType === 'POP') {
      const y = positions.current.get(location.key);
      if (y == null) return undefined;
      return untilReady(() => {
        const max = document.documentElement.scrollHeight - window.innerHeight;
        window.scrollTo(0, Math.min(y, Math.max(0, max)));
        return max >= y;
      });
    }
    if (location.hash) {
      const id = decodeURIComponent(location.hash.slice(1));
      return untilReady(() => {
        const el = document.getElementById(id);
        if (el) el.scrollIntoView({ block: 'start' });
        return Boolean(el);
      });
    }
    if (pathChanged) window.scrollTo(0, 0);
    return undefined;
  }, [location.key, location.pathname, location.hash, navType]);

  // Focus the page heading and announce the page after a navigation.
  useEffect(() => {
    const pathChanged = lastPath.current !== location.pathname;
    lastPath.current = location.pathname;
    if (firstPath.current) {
      firstPath.current = false;
      return undefined;
    }
    if (!pathChanged || (location.state && location.state.keepFocus)) return undefined;
    let timer = 0;
    const stop = untilReady(() => {
      const main = document.getElementById('main');
      if (!main) return false;
      const h1 = main.querySelector('h1');
      if (!h1) return false;
      if (!h1.hasAttribute('tabindex')) h1.setAttribute('tabindex', '-1');
      if (!location.hash) h1.focus({ preventScroll: true });
      timer = window.setTimeout(() => setAnnouncement(document.title), 150);
      return true;
    }, 3000);
    return () => {
      stop();
      clearTimeout(timer);
    };
  }, [location.pathname, location.key, location.hash, location.state]);

  return (
    <div className="announcer" aria-live="polite" aria-atomic="true">
      {announcement}
    </div>
  );
}
