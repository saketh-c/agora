import { Fragment, useEffect, useId, useMemo, useRef, useState } from 'react';
import { Link, useLocation, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import {
  agendaFor,
  calendarThrough,
  daysBetween,
  describeRecurrence,
  expandCityMeetings,
  formatDate,
  getLocale,
  getTopic,
  hasEnded,
  inferTopics,
  lowerFirst,
  nextMeetingFor,
  relativeDays,
  t,
  tn,
  windowEnd,
} from '@agora/core';
import { rawCity } from '../lib/data.js';
import { parseDeadlineRule } from '../lib/deadline.js';
import { useCities } from '../lib/DataProvider.jsx';
import { useStore } from '../lib/store.jsx';
import { api } from '../lib/api.js';
import { directionsUrl } from '../lib/ics.js';
import { usePageTitle } from '../components/shell/PageMeta.jsx';
import useClock from '../components/home/useClock.js';
import {
  AddToCalendar,
  asSentence,
  Badge,
  DateTile,
  deadlineText,
  Disclosure,
  EmptyState,
  Icon,
  Linkified,
  meetingDeadline,
  MeetingDetail,
  MeetingDetailBadge,
  MeetingShare,
  MeetingStatus,
  meetingTitle,
  monthDay,
  NewsList,
  Notice,
  PageHeader,
  remoteState,
  Section,
  Sheet,
  speakMinutes,
  tidyTimes,
  timeText,
  whenText,
} from '../components/ui/index.js';
import '../styles/pages/city.css';

const HORIZON = 90;
const PER_RULE = 6;
/** A city checked longer ago than this says so, instead of a plain "Verified" line. */
const STALE_DAYS = 45;

const hostOf = (url) => {
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return '';
  }
};

