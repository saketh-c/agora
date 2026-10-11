import { lazy, Suspense, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { Link, useLocation, useNavigate, useNavigationType, useSearchParams } from 'react-router-dom';
import { addDays, agendaFor, cityPoint, compareText, expandCityMeetings, formatDate, hasEnded, haversineMiles, isDateStr, joinItems, joinList, labelValue, lowerFirst, nextMeetingFor, normalizePrefs, scoreMeeting, sentenceGap, t, tn, topicList, upcomingMeetings, weekdayNames, weekdayShortNames } from '@agora/core';
import { nowIso, today as todayFn } from '../lib/data.js';
import { useCities } from '../lib/DataProvider.jsx';
import { useStore } from '../lib/store.jsx';
import { lookupPlace, placeFromDevice, placesOf, withPlaces } from '../lib/places.js';
import {
  DEFAULT_WHEN,
  FILTER_KEYS,
  WEEK_ORDER,
  WHEN,
  activeKeys,
  changedKeys,
  clearFilters,
  countyKey,
  dateWindow,
  mileChoices,
  parseQuery,
  passes,
  queryVocab,
  isPastRange,
  readFilters,
  relaxTogether,
  relaxations,
  sortMeetings,
  windowDays,
  withoutKey,
  writeFilters,
} from '../lib/meetingFilters.js';
import { useHideFooter, useSkipLink } from '../components/shell/PageMeta.jsx';
import { SETUP_STATE, setupTo } from '../components/shell/SetupHost.jsx';
import AppFooter from '../components/shell/AppFooter.jsx';
import FilterControls from '../components/meetings/FilterControls.jsx';
import MapStrip from '../components/meetings/MapStrip.jsx';
import { locate, readHere, resolveOrigin } from '../components/meetings/origin.js';
import { canSpeakText, Chip, dayTimeText, EmptyState, Icon, MeetingDetail, MeetingDetailBadge, MeetingRow, MeetingShare, meetingDeadline, Menu, monthDay, Segmented, Sheet, whenText } from '../components/ui/index.js';
import '../styles/pages/meetings.css';

// Leaflet only loads when a map is on screen (desktop, or the phone Map view).
const MapView = lazy(() => import('../components/MapView.jsx'));

const FIRST_PAGE = 10;
const PAGE = 20;
/** How many meetings one council may place before others in "Best for you"; the rest follow. */
const PER_CITY = 2;
const PANEL_INSET = 452;
const STRIP_MAX = 30;
const EMPTY = new Set();
/** Filters shown in the row of removable chips (the others have their own chip or menu above). */
const STRIP_KINDS = new Set(['dow', 'time', 'topic', 'county', 'city']);
/** Parts of the URL that are not remembered between visits. */
const NOT_REMEMBERED = ['meeting', 'setup', 'q'];
/**
 * Where distance is measured from is the profile's (prefs.origin, shared with Home and
 * Prepare); a city or a looked-up place chosen here is for this visit only.
 */
const ORIGIN_KEYS = ['near', 'at', 'atl'];

/** A remembered query without what should not come back: the origin, and a date range that is over. */
function rememberable(query, today) {
  const next = new URLSearchParams(query);
  for (const k of [...NOT_REMEMBERED, ...ORIGIN_KEYS]) next.delete(k);
  if (isPastRange(next.get('from'), next.get('to'), today)) for (const k of ['when', 'from', 'to']) next.delete(k);
  return next;
}

/**
 * The address's current query. Two quick changes (a chip, then a key in the search box) can
 * both land before React renders again; starting from the live URL keeps the first one.
 */
const latest = (prev) => new URLSearchParams(typeof window !== 'undefined' ? window.location.search : prev);

function useMedia(query) {
  const read = () => typeof window !== 'undefined' && window.matchMedia(query).matches;
  const [matches, setMatches] = useState(read);
  useEffect(() => {
    const mq = window.matchMedia(query);
    const on = () => setMatches(mq.matches);
    on();
    mq.addEventListener('change', on);
    return () => mq.removeEventListener('change', on);
  }, [query]);
  return matches;
}

/**
 * The current instant, refreshed each minute and whenever the tab comes back into view, so a
 * meeting that just ended leaves the list even in a tab left open overnight.
 */
function useNow() {
  const [now, setNow] = useState(nowIso);
  useEffect(() => {
    const tick = () => setNow(nowIso());
    const id = setInterval(tick, 60000);
    const onShow = () => document.visibilityState === 'visible' && tick();
    document.addEventListener('visibilitychange', onShow);
    window.addEventListener('pageshow', onShow);
    return () => {
      clearInterval(id);
      document.removeEventListener('visibilitychange', onShow);
      window.removeEventListener('pageshow', onShow);
    };
  }, []);
  return now;
}

/** "Next 2 weeks", "Oct 13 to Oct 20", "Oct 20". */
function whenLabel(f, today) {
  if (f.when !== 'custom') return t(`meetings.when.${f.when}`);
  const w = dateWindow(f, today);
  return w.from === w.to ? monthDay(w.from) : t('meetings.when.range', { from: monthDay(w.from), to: monthDay(w.to) });
}

/** "this weekend", "in the next 2 weeks", "from Oct 13 to Oct 20", "on Oct 20": a window inside a sentence. */
function whenPhrase(f, today) {
  if (f.when !== 'custom') return t(`meetings.when.phrase.${f.when}`);
  const w = dateWindow(f, today);
  return w.from === w.to ? t('meetings.when.phrase.day', { date: monthDay(w.from) }) : t('meetings.when.phrase.range', { from: monthDay(w.from), to: monthDay(w.to) });
}

export default function Meetings() {
  useHideFooter();
  const { prefs, setPrefs, lang, ui, setUi } = useStore();
  const { cities, cityById, liveReady } = useCities();
  const [params, setParams] = useSearchParams();
  const location = useLocation();
  const navigate = useNavigate();
  const navType = useNavigationType();
  const isDesktop = useMedia('(min-width: 1024px)');
  const now = useNow();
  const today = todayFn();
  const P = useMemo(() => normalizePrefs(prefs), [prefs]);
  const saved = useMemo(() => placesOf(P, cityById), [P, cityById]);
  const [here, setHere] = useState(readHere);
  const [hereStatus, setHereStatus] = useState('idle');

  // ---------- reference data ----------
  const cityIds = useMemo(() => new Set(cities.map((c) => c.cityId)), [cities]);
  const counties = useMemo(() => {
    const byKey = new Map();
    for (const c of cities) byKey.set(countyKey(c.county), c.county);
    return [...byKey].map(([key, name]) => ({ key, name })).sort((a, b) => compareText(a.name, b.name));
  }, [cities]);
  const countySet = useMemo(() => new Set(counties.map((c) => c.key)), [counties]);
  const countyOfCity = useMemo(() => new Map(cities.map((c) => [c.cityId, countyKey(c.county)])), [cities]);
  const topics = useMemo(() => topicList().filter((tp) => tp.id !== 'other'), [lang]); // eslint-disable-line react-hooks/exhaustive-deps
  const vocab = useMemo(() => queryVocab(lang), [lang]);
  const cityTopics = useMemo(() => {
    const map = new Map();
    for (const city of cities) {
      const { upcoming, recent } = agendaFor(city, today);
      map.set(city.cityId, new Set([...upcoming, ...recent].flatMap((it) => it.topics || [])));
    }
    return map;
  }, [cities, today]);

  // ---------- filters (in the URL) ----------
  const defaultNear = saved[saved.origin] ? saved.origin : null;
  const defaults = useMemo(
    () => ({ when: DEFAULT_WHEN, after: !P.availability.daytime, speak: true, remote: false, miles: defaultNear ? P.maxMiles : null, near: defaultNear, sort: P.homeCityId || defaultNear ? 'best' : 'soonest' }),
    [P.availability.daytime, P.maxMiles, P.homeCityId, defaultNear],
  );
  const readCtx = useMemo(() => ({ today, cityIds, counties: countySet }), [today, cityIds, countySet]);
  const f = useMemo(() => readFilters(params, defaults, readCtx), [params, defaults, readCtx]);
  const view = params.get('view') === 'map' ? 'map' : 'list';
  const phoneMap = view === 'map' && !isDesktop;
  const meetingId = params.get('meeting');

  /** Change filters in place (no new history entry). An open meeting stays open. */
  const update = useCallback(
    (patch) => {
      setParams(
        (prev) => {
          const next = latest(prev);
          writeFilters(next, { ...readFilters(next, defaults, readCtx), ...patch }, defaults);
          return next;
        },
        // Going Back from here would undo the filter change, so it no longer just closes a meeting.
        { replace: true, state: null },
      );
    },
    [setParams, defaults, readCtx],
  );

  const setView = (v) =>
    setParams(
      (prev) => {
        const next = latest(prev);
        if (v === 'map') next.set('view', 'map');
        else next.delete('view');
        return next;
      },
      { replace: true, state: location.state },
    );

  // Coming back through the tab bar (a bare /meetings): bring back the filters and the
  // List | Map choice this profile used last. Search text and an open meeting are not kept.
  const restoring = useRef(false);
  useLayoutEffect(() => {
    if (navType === 'REPLACE') return;
    const savedQuery = typeof ui.meetingsQuery === 'string' ? ui.meetingsQuery : '';
    if (!savedQuery || FILTER_KEYS.some((k) => params.has(k))) return;
    const restored = rememberable(savedQuery, today);
    if (!restored.toString()) {
      // Only what is no longer kept (an old origin, a range that is over): forget it.
      setUi({ meetingsQuery: '' });
      return;
    }
    restoring.current = true;
    setParams(
      (prev) => {
        const next = new URLSearchParams(restored);
        for (const k of NOT_REMEMBERED) if (prev.has(k)) next.set(k, prev.get(k));
        return next;
      },
      { replace: true, state: location.state },
    );
    // Only on arrival.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [location.key]);
  useEffect(() => {
    if (restoring.current && !FILTER_KEYS.some((k) => params.has(k))) return;
    restoring.current = false;
    const s = rememberable(params, today).toString();
    if (s !== (ui.meetingsQuery || '')) setUi({ meetingsQuery: s });
    // Saves follow the address only.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [params]);

  // ---------- where distance is measured from ----------
  const origin = useMemo(() => {
    const ctx = { saved, here, pt: f.pt, cityById };
    const o = resolveOrigin(f.near, ctx) || resolveOrigin(defaults.near, ctx);
    if (!o) return null;
    return { ...o, mapLabel: o.id === 'here' ? t('meetings.youAreHere') : o.name || o.label };
    // lang: labels are translated
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [f.near, f.pt, saved, here, cityById, defaults.near, lang]);
  const milesTo = useMemo(() => {
    const map = new Map();
    if (origin) for (const city of cities) map.set(city.cityId, haversineMiles(origin, cityPoint(city)));
    return map;
  }, [cities, origin]);

  /**
   * Home, School and where you are now are the profile's places: choosing one here makes it the
   * place Home and Prepare measure from too (prefs.origin), so every page agrees. A city or a
   * looked-up place stays in the address, for this visit.
   */
  const shareOrigin = useCallback(
    (id, position) => {
      setPrefs((cur) => withPlaces(cur, position ? { here: placeFromDevice(position, position.at), origin: 'here' } : { origin: id }, cities));
      update({ near: null, pt: null });
    },
    [setPrefs, cities, update],
  );
  const onNear = useCallback(
    (v) => {
      if (v !== 'here') {
        setHereStatus('idle');
        if (v === 'home' || v === 'school') shareOrigin(v);
        else update({ near: v, pt: null });
        return;
      }
      if (here || saved.here) {
        setHereStatus('idle');
        // A position found earlier in this tab is saved; one already saved is kept as it is.
        shareOrigin('here', saved.here ? null : here);
        return;
      }
      setHereStatus('locating');
      locate().then(
        (p) => {
          setHere(p);
          setHereStatus('idle');
          shareOrigin('here', p);
        },
        (err) => setHereStatus(err && err.code === 'denied' ? 'denied' : 'failed'),
      );
    },
    [here, saved.here, update, shareOrigin],
  );

  const [lookupState, setLookupState] = useState({ status: 'idle' });
  const lookupAbort = useRef(null);
  useEffect(() => () => lookupAbort.current && lookupAbort.current.abort(), []);
  const runLookup = useCallback(
    async (text) => {
      const q = String(text || '').trim();
      if (q.length < 2) return;
      if (lookupAbort.current) lookupAbort.current.abort();
      const ctrl = typeof AbortController === 'function' ? new AbortController() : null;
      lookupAbort.current = ctrl;
      setLookupState({ status: 'looking', query: q });
      try {
        const place = await lookupPlace(q, { cities, signal: ctrl ? ctrl.signal : undefined });
        if (place.kind === 'city' && place.cityId && cityIds.has(place.cityId)) update({ near: place.cityId, pt: null });
        else update({ near: 'pt', pt: { lat: place.lat, lng: place.lng, label: place.label || q } });
        setLookupState({ status: 'idle' });
      } catch (err) {
        const code = err && err.code;
        if (code === 'aborted') return;
        const message =
          code === 'outside_area' ? t('meetings.from.outside', { place: err.label || q }) : code === 'offline' ? t('meetings.from.offline') : code === 'busy' || code === 'unavailable' ? t('meetings.from.busy') : t('meetings.from.notFound', { place: q });
        setLookupState({ status: 'error', query: q, message });
      }
    },
    [cities, cityIds, update],
  );
  const lookup = useMemo(() => ({ available: true, state: lookupState, run: runLookup, reset: () => setLookupState({ status: 'idle' }) }), [lookupState, runLookup]);

  // ---------- the list ----------
  const win = dateWindow(f, today);
  const base = useMemo(() => upcomingMeetings(cities, { from: win.from, days: windowDays(win), now }), [cities, win.from, win.to, now]); // eslint-disable-line react-hooks/exhaustive-deps
  const query = useMemo(() => parseQuery(f.q, { cities, topics, today, vocab }), [f.q, cities, topics, today, vocab]);
  const ctx = useMemo(
    () => ({
      cityById,
      topicsAt: (id) => cityTopics.get(id) || EMPTY,
      countyOf: (id) => countyOfCity.get(id),
      milesTo: (id) => (milesTo.has(id) ? milesTo.get(id) : null),
      hasOrigin: Boolean(origin),
      query,
    }),
    [cityById, cityTopics, countyOfCity, milesTo, origin, query],
  );
  const canBest = Boolean(P.homeCityId || origin);
  const sort = f.sort === 'nearest' && origin ? 'nearest' : f.sort === 'best' && canBest ? 'best' : 'soonest';
  const scorePrefs = useMemo(() => ({ ...P, location: origin ? { lat: origin.lat, lng: origin.lng } : null, maxMiles: f.miles }), [P, origin, f.miles]);
  const list = useMemo(() => {
    const items = base.filter((m) => passes(m, f, ctx));
    return sortMeetings(items, sort, { scoreOf: (m) => scoreMeeting(m, cityById(m.cityId), scorePrefs, { today }).score, milesTo: ctx.milesTo, perCity: PER_CITY });
  }, [base, f, ctx, sort, cityById, scorePrefs, today]);

  /** How many meetings another filter state would show (for the ways out of an empty list). */
  const pools = useRef(new Map());
  const countFor = useCallback(
    (g) => {
      const w = dateWindow(g, today);
      let pool = base;
      if (w.from < win.from || w.to > win.to) {
        const key = `${w.from}|${w.to}|${now}`;
        if (!pools.current.has(key)) {
          if (pools.current.size > 8) pools.current.clear();
          pools.current.set(key, upcomingMeetings(cities, { from: w.from, days: windowDays(w), now }));
        }
        pool = pools.current.get(key);
      }
      return pool.filter((m) => m.date >= w.from && m.date <= w.to && passes(m, g, ctx)).length;
    },
    [base, win.from, win.to, today, now, cities, ctx],
  );

  // ---------- the open meeting ----------
  const selected = useMemo(() => {
    if (!meetingId) return null;
    const hit = base.find((m) => m.id === meetingId);
    if (hit) return hit;
    const [cityId, date] = meetingId.split(':');
    const city = cityById(cityId);
    if (!city || !isDateStr(date) || date < today) return null;
    return expandCityMeetings(city, date, date).find((m) => m.id === meetingId && !hasEnded(m, now)) || null;
  }, [meetingId, base, cityById, today, now]);
  const selectedCity = selected ? cityById(selected.cityId) : null;
  const nextSpeakable = useMemo(() => {
    if (!selected || selected.openToPublicComment || selected.status === 'cancelled' || !selectedCity) return null;
    return nextMeetingFor(selectedCity, selected.date, { publicCommentOnly: true, now });
  }, [selected, selectedCity, now]);
  const selectedDistance = selected && origin && milesTo.has(selected.cityId) && milesTo.get(selected.cityId) >= 0.3 ? { miles: milesTo.get(selected.cityId), from: origin.label } : null;
  const selectedReasons = useMemo(() => {
    if (!selected || sort !== 'best' || !selectedCity) return null;
    // The distance line and the "Your city" badge already say how near it is.
    const said = Boolean(selectedDistance) || selected.cityId === P.homeCityId;
    return scoreMeeting(selected, selectedCity, scorePrefs, { today })
      .reasons.filter((r) => r.points > 0 && !(said && r.kind === 'distance'))
      .slice(0, 3)
      .map((r) => r.text);
  }, [selected, selectedCity, sort, scorePrefs, today, selectedDistance, P.homeCityId]);

  // A link to a meeting that has passed or never existed: drop it quietly. A meeting only a
  // city's agenda site lists exists once the live agendas have loaded (or failed to), so wait.
  useEffect(() => {
    if (meetingId && !selected && liveReady)
      setParams(
        (prev) => {
          const next = latest(prev);
          next.delete('meeting');
          return next;
        },
        { replace: true },
      );
  }, [meetingId, selected, liveReady, setParams]);

  const returnFocus = useRef(null);
  const focusPanel = useRef(false);
  const switching = useRef(false);
  const panelRef = useRef(null);

  const openMeeting = useCallback(
    (m) => {
      if (!m) return;
      const fromOpen = Boolean(params.get('meeting'));
      if (document.activeElement && document.activeElement !== document.body && !(panelRef.current && panelRef.current.contains(document.activeElement))) returnFocus.current = document.activeElement;
      focusPanel.current = true;
      switching.current = fromOpen;
      setParams(
        (prev) => {
          const next = latest(prev);
          next.set('meeting', m.id);
          return next;
        },
        // Opening adds a history entry, so the phone's Back gesture closes the sheet;
        // switching from one meeting to another does not.
        fromOpen ? { replace: true, state: location.state } : { state: { meetingOpen: true } },
      );
    },
    [params, setParams, location.state],
  );

  const closeMeeting = useCallback(() => {
    if (location.state && location.state.meetingOpen) navigate(-1);
    else
      setParams(
        (prev) => {
          const next = latest(prev);
          next.delete('meeting');
          return next;
        },
        { replace: true },
      );
  }, [location.state, navigate, setParams]);

  // Desktop panel: take focus when someone opens a meeting; give it back when it closes.
  const selectedKey = selected ? selected.id : '';
  useEffect(() => {
    const opened = focusPanel.current;
    const switched = switching.current;
    focusPanel.current = false;
    switching.current = false;
    if (!selectedKey || !opened) return;
    if (!isDesktop) {
      // The sheet focuses itself when it opens. When it switches to another meeting ("See that
      // meeting"), the button that was pressed is gone, so focus goes back to the dialog.
      if (switched) {
        const dialog = document.querySelector('[role="dialog"][aria-labelledby="md-h"]');
        if (dialog) dialog.focus({ preventScroll: true });
      }
      return;
    }
    if (panelRef.current) panelRef.current.focus({ preventScroll: true });
    // A pin click selects a meeting that may be far down the list: bring its row into view.
    const row = document.querySelector(`[data-mid="${CSS.escape(selectedKey)}"]`);
    if (row) row.scrollIntoView({ block: 'nearest' });
  }, [selectedKey, isDesktop]);
  useEffect(() => {
    if (selectedKey || !returnFocus.current) return;
    const el = returnFocus.current;
    returnFocus.current = null;
    if (isDesktop && el.isConnected) el.focus({ preventScroll: true });
  }, [selectedKey, isDesktop]);

  // ---------- filters panel (desktop, inline) and sheet (phones) ----------
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [section, setSection] = useState(null);
  const filtersBtn = useRef(null);
  const panelHeading = useRef(null);
  const openFilters = (name) => {
    setSection(name ? { name } : null);
    setFiltersOpen(true);
  };
  const closePanel = useCallback(() => {
    setFiltersOpen(false);
    if (filtersBtn.current) filtersBtn.current.focus({ preventScroll: true });
  }, []);
  // The phone sheet is not shown on desktop and the inline panel not on phones.
  const sheetOpen = filtersOpen && !isDesktop;
  const panelOpen = filtersOpen && isDesktop;

  // Opened from Filters, the panel takes focus (its heading), so Tab goes straight into it
  // rather than past the other chips. Opened for one group, FilterControls focuses that group.
  useEffect(() => {
    if (!panelOpen || section) return undefined;
    const id = requestAnimationFrame(() => {
      const h = panelHeading.current;
      if (!h) return;
      h.focus({ preventScroll: true });
      h.scrollIntoView({ block: 'nearest' });
    });
    return () => cancelAnimationFrame(id);
  }, [panelOpen, section]);

  // Escape closes the filters panel, then the meeting panel, wherever focus is, unless
  // something smaller (a menu, a dialog, a city list, a search box with text) uses it first.
  useEffect(() => {
    if (!isDesktop || (!selectedKey && !panelOpen)) return undefined;
    const onKey = (e) => {
      if (e.key !== 'Escape' || e.defaultPrevented) return;
      if (document.querySelector('.sheet-layer')) return;
      const el = e.target instanceof Element ? e.target : null;
      if (el && el.closest('[role="menu"]')) return;
      if (el && el.matches('input[type="search"]') && el.value) return;
      if (panelOpen) {
        e.preventDefault();
        closePanel();
        return;
      }
      if (el && el.closest('.cbx, .mtg-fpanel')) return;
      e.preventDefault();
      closeMeeting();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [isDesktop, selectedKey, panelOpen, closeMeeting, closePanel]);
  const addPlace = () => {
    // One dialog at a time: close the filters before "Your city, topics and times" opens.
    setFiltersOpen(false);
    navigate(setupTo(location), { state: SETUP_STATE });
  };

  // ---------- paging ----------
  const sigParams = new URLSearchParams(params);
  for (const k of ['meeting', 'view', 'setup']) sigParams.delete(k);
  const sig = sigParams.toString();
  const [page, setPage] = useState({ sig, n: FIRST_PAGE });
  const shownCount = page.sig === sig ? page.n : FIRST_PAGE;
  const shown = list.slice(0, shownCount);
  const moreFocus = useRef(null);
  const showMore = () => {
    moreFocus.current = shownCount;
    setPage({ sig, n: shownCount + PAGE });
  };
  useEffect(() => {
    if (moreFocus.current == null) return;
    const el = document.querySelector(`[data-idx="${moreFocus.current}"]`);
    moreFocus.current = null;
    if (el) el.focus();
  }, [shownCount]);

  const skipTarget = list.length && !phoneMap;
  useSkipLink(skipTarget ? 'mtg-results' : null, skipTarget ? tn('meetings.skipToResults', list.length) : null);

  // ---------- map pins: the councils in the list ----------
  const [hot, setHot] = useState(null);
  const pins = useMemo(() => {
    const byCity = new Map();
    for (const m of list) {
      const entry = byCity.get(m.cityId);
      if (!entry) byCity.set(m.cityId, { first: m, go: Boolean(m.openToPublicComment) });
      else if (m.openToPublicComment) entry.go = true;
    }
    if (selected && !byCity.has(selected.cityId)) byCity.set(selected.cityId, { first: selected, go: Boolean(selected.openToPublicComment) });
    return [...byCity.values()].map(({ first, go }) => {
      const city = cityById(first.cityId);
      const m = selected && selected.cityId === first.cityId ? selected : first;
      return {
        cityId: city.cityId,
        name: city.name,
        lat: city.cityHall.lat,
        lng: city.cityHall.lng,
        tone: go ? 'go' : 'watch',
        tag: t('meetings.pinTag', { city: city.name, when: dayTimeText(m.date, m.time) }),
        aria: t('meetings.pinLabel', { city: city.name, when: whenText(m.date, m.time), status: m.openToPublicComment ? canSpeakText(city) : t('ui.watchOnly') }),
      };
    });
  }, [list, selected, cityById, lang]); // eslint-disable-line react-hooks/exhaustive-deps
  const councils = new Set(list.map((m) => m.cityId)).size;

  // The chip row fades out at its end (the right; the left in Arabic) while more chips are
  // hidden past the edge. Right to left, scrollLeft runs from 0 into negative numbers.
  const chipbarRef = useRef(null);
  const [chipEnd, setChipEnd] = useState(false);
  const checkChipEnd = useCallback(() => {
    const el = chipbarRef.current;
    if (el) setChipEnd(Math.abs(el.scrollLeft) + el.clientWidth >= el.scrollWidth - 4);
  }, []);
  useEffect(() => {
    checkChipEnd();
  });
  useEffect(() => {
    const el = chipbarRef.current;
    if (!el || typeof ResizeObserver !== 'function') return undefined;
    const ro = new ResizeObserver(checkChipEnd);
    ro.observe(el);
    return () => ro.disconnect();
  }, [checkChipEnd]);
  const onPin = useCallback(
    (cityId) => {
      if (phoneMap && hot !== cityId) {
        // First tap: show that city's meeting in the strip; a second tap opens it.
        setHot(cityId);
        return;
      }
      if (selected && selected.cityId === cityId) return;
      const m = list.find((x) => x.cityId === cityId);
      if (m) openMeeting(m);
    },
    [phoneMap, hot, list, selected, openMeeting],
  );

  // ---------- words for chips ----------
  const shortDays = weekdayShortNames();
  const longDays = weekdayNames();
  const keyLabel = (key) => {
    const [kind, id] = key.split(/:(.*)/s);
    switch (kind) {
      case 'when':
        return whenLabel(f, today);
      case 'dow':
        return joinItems(f.dow.map((i) => shortDays[i]));
      case 'time':
        return joinItems(f.time.map((x) => t(`meetings.time.${x}`)));
      case 'after':
        return t('ui.timing.after');
      case 'speak':
        return t('ui.canSpeak');
      case 'remote':
        return t('meetings.speaking.remote');
      case 'miles':
        return t('meetings.distance.within', { n: f.miles });
      case 'topic': {
        const tp = topics.find((x) => x.id === id);
        return tp ? tp.label : id;
      }
      case 'county': {
        const c = counties.find((x) => x.key === id);
        return t('meetings.where.county', { county: c ? c.name : id });
      }
      case 'city': {
        const c = cityById(id);
        return c ? c.name : id;
      }
      default:
        return key;
    }
  };
  const keys = activeKeys(f, { hasOrigin: Boolean(origin) });
  // The number on Filters counts only what differs from the profile's defaults.
  const changed = changedKeys(f, defaults, { hasOrigin: Boolean(origin) }).length;
  const stripKeys = keys.filter((k) => STRIP_KINDS.has(k.split(':')[0]));
  const clearAll = () => update(clearFilters(f));

  const nonDefaultOrigin = origin && origin.id !== defaults.near;
  const milesLabel = !origin ? t('meetings.distance.label') : f.miles == null ? t('meetings.distance.any') : nonDefaultOrigin ? t('meetings.distance.withinFrom', { n: f.miles, place: origin.label }) : t('meetings.distance.within', { n: f.miles });

  // ---------- search hints ----------
  const structured = query && (query.weekdays.size > 0 || query.dates || query.counties.size > 0);
  const makeFilter = () => {
    const patch = { q: query.terms.map((x) => x.text).join(' ') };
    if (query.weekdays.size) patch.dow = WEEK_ORDER.filter((i) => f.dow.includes(i) || query.weekdays.has(i));
    if (query.counties.size) patch.counties = [...new Set([...f.counties, ...query.counties])];
    if (query.dates) {
      if (query.dateWord && WHEN.includes(query.dateWord)) Object.assign(patch, { when: query.dateWord, from: '', to: '' });
      else {
        const ds = [...query.dates].sort();
        Object.assign(patch, { when: 'custom', from: ds[0], to: ds[ds.length - 1] });
      }
    }
    update(patch);
  };
  let searchHint = null;
  if (structured) {
    let text;
    if (query.weekdays.size) text = t('meetings.hint.days', { days: joinList(WEEK_ORDER.filter((i) => query.weekdays.has(i)).map((i) => longDays[i])) });
    else if (query.dates) text = t('meetings.hint.dates', { dates: query.dateWord ? t(`meetings.when.phrase.${query.dateWord}`) : joinList([...query.dates].sort().map((d) => monthDay(d))) });
    else text = t('meetings.hint.county', { county: joinItems(counties.filter((c) => query.counties.has(c.key)).map((c) => c.name)) });
    searchHint = { text, action: t('meetings.hint.makeFilter'), onClick: makeFilter };
  }
  let countyHint = null;
  if (!structured && query && query.countyHint) {
    const c = counties.find((x) => x.key === query.countyHint);
    if (c) countyHint = { text: t('meetings.hint.countyAlso', { county: c.name }), action: t('meetings.hint.countyShow'), onClick: () => update({ q: '', counties: [...new Set([...f.counties, c.key])] }) };
  }
  // A search the filters partly hide: say how much and offer to show it.
  const hiddenForSearch = useMemo(() => {
    if (!query || !list.length || !keys.some((k) => k !== 'when')) return 0;
    const g = { ...clearFilters(f), when: f.when, from: f.from, to: f.to };
    return Math.max(0, countFor(g) - list.length);
    // keys follow f
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query, list.length, f, countFor]);
  const topicOnly = query && !structured && query.terms.length === 1 && !query.terms[0].cityIds.size && query.terms[0].topicIds.length > 0;
  const hintTopic = topicOnly ? topics.find((tp) => tp.id === query.terms[0].topicIds[0]) : null;

  // ---------- empty states ----------
  const emptyInfo = useMemo(() => {
    if (list.length) return null;
    // The default two weeks can widen too, so a search for a city that meets later and
    // farther away than the limit still gets one way out.
    const relaxKeys = keys.includes('when') || f.when === '3months' ? keys : [...keys, 'when'];
    const fixes = relaxations(f, relaxKeys, countFor).slice(0, 3);
    const everything = countFor({ ...clearFilters(f), when: '3months' });
    // No single filter is enough: the fewest that hide meetings together.
    const together = fixes.length || relaxKeys.length < 2 ? null : relaxTogether(f, relaxKeys, countFor);
    return { fixes, everything, together, withoutAll: keys.length ? countFor(clearFilters(f)) : 0 };
    // keys follow f
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [list.length, f, countFor]);

  // Every word of the search was understood (a city, county, topic, day or date), so the
  // answer is "none of them meet then", not "try other words".
  const understood = Boolean(query) && (query.weekdays.size > 0 || Boolean(query.dates) || query.counties.size > 0 || query.terms.some((x) => x.cityIds.size || x.topicIds.length)) && query.terms.every((x) => x.cityIds.size || x.topicIds.length);

  const fixText = (fix) => {
    if (fix.key === 'when') return tn(f.when === DEFAULT_WHEN ? 'meetings.empty.more3months' : 'meetings.empty.more2weeks', fix.count);
    return tn('meetings.empty.hiddenBy', fix.count, { filter: keyLabel(fix.key) });
  };
  // A search for one city ("irving") names it in the way out.
  const searchedCity =
    query && query.terms.length === 1 && query.terms[0].cityIds.size === 1 && !query.terms[0].topicIds.length && !query.weekdays.size && !query.dates && !query.counties.size ? cityById([...query.terms[0].cityIds][0]) : null;
  /** "4 meetings in Irving in the next 3 months", "5 meetings in the next 3 months hidden by Within 15 mi". */
  const togetherText = ({ keys: drop, count }) => {
    const later = drop.includes('when') && f.when === DEFAULT_WHEN;
    const rest = later ? drop.filter((k) => k !== 'when') : drop;
    const filter = joinList(rest.map(keyLabel));
    if (searchedCity) {
      if (later) return tn('meetings.empty.cityLater', count, { city: searchedCity.name });
      return tn('meetings.empty.cityHiddenBy', count, { city: searchedCity.name, filter });
    }
    if (later) return rest.length ? tn('meetings.empty.laterHiddenBy', count, { filter }) : tn('meetings.empty.more3months', count);
    return tn('meetings.empty.hiddenBy', count, { filter });
  };

  const day = (date) => (date === today ? t('common.today') : date === addDays(today, 1) ? t('common.tomorrow') : formatDate(date, { long: true }));

  const rowHover = isDesktop
    ? (m) => ({
        onMouseEnter: () => setHot(m.cityId),
        onMouseLeave: () => setHot((h) => (h === m.cityId ? null : h)),
        onFocus: () => setHot(m.cityId),
        onBlur: () => setHot((h) => (h === m.cityId ? null : h)),
      })
    : () => ({});
  // In the phone map's strip a card shows the essentials only; the sheet has the rest.
  const row = (m, i, { compact = false } = {}) => (
    <MeetingRow
      meeting={m}
      city={cityById(m.cityId)}
      onSelect={openMeeting}
      selected={Boolean(selected && selected.id === m.id)}
      homeCityId={P.homeCityId}
      distanceMiles={milesTo.has(m.cityId) ? milesTo.get(m.cityId) : null}
      deadline={m.openToPublicComment && !compact ? meetingDeadline(m, now) : null}
      showTiming={!f.after && !compact}
      aria-haspopup={isDesktop ? undefined : 'dialog'}
      data-mid={m.id}
      data-idx={i}
      {...rowHover(m)}
    />
  );

  let body;
  if (!list.length && emptyInfo) {
    if (query && emptyInfo.everything === 0) {
      body = (
        <EmptyState
          icon="search"
          title={t('meetings.empty.noSearchTitle', { q: f.q.trim() })}
          actions={
            <button type="button" className="btn btn--primary" onClick={() => update({ q: '' })}>
              {t('meetings.clearSearch')}
            </button>
          }
        >
          {understood ? t('meetings.empty.noSearchAll') : t('meetings.empty.noSearchBody')}
        </EmptyState>
      );
    } else {
      const onlyWindow = !keys.length && !query;
      const title = onlyWindow ? t('meetings.empty.windowTitle', { range: whenPhrase(f, today) }) : query ? t('meetings.empty.search', { q: f.q.trim() }) : t('meetings.empty.title');
      body = (
        <EmptyState
          icon={query ? 'search' : 'cal'}
          title={title}
          actions={
            !emptyInfo.fixes.length && !(emptyInfo.together && emptyInfo.together.count > 0) && keys.length ? (
              <button type="button" className="btn btn--primary" onClick={clearAll}>
                {t('meetings.clearAll')}
              </button>
            ) : query ? (
              <button type="button" className="btn btn--quiet mtg-empty__clear" onClick={() => update({ q: '' })}>
                {t('meetings.clearSearch')}
              </button>
            ) : null
          }
        >
          {emptyInfo.fixes.length ? (
            <ul className="mtg-fixes">
              {emptyInfo.fixes.map((fix) => (
                <li key={fix.key}>
                  <span>{fixText(fix)}</span>
                  <button type="button" className="btn btn--secondary btn--sm" onClick={() => update(withoutKey(f, fix.key))}>
                    {t('meetings.empty.showThem')}
                  </button>
                </li>
              ))}
            </ul>
          ) : emptyInfo.together && emptyInfo.together.count > 0 ? (
            <ul className="mtg-fixes">
              <li>
                <span>{togetherText(emptyInfo.together)}</span>
                <button type="button" className="btn btn--secondary btn--sm" onClick={() => update(emptyInfo.together.keys.reduce(withoutKey, f))}>
                  {t('meetings.empty.showThem')}
                </button>
              </li>
            </ul>
          ) : keys.length && emptyInfo.withoutAll ? (
            <p>{tn('meetings.empty.withoutAll', emptyInfo.withoutAll)}</p>
          ) : (
            <p>{onlyWindow ? t('meetings.empty.windowBody') : t('meetings.empty.body')}</p>
          )}
        </EmptyState>
      );
    }
  } else if (sort === 'soonest') {
    const groups = [];
    shown.forEach((m, i) => {
      const last = groups[groups.length - 1];
      if (last && last.date === m.date) last.items.push([m, i]);
      else groups.push({ date: m.date, items: [[m, i]] });
    });
    body = groups.map((g) => (
      <section key={g.date} className="mtg__day" aria-labelledby={`day-${g.date}`}>
        <h2 className="day-head" id={`day-${g.date}`}>
          {day(g.date)}
        </h2>
        <ul className="group">
          {g.items.map(([m, i]) => (
            <li key={m.id}>{row(m, i)}</li>
          ))}
        </ul>
      </section>
    ));
  } else {
    body = (
      <ul className="group">
        {shown.map((m, i) => (
          <li key={m.id}>{row(m, i)}</li>
        ))}
      </ul>
    );
  }

  const remaining = list.length - shown.length;
  const showSort = !phoneMap;
  const sortName = { best: t('meetings.sortBest'), soonest: t('meetings.sortSoonest'), nearest: t('meetings.sortNearest') };
  const sortItems = [
    ...(canBest ? [{ type: 'radio', label: sortName.best, checked: sort === 'best', onSelect: () => update({ sort: 'best' }) }] : []),
    { type: 'radio', label: sortName.soonest, checked: sort === 'soonest', onSelect: () => update({ sort: 'soonest' }) },
    ...(origin ? [{ type: 'radio', label: sortName.nearest, checked: sort === 'nearest', onSelect: () => update({ sort: 'nearest' }) }] : []),
  ];

  const mapEmpty =
    !list.length && emptyInfo ? (
      <div className="map__emptycard">
        <p className="map__emptyt">{t('meetings.empty.map')}</p>
        {phoneMap && (emptyInfo.fixes[0] || emptyInfo.together || keys.length > 0 || query) ? (
          query && emptyInfo.everything === 0 ? (
            <button type="button" className="btn btn--secondary btn--sm" onClick={() => update({ q: '' })}>
              {t('meetings.clearSearch')}
            </button>
          ) : emptyInfo.fixes[0] ? (
            <>
              <p className="help">{fixText(emptyInfo.fixes[0])}</p>
              <button type="button" className="btn btn--secondary btn--sm" onClick={() => update(withoutKey(f, emptyInfo.fixes[0].key))}>
                {t('meetings.empty.showThem')}
              </button>
            </>
          ) : emptyInfo.together && emptyInfo.together.count > 0 ? (
            <>
              <p className="help">{togetherText(emptyInfo.together)}</p>
              <button type="button" className="btn btn--secondary btn--sm" onClick={() => update(emptyInfo.together.keys.reduce(withoutKey, f))}>
                {t('meetings.empty.showThem')}
              </button>
            </>
          ) : (
            <button type="button" className="btn btn--secondary btn--sm" onClick={() => (keys.length ? clearAll() : update({ q: '' }))}>
              {keys.length ? t('meetings.clearAll') : t('meetings.clearSearch')}
            </button>
          )
        ) : null}
      </div>
    ) : null;

  const mapBlock = (
    <Suspense fallback={<div className="map map--loading" role="status" aria-label={t('meetings.mapLoading')} />}>
      <MapView pins={pins} selectedId={selected ? selected.cityId : null} hotId={hot} followHot={phoneMap} onSelect={onPin} origin={origin} ringMiles={origin ? f.miles : null} insetRight={isDesktop && selected ? PANEL_INSET : 0} empty={mapEmpty} />
    </Suspense>
  );

  const filterControls = (idBase) => (
    <FilterControls
      idBase={idBase}
      f={{ ...f, near: origin ? origin.id : f.near }}
      update={update}
      today={today}
      win={win}
      topics={topics}
      cities={cities}
      counties={counties}
      saved={saved}
      origin={origin}
      savedMiles={P.maxMiles}
      onNear={onNear}
      hereStatus={hereStatus}
      lookup={lookup}
      onAddPlace={addPlace}
      section={section}
    />
  );

  const countText = list.length ? t('meetings.countAt', { meetings: tn('meetings.count', list.length), councils: tn('meetings.councils', councils) }) : tn('meetings.count', 0);
  const noPlaceTip = !origin && !ui.meetingsPlaceTipHidden;

  return (
    <div className={`mtg${view === 'map' ? ' mtg--mapview' : ''}`}>
      <div className="mtg__list">
        <div className="mtg__head">
          <h1 className="t-title">{t('meetings.title')}</h1>
          <Segmented
            className="mtg__view"
            label={t('meetings.view')}
            value={view}
            onChange={setView}
            options={[
              { value: 'list', label: t('meetings.viewList'), icon: 'list' },
              { value: 'map', label: t('meetings.viewMap'), icon: 'map' },
            ]}
          />
        </div>

        <div className="mtg__tools">
          <div className={`search${f.q ? ' search--has-clear' : ''}`}>
            <Icon name="search" />
            <input type="search" value={f.q} onChange={(e) => update({ q: e.target.value })} placeholder={t('meetings.searchPlaceholder')} aria-label={t('meetings.searchLabel')} enterKeyHint="search" autoComplete="off" />
            {f.q && (
              <button type="button" className="iconbtn search__clear" aria-label={t('meetings.clearSearch')} onClick={() => update({ q: '' })}>
                <Icon name="x" size={20} />
              </button>
            )}
          </div>
          <div className={`mtg__chips${chipEnd ? ' is-end' : ''}`}>
            <div ref={chipbarRef} className="chipbar" role="group" aria-label={t('meetings.filtersLabel')} onScroll={checkChipEnd}>
              <Chip
                ref={filtersBtn}
                icon="sliders"
                count={changed}
                className={panelOpen ? 'is-open' : ''}
                aria-label={changed ? tn('meetings.filtersOn', changed) : t('meetings.filters')}
                aria-haspopup={isDesktop ? undefined : 'dialog'}
                aria-expanded={isDesktop ? panelOpen : undefined}
                aria-controls={isDesktop && panelOpen ? 'mtg-fpanel' : undefined}
                onClick={() => (panelOpen ? closePanel() : openFilters(null))}
              >
                {t('meetings.filters')}
              </Chip>
              <Menu
                label={labelValue(t('meetings.when.label'), whenLabel(f, today))}
                buttonClassName={`chip chip--menu${f.when !== DEFAULT_WHEN ? ' is-on' : ''}`}
                align="start"
                button={
                  <>
                    {whenLabel(f, today)}
                    <Icon name="chev-d" size={20} />
                  </>
                }
                items={[
                  ...WHEN.map((w) => ({ type: 'radio', label: t(`meetings.when.${w}`), checked: f.when === w, onSelect: () => update({ when: w, from: '', to: '' }) })),
                  { type: 'separator' },
                  {
                    type: 'radio',
                    label: t('meetings.when.custom'),
                    sub: f.when === 'custom' ? whenLabel(f, today) : undefined,
                    checked: f.when === 'custom',
                    onSelect: () => {
                      if (f.when !== 'custom') update({ when: 'custom', from: win.from, to: win.to });
                      openFilters('when');
                    },
                  },
                ]}
              />
              {origin ? (
                <Menu
                  label={labelValue(t('meetings.distance.label'), milesLabel)}
                  buttonClassName={`chip chip--menu${f.miles != null ? ' is-on' : ''}`}
                  align="start"
                  button={
                    <>
                      {milesLabel}
                      <Icon name="chev-d" size={20} />
                    </>
                  }
                  items={[
                    { type: 'group', label: t('meetings.distance.menuFrom', { place: origin.label }) },
                    ...mileChoices(P.maxMiles, f.miles).map((n) => ({ type: 'radio', label: t('ui.milesShort', { n }), checked: f.miles === n, onSelect: () => update({ miles: n }) })),
                    { type: 'radio', label: t('meetings.distance.any'), checked: f.miles == null, onSelect: () => update({ miles: null }) },
                    { type: 'separator' },
                    { label: t('meetings.distance.elsewhere'), icon: 'pin', onSelect: () => openFilters('distance') },
                  ]}
                />
              ) : (
                <Chip menu aria-haspopup={isDesktop ? undefined : 'dialog'} onClick={() => openFilters('distance')}>
                  {t('meetings.distance.label')}
                </Chip>
              )}
              <Chip pressed={f.after} title={t('meetings.time.afterLong')} onClick={() => update({ after: !f.after })}>
                {t('ui.timing.after')}
              </Chip>
              <Chip pressed={f.speak} onClick={() => update({ speak: !f.speak })}>
                {t('ui.canSpeak')}
              </Chip>
              <Chip pressed={f.remote} title={t('meetings.speaking.remoteLong')} onClick={() => update({ remote: !f.remote })}>
                {t('meetings.speaking.remote')}
              </Chip>
            </div>
          </div>
          {stripKeys.length > 0 && !panelOpen && (
            <ul className="mtg__active" aria-label={t('meetings.activeLabel')}>
              {stripKeys.map((key) => (
                <li key={key}>
                  <button type="button" className="chip is-on mtg-x" aria-label={t('meetings.remove', { filter: keyLabel(key) })} onClick={() => update(withoutKey(f, key))}>
                    <span className="mtg-x__t">{keyLabel(key)}</span>
                    <Icon name="x" size={20} />
                  </button>
                </li>
              ))}
              <li>
                <button type="button" className="see mtg__clearall" onClick={clearAll}>
                  {t('meetings.clearAll')}
                </button>
              </li>
            </ul>
          )}
        </div>

        {panelOpen && (
          <section id="mtg-fpanel" className="mtg-fpanel" aria-labelledby="mtg-fpanel-h">
            <div className="mtg-fpanel__bar">
              <h2 className="t-heading" id="mtg-fpanel-h" ref={panelHeading} tabIndex={-1}>
                {t('meetings.filters')}
              </h2>
              <button type="button" className="iconbtn" aria-label={t('common.close')} onClick={closePanel}>
                <Icon name="x" />
              </button>
            </div>
            {filterControls('mf-panel')}
            <div className="mtg-fpanel__foot">
              <span className="count-l num" aria-hidden="true">
                {tn('meetings.count', list.length)}
              </span>
              <button type="button" className="btn btn--quiet" onClick={clearAll} aria-disabled={!keys.length || undefined}>
                {t('meetings.clearAll')}
              </button>
              <button type="button" className="btn btn--primary" onClick={closePanel}>
                {t('meetings.done')}
              </button>
            </div>
          </section>
        )}

        {searchHint && (
          <p className="mtg__hint">
            <Icon name="info" size={18} />
            <span>
              {searchHint.text}
              {sentenceGap(searchHint.text)}
              <button type="button" className="link" onClick={searchHint.onClick}>
                {searchHint.action}
              </button>
            </span>
          </p>
        )}
        {hiddenForSearch > 0 && !searchHint && (
          <p className="mtg__hint">
            <Icon name="eye" size={18} />
            <span>
              {tn('meetings.hint.hidden', hiddenForSearch, { q: f.q.trim() })}
              {sentenceGap(tn('meetings.hint.hidden', hiddenForSearch, { q: f.q.trim() }))}
              <button type="button" className="link" onClick={() => update({ ...clearFilters(f), when: f.when, from: f.from, to: f.to })}>
                {t('meetings.hint.showThem')}
              </button>
            </span>
          </p>
        )}
        {countyHint && !hiddenForSearch && (
          <p className="mtg__hint">
            <Icon name="info" size={18} />
            <span>
              {countyHint.text}
              {sentenceGap(countyHint.text)}
              <button type="button" className="link" onClick={countyHint.onClick}>
                {countyHint.action}
              </button>
            </span>
          </p>
        )}
        {hintTopic && !searchHint && !hiddenForSearch && <p className="mtg__hint mtg__hint--plain">{t('meetings.topicHint', { topic: hintTopic.short || lowerFirst(hintTopic.label) })}</p>}

        {noPlaceTip && (
          <div className="notice mtg__tip">
            <Icon name="pin" />
            <div>
              <p>{t('meetings.noPlace.body')}</p>
              <p className="act">
                <Link className="link" to={setupTo(location)} state={SETUP_STATE}>
                  {t('meetings.noPlace.action')}
                </Link>
                <button type="button" className="link mtg__tiphide" onClick={() => setUi({ meetingsPlaceTipHidden: true })}>
                  {t('meetings.noPlace.dismiss')}
                </button>
              </p>
            </div>
          </div>
        )}

        <div className={`listbar${showSort ? '' : ' listbar--count'}`}>
          {showSort ? (
            <Menu
              label={labelValue(t('meetings.sort'), sortName[sort])}
              buttonClassName="sortbtn"
              align="start"
              button={
                <>
                  {sortName[sort]}
                  <Icon name="chev-d" size={20} />
                </>
              }
              items={sortItems}
            />
          ) : null}
          <span className="count-l num" role="status" aria-live="polite">
            {countText}
          </span>
        </div>

        {phoneMap ? (
          <div className="mtg__phonemap">
            {mapBlock}
            <MapStrip label={t('meetings.strip')} meetings={list.slice(0, STRIP_MAX)} activeCity={hot} onActive={setHot} renderRow={(m, i) => row(m, i, { compact: true })} />
          </div>
        ) : (
          <div id="mtg-results" className="mtg__results" tabIndex={-1}>
            {body}
            {remaining > 0 && (
              <button type="button" className="btn btn--secondary btn--block mtg__more" onClick={showMore}>
                {t('meetings.showMore', { n: Math.min(PAGE, remaining) })}
              </button>
            )}
          </div>
        )}

        <ul className="group browse">
          <li>
            <Link className="lrow lrow--icon" to="/cities">
              <span className="lrow__ic">
                <Icon name="book" />
              </span>
              <span>
                <span className="lrow__t">{t('meetings.browseCities', { n: cities.length })}</span>
                <span className="lrow__m">{t('meetings.browseCitiesSub')}</span>
              </span>
              <Icon name="chev-r" />
            </Link>
          </li>
        </ul>
        <AppFooter inline />
      </div>

      {isDesktop && (
        <div className="mtg__map">
          {mapBlock}
          {selected && (
            <aside ref={panelRef} className="panel mtg-panel" aria-labelledby="md-h" tabIndex={-1}>
              <div className="sheet__bar">
                <span className="sheet__title">
                  <MeetingDetailBadge meeting={selected} homeCityId={P.homeCityId} />
                </span>
                <span className="sheet__tools">
                  <MeetingShare meeting={selected} />
                  <button type="button" className="iconbtn" aria-label={t('common.close')} onClick={closeMeeting}>
                    <Icon name="x" />
                  </button>
                </span>
              </div>
              <MeetingDetail
                key={selected.id}
                className="mtg-panel__body"
                meeting={selected}
                city={selectedCity}
                today={today}
                now={now}
                headingId="md-h"
                nextSpeakable={nextSpeakable}
                onOpenMeeting={openMeeting}
                distance={selectedDistance}
                reasons={selectedReasons}
              />
            </aside>
          )}
        </div>
      )}

      {!isDesktop && (
        <Sheet open={Boolean(selected)} onClose={closeMeeting} labelledBy="md-h" barStart={selected ? <MeetingDetailBadge meeting={selected} homeCityId={P.homeCityId} /> : null} barEnd={selected ? <MeetingShare meeting={selected} /> : null}>
          {selected && (
            <MeetingDetail key={selected.id} meeting={selected} city={selectedCity} today={today} now={now} headingId="md-h" nextSpeakable={nextSpeakable} onOpenMeeting={openMeeting} distance={selectedDistance} reasons={selectedReasons} />
          )}
        </Sheet>
      )}

      <Sheet
        open={sheetOpen}
        onClose={() => setFiltersOpen(false)}
        title={t('meetings.filters')}
        footer={
          <div className="btn-row mtg-filters__foot">
            <button type="button" className="btn btn--quiet" onClick={clearAll} aria-disabled={!keys.length || undefined}>
              {t('meetings.clearAll')}
            </button>
            <button type="button" className="btn btn--primary" onClick={() => setFiltersOpen(false)}>
              {tn('meetings.showResults', list.length)}
            </button>
          </div>
        }
      >
        {filterControls('mf-sheet')}
      </Sheet>
    </div>
  );
}
