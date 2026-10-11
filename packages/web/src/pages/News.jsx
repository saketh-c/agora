import { useEffect, useMemo, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { formatDate, getTopic, isTopicId, lowerFirst, t, tn, topicList } from '@agora/core';
import { sources as NEWSROOMS } from '@data/news.json';
import { useStore } from '../lib/store.jsx';
import { useCities } from '../lib/DataProvider.jsx';
import { api } from '../lib/api.js';
import useClock from '../components/home/useClock.js';
import { useSkipLink } from '../components/shell/PageMeta.jsx';
import { EmptyState, Icon, Menu, Notice, PageHeader, Section, matchCities } from '../components/ui/index.js';
import '../styles/pages/news.css';

const PAGE = 30;
const DEBOUNCE_MS = 400;
/** A tab that comes back after this long fetches the headlines again. */
const REFRESH_MS = 30 * 60 * 1000;
const CENTRAL = 'America/Chicago';

/** 'YYYY-MM-DD' of an instant, in Dallas-Fort Worth. */
function centralDay(iso) {
  const d = new Date(iso);
  if (!iso || Number.isNaN(d.getTime())) return '';
  return new Intl.DateTimeFormat('en-CA', { timeZone: CENTRAL, year: 'numeric', month: '2-digit', day: '2-digit' }).format(d);
}

function dayLabel(day, today) {
  if (!day) return '';
  if (day === today) return t('common.today');
  const y = new Date(`${today}T12:00:00Z`);
  y.setUTCDate(y.getUTCDate() - 1);
  if (day === y.toISOString().slice(0, 10)) return t('news.yesterday');
  return formatDate(day, { withYear: day.slice(0, 4) !== today.slice(0, 4) });
}

const LOCALE = { en: 'en-US', es: 'es-US', vi: 'vi-VN' };

const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** The few newsrooms to read directly when headlines cannot load. */
const FALLBACK_ROOMS = (NEWSROOMS || []).filter((s) => s.homepage && (s.coverage || []).includes('dfw')).slice(0, 4);

/**
 * News: recent local reporting on city government, filtered to the student's topics by
 * default. Headlines load once (one request, up to 200 stories from the last 30 days) and
 * every filter works on that list in the browser, so typing a city never fires a request.
 */
export default function News() {
  const { prefs, lang } = useStore();
  const { cities, cityById } = useCities();
  const [params, setParams] = useSearchParams();
  const { today } = useClock();
  useSkipLink('nw-results', t('shell.skip.headlines'));
  const interests = useMemo(() => (prefs.interests || []).filter((id) => id !== 'other'), [prefs.interests]);
  // ?city= (a city id from a city page's "See all", or typed text) starts the city filter, and
  // then every topic, so the stories the city page showed are the ones that open here.
  const initialCity = useMemo(() => {
    const raw = (params.get('city') || '').trim();
    const hit = raw ? cityById(raw.toLowerCase()) : null;
    return hit ? hit.name : raw;
    // Read once, on arrival.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  // ?topic= keeps the topic across a reload or Back; without it, your topics (or all of them).
  const defaultTopic = interests.length ? 'yours' : 'all';
  const [topic, setTopicState] = useState(() => {
    const raw = (params.get('topic') || '').trim();
    if (raw === 'all' || (raw === 'yours' && interests.length) || (raw !== 'other' && isTopicId(raw))) return raw;
    return initialCity ? 'all' : defaultTopic;
  });
  const setTopic = (value) => {
    setTopicState(value);
    // From the address as it is now, so a city filter written a moment ago is kept.
    const next = new URLSearchParams(window.location.search);
    if (value === defaultTopic) next.delete('topic');
    else next.set('topic', value);
    setParams(next, { replace: true });
  };
  const [cityInput, setCityInput] = useState(initialCity);
  const [cityQuery, setCityQuery] = useState(initialCity);
  const [state, setState] = useState({ status: 'loading', data: null, error: null });
  const [attempt, setAttempt] = useState(0);
  const [limit, setLimit] = useState(PAGE);

  // `attempt` counts loads: the first, Try again, and a quiet refresh when a tab left open
  // comes back after a while. A quiet refresh keeps the list on screen while it loads, and
  // keeps it if the refresh fails.
  const loadedAt = useRef(0);
  const quiet = useRef(false);
  useEffect(() => {
    const controller = new AbortController();
    const keep = quiet.current;
    quiet.current = false;
    if (!keep) setState((s) => ({ ...s, status: 'loading', error: null }));
    api
      .news({ limit: 200 }, { signal: controller.signal })
      .then((data) => {
        loadedAt.current = Date.now();
        setState({ status: 'ok', data, error: null });
      })
      .catch((error) => {
        if (error && error.code === 'aborted') return;
        if (!keep) setState({ status: 'error', data: null, error });
      });
    return () => controller.abort();
  }, [attempt]);

  useEffect(() => {
    const onVisible = () => {
      if (document.visibilityState !== 'visible' || !loadedAt.current || Date.now() - loadedAt.current < REFRESH_MS) return;
      quiet.current = true;
      setAttempt((n) => n + 1);
    };
    document.addEventListener('visibilitychange', onVisible);
    return () => document.removeEventListener('visibilitychange', onVisible);
  }, []);

  // The city box filters after a short pause, not on every keystroke.
  useEffect(() => {
    const timer = setTimeout(() => setCityQuery(cityInput.trim()), DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [cityInput]);

  useEffect(() => setLimit(PAGE), [topic, cityQuery]);

  const items = useMemo(() => (state.data && Array.isArray(state.data.items) ? state.data.items.filter((i) => i && i.title && i.link) : []), [state.data]);

  const counts = useMemo(() => {
    const m = new Map();
    for (const i of items) for (const id of i.topics || []) m.set(id, (m.get(id) || 0) + 1);
    return m;
  }, [items]);

  // Your topics first, then every other topic that has stories, most covered first.
  const topics = useMemo(() => {
    const all = topicList().filter((x) => x.id !== 'other');
    const mine = interests.map((id) => all.find((x) => x.id === id)).filter(Boolean);
    const rest = all.filter((x) => !interests.includes(x.id) && counts.get(x.id)).sort((a, b) => counts.get(b.id) - counts.get(a.id));
    return { mine, rest };
    // lang: topic labels are read in the current language.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [interests, counts, lang]);

  const city = useMemo(() => {
    if (!cityQuery) return null;
    const [hit] = matchCities(cities, cityQuery, 1);
    return hit || null;
  }, [cities, cityQuery]);

  // The settled city filter lives in the address (as the city's id when it names one), so a
  // link or a reload opens the same list. Replace, so typing never piles up history.
  const firstSync = useRef(true);
  useEffect(() => {
    if (firstSync.current) {
      firstSync.current = false;
      return;
    }
    const value = cityQuery ? (city ? city.cityId : cityQuery) : '';
    setParams(
      (prev) => {
        const next = new URLSearchParams(prev);
        if (value) next.set('city', value);
        else next.delete('city');
        return next;
      },
      { replace: true },
    );
  }, [cityQuery, city, setParams]);

  const shown = useMemo(() => {
    let list = items;
    if (topic === 'yours') list = list.filter((i) => (i.topics || []).some((id) => interests.includes(id)));
    else if (topic !== 'all') list = list.filter((i) => (i.topics || []).includes(topic));
    if (cityQuery) {
      const name = city ? city.name : cityQuery;
      const word = new RegExp(`(^|[^\\p{L}])${escapeRe(name)}($|[^\\p{L}])`, 'iu');
      // The same test the server runs for a city page's "in the news" list: the stories that
      // name the city or its county, or that mention it in the headline or summary.
      list = list.filter((i) => (city && ((i.places || []).includes(city.cityId) || (city.county && (i.counties || []).includes(city.county)))) || word.test(`${i.title} ${i.description || ''}`));
    }
    return list;
  }, [items, topic, interests, cityQuery, city]);

  const groups = useMemo(() => {
    const out = [];
    for (const item of shown.slice(0, limit)) {
      const day = centralDay(item.publishedAt);
      const last = out[out.length - 1];
      if (last && last.day === day) last.items.push(item);
      else out.push({ day, items: [item] });
    }
    return out;
  }, [shown, limit]);

  const topicName = topic === 'yours' ? t('news.yourTopics') : topic === 'all' ? t('news.allTopics') : getTopic(topic).label;
  const radio = (x) => ({ type: 'radio', key: x.id, label: t('news.topicCount', { topic: x.label, n: counts.get(x.id) || 0 }), checked: topic === x.id, onSelect: () => setTopic(x.id) });
  const menuItems = [
    ...(interests.length ? [{ type: 'radio', key: 'yours', label: t('news.yourTopics'), checked: topic === 'yours', onSelect: () => setTopic('yours') }] : []),
    { type: 'radio', key: 'all', label: t('news.allTopics'), checked: topic === 'all', onSelect: () => setTopic('all') },
    { type: 'separator' },
    ...(topics.mine.length ? [{ type: 'group', label: t('news.yourTopics') }, ...topics.mine.map(radio)] : []),
    ...(topics.rest.length ? [{ type: 'group', label: topics.mine.length ? t('news.moreTopics') : t('news.topicsLabel') }, ...topics.rest.map(radio)] : []),
  ];
  const data = state.data;
  const unavailable = state.status === 'error' || (state.status === 'ok' && data && Number(data.fetchedFeeds) === 0 && !items.length);
  const cityName = city ? city.name : cityQuery;

  const links = useMemo(() => {
    if (!data || !Array.isArray(data.topicLinks)) return [];
    const wanted = topic === 'all' ? null : topic === 'yours' ? interests : [topic];
    const seen = new Set();
    const out = [];
    for (const l of data.topicLinks) {
      if (!l || !l.url || (wanted && !wanted.includes(l.topic)) || seen.has(l.sourceName)) continue;
      seen.add(l.sourceName);
      out.push(l);
      if (out.length >= 6) break;
    }
    return out;
  }, [data, topic, interests]);

  const snapshotWhen =
    data && data.snapshotAt
      ? new Intl.DateTimeFormat(LOCALE[lang] || 'en-US', { timeZone: CENTRAL, month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }).format(new Date(data.snapshotAt))
      : '';

  return (
    <div className="wrap nw">
      <PageHeader title={t('news.heading')} lead={t('news.lead', { n: (data && data.maxAgeDays) || 30 })}>
        {lang !== 'en' && (
          <Notice className="nw-lang" icon="globe">
            {t('news.englishNote')}
          </Notice>
        )}
      </PageHeader>

      <div className="nw-grid">
        <div className="nw-main">
          <div className="nw-tools">
            <Menu
              align="start"
              className="nw-topic"
              label={`${t('news.topicsLabel')}: ${topicName}`}
              buttonClassName="chip chip--menu"
              button={
                <>
                  {topicName}
                  <Icon name="chev-d" size={20} />
                </>
              }
              items={menuItems}
            />
            <div className="search nw-search">
              <Icon name="search" />
              <label className="vh" htmlFor="nw-city">
                {t('news.cityLabel')}
              </label>
              <input id="nw-city" type="search" value={cityInput} onChange={(e) => setCityInput(e.target.value)} placeholder={t('news.cityPlaceholder')} autoComplete="off" enterKeyHint="search" />
            </div>
          </div>

          {state.status === 'loading' && <Loading />}

          {unavailable && <Unavailable error={state.error} onRetry={() => setAttempt((n) => n + 1)} />}

          {state.status === 'ok' && !unavailable && (
            <>
              <div className="nw-listbar" id="nw-results">
                <p className="nw-listbar__count" aria-live="polite">
                  {cityQuery ? tn('news.countCity', shown.length, { city: cityName }) : tn('news.headlinesShown', shown.length)}
                </p>
                {snapshotWhen && <p className="nw-listbar__when">{t('news.snapshotNote', { when: snapshotWhen })}</p>}
              </div>

              {shown.length === 0 ? (
                <EmptyState
                  icon="news"
                  title={topic === 'yours' && !cityQuery ? t('news.emptyYoursTitle') : t('news.emptyTitle')}
                  actions={
                    <>
                      {topic !== 'all' && (
                        <button type="button" className="btn btn--secondary" onClick={() => setTopic('all')}>
                          {t('news.showAllTopics')}
                        </button>
                      )}
                      {cityQuery && (
                        <button
                          type="button"
                          className="btn btn--quiet"
                          onClick={() => {
                            setCityInput('');
                            setCityQuery('');
                          }}
                        >
                          {t('news.clearCity')}
                        </button>
                      )}
                    </>
                  }
                >
                  {topic === 'yours' && !cityQuery ? t('news.emptyYoursBody') : t('news.emptyBody')}
                </EmptyState>
              ) : (
                <div className="nw-days">
                  {groups.map((g) => (
                    <section key={g.day || 'undated'} className="nw-day" aria-labelledby={`nw-d-${g.day}`}>
                      <h2 className="day-head" id={`nw-d-${g.day}`}>
                        {dayLabel(g.day, today)}
                      </h2>
                      <ul className="group">
                        {g.items.map((item) => (
                          <li key={item.link}>
                            <a className="lrow nw-row" href={item.link} target="_blank" rel="noopener noreferrer">
                              <span className="nw-row__main">
                                <span className="lrow__t" lang="en">
                                  {item.title}
                                </span>
                                {item.description && (
                                  <span className="nw-row__d" lang="en">
                                    {item.description}
                                  </span>
                                )}
                                <span className="lrow__m" lang="en">
                                  {item.sourceName}
                                </span>
                              </span>
                              <Icon name="ext" />
                              <span className="vh">{t('ui.opensNewTab')}</span>
                            </a>
                          </li>
                        ))}
                      </ul>
                    </section>
                  ))}
                  {shown.length > limit && (
                    <button type="button" className="btn btn--secondary nw-more" onClick={() => setLimit((n) => n + PAGE)}>
                      {t('news.showMore')}
                    </button>
                  )}
                  {data.pendingFeeds > 0 && <p className="nw-pending">{t('news.pending')}</p>}
                </div>
              )}
            </>
          )}
        </div>

        {links.length > 0 && (
          <aside className="nw-side">
            <Section title={t('news.keepReading')} id="nw-more">
              <ul className="group">
                {links.map((l) => (
                  <li key={l.url}>
                    <a className="lrow" href={l.url} target="_blank" rel="noopener noreferrer">
                      <span>
                        <span className="lrow__t">{l.sourceName}</span>
                        <span className="lrow__m">{t('news.coverage', { topic: lowerFirst(getTopic(l.topic).label) })}</span>
                      </span>
                      <Icon name="ext" />
                      <span className="vh">{t('ui.opensNewTab')}</span>
                    </a>
                  </li>
                ))}
              </ul>
            </Section>
          </aside>
        )}
      </div>
    </div>
  );
}

function Loading() {
  return (
    <div className="nw-loading" role="status" aria-live="polite">
      <span className="vh">{t('news.loading')}</span>
      <span className="skel nw-loading__head" aria-hidden="true" />
      <ul className="group" aria-hidden="true">
        {[0, 1, 2, 3].map((i) => (
          <li key={i} className="nw-loading__row">
            <span className="skel" />
            <span className="skel" />
            <span className="skel" />
          </li>
        ))}
      </ul>
    </div>
  );
}

/** Says what went wrong (busy, offline, or the service), and what to do next. */
function Unavailable({ error, onRetry }) {
  const code = error && error.code;
  const busy = code === 'rate_limited' || code === 'busy';
  const offline = !busy && typeof navigator !== 'undefined' && navigator.onLine === false;
  const wait = error && Number(error.retryAfter) > 0 ? Math.ceil(Number(error.retryAfter)) : 0;
  const title = busy ? t('news.busyTitle') : offline ? t('news.offlineTitle') : t('news.downTitle');
  const body = busy ? (wait ? tn('news.busyBody', wait) : t('news.busyBodySoon')) : offline ? t('news.offlineBody') : t('news.downBody');
  return (
    <div className="nw-down">
      <EmptyState
        icon={busy ? 'clock' : 'offline'}
        title={title}
        role="status"
        actions={
          <button type="button" className="btn btn--primary" onClick={onRetry}>
            <Icon name="refresh" size={20} />
            {t('news.retry')}
          </button>
        }
      >
        {body}
      </EmptyState>
      {!busy && FALLBACK_ROOMS.length > 0 && (
        <Section title={t('news.newsrooms')} level={2} className="nw-rooms">
          <ul className="group">
            {FALLBACK_ROOMS.map((s) => (
              <li key={s.id}>
                <a className="lrow" href={s.homepage} target="_blank" rel="noopener noreferrer">
                  <span className="lrow__t">{s.name}</span>
                  <Icon name="ext" />
                  <span className="vh">{t('ui.opensNewTab')}</span>
                </a>
              </li>
            ))}
          </ul>
        </Section>
      )}
    </div>
  );
}
