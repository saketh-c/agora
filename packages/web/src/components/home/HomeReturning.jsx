import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { lowerFirst, normalizePrefs, t, tList } from '@agora/core';
import { useCities } from '../../lib/DataProvider.jsx';
import { useStore } from '../../lib/store.jsx';
import { api } from '../../lib/api.js';
import { KIND_ICON, seedPosts } from '../../lib/community.js';
import { Avatar, Icon, MeetingRow, NewsList, Section, distanceText, meetingDeadline, monthDay } from '../ui/index.js';
import NextMeetingCard from './NextMeetingCard.jsx';
import NextPicker from './NextPicker.jsx';
import PlaceSwitch from './PlaceSwitch.jsx';
import { SETUP_STATE, setupTo } from '../shell/SetupHost.jsx';
import useClock from './useClock.js';
import { activeOrigin } from '../../lib/places.js';
import { HOME_DAYS, HOME_ROWS, comingUp, greetingKind, pickNews, pickNextMeeting, pickPost, seatsNear, withinLimit } from './homeData.js';
import { pickerMeetings } from '../prepare/prepPick.js';

/** "Saturday, Oct 10": today's date for the line beside the greeting, in the app language. */
function todayLine(today) {
  const [y, m, d] = today.split('-').map(Number);
  const weekday = tList('format.weekdays')[new Date(Date.UTC(y, m - 1, d)).getUTCDay()];
  const text = t('format.date', { weekday, month: tList('format.monthsShort')[m - 1], day: d });
  return text.charAt(0).toLocaleUpperCase() + text.slice(1);
}

/** The headline: "Ana, your turn is Monday." or, with nothing ahead, "Hi, Ana". */
function headline(meeting, today, name) {
  const kind = greetingKind(meeting, today);
  const suffix = name ? '' : 'NoName';
  if (kind === 'hi') return name ? t('home.greet.hi', { name }) : t('home.greet.hiNoName');
  const [y, m, d] = meeting.date.split('-').map(Number);
  const day = tList('format.weekdays')[new Date(Date.UTC(y, m - 1, d)).getUTCDay()];
  return t(`home.greet.${kind}${suffix}`, { name, day, date: monthDay(meeting.date) });
}

/** The team's posts, loaded on demand so the first screen does not carry them. */
function useSeedPosts(lang) {
  const [seed, setSeed] = useState(null);
  useEffect(() => {
    let alive = true;
    import('@data/community.json')
      .then((mod) => alive && setSeed(mod.default || mod))
      .catch(() => alive && setSeed({ posts: [] }));
    return () => {
      alive = false;
    };
  }, []);
  return useMemo(() => (seed ? seedPosts(seed, lang) : null), [seed, lang]);
}

/** Headlines, fetched once per visit; filtered on the device by the student's topics and city. */
function useHeadlines() {
  const [state, setState] = useState({ status: 'loading', items: [] });
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    const controller = typeof AbortController === 'function' ? new AbortController() : null;
    setState({ status: 'loading', items: [] });
    api
      .news({ limit: 80 }, { signal: controller ? controller.signal : undefined })
      .then((data) => {
        const items = (data && data.items) || [];
        setState({ status: !items.length && data && data.fetchedFeeds === 0 ? 'error' : 'ready', items });
      })
      .catch((err) => {
        if (err && err.code === 'aborted') return;
        setState({ status: 'error', items: [] });
      });
    return () => controller && controller.abort();
  }, [attempt]);
  return [state, useCallback(() => setAttempt((n) => n + 1), [])];
}

function SkeletonRows({ n = HOME_ROWS }) {
  return (
    <ul className="group" aria-hidden="true">
      {Array.from({ length: n }, (_, i) => (
        <li key={i}>
          <span className="skel--line" />
        </li>
      ))}
    </ul>
  );
}

