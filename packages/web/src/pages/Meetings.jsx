import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useLocation, useNavigate, useSearchParams } from 'react-router-dom';
import {
  agendaFor,
  addDays,
  cityPoint,
  expandCityMeetings,
  formatDate,
  hasEnded,
  haversineMiles,
  isDateStr,
  isTopicId,
  lowerFirst,
  nextMeetingFor,
  normalizePrefs,
  scoreMeeting,
  t,
  tn,
  topicList,
  upcomingMeetings,
} from '@agora/core';
import { nowIso, today as todayFn } from '../lib/data.js';
import { useCities } from '../lib/DataProvider.jsx';
import { useStore } from '../lib/store.jsx';
import { milesChoices } from '../lib/distance.js';
import { useHideFooter } from '../components/shell/PageMeta.jsx';
import { SETUP_STATE, setupTo } from '../components/shell/SetupHost.jsx';
import AppFooter from '../components/shell/AppFooter.jsx';
import { canSpeakText, Chip, dayTimeText, EmptyState, Icon, MeetingDetail, MeetingDetailBadge, MeetingRow, meetingDeadline, Menu, remoteState, schoolTiming, Segmented, Sheet, whenText } from '../components/ui/index.js';
import '../styles/pages/meetings.css';

// Leaflet only loads when a map is on screen (desktop, or the phone Map view).
const MapView = lazy(() => import('../components/MapView.jsx'));

const DAYS = [7, 14, 30];
const FIRST_PAGE = 10;
const PAGE = 20;
/** How many meetings one council may place before others in "Best for you"; the rest follow. */
const PER_CITY = 2;
const PANEL_INSET = 452;