/** The first sentence of a longer data paragraph. */
function firstSentence(text) {
  const s = String(text || '').trim();
  const cut = s.search(/[.!?](\s+)(?=[A-ZÁÉÍÓÚÑĐ0-9"(])/u);
  return cut > 0 ? s.slice(0, cut + 1) : s;
}

/** One agenda item with "Explain this": AI when the server has it, a topic guide otherwise. */
function AgendaItem({ item, index, city }) {
  const [state, setState] = useState({ status: 'idle', text: '' });
  const id = useId();
  const busy = state.status === 'loading';
  const open = state.status === 'open';

  const toggle = async () => {
    if (busy) return; // a second click while waiting must not send a second request
    if (open) return setState((s) => ({ ...s, status: 'closed' }));
    if (state.text) return setState((s) => ({ ...s, status: 'open' }));
    setState({ status: 'loading', text: '' });
    try {
      // The English title and the item's position let the server find it in any language.
      const r = await api.explain({ title: item.titleSource || item.title, summary: item.summary, cityId: city.cityId, itemIndex: index >= 0 ? index : undefined });
      setState({ status: 'open', text: r.text });
    } catch {
      const topics = item.topics && item.topics.length ? item.topics : inferTopics(item.titleSource || item.title);
      const topic = getTopic(topics[0]);
      const lead = topic.id === 'other' ? t('drawer.itemOnAgenda', { city: city.name }) : t('drawer.itemAbout', { topic: topic.short, city: city.name });
      const why = topic.id === 'other' ? '' : ` ${t('drawer.whyMatters', { angle: topic.youthAngle })}`;
      setState({ status: 'open', text: `${lead} ${item.summary || ''}${why}`.replace(/\s+/g, ' ').trim() });
    }
  };

  // Items read from the city's agenda site stay in the city's English (core/src/agendas.js).
  const english = item.auto && !item.titleSource && getLocale() !== 'en' ? 'en' : undefined;

  return (
    <li className="agenda__item">
      <p className="agenda__t" lang={english}>
        {item.url ? (
          <a href={item.url} target="_blank" rel="noopener noreferrer">
            {item.title}
            <span className="vh"> {t('ui.opensNewTab')}</span>
          </a>
        ) : (
          item.title
        )}
      </p>
      {item.summary && (
        <p className="agenda__s" lang={english}>
          {item.summary}
        </p>
      )}
      <button type="button" className="btn btn--quiet btn--sm agenda__btn" onClick={toggle} aria-expanded={open} aria-controls={id} aria-busy={busy || undefined}>
        {busy ? <span className="spinner" aria-hidden="true" /> : <Icon name="bulb" />}
        {open ? t('drawer.hide') : t('drawer.explainThis')}
      </button>
      <div id={id} role="status" aria-live="polite">
        {busy && <span className="vh">{t('drawer.explaining')}</span>}
        {open && (
          <Notice icon="bulb" className="agenda__x">
            <p>{state.text}</p>
          </Notice>
        )}
      </div>
    </li>
  );
}

/** The schedule rows for one meeting rule: date, time and whether you can speak. Each opens the meeting. */
function SchedList({ items, onOpen }) {
  const [all, setAll] = useState(false);
  const shown = all ? items : items.slice(0, PER_RULE);
  return (
    <>
      <ul className="sched">
        {shown.map((o) => {
          const cancelled = o.status === 'cancelled';
          const tone = cancelled ? 'stop' : o.openToPublicComment ? 'go' : 'watch';
          const icon = cancelled ? 'xc' : o.openToPublicComment ? 'mic' : 'eye';
          const label = cancelled ? t('ui.cancelled') : o.openToPublicComment ? t('ui.canSpeak') : t('ui.watchOnly');
          return (
            <li key={o.id}>
              <button type="button" className={`sched__row${cancelled ? ' is-cancelled' : ''}`} onClick={() => onOpen(o)} aria-haspopup="dialog">
                <span className="sched__when num">
                  <strong>{formatDate(o.date)}</strong>, {timeText(o.time)}
                  {o.movedFrom && <span className="sched__note">{t('ui.movedFrom', { date: formatDate(o.movedFrom) })}</span>}
                </span>
                <span className={`st st--${tone}`}>
                  <Icon name={icon} />
                  {label}
                </span>
              </button>
            </li>
          );
        })}
      </ul>
      {items.length > PER_RULE && (
        <button type="button" className="btn btn--quiet btn--sm sched__all" onClick={() => setAll((v) => !v)} aria-expanded={all}>
          {all ? t('common.showFewer') : t('common.showAll', { n: items.length })}
        </button>
      )}
    </>
  );
}

export default function CityPage() {
  const { id } = useParams();
  const key = String(id || '').toLowerCase();
  // A new city is a new page: no state (open sheet, expanded lists) carries over.
  return <CityView key={key} id={key} />;
}

function CityView({ id }) {
  const { cityById, cities } = useCities();
  const { prefs, setHomeCity, lang } = useStore();
  const city = cityById(id);
  usePageTitle(city ? city.name : t('city.notFound'));
  const [params, setParams] = useSearchParams();
  const location = useLocation();
  const navigate = useNavigate();
  // The minute clock (also refreshed when the tab comes back): a meeting that ends while the
  // page is open drops off, and the next one and its sign-up deadline take its place.
  const { today, now } = useClock();

  const upcoming = useMemo(() => (city ? expandCityMeetings(city, today, windowEnd(today, HORIZON)).filter((o) => !hasEnded(o, now)) : []), [city, today, now]);
  const next = useMemo(() => (city ? nextMeetingFor(city, today, { publicCommentOnly: true, horizonDays: HORIZON, now }) : null), [city, today, now]);
  const through = city ? calendarThrough(city) : null;
  const agenda = useMemo(() => (city ? agendaFor(city, today) : { upcoming: [], recent: [] }), [city, today]);

  // ---------- one meeting in a sheet (?meeting=<id>, or the older ?date=YYYY-MM-DD) ----------
  const meetingParam = params.get('meeting');
  const dateParam = params.get('date');
  const occ = useMemo(() => {
    if (meetingParam) return upcoming.find((o) => o.id === meetingParam) || null;
    if (dateParam) {
      const same = upcoming.filter((o) => o.date === dateParam);
      return same.find((o) => o.openToPublicComment && o.status !== 'cancelled') || same[0] || null;
    }
    return null;
  }, [meetingParam, dateParam, upcoming]);
  const occNext = useMemo(() => (occ && city && !occ.openToPublicComment && occ.status !== 'cancelled' ? nextMeetingFor(city, occ.date, { publicCommentOnly: true, now }) : null), [occ, city, now]);

  const dropMeetingParams = () =>
    setParams(
      (prev) => {
        const n = new URLSearchParams(prev);
        n.delete('meeting');
        n.delete('date');
        return n;
      },
      { replace: true },
    );
  // A link to a date with no meeting: drop it, so nothing reopens later.
  useEffect(() => {
    if ((meetingParam || dateParam) && !occ) dropMeetingParams();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [meetingParam, dateParam, occ]);

  const openOcc = (o) => {
    const already = Boolean(meetingParam || dateParam);
    setParams(
      (prev) => {
        const n = new URLSearchParams(prev);
        n.delete('date');
        n.set('meeting', o.id);
        return n;
      },
      already ? { replace: true, state: location.state } : { state: { meetingOpen: true } },
    );
  };
  // Closing removes the parameter, so a reload or Back never reopens the sheet.
  const closeOcc = () => {
    if (location.state && location.state.meetingOpen) navigate(-1);
    else dropMeetingParams();
  };

  // ---------- "Set as my city" ----------
  const isHome = Boolean(city && prefs.homeCityId === city.cityId);
  const mineRef = useRef(null);
  const justSet = useRef(false);
  const [said, setSaid] = useState('');
  useEffect(() => {
    if (isHome && justSet.current && mineRef.current) mineRef.current.focus();
    justSet.current = false;
  }, [isHome]);

  // ---------- news for this city ----------
  const [news, setNews] = useState({ status: 'loading', items: [] });
  const cityName = city ? city.name : '';
  useEffect(() => {
    if (!cityName) return undefined;
    const ac = new AbortController();
    setNews({ status: 'loading', items: [] });
    api
      .news({ city: cityName, limit: 3 }, { signal: ac.signal })
      .then((r) => setNews({ status: 'ok', items: (r && r.items) || [] }))
      .catch((err) => {
        if (err && err.code === 'aborted') return;
        setNews({ status: 'error', items: [] });
      });
    return () => ac.abort();
  }, [cityName, lang]);

  if (!city) {
    return (
      <div className="wrap city">
        <PageHeader title={t('city.notFound')} crumbs={[{ to: '/meetings', label: t('nav.meetings') }, { to: '/cities', label: t('cities.title') }, { label: t('city.notFound') }]} />
        <EmptyState
          icon="map"
          className="city__missing"
          actions={
            <Link className="btn btn--primary" to="/cities">
              {t('city.seeAllCities')}
            </Link>
          }
          title={t('city.missingTitle')}
        >
          {t('city.notFoundBody', { n: cities.length })}
        </EmptyState>
      </div>
    );
  }

  const pc = city.publicComment || {};
  const council = city.council || {};
  const hall = city.cityHall || {};
  const hallName = String(hall.name || '')
    .replace(/\s*\([^)]*\)/g, '')
    .split(',')[0]
    .trim();
  const street = String(hall.address || '').split(',')[0].trim();
  // Street names end in an abbreviation ("200 N. Fifth St."), and the sentence around the
  // place ends with its own period, so the place gives its period up: never "St..".
  const place = [hallName, street].filter(Boolean).join(', ').replace(/\.+$/, '');
  const members = Number(council.size) > 1 ? Number(council.size) - 1 : null;
  const lead = council.mayorName && members ? t('city.lead', { mayor: t('city.mayor', { name: council.mayorName }), n: members, place }) : t('city.meetsAt', { place });

  const deadline = next ? meetingDeadline(next, now) : null;
  const before = next ? upcoming.find((o) => o.date === next.date && o.time < next.time && !o.openToPublicComment && o.status !== 'cancelled') : null;
  const minutes = speakMinutes(city);
  const remote = remoteState(city);
  // Step 1 in the app's own words when the city's deadline is one the app understands
  // (Plano, Dallas, Fort Worth); the city's wording then moves into "Full rules".
  const rule = parseDeadlineRule(((rawCity(city.cityId) || {}).publicComment || {}).deadline);
  const signupRule = !rule
    ? ''
    : rule.kind === 'sameDay'
      ? t('city.signupRule.sameDay', { time: timeText(rule.time) })
      : rule.kind === 'hoursBefore'
        ? rule.minutes % 60 === 0
          ? tn('city.signupRule.hoursBefore', rule.minutes / 60)
          : tn('city.signupRule.minutesBefore', rule.minutes)
        : t('city.signupRule.businessDay', { time: timeText(rule.time) });
  const fullRules = [signupRule && pc.deadline ? t('city.deadline', { deadline: pc.deadline }) : '', pc.summary, pc.howToRegister, pc.notes].filter(Boolean);
  const throughYear = through ? Number(through.slice(0, 4)) + 1 : null;

  // Schedule: one disclosure per meeting rule, plus special and moved meetings that belong to none.
  const used = new Set();
  const groups = (city.meetings || []).map((rule, i) => {
    const items = upcoming.filter((o) => o.label === rule.label && o.status !== 'special');
    items.forEach((o) => used.add(o.id));
    const title = meetingTitle({ label: rule.label, cityName: city.name });
    const rec = describeRecurrence(rule.recurrence);
    const time = rule.recurrence && rule.recurrence.time;
    return { key: `rule-${i}`, title, time, summary: rule.openToPublicComment === false ? t('city.ruleWatch', { rule: rec }) : rec, items };
  });
  // Two rules with the same name ("Work session" at 9 AM and at 2 PM) read as a duplicate: name the time.
  const shared = new Set(groups.filter((g, i) => groups.some((o, j) => j !== i && o.title === g.title)).map((g) => g.title));
  for (const g of groups) {
    if (g.time && shared.has(g.title)) g.title = t('city.ruleAt', { title: g.title, time: timeText(g.time) });
  }
  const extra = upcoming.filter((o) => !used.has(o.id));
  if (extra.length) groups.push({ key: 'extra', title: t('city.special'), summary: tn('city.upcomingCount', extra.length), items: extra });
  const firstOpen = Math.max(
    0,
    groups.findIndex((g) => g.items.some((o) => o.openToPublicComment)),
  );

  // Upcoming agenda items, soonest meeting first, grouped by date (undated ones last).
  const upcomingByDate = [];
  for (const item of agenda.upcoming) {
    const last = upcomingByDate[upcomingByDate.length - 1];
    const date = item.meetingDate || null;
    if (last && last.date === date) last.items.push(item);
    else upcomingByDate.push({ date, items: [item] });
  }

  // Recent agenda items, newest meeting first, grouped by date.
  const recentByDate = [];
  for (const item of agenda.recent) {
    const last = recentByDate[recentByDate.length - 1];
    if (last && last.date === item.meetingDate) last.items.push(item);
    else recentByDate.push({ date: item.meetingDate, items: [item] });
  }
  const recentSummary = recentByDate.length === 1 ? tn('city.recentFrom', agenda.recent.length, { date: monthDay(recentByDate[0].date) }) : recentByDate.length ? tn('city.recentSince', agenda.recent.length, { date: monthDay(recentByDate[recentByDate.length - 1].date) }) : '';
  const indexOf = (item) => (city.agendaItems || []).indexOf(item);

  // Official links, each with the site it goes to; sources with one link per site.
  const links = [];
  const seenUrls = new Set();
  const addLink = (url, title, sub) => {
    if (!url || seenUrls.has(url)) return;
    seenUrls.add(url);
    links.push({ url, title, sub: sub || hostOf(url) });
  };
  addLink(city.website, t('city.website'));
  // A platform is worth showing only when it is a real name ("Legistar"), not "other".
  const platform = city.agendaPortal && city.agendaPortal.platform;
  if (city.agendaPortal) addLink(city.agendaPortal.url, t('city.agendas'), platform && !/^(other|unknown|none|n\/a)$/i.test(platform) ? platform : undefined);
  if (city.liveStream) addLink(city.liveStream.url, t('ui.watchLive'));
  addLink(council.findMyDistrictUrl || council.districtMapUrl, t('city.districtMap'));
  const sourceHosts = new Map();
  for (const s of city.sources || []) {
    const host = hostOf(s);
    if (host && !sourceHosts.has(host)) sourceHosts.set(host, s);
  }

  const youth = city.youthPrograms || [];
  const stale = Boolean(city.lastVerified) && daysBetween(city.lastVerified, today) > STALE_DAYS;

  return (
    <div className="wrap city">
      <PageHeader
        className="city-head"
        title={t('city.councilTitle', { city: city.name })}
        lead={lead}
        crumbs={[{ to: '/meetings', label: t('nav.meetings') }, { to: '/cities', label: t('cities.title') }, { label: city.name }]}
        actions={
          isHome ? (
            <span ref={mineRef} tabIndex={-1} className="city-head__mine">
              <Badge tone="ink" icon="check">
                {t('ui.yourCity')}
              </Badge>
            </span>
          ) : (
            <button
              type="button"
              className="btn btn--secondary btn--sm city-head__set"
              onClick={() => {
                justSet.current = true;
                setHomeCity(city);
                setSaid(t('city.nowYourCity', { city: city.name }));
              }}
            >
              <Icon name="pin" />
              {t('common.setAsMyCity')}
            </button>
          )
        }
      />
      <p className="vh" role="status" aria-live="polite">
        {said}
      </p>

      <div className="city-grid">
        <div className="city-main">
          <section aria-labelledby="nm-h">
            <div className="sec-head">
              <h2 className="t-heading" id="nm-h">
                {t('city.nextSpeak')}
              </h2>
            </div>
            {next ? (
              <div className="meetcard">
                <div className="meetcard__top">
                  <DateTile date={next.date} size="lg" />
                  <div>
                    <p className="meetcard__t">{meetingTitle(next)}</p>
                    <p className="meetcard__w num">
                      <strong>{whenText(next.date, next.time)}</strong> <span>{lowerFirst(relativeDays(next.date, today))}</span>
                    </p>
                  </div>
                </div>
                <MeetingStatus variant="badges" meeting={next} city={city} showRemote />
                {deadline && (
                  <p className={`deadline st st--${deadline.passed ? 'stop' : 'amber'}`}>
                    <Icon name="clock" />
                    {deadline.passed ? t('ui.signupClosed') : `${asSentence(deadlineText(deadline, 'closes'))} ${t('ui.noDoorSignup')}`}
                  </p>
                )}
                <div className="btn-row">
                  <Link className="btn btn--primary" to={`/prepare?meeting=${encodeURIComponent(next.id)}`}>
                    {t('ui.prepareToSpeak')}
                  </Link>
                  <span className="btn-row btn-row--tight">
                    <AddToCalendar meeting={next} city={city} now={now} />
                    <a className="btn btn--quiet" href={directionsUrl(next)} target="_blank" rel="noopener noreferrer">
                      <Icon name="nav" />
                      {t('ui.directions')}
                      <span className="vh"> {t('ui.opensNewTab')}</span>
                    </a>
                  </span>
                </div>
                {before && (
                  <p className="meetcard__also">
                    <Icon name="eye" />
                    <span>{t('city.alsoBefore', { time: timeText(before.time), title: lowerFirst(meetingTitle(before)) })}</span>
                  </p>
                )}
              </div>
            ) : (
              <EmptyState
                icon="cal"
                title={throughYear ? t('cities.calendarNotPosted', { year: throughYear }) : t('city.noSpeakTitle')}
                actions={
                  city.agendaPortal && city.agendaPortal.url ? (
                    <a className="btn btn--secondary" href={city.agendaPortal.url} target="_blank" rel="noopener noreferrer">
                      <Icon name="ext" />
                      {t('city.openCalendar')}
                      <span className="vh"> {t('ui.opensNewTab')}</span>
                    </a>
                  ) : null
                }
              >
                {throughYear ? t('city.calendarThrough', { city: city.name, date: monthDay(through) }) : t('city.noSpeakBody')}
              </EmptyState>
            )}
          </section>

          <section id="speak" className="city-sec" aria-labelledby="ht-h">
            <div className="sec-head">
              <h2 className="t-heading" id="ht-h">
                {t('city.howToSpeak')}
              </h2>
            </div>
            <div className="howto">
              <ol>
                <li>
                  <div>
                    {signupRule ? (
                      <>
                        <strong>{signupRule}</strong> {t('ui.noDoorSignup')}
                      </>
                    ) : (
                      <>
                        <strong>{t('city.stepSignup')}</strong>
                        {pc.deadline && (
                          <>
                            {' '}
                            <Linkified text={t('city.deadline', { deadline: pc.deadline })} />
                          </>
                        )}
                      </>
                    )}
                    {pc.registrationUrl && (
                      <>
                        <br />
                        <a className="btn btn--secondary btn--sm" href={pc.registrationUrl} target="_blank" rel="noopener noreferrer">
                          <Icon name="ext" />
                          {t('city.openForm')}
                          <span className="vh"> {t('ui.opensNewTab')}</span>
                        </a>
                      </>
                    )}
                  </div>
                </li>
                <li>
                  <div>
                    <strong>{minutes ? tn('city.stepSpeak', minutes) : t('city.stepSpeakNoLimit')}</strong> {t(`ui.remoteLong.${remote}`)}
                  </div>
                </li>
                {pc.writtenCommentMethod && (
                  <li>
                    <div>
                      <strong>{t('city.stepWritten')}</strong> <Linkified text={pc.writtenCommentMethod} />
                    </div>
                  </li>
                )}
              </ol>
            </div>
            {fullRules.length > 0 && (
              <Disclosure className="city-rules" title={t('city.fullRules')} summary={t('city.fullRulesSub')}>
                {fullRules.map((text, i) => (
                  <p key={i} className="slate">
                    <Linkified text={text} />
                  </p>
                ))}
                {pc.source && (
                  <p>
                    <a className="link" href={pc.source} target="_blank" rel="noopener noreferrer">
                      {`${t('city.source')}: ${hostOf(pc.source)}`}
                      <span className="vh"> {t('ui.opensNewTab')}</span>
                    </a>
                  </p>
                )}
              </Disclosure>
            )}
          </section>

          <section id="schedule" className="city-sec" aria-labelledby="sc-h">
            <div className="sec-head">
              <h2 className="t-heading" id="sc-h">
                {t('city.schedule')}
              </h2>
            </div>
            {groups.map((g, i) => (
              <Disclosure key={g.key} title={g.title} summary={g.summary} defaultOpen={i === firstOpen}>
                {g.items.length ? <SchedList items={g.items} onOpen={openOcc} /> : <p className="slate t-small">{t('city.noDates')}</p>}
                {throughYear && <p className="sched__foot">{t('city.postedThrough', { date: monthDay(through), year: throughYear })}</p>}
              </Disclosure>
            ))}
            {agenda.upcoming.length > 0 && (
              <Disclosure title={t('city.upcoming')} summary={tn('city.upcomingCount', agenda.upcoming.length)} defaultOpen>
                {lang !== 'en' && agenda.upcoming.some((item) => item.auto && !item.titleSource) && <p className="slate t-small">{t('live.englishNote')}</p>}
                {upcomingByDate.map((day) => (
                  <Fragment key={day.date || 'undated'}>
                    {day.date && <h3 className="agenda__date">{formatDate(day.date)}</h3>}
                    <ul className="agenda">
                      {day.items.map((item) => (
                        <AgendaItem key={`${item.meetingDate}-${indexOf(item)}`} item={item} index={indexOf(item)} city={city} />
                      ))}
                    </ul>
                  </Fragment>
                ))}
              </Disclosure>
            )}
            {agenda.recent.length > 0 && (
              <Disclosure id="agenda" title={t('city.recent')} summary={recentSummary}>
                {lang !== 'en' && agenda.recent.some((item) => item.auto && !item.titleSource) && <p className="slate t-small">{t('live.englishNote')}</p>}
                {recentByDate.map((day) => (
                  <Fragment key={day.date}>
                    <h3 className="agenda__date">{formatDate(day.date)}</h3>
                    <ul className="agenda">
                      {day.items.map((item) => (
                        <AgendaItem key={indexOf(item)} item={item} index={indexOf(item)} city={city} />
                      ))}
                    </ul>
                  </Fragment>
                ))}
              </Disclosure>
            )}
          </section>
        </div>

        <aside className="city-side">
          {youth.length > 0 && (
            <Section title={t('city.youthIn', { city: city.name })}>
              <div className="card">
                <ul className="youth">
                  {youth.map((p, i) => (
                    <li key={i}>
                      <p className="youth__t">
                        {p.url ? (
                          <a href={p.url} target="_blank" rel="noopener noreferrer">
                            {String(p.name).split(' ').slice(0, -1).join(' ')}{' '}
                            <span className="youth__last">
                              {String(p.name).split(' ').slice(-1)[0]}
                              <Icon name="ext" size={16} />
                            </span>
                            <span className="vh"> {t('ui.opensNewTab')}</span>
                          </a>
                        ) : (
                          p.name
                        )}
                      </p>
                      <p className="youth__m">{tidyTimes([p.ages ? String(p.ages).replace(/\.$/, '') : '', firstSentence(p.description)].filter(Boolean).join('. '))}</p>
                      {p.applyWindow && (
                        <p className="st st--plain">
                          <Icon name="cal" />
                          {t('city.apply', { window: tidyTimes(String(p.applyWindow).split(/;\s*/)[0]) })}
                        </p>
                      )}
                    </li>
                  ))}
                </ul>
              </div>
            </Section>
          )}

          <Section title={t('city.links')}>
            <ul className="group links">
              {links.map((l) => (
                <li key={l.url}>
                  <a className="lrow" href={l.url} target="_blank" rel="noopener noreferrer">
                    <span>
                      <span className="lrow__t">{l.title}</span>
                      {l.sub && <span className="lrow__m">{l.sub}</span>}
                    </span>
                    <Icon name="ext" />
                    <span className="vh">{t('ui.opensNewTab')}</span>
                  </a>
                </li>
              ))}
            </ul>
            {stale ? (
              <p className="verified city__verified city__verified--stale">
                <Icon name="clock" />
                {t('city.verifiedStale', { date: monthDay(city.lastVerified, { withYear: true }) })}
              </p>
            ) : (
              <p className="verified city__verified">
                <Icon name="shield" />
                {t('city.verifiedLine', { date: city.lastVerified ? monthDay(city.lastVerified, { withYear: true }) : '' })}
              </p>
            )}
            {sourceHosts.size > 0 && (
              <Disclosure variant="plain" title={t('city.sources')} className="city__sources">
                <ul>
                  {[...sourceHosts].map(([host, url]) => (
                    <li key={host}>
                      <a className="link" href={url} target="_blank" rel="noopener noreferrer">
                        {host}
                        <span className="vh"> {t('ui.opensNewTab')}</span>
                      </a>
                    </li>
                  ))}
                </ul>
              </Disclosure>
            )}
          </Section>

          <Section title={t('city.newsIn', { city: city.name })} see={{ to: `/news?city=${city.cityId}` }}>
            {news.status === 'loading' ? (
              <ul className="group" aria-hidden="true">
                <li>
                  <span className="skel skel--line" />
                </li>
                <li>
                  <span className="skel skel--line" />
                </li>
              </ul>
            ) : news.items.length ? (
              <NewsList items={news.items} limit={3} lang={lang} />
            ) : (
              <p className="city__quiet">{news.status === 'error' ? t('city.newsError') : t('city.newsEmpty', { city: city.name })}</p>
            )}
          </Section>
        </aside>
      </div>

      <Sheet open={Boolean(occ)} onClose={closeOcc} labelledBy="city-md-h" variant="side" barStart={occ ? <MeetingDetailBadge meeting={occ} homeCityId={prefs.homeCityId} /> : null} barEnd={occ ? <MeetingShare meeting={occ} /> : null}>
        {occ && <MeetingDetail key={occ.id} meeting={occ} city={city} today={today} now={now} headingId="city-md-h" nextSpeakable={occNext} onOpenMeeting={openOcc} hideCityLink />}
      </Sheet>
    </div>
  );
}