function HomeNews({ prefs, county, lang }) {
  const [state, retry] = useHeadlines();
  const items = useMemo(() => pickNews(state.items, { interests: prefs.interests, homeCityId: prefs.homeCityId, county }), [state.items, prefs.interests, prefs.homeCityId, county]);
  if (state.status === 'loading') {
    return (
      <div role="status" aria-live="polite">
        <span className="vh">{t('home.news.loading')}</span>
        <SkeletonRows />
      </div>
    );
  }
  if (state.status === 'error' || !items.length) {
    return (
      <div className="home-quiet">
        <Icon name={state.status === 'error' ? 'offline' : 'news'} />
        <div>
          <p>{state.status === 'error' ? t('home.news.error') : t('home.news.none')}</p>
          {state.status === 'error' && (
            <button type="button" className="link" onClick={retry}>
              {t('home.news.retry')}
            </button>
          )}
        </div>
      </div>
    );
  }
  return (
    <>
      <NewsList items={items} lang={lang} limit={HOME_ROWS} />
      {lang !== 'en' && <p className="home-note">{t('home.news.english')}</p>}
    </>
  );
}

/** Where an application stands, as one status line: amber when the window closes within two weeks. */
function seatStatus(apply) {
  const until = apply.applyBy ? t('home.seats.until', { date: monthDay(apply.applyBy).replace(/ /g, '\u00a0') }) : '';
  if (apply.state === 'closing') return { tone: 'amber', icon: 'clock', text: until };
  if (apply.state === 'open') return { tone: 'plain', icon: 'check', text: until || t('home.seats.open') };
  if (apply.state === 'rolling') return { tone: 'plain', icon: 'check', text: t('home.seats.rolling') };
  return { tone: 'plain', icon: 'info', text: t('home.seats.ask') };
}

function Seats({ seats, prefs }) {
  if (!seats.length) {
    return (
      <div className="home-quiet">
        <Icon name="people" />
        <p>{t('home.seats.none')}</p>
      </div>
    );
  }
  return (
    <ul className="group">
      {seats.map((s) => {
        const where = distanceText({ cityId: s.cityId }, { homeCityId: prefs.homeCityId, distanceMiles: s.distanceMiles });
        const status = s.apply ? seatStatus(s.apply) : null;
        return (
          <li key={`${s.cityId}:${s.name}`}>
            <a className="lrow" href={s.url} target="_blank" rel="noopener noreferrer">
              <span>
                <span className="lrow__t">{s.name}</span>
                <span className="lrow__m">{where ? t('home.seats.meta', { city: s.cityName, where: lowerFirst(where) }) : s.cityName}</span>
                {status && status.text ? (
                  <span className={`st st--${status.tone} seat__st`}>
                    <Icon name={status.icon} />
                    {status.text}
                  </span>
                ) : null}
              </span>
              <Icon name="ext" />
              <span className="vh">{t('ui.opensNewTab')}</span>
            </a>
          </li>
        );
      })}
    </ul>
  );
}

function CommunityPost({ post, cityName }) {
  if (!post) {
    return (
      <div className="home-quiet">
        <Icon name="people" />
        <p>{t('home.community.none')}</p>
      </div>
    );
  }
  const kind = t(`community.kinds.${post.kind}`);
  const who = post.team ? t('home.community.team') : (post.author && post.author.name) || '';
  const lead = String(post.body || '').split(/\n\s*\n/)[0];
  return (
    <Link className="post home-post" to="/community">
      <span className="post__kind">
        <Icon name={KIND_ICON[post.kind] || 'bulb'} />
        {cityName ? t('home.community.kindCity', { kind, city: cityName }) : kind}
      </span>
      <span className="post__t">{post.title}</span>
      {lead && <span className="post__b">{lead}</span>}
      <span className="post__foot">
        <span className="post__who">
          {who && <Avatar name={post.team ? 'Agora' : who} />}
          {who}
        </span>
        <span className="num">{monthDay(post.postedAt)}</span>
      </span>
    </Link>
  );
}

/**
 * How far the featured meeting is: "2.1 mi away", or "12 mi away, past your 5 mi limit" when
 * Home had to reach past the limit. Nothing when the meeting is at the city hall you measure from.
 */
