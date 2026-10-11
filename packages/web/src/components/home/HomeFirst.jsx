import { useCallback, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { formatTime, offeredLocales, t } from '@agora/core';
import { useCities } from '../../lib/DataProvider.jsx';
import { useStore } from '../../lib/store.jsx';
import { EmptyState, MeetingRow, Section, meetingDeadline } from '../ui/index.js';
import HeroArt from './HeroArt.jsx';
import PlaceField from './PlaceField.jsx';
import TopicPicker from './TopicPicker.jsx';
import useClock from './useClock.js';
import { eveningShare, firstVisitMeetings } from './homeData.js';
import { withPlaces } from '../../lib/places.js';

const reducedMotion = () => typeof window !== 'undefined' && window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

/**
 * Slide list items to their new places when the order changes (FLIP), so a re-ranked list reads
 * as the same meetings moving, not a new list. Items carry data-flip="<key>".
 */
function useFlip(ref, signature) {
  const last = useRef(null);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const nodes = [...el.querySelectorAll('[data-flip]')];
    const tops = new Map(nodes.map((n) => [n.dataset.flip, n.getBoundingClientRect().top]));
    const before = last.current;
    last.current = tops;
    if (!before || reducedMotion() || typeof nodes[0]?.animate !== 'function') return;
    for (const node of nodes) {
      const was = before.get(node.dataset.flip);
      if (was == null) {
        node.animate([{ opacity: 0, transform: 'translateY(12px)' }, { opacity: 1, transform: 'none' }], { duration: 260, easing: 'cubic-bezier(.2,0,0,1)' });
      } else if (was !== tops.get(node.dataset.flip)) {
        node.animate([{ transform: `translateY(${was - tops.get(node.dataset.flip)}px)` }, { transform: 'none' }], { duration: 320, easing: 'cubic-bezier(.2,0,0,1)' });
      }
    }
  }, [ref, signature]);
}

/**
 * Home before setup: the pitch in one line, one question (where you live or go to school), three
 * real meetings a student can speak at, and optional topics that re-sort that list in place.
 * Answering the question completes setup; `onDone({ place, city, slot, before })` lets the page
 * confirm it (with Undo) and move focus to what replaces it. `focusPlace` puts the cursor in the
 * question's field (after an Undo).
 */
export default function HomeFirst({ onDone, onOpenMeeting, focusPlace = false }) {
  const { prefs, setPrefs, completeSetup, lang, setLang } = useStore();
  const { cities, cityById } = useCities();
  const { today, now } = useClock();
  const listRef = useRef(null);
  const [sortedNote, setSortedNote] = useState('');
  const deadlineOf = useCallback((m) => meetingDeadline(m, now), [now]);

  const meetings = useMemo(() => firstVisitMeetings(cities, prefs, { today, now, deadlineOf }), [cities, prefs, today, now, deadlineOf]);
  const stat = useMemo(() => eveningShare(cities, { today, now }), [cities, today, now]);
  useFlip(listRef, meetings.map((m) => m.id).join('|'));

  // The answer becomes Home, or School when the lookup found a school. `before` lets Home undo it.
  const choosePlace = ({ place, city, school }) => {
    if (!place) return;
    const before = prefs;
    const slot = school ? 'school' : 'home';
    const done = completeSetup((p) => withPlaces(p, { [slot]: place, origin: slot }, cities));
    if (done && onDone) onDone({ place, city, slot, before });
  };

  const setInterests = (interests) => {
    setPrefs({ interests });
    setSortedNote(interests.length ? t('home.topics.sorted') : t('home.topics.cleared'));
  };

  // The other languages the app offers (completely translated ones, LOCALES[].ready).
  const otherLanguages = offeredLocales(lang).filter((l) => l.code !== lang);

  return (
    <>
      <section className="hero" aria-labelledby="hero-h">
        <div className="wrap hero__in">
          <div className="hero__text">
            <h1 className="t-hero" id="hero-h">
              {t('home.hero')}
            </h1>
            <p className="hero__lead">{t('home.heroLead')}</p>
          </div>
          <PlaceField variant="ask" cities={cities} onPlace={choosePlace} autoFocus={focusPlace} />
        </div>
        <HeroArt />
      </section>

      <div className="wrap home">
        <div className="first-grid">
          <Section title={t('home.speakable')} see={{ to: '/meetings' }} className="first-list">
            {meetings.length ? (
              <ul className="group" ref={listRef}>
                {meetings.map((m) => (
                  <li key={m.id} data-flip={m.id}>
                    <MeetingRow meeting={m} city={cityById(m.cityId)} deadline={deadlineOf(m)} onSelect={onOpenMeeting} />
                  </li>
                ))}
              </ul>
            ) : (
              <EmptyState
                icon="cal"
                title={t('home.speakableNone')}
                actions={
                  <Link className="btn btn--secondary" to="/meetings">
                    {t('home.speakableAll')}
                  </Link>
                }
              />
            )}
          </Section>

          <section className="first-topics" aria-labelledby="first-topics-h">
            <div className="sec-head">
              <h2 className="t-heading" id="first-topics-h">
                {t('home.topics.title')}
              </h2>
            </div>
            <p className="first-topics__lead">{t('home.topics.lead')}</p>
            <TopicPicker value={prefs.interests} onChange={setInterests} label={t('home.topics.title')} />
            <p className="vh" aria-live="polite">
              {sortedNote}
            </p>

            {stat && (
              <div className="statline">
                <span className="statline__n num">{t('home.stat.n', { n: stat.inTen })}</span>
                <p>
                  {t('home.stat.text', { n: stat.days, time: formatTime('17:00', undefined, { compact: true }) })}{' '}
                  <Link className="link" to="/insights">
                    {t('home.stat.see')}
                  </Link>
                </p>
              </div>
            )}

            <div className="langs" role="group" aria-label={t('home.languages')}>
              {otherLanguages.map((l) => (
                <button key={l.code} type="button" className="langname" lang={l.tag} dir={l.dir} onClick={() => setLang(l.code)}>
                  {l.nativeName}
                </button>
              ))}
            </div>
          </section>
        </div>
      </div>
    </>
  );
}
