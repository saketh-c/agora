import { useCallback, useEffect, useRef, useState } from 'react';
import { useLocation } from 'react-router-dom';
import { t } from '@agora/core';
import { useCities } from '../../lib/DataProvider.jsx';
import { useStore } from '../../lib/store.jsx';
import { placeFromDevice, placeName, placesOf, withPlaces, nearText } from '../../lib/places.js';
import { Icon, Menu, timeText } from '../ui/index.js';
import { SETUP_STATE, setupTo } from '../shell/SetupHost.jsx';
import { currentPosition } from './usePlaceFinder.js';

/** A position older than this reads as "where you were at 3:40 PM", not "where you are now". */
const STALE_MS = 30 * 60 * 1000;
/** Refreshed quietly on arrival when older than this and the browser already allows location. */
const REFRESH_MS = 10 * 60 * 1000;

const ageOf = (place) => (place && place.at ? Date.now() - Date.parse(place.at) : Infinity);

/** "15:40" in Central time, for "where you were at 3:40 PM". */
function clockOf(iso) {
  const d = new Date(iso);
  const parts = new Intl.DateTimeFormat('en-US', { timeZone: 'America/Chicago', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(d);
  const get = (type) => (parts.find((p) => p.type === type) || {}).value || '00';
  return `${get('hour')}:${get('minute')}`;
}

/**
 * Which place Home measures from, and a quick switch: Home, School (or "Add your school"),
 * Where I am now (asks the browser once, precise), and a way into the setup sheet.
 * Switching saves right away: Home, Meetings and Prepare all measure from the same place.
 */
export default function PlaceSwitch() {
  const { prefs, setPrefs } = useStore();
  const { cities, cityById } = useCities();
  const location = useLocation();
  const [status, setStatus] = useState({ kind: 'idle', text: '' });
  const seq = useRef(0);
  const s = placesOf(prefs, cityById);
  const active = s[s.origin];

  const locate = useCallback(
    (quiet = false) => {
      const id = ++seq.current;
      if (!quiet) setStatus({ kind: 'busy', text: t('home.places.finding') });
      currentPosition().then(
        (p) => {
          if (id !== seq.current) return;
          setPrefs((cur) => withPlaces(cur, { here: placeFromDevice(p), origin: 'here' }, cities));
          setStatus({ kind: quiet ? 'idle' : 'done', text: quiet ? '' : t('home.places.nowHere') });
        },
        (err) => {
          if (id !== seq.current || quiet) return;
          setStatus({ kind: 'error', text: err.message });
        },
      );
    },
    [cities, setPrefs],
  );

  // Measuring from "where I am now": refresh an old position on arrival, but only when the
  // browser already allows it (never a surprise permission prompt).
  useEffect(() => {
    if (s.origin !== 'here' || ageOf(s.here) < REFRESH_MS) return;
    const perms = typeof navigator !== 'undefined' && navigator.permissions;
    if (!perms || typeof perms.query !== 'function') return;
    perms
      .query({ name: 'geolocation' })
      .then((r) => r.state === 'granted' && locate(true))
      .catch(() => {});
    // Once per arrival.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Clear the spoken confirmation so the same words are announced next time.
  useEffect(() => {
    if (status.kind !== 'done') return undefined;
    const timer = setTimeout(() => setStatus({ kind: 'idle', text: '' }), 4000);
    return () => clearTimeout(timer);
  }, [status]);

  const choose = (origin) => {
    seq.current += 1;
    setStatus({ kind: 'idle', text: '' });
    if (origin === 'here') return locate(false);
    setPrefs((cur) => withPlaces(cur, { origin }, cities));
    return undefined;
  };

  if (!active) return null;

  const setupLink = setupTo(location);
  let text = nearText(s.origin, active);
  if (s.origin === 'here' && ageOf(active) > STALE_MS) text = t('home.places.nearEarlier', { time: timeText(clockOf(active.at)) });

  const items = [
    { type: 'group', label: t('home.places.switchLabel') },
    s.home
      ? { type: 'radio', key: 'home', icon: 'home', label: t('home.places.home'), sub: placeName(s.home), checked: s.origin === 'home', onSelect: () => choose('home') }
      : { type: 'link', key: 'add-home', icon: 'home', label: t('home.places.addHome'), to: setupLink, state: { ...SETUP_STATE, editPlace: 'home' }, refocus: true },
    s.school
      ? { type: 'radio', key: 'school', icon: 'school', label: t('home.places.school'), sub: placeName(s.school), checked: s.origin === 'school', onSelect: () => choose('school') }
      : { type: 'link', key: 'add-school', icon: 'school', label: t('home.places.addSchool'), to: setupLink, state: { ...SETUP_STATE, editPlace: 'school' }, refocus: true },
    { type: 'radio', key: 'here', icon: 'locate', label: t('home.places.here'), sub: t('home.places.hereSub'), checked: s.origin === 'here', onSelect: () => choose('here') },
    { type: 'separator' },
    { type: 'link', key: 'edit', icon: 'sliders', label: t('home.places.edit'), to: setupLink, state: SETUP_STATE, refocus: true },
  ];

  const busy = status.kind === 'busy';
  return (
    <div className="pswitch">
      <Menu
        align="start"
        buttonClassName="chip chip--menu pswitch__btn"
        label={t('home.places.switchAria', { place: text })}
        menuLabel={t('home.places.switchLabel')}
        button={
          <>
            {busy ? <span className="spinner" aria-hidden="true" /> : <Icon name={s.origin === 'school' ? 'school' : s.origin === 'here' ? 'locate' : 'pin'} size={20} />}
            <span className="pswitch__t">{busy ? status.text : text}</span>
            <Icon name="chev-d" size={20} />
          </>
        }
        items={items}
      />
      <p className={`pswitch__msg${status.kind === 'error' ? ' err' : ''}`} role="status" aria-live="polite">
        {status.kind === 'error' && <Icon name="alert" />}
        {status.kind === 'error' || status.kind === 'done' ? status.text : ''}
      </p>
    </div>
  );
}