export function whereLine(meeting, prefs, cityById) {
  if (!meeting || meeting.distanceMiles == null) return '';
  const origin = activeOrigin(prefs, cityById);
  if (meeting.distanceMiles < 0.3 && origin && origin.place.kind === 'city') return '';
  const where = t('home.next.away', { distance: distanceText({}, { distanceMiles: meeting.distanceMiles }) });
  if (withinLimit(meeting, prefs)) return where;
  return t('home.next.farther', { where, max: t('ui.milesShort', { n: prefs.maxMiles }) });
}

/** "Showing meetings near Garland." after the first-visit answer, with Undo and Change. */
function Confirmation({ confirm, onUndo, onDismiss, setupLink }) {
  const { place, city, slot } = confirm;
  const text = place.kind === 'current' ? t('home.confirm.nearYou', { city: city.name }) : t('home.confirm.near', { place: place.label || city.name });
  return (
    <div className="notice notice--card home-confirm">
      <Icon name="check" />
      <div>
        <p>
          {slot === 'school' && <strong>{t('home.confirm.savedSchool')} </strong>}
          {text}
        </p>
        <div className="act">
          <button type="button" className="btn btn--secondary btn--sm" onClick={onUndo}>
            {t('home.confirm.undo')}
          </button>
          <Link className="btn btn--quiet btn--sm" to={setupLink} state={SETUP_STATE} onClick={onDismiss}>
            {t('home.confirm.change')}
          </Link>
        </div>
      </div>
      <button type="button" className="iconbtn home-confirm__x" onClick={onDismiss} aria-label={t('home.confirm.dismiss')}>
        <Icon name="x" />
      </button>
    </div>
  );
}

/**
 * Home for a student who has set up: the headline that names their turn, which place distances
 * come from (with a quick switch), the Go card for the next meeting they can speak at, three
 * more meetings, then seats, news and one community post. `confirm` (just after the first-visit
 * answer) shows what was saved with `onUndo` and `onDismissConfirm`.
 */
