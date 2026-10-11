import { createContext, useCallback, useContext, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { useLocation, useNavigationType } from 'react-router-dom';
import { t } from '@agora/core';
import { documentTitle } from './nav.js';

/**
 * Per-route chrome: document titles, the polite route announcer, focus on navigation, scroll
 * restoration, skip links, and whether the shell shows its footer.
 *
 * Pages call:
 *   usePageTitle('Plano')   -> document.title "Plano | Agora" (default comes from nav.js)
 *   useHideFooter()         -> the shell skips its footer (render <AppFooter inline /> yourself)
 *   useSkipLink('cm-posts', t('shell.skip.posts'))
 *                           -> a second skip link, after "Skip to content", that jumps past the
 *                              page's own search and filters to its results (the element with
 *                              that id takes focus)
 */
const Ctx = createContext({ setName: () => {}, setFooterHidden: () => {}, addSkip: () => () => {}, skips: [] });

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

/** Offer "Skip to <label>" at the top of the page while this page is shown. */
export function useSkipLink(id, label) {
  const { addSkip } = useContext(Ctx);
  useEffect(() => {
    if (!id || !label) return undefined;
    return addSkip({ id, label });
  }, [id, label, addSkip]);
}

export function PageMetaProvider({ children }) {
  const [named, setName] = useState({ pathname: null, name: '' });
  const [footerHidden, setFooterHidden] = useState(0);
  const [skips, setSkips] = useState([]);
  const addSkip = useCallback((link) => {
    setSkips((list) => [...list.filter((s) => s.id !== link.id), link]);
    return () => setSkips((list) => list.filter((s) => s.id !== link.id || s.label !== link.label));
  }, []);
  const value = useMemo(() => ({ setName, setFooterHidden, addSkip, skips, named, footerHidden: footerHidden > 0 }), [named, footerHidden, addSkip, skips]);
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

/**
 * The key a scroll position is saved under. Every page opened by typing its address (or from
 * a bookmark) is history entry "default", so that key also names the address: otherwise one
 * page's saved position would be restored on another.
 */
function posKey(location) {
  return location.key === 'default' ? `default:${location.pathname}${location.search}${location.hash}` : location.key;
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

/** Give `el` focus without scrolling; a non-interactive target gets a quiet tabindex first. */
function focusQuietly(el) {
  if (!el) return;
  if (!el.matches('a[href], button, input, select, textarea, summary, [tabindex]')) {
    el.setAttribute('tabindex', '-1');
    el.setAttribute('data-route-focus', '');
  }
  el.focus({ preventScroll: true });
}

/** Open every closed <details> around (or at) an anchor target, so a link to it shows it. */
function revealTarget(el) {
  for (let d = el.closest('details:not([open])'); d; d = d.parentElement && d.parentElement.closest('details:not([open])')) d.open = true;
}

/**
 * Where a hash link lands focus: the element itself when it can take focus, the summary of a
 * <details>, otherwise the section's heading (a ring around a whole section is noise).
 */
function hashFocusTarget(el) {
  if (el.matches('a[href], button, input, select, textarea, [tabindex]')) return el;
  if (el.tagName === 'DETAILS') return el.querySelector(':scope > summary') || el;
  return el.querySelector('h1, h2, h3') || el;
}

/** "#data" -> "data"; a malformed escape is looked up as typed. */
function hashId(hash) {
  const raw = String(hash || '').replace(/^#/, '');
  try {
    return decodeURIComponent(raw);
  } catch {
    return raw;
  }
}

function skipTo(e, id) {
  e.preventDefault();
  // A page's own target can be missing (no results right now): land on the content instead.
  const el = document.getElementById(id) || document.getElementById('main');
  if (!el) return;
  focusQuietly(el);
  el.scrollIntoView({ block: 'start' });
}

/**
 * The skip links, first in the tab order: "Skip to content", then any the page registered
 * with useSkipLink ("Skip to results"). Each is hidden until it has keyboard focus.
 */
export function SkipLinks() {
  const { skips } = useContext(Ctx);
  return (
    <>
      <a className="skip" href="#main" onClick={(e) => skipTo(e, 'main')}>
        {t('nav.skip')}
      </a>
      {skips.map((s) => (
        <a key={s.id} className="skip" href={`#${s.id}`} onClick={(e) => skipTo(e, s.id)}>
          {s.label}
        </a>
      ))}
    </>
  );
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
  const keyRef = useRef(posKey(location));
  // The page and hash whose jump already happened (set when the target is found, so the
  // effect re-run that development's StrictMode does still jumps).
  const hashDone = useRef({ pathname: null, hash: null });
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
    keyRef.current = posKey(location);
    savePositions(positions.current);
    const pathChanged = lastPath.current !== location.pathname;
    // Only a new page or a new hash jumps to the hash: opening a meeting sheet on
    // /city/plano#schedule changes the query, and must not scroll the page under it.
    const hashChanged = hashDone.current.pathname !== location.pathname || hashDone.current.hash !== location.hash;
    if (!location.hash) hashDone.current = { pathname: location.pathname, hash: '' };
    if (navType === 'POP') {
      const y = positions.current.get(keyRef.current);
      if (y != null) {
        hashDone.current = { pathname: location.pathname, hash: location.hash };
        return untilReady(() => {
          const max = document.documentElement.scrollHeight - window.innerHeight;
          window.scrollTo(0, Math.min(y, Math.max(0, max)));
          return max >= y;
        });
      }
      // Nothing saved for this entry: a link opened directly, or a reload before any scroll.
      // Fall through, so a #hash still lands on its target.
    }
    if (location.hash && hashChanged) {
      const id = hashId(location.hash);
      // A page that loads late (a lazy route, fonts, a list) can push the target down after
      // the first jump, so check again for a moment and follow it unless the reader scrolled.
      let found = null;
      let settledAt = 0;
      let lastY = -1;
      return untilReady(() => {
        if (!found) {
          found = document.getElementById(id);
          if (!found) return false;
          hashDone.current = { pathname: location.pathname, hash: location.hash };
          revealTarget(found);
          settledAt = performance.now();
        } else if (lastY >= 0 && Math.abs(window.scrollY - lastY) > 2) {
          return true; // the reader scrolled: leave them there
        }
        const top = found.getBoundingClientRect().top;
        const pad = parseFloat(getComputedStyle(document.documentElement).scrollPaddingTop) || 0;
        const margin = parseFloat(getComputedStyle(found).scrollMarginTop) || 0;
        // Where scrollIntoView puts it: the page's scroll padding plus the target's own margin.
        if (lastY < 0 || Math.abs(top - (pad + margin)) > 4) found.scrollIntoView({ block: 'start' });
        lastY = window.scrollY;
        return performance.now() - settledAt > 800;
      }, 3500);
    }
    if (pathChanged) window.scrollTo(0, 0);
    return undefined;
    // posKey(location) reads only these fields.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [location.key, location.pathname, location.search, location.hash, navType]);

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
      else {
        // A link to a section of another page ("/about#data"): start reading there.
        const target = document.getElementById(hashId(location.hash));
        if (target) focusQuietly(hashFocusTarget(target));
        else h1.focus({ preventScroll: true });
      }
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