const fold = (s) =>
  String(s || '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .trim();

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

/** The current instant, refreshed each minute, so a meeting that just ended leaves the list. */
function useNow() {
  const [now, setNow] = useState(nowIso);
  useEffect(() => {
    const id = setInterval(() => setNow(nowIso()), 60000);
    return () => clearInterval(id);
  }, []);
  return now;
}

/** Filters live in the URL (only where they differ from the defaults), so Back and links keep them. */
function readFilters(params, defaults) {
  const flag = (key, fallback) => (params.has(key) ? params.get(key) === '1' : fallback);
  const days = Number(params.get('days'));
  // ?miles=any turns the distance filter off; no ?miles= means the saved distance.
  const rawMiles = params.get('miles');
  const miles = rawMiles === 'any' ? null : Number(rawMiles) > 0 && Number(rawMiles) <= 200 ? Number(rawMiles) : defaults.miles;
  const sort = params.get('sort');
  return {
    q: params.get('q') || '',
    days: DAYS.includes(days) ? days : 14,
    after: flag('after', defaults.after),
    speak: flag('speak', defaults.speak),
    remote: flag('remote', false),
    miles,
    topics: [...new Set((params.get('topics') || '').split(',').filter(isTopicId))],
    sort: sort === 'best' || sort === 'soonest' ? sort : defaults.sort,
  };
}

function writeFilters(params, f, defaults) {
  const set = (key, value, isDefault) => (isDefault ? params.delete(key) : params.set(key, value));
  set('q', f.q, !f.q);
  set('days', String(f.days), f.days === 14);
  set('after', f.after ? '1' : '0', f.after === defaults.after);
  set('speak', f.speak ? '1' : '0', f.speak === defaults.speak);
  set('remote', '1', !f.remote);
  set('miles', f.miles == null ? 'any' : String(f.miles), f.miles === defaults.miles);
  set('topics', f.topics.join(','), !f.topics.length);
  set('sort', f.sort, f.sort === defaults.sort);
}

/**
 * What a search box query means: city names first (a prefix of the name or of one of its words),
 * then initials, partial names and counties; plus topics, matched against the councils whose
 * recent or upcoming agendas touched them.
 */
function readQuery(q, cities, topics) {
  const n = fold(q);
  if (!n) return null;
  const words = (s) => fold(s).split(/[\s,/-]+/);
  let hits = cities.filter((c) => c.cityId === n || fold(c.name).startsWith(n) || words(c.name).some((w) => w.startsWith(n)));
  if (!hits.length) {
    const bare = n.replace(/\s+/g, '');
    hits = cities.filter((c) => {
      const w = words(c.name);
      return (w.length > 1 && w.map((x) => x[0]).join('').startsWith(bare)) || fold(c.name).includes(n) || fold(c.county).startsWith(n);
    });
  }
  const topicIds =
    n.length >= 3
      ? topics.filter((tp) => words(tp.label).some((w) => w.startsWith(n)) || fold(tp.short).startsWith(n) || (tp.keywords || []).some((k) => fold(k).startsWith(n))).map((tp) => tp.id)
      : [];
  return { text: n, cityIds: new Set(hits.map((c) => c.cityId)), topicIds };
}

/** One choice out of a few, as native radio buttons drawn as chips (inside a fieldset with a legend). */
function ChoiceChips({ name, value, options, onChange }) {
  return (
    <div className="chipwrap">
      {options.map((o) => {
        const on = o.value === value;
        return (
          <label key={o.value} className={`chip choice${on ? ' is-on' : ''}`}>
            <input type="radio" className="vh" name={name} checked={on} onChange={() => onChange(o.value)} />
            {on && <Icon name="check" size={20} />}
            {o.label}
          </label>
        );
      })}
    </div>
  );
}

export default function Meetings() {
  useHideFooter();
  const { prefs, lang } = useStore();
  const { cities, cityById } = useCities();
  const [params, setParams] = useSearchParams();
  const location = useLocation();
  const navigate = useNavigate();
  const isDesktop = useMedia('(min-width: 1024px)');
  const now = useNow();
  const today = todayFn();
  const P = useMemo(() => normalizePrefs(prefs), [prefs]);
  const hasPlace = Boolean(P.homeCityId || P.location);

  // With a place set, the list starts at the distance the student said they can travel.
  const defaults = useMemo(
    () => ({ after: !P.availability.daytime, speak: true, sort: hasPlace ? 'best' : 'soonest', miles: P.location ? P.maxMiles : null }),
    [P.availability.daytime, hasPlace, P.location, P.maxMiles],
  );
  const f = readFilters(params, defaults);
  const sort = hasPlace ? f.sort : 'soonest';
  const view = params.get('view') === 'map' ? 'map' : 'list';
  const meetingId = params.get('meeting');

  const [filtersOpen, setFiltersOpen] = useState(false);
  const returnFocus = useRef(null);
  const focusPanel = useRef(false);
  const switching = useRef(false);
  const panelRef = useRef(null);

  /** Change filters in place (no new history entry). An open meeting stays open. */
  const update = useCallback(
    (patch) => {
      setParams(
        (prev) => {
          const next = new URLSearchParams(prev);
          writeFilters(next, { ...readFilters(prev, defaults), ...patch }, defaults);
          return next;
        },
        // Going Back from here would undo the filter change, so it no longer just closes a meeting.
        { replace: true, state: null },
      );
    },
    [setParams, defaults],
  );

  const setView = (v) =>
    setParams(
      (prev) => {
        const next = new URLSearchParams(prev);
        if (v === 'map') next.set('view', 'map');
        else next.delete('view');
        return next;
      },
      { replace: true, state: location.state },
    );

  // ---------- data ----------
  const topics = useMemo(() => topicList().filter((tp) => tp.id !== 'other'), [lang]); // eslint-disable-line react-hooks/exhaustive-deps
  const base = useMemo(() => upcomingMeetings(cities, { from: today, days: f.days, now }), [cities, today, f.days, now]);
  const cityTopics = useMemo(() => {
    const map = new Map();
    for (const city of cities) {
      const { upcoming, recent } = agendaFor(city, today);
      map.set(city.cityId, new Set([...upcoming, ...recent].flatMap((it) => it.topics || [])));
    }
    return map;
  }, [cities, today]);
  const milesTo = useMemo(() => {
    const map = new Map();
    if (P.location) for (const city of cities) map.set(city.cityId, haversineMiles(P.location, cityPoint(city)));
    return map;
  }, [cities, P.location]);
  const query = useMemo(() => readQuery(f.q, cities, topics), [f.q, cities, topics]);
  const topicKey = f.topics.join(',');

  const list = useMemo(() => {
    const wanted = topicKey ? topicKey.split(',') : [];
    const items = base.filter((m) => {
      const city = cityById(m.cityId);
      if (f.after && !['after', 'weekend'].includes(schoolTiming(m))) return false;
      if (f.speak && !m.openToPublicComment) return false;
      if (f.remote && remoteState(city) !== 'yes') return false;
      if (f.miles != null && milesTo.size && !(milesTo.get(m.cityId) <= f.miles)) return false;
      if (wanted.length && !wanted.some((id) => cityTopics.get(m.cityId).has(id))) return false;
      if (query) {
        const byCity = query.cityIds.has(m.cityId);
        const byLabel = query.text.length >= 3 && fold(m.label).includes(query.text);
        const byTopic = query.topicIds.some((id) => cityTopics.get(m.cityId).has(id));
        if (!byCity && !byLabel && !byTopic) return false;
      }
      return true;
    });
    if (sort !== 'best') return items;
    const scored = items.map((m) => ({ m, s: scoreMeeting(m, cityById(m.cityId), P, { today }).score }));
    scored.sort((a, b) => b.s - a.s || a.m.date.localeCompare(b.m.date) || a.m.time.localeCompare(b.m.time) || a.m.cityName.localeCompare(b.m.cityName));
    const first = [];
    const later = [];
    const seen = new Map();
    for (const { m } of scored) {
      const n = seen.get(m.cityId) || 0;
      (n < PER_CITY ? first : later).push(m);
      seen.set(m.cityId, n + 1);
    }
    return [...first, ...later];
  }, [base, cityById, f.after, f.speak, f.remote, f.miles, topicKey, query, sort, cityTopics, milesTo, P, today]);

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

  // A link to a meeting that has passed or never existed: drop it quietly.
  useEffect(() => {
    if (meetingId && !selected)
      setParams(
        (prev) => {
          const next = new URLSearchParams(prev);
          next.delete('meeting');
          return next;
        },
        { replace: true },
      );
  }, [meetingId, selected, setParams]);

  const openMeeting = useCallback(
    (m) => {
      if (!m) return;
      const fromOpen = Boolean(params.get('meeting'));
      if (document.activeElement && document.activeElement !== document.body && !(panelRef.current && panelRef.current.contains(document.activeElement))) returnFocus.current = document.activeElement;
      focusPanel.current = true;
      switching.current = fromOpen;
      setParams(
        (prev) => {
          const next = new URLSearchParams(prev);
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
          const next = new URLSearchParams(prev);
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

  // ---------- paging ----------
  const sig = `${f.q}|${f.days}|${f.after}|${f.speak}|${f.remote}|${f.miles}|${topicKey}|${sort}`;
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

  // ---------- map pins: the councils in the list ----------
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

  const onPin = useCallback(
    (cityId) => {
      if (selected && selected.cityId === cityId) return;
      const m = list.find((x) => x.cityId === cityId);
      if (m) openMeeting(m);
    },
    [list, selected, openMeeting],
  );

  // "You are here" only when the distance origin is not just the home city hall.
  const homeCity = P.homeCityId ? cityById(P.homeCityId) : null;
  const you = P.location && !(homeCity && haversineMiles(P.location, cityPoint(homeCity)) < 0.3) ? P.location : null;
  const centre = homeCity ? cityPoint(homeCity) : P.location;

  // ---------- pieces ----------
  const milesOn = f.miles != null && P.location != null;
  const sheetCount = (milesOn ? 1 : 0) + f.topics.length;
  const anyFilter = f.after || f.speak || f.remote || milesOn || f.topics.length > 0;
  const clearAll = () => update({ q: '', after: false, speak: false, remote: false, miles: null, topics: [] });
  const topicOnly = query && !query.cityIds.size && query.topicIds.length > 0;
  const hintTopic = topicOnly ? topics.find((tp) => tp.id === query.topicIds[0]) : null;

  const daysLabel = (d) => t(`meetings.days${d}`);
  const dayHead = (date) => (date === today ? t('common.today') : date === addDays(today, 1) ? t('common.tomorrow') : formatDate(date, { long: true }));

  const row = (m, i) => (
    <li key={m.id}>
      <MeetingRow
        meeting={m}
        city={cityById(m.cityId)}
        onSelect={openMeeting}
        selected={Boolean(selected && selected.id === m.id)}
        homeCityId={P.homeCityId}
        distanceMiles={milesTo.has(m.cityId) ? milesTo.get(m.cityId) : null}
        deadline={m.openToPublicComment ? meetingDeadline(m, now) : null}
        showTiming={!f.after}
        aria-haspopup={isDesktop ? undefined : 'dialog'}
        data-mid={m.id}
        data-idx={i}
      />
    </li>
  );

  let body;
  if (!list.length) {
    if (query) {
      body = (
        <EmptyState
          icon="search"
          title={t('meetings.noSearchTitle', { q: f.q.trim() })}
          actions={
            <button type="button" className="btn btn--primary" onClick={() => update({ q: '' })}>
              {t('meetings.clearSearch')}
            </button>
          }
        >
          {t('meetings.noSearchBody')}
        </EmptyState>
      );
    } else if (anyFilter) {
      body = (
        <EmptyState
          icon="cal"
          title={t('meetings.emptyTitle')}
          actions={
            <button type="button" className="btn btn--primary" onClick={clearAll}>
              {t('meetings.clearFilters')}
            </button>
          }
        >
          {t('meetings.emptyBody')}
        </EmptyState>
      );
    } else {
      body = (
        <EmptyState
          icon="cal"
          title={t('meetings.emptyWindowTitle', { n: f.days })}
          actions={
            f.days < 30 ? (
              <button type="button" className="btn btn--primary" onClick={() => update({ days: 30 })}>
                {t('meetings.showThirty')}
              </button>
            ) : null
          }
        >
          {t('meetings.emptyWindowBody')}
        </EmptyState>
      );
    }
  } else if (sort === 'best') {
    body = <ul className="group">{shown.map(row)}</ul>;
  } else {
    const groups = [];
    shown.forEach((m, i) => {
      const last = groups[groups.length - 1];
      if (last && last.date === m.date) last.items.push([m, i]);
      else groups.push({ date: m.date, items: [[m, i]] });
    });
    body = groups.map((g) => (
      <section key={g.date} className="mtg__day" aria-labelledby={`day-${g.date}`}>
        <h2 className="day-head" id={`day-${g.date}`}>
          {dayHead(g.date)}
        </h2>
        <ul className="group">{g.items.map(([m, i]) => row(m, i))}</ul>
      </section>
    ));
  }

  const remaining = list.length - shown.length;
  // Sorting orders the list; on a phone's map there is no list to order.
  const showSort = hasPlace && !(view === 'map' && !isDesktop);
  const mapBlock = (
    <Suspense fallback={<div className="map map--loading" role="status" aria-label={t('meetings.mapLoading')} />}>
      <MapView pins={pins} selectedId={selected ? selected.cityId : null} onSelect={onPin} you={you} home={centre} insetRight={isDesktop && selected ? PANEL_INSET : 0} />
    </Suspense>
  );

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
          <div className="mtg__chips">
            <div className="chipbar" role="group" aria-label={t('meetings.filtersLabel')}>
              <Chip icon="sliders" count={sheetCount} aria-haspopup="dialog" onClick={() => setFiltersOpen(true)}>
                {t('meetings.filters')}
              </Chip>
              <Menu
                label={daysLabel(f.days)}
                buttonClassName="chip chip--menu"
                align="start"
                button={
                  <>
                    {daysLabel(f.days)}
                    <Icon name="chev-d" size={20} />
                  </>
                }
                items={DAYS.map((d) => ({ type: 'radio', label: daysLabel(d), checked: f.days === d, onSelect: () => update({ days: d }) }))}
              />
              <Chip pressed={f.after} onClick={() => update({ after: !f.after })}>
                {t('ui.timing.after')}
              </Chip>
              <Chip pressed={f.speak} onClick={() => update({ speak: !f.speak })}>
                {t('ui.canSpeak')}
              </Chip>
              <Chip pressed={f.remote} onClick={() => update({ remote: !f.remote })}>
                {t('meetings.remoteOk')}
              </Chip>
            </div>
          </div>
        </div>

        {hintTopic && <p className="mtg__hint">{t('meetings.topicHint', { topic: hintTopic.short || lowerFirst(hintTopic.label) })}</p>}

        <div className={`listbar${showSort ? '' : ' listbar--count'}`}>
          {showSort ? (
            <Menu
              label={`${t('meetings.sort')}: ${sort === 'best' ? t('meetings.sortBest') : t('meetings.sortSoonest')}`}
              buttonClassName="sortbtn"
              align="start"
              button={
                <>
                  {sort === 'best' ? t('meetings.sortBest') : t('meetings.sortSoonest')}
                  <Icon name="chev-d" size={20} />
                </>
              }
              items={[
                { type: 'radio', label: t('meetings.sortBest'), checked: sort === 'best', onSelect: () => update({ sort: 'best' }) },
                { type: 'radio', label: t('meetings.sortSoonest'), checked: sort === 'soonest', onSelect: () => update({ sort: 'soonest' }) },
              ]}
            />
          ) : null}
          <span className="count-l num" role="status" aria-live="polite">
            {tn('meetings.count', list.length)}
          </span>
        </div>

        {view === 'map' && !isDesktop ? (
          <div className="mtg__phonemap">{mapBlock}</div>
        ) : (
          <>
            {body}
            {remaining > 0 && (
              <button type="button" className="btn btn--secondary btn--block mtg__more" onClick={showMore}>
                {t('meetings.showMore', { n: Math.min(PAGE, remaining) })}
              </button>
            )}
          </>
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
            <aside
              ref={panelRef}
              className="panel mtg-panel"
              aria-labelledby="md-h"
              tabIndex={-1}
              onKeyDown={(e) => {
                if (e.key === 'Escape') {
                  e.stopPropagation();
                  closeMeeting();
                }
              }}
            >
              <div className="sheet__bar">
                <span className="sheet__title">
                  <MeetingDetailBadge meeting={selected} homeCityId={P.homeCityId} />
                </span>
                <button type="button" className="iconbtn" aria-label={t('common.close')} onClick={closeMeeting}>
                  <Icon name="x" />
                </button>
              </div>
              <MeetingDetail key={selected.id} className="mtg-panel__body" meeting={selected} city={selectedCity} today={today} now={now} headingId="md-h" nextSpeakable={nextSpeakable} onOpenMeeting={openMeeting} />
            </aside>
          )}
        </div>
      )}

      {!isDesktop && (
        <Sheet open={Boolean(selected)} onClose={closeMeeting} labelledBy="md-h" barStart={selected ? <MeetingDetailBadge meeting={selected} homeCityId={P.homeCityId} /> : null}>
          {selected && <MeetingDetail key={selected.id} meeting={selected} city={selectedCity} today={today} now={now} headingId="md-h" nextSpeakable={nextSpeakable} onOpenMeeting={openMeeting} />}
        </Sheet>
      )}

      <Sheet
        open={filtersOpen}
        onClose={() => setFiltersOpen(false)}
        title={t('meetings.filters')}
        footer={
          <div className="btn-row mtg-filters__foot">
            <button type="button" className="btn btn--quiet" onClick={() => update({ days: 14, miles: defaults.miles, topics: [], remote: false })}>
              {t('meetings.clear')}
            </button>
            <button type="button" className="btn btn--primary" onClick={() => setFiltersOpen(false)}>
              {tn('meetings.showResults', list.length)}
            </button>
          </div>
        }
      >
        <div className="mtg-filters">
          <fieldset>
            <legend className="label">{t('meetings.when')}</legend>
            <ChoiceChips name="mtg-days" value={f.days} onChange={(d) => update({ days: d })} options={DAYS.map((d) => ({ value: d, label: daysLabel(d) }))} />
          </fieldset>
          <fieldset>
            <legend className="label">{t('meetings.distance')}</legend>
            {P.location ? (
              <ChoiceChips
                name="mtg-miles"
                value={f.miles == null ? 'any' : f.miles}
                onChange={(v) => update({ miles: v === 'any' ? null : v })}
                options={[{ value: 'any', label: t('meetings.anyDistance') }, ...milesChoices(P.maxMiles).map((n) => ({ value: n, label: t('ui.milesShort', { n }) }))]}
              />
            ) : (
              <p className="help">
                {t('meetings.distanceNeedsCity')}{' '}
                <Link className="link" to={setupTo(location)} state={SETUP_STATE}>
                  {t('meetings.setCity')}
                </Link>
              </p>
            )}
          </fieldset>
          <fieldset>
            <legend className="label">{t('meetings.topics')}</legend>
            <p className="help">{t('meetings.topicsHelp')}</p>
            <div className="chipwrap">
              {topics.map((tp) => {
                const on = f.topics.includes(tp.id);
                return (
                  <Chip key={tp.id} pressed={on} onClick={() => update({ topics: on ? f.topics.filter((x) => x !== tp.id) : [...f.topics, tp.id] })}>
                    {tp.label}
                  </Chip>
                );
              })}
            </div>
          </fieldset>
          <label className="check-row">
            <input type="checkbox" checked={f.remote} onChange={(e) => update({ remote: e.target.checked })} />
            <span>{t('meetings.remoteLong')}</span>
          </label>
        </div>
      </Sheet>
    </div>
  );
}