export default function HomeReturning({ focusHeading = false, onOpenMeeting, confirm = null, onUndo, onDismissConfirm }) {
  const { prefs, profile, ui, prepFor, setPrepMeeting, lang } = useStore();
  const location = useLocation();
  const [picking, setPicking] = useState(false);
  const [picked, setPicked] = useState('');
  const { cities, cityById } = useCities();
  const { today, now } = useClock();
  const headingRef = useRef(null);
  const deadlineOf = useCallback((m) => meetingDeadline(m, now), [now]);

  const next = useMemo(
    () => pickNextMeeting(cities, cityById, prefs, { today, now, prepMeetingId: ui.prepMeeting, deadlineOf }),
    [cities, cityById, prefs, today, now, ui.prepMeeting, deadlineOf],
  );
  const rows = useMemo(() => comingUp(cities, prefs, { today, now, exclude: next, deadlineOf }), [cities, prefs, today, now, next, deadlineOf]);
  // The same meetings Prepare's picker offers, so both pickers agree.
  const lists = useMemo(() => (picking ? pickerMeetings({ cities, cityById, prefs, today, now, deadlineOf }) : null), [picking, cities, cityById, prefs, today, now, deadlineOf]);
  // A meeting chosen earlier (here or in Prepare) stays on top, so it shows as chosen.
  const chosenElsewhere = lists && next && ui.prepMeeting === next.id && ![...lists.home, ...lists.others].some((m) => m.id === next.id) ? next : null;
  const anyFar = rows.some((m) => !withinLimit(m, prefs));
  const seats = useMemo(() => seatsNear(cities, prefs), [cities, prefs]);
  const homeCity = prefs.homeCityId ? cityById(prefs.homeCityId) : null;
  const posts = useSeedPosts(lang);
  const post = useMemo(() => (posts ? pickPost(posts, { homeCityId: prefs.homeCityId }) : null), [posts, prefs.homeCityId]);
  const postCity = post && post.cityId ? cityById(post.cityId) : null;

  // Arriving here from the first-visit question: the page changed under the student's cursor,
  // so put focus on the new heading (screen readers then read the greeting).
  useEffect(() => {
    if (focusHeading && headingRef.current) headingRef.current.focus({ preventScroll: false });
  }, [focusHeading]);

  // Clear the spoken confirmation of a new pick, so the same words are announced next time.
  useEffect(() => {
    if (!picked) return undefined;
    const timer = setTimeout(() => setPicked(''), 4000);
    return () => clearTimeout(timer);
  }, [picked]);

  const choose = (id) => {
    setPrepMeeting(id);
    setPicked(id ? t('home.pick.chosen') : t('home.pick.chosenAuto'));
  };

  const setupLink = (
    <Link className="btn btn--secondary" to="/?setup=1" state={SETUP_STATE}>
      {t('home.next.changeSetup')}
    </Link>
  );

  return (
    <div className="wrap home">
      <div className="greet">
        <h1 className="t-title" ref={headingRef} tabIndex={-1}>
          {headline(next, today, profile.name)}
        </h1>
        <p className="greet__date">{todayLine(today)}</p>
        <PlaceSwitch />
      </div>

      {confirm && <Confirmation confirm={confirm} onUndo={onUndo} onDismiss={onDismissConfirm} setupLink={setupTo(location)} />}

      <div className="home-top">
        <NextMeetingCard
          meeting={next}
          city={next ? cityById(next.cityId) : null}
          today={today}
          now={now}
          prep={next ? prepFor(next.id) : null}
          onContinue={() => next && setPrepMeeting(next.id)}
          setupLink={setupLink}
          where={whereLine(next, prefs, cityById)}
          onDetails={onOpenMeeting}
          onPick={() => setPicking(true)}
        />
        <Section title={t('home.comingUp')} see={{ to: '/meetings' }}>
          {rows.length ? (
            <ul className="group">
              {rows.map((m) => (
                <li key={m.id}>
                  <MeetingRow meeting={m} city={cityById(m.cityId)} homeCityId={prefs.homeCityId} deadline={deadlineOf(m)} onSelect={onOpenMeeting} />
                </li>
              ))}
            </ul>
          ) : (
            <div className="home-quiet">
              <Icon name="cal" />
              <p>{t('home.comingUpNone', { n: HOME_DAYS })}</p>
            </div>
          )}
          {anyFar && (
            <p className="home-note">
              {t('home.far', { max: t('ui.milesShort', { n: prefs.maxMiles }) })}{' '}
              <Link className="link" to={setupTo(location)} state={SETUP_STATE}>
                {t('home.farChange')}
              </Link>
            </p>
          )}
        </Section>
      </div>

      <div className="home-more">
        <Section title={t('home.seats.title')} see={homeCity ? { to: `/city/${homeCity.cityId}` } : undefined}>
          <Seats seats={seats} prefs={prefs} />
        </Section>
        <Section title={t('home.news.title')} see={{ to: '/news' }}>
          <HomeNews prefs={prefs} county={homeCity ? homeCity.county : null} lang={lang} />
        </Section>
        <Section title={t('home.community.title')} see={{ to: '/community' }}>
          {posts ? <CommunityPost post={post} cityName={postCity ? postCity.name : ''} /> : <div className="post home-post skel--post" aria-hidden="true" />}
        </Section>
      </div>

      <NextPicker
        open={picking}
        onClose={() => setPicking(false)}
        lists={lists}
        current={chosenElsewhere}
        maxMiles={prefs.location ? normalizePrefs(prefs).maxMiles : null}
        hasPlace={Boolean(prefs.location)}
        chosenId={ui.prepMeeting && ui.prepMeeting !== 'practice' ? ui.prepMeeting : null}
        onChoose={choose}
        today={today}
        deadlineOf={deadlineOf}
        cityById={cityById}
        homeCityId={prefs.homeCityId}
      />
      <p className="vh" role="status" aria-live="polite">
        {picked}
      </p>
    </div>
  );
}
