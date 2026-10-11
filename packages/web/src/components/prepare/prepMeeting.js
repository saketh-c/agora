/**
 * The meeting Prepare, Write and Practice are getting ready for, as a hook. The rules live in
 * prepPick.js (pure and tested): the address, then the saved meeting, then exactly the meeting
 * Home's "Your next meeting" card shows, so progress is always counted for the same meeting.
 *
 * The default is saved to the profile (ui.prepMeeting) the first time the student acts on it
 * (marks a step, checks an item, opens Write or Practice), so Home and every Prepare page keep
 * pointing at it even after the ranking changes.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { hasEnded } from '@agora/core';
import { useStore } from '../../lib/store.jsx';
import { useCities } from '../../lib/DataProvider.jsx';
import { PRACTICE_ONLY, carryPrep, carryableSteps, withPrepChecklist } from '../../lib/prep.js';
import useClock from '../home/useClock.js';
import { meetingDeadline } from '../ui/index.js';
import { resolvePrepMeeting } from './prepPick.js';

/** Seconds each speaker gets when there is no meeting, or the city publishes no limit. */
export const DEFAULT_LIMIT_SECONDS = 180;

export function usePrepMeeting() {
  const [params, setParams] = useSearchParams();
  const { prefs, ui, setUi, prepMeetingId, setPrepMeeting, setPrepStep } = useStore();
  const { cities, cityById, liveReady } = useCities();
  // Ticks every minute and when the tab comes back, so a meeting that ends while the page is
  // open moves on (and its sign-up deadline closes) without a reload.
  const { today: day, now } = useClock();
  const deadlineOf = useCallback((m) => meetingDeadline(m, now), [now]);
  // After a pick, the old ?meeting= or ?city= is dropped from the address. The router applies
  // that a beat later than the saved pick, so until it does the old value is ignored (otherwise
  // the address would win and the pick would bounce back).
  const dropped = useRef(null);
  const rawUrlId = params.get('meeting');
  const rawCity = params.get('city');
  if (dropped.current && !rawUrlId && !rawCity) dropped.current = null;
  const urlId = dropped.current && rawUrlId === dropped.current.meeting ? null : rawUrlId;
  const cityParam = dropped.current && rawCity === dropped.current.city ? null : rawCity;

  const { meeting, practicing, problem, askedId, source, pending } = useMemo(
    () => resolvePrepMeeting({ cities, cityById, prefs, today: day, now, urlId, cityParam, savedId: prepMeetingId, deadlineOf, liveReady }),
    [cities, cityById, prefs, day, now, urlId, cityParam, prepMeetingId, deadlineOf, liveReady],
  );
  const prepKey = meeting ? meeting.id : PRACTICE_ONLY;
  const past = Boolean(meeting && hasEnded(meeting, now));

  // A past meeting can point at the next one Home would suggest.
  const upcoming = useMemo(() => {
    if (!past) return null;
    const r = resolvePrepMeeting({ cities, cityById, prefs, today: day, now, deadlineOf });
    return r.meeting && r.meeting.id !== prepKey ? r.meeting : null;
  }, [past, cities, cityById, prefs, day, now, deadlineOf, prepKey]);

  // Keep a meeting chosen in the address, so /prepare remembers it next time.
  useEffect(() => {
    if (askedId && askedId !== prepMeetingId && (askedId === PRACTICE_ONLY || (meeting && meeting.id === askedId))) setPrepMeeting(askedId);
  }, [askedId, prepMeetingId, meeting, setPrepMeeting]);

  /** Save the meeting shown (the default included), so Home and every Prepare page agree on it. */
  const pin = useCallback(() => {
    if (prepKey !== prepMeetingId) setPrepMeeting(prepKey);
  }, [prepKey, prepMeetingId, setPrepMeeting]);

  /** Mark a step for this meeting (and pin the meeting). */
  const markStep = useCallback(
    (step, on = true) => {
      pin();
      setPrepStep(prepKey, step, on);
    },
    [pin, prepKey, setPrepStep],
  );

  /** Set the "On the day" items checked for this meeting; checking them all marks the step done. */
  const setChecklist = useCallback(
    (checked, total) => {
      pin();
      setUi((u) => ({ prep: withPrepChecklist(u.prep, prepKey, checked, total) }));
    },
    [pin, prepKey, setUi],
  );

  // After switching meetings: offer to carry over the steps that are not tied to one meeting.
  const [carry, setCarry] = useState(null);
  const choose = useCallback(
    (id) => {
      const target = id || PRACTICE_ONLY;
      const steps = target === PRACTICE_ONLY ? [] : carryableSteps(ui.prep, prepKey, target);
      setCarry(steps.length ? { from: prepKey, to: target, steps } : null);
      setPrepMeeting(target);
      if (params.has('meeting') || params.has('city')) {
        dropped.current = { meeting: params.get('meeting'), city: params.get('city') };
        setParams(
          (p) => {
            const next = new URLSearchParams(p);
            next.delete('meeting');
            next.delete('city');
            return next;
          },
          { replace: true },
        );
      }
    },
    [ui.prep, prepKey, params, setParams, setPrepMeeting],
  );
  const acceptCarry = useCallback(() => {
    if (!carry) return;
    setUi((u) => ({ prep: carryPrep(u.prep, carry.from, carry.to, carry.steps) }));
    setCarry(null);
  }, [carry, setUi]);
  const dismissCarry = useCallback(() => setCarry(null), []);
  // The offer only makes sense for the meeting it was made for.
  const carryOffer = carry && carry.to === prepKey ? carry : null;

  const city = meeting ? cityById(meeting.cityId) : null;
  const homeCity = prefs.homeCityId ? cityById(prefs.homeCityId) : null;

  return {
    meeting,
    city,
    homeCity,
    practicing,
    past,
    upcoming,
    problem,
    // The meeting asked for may still come with the live agendas: it is being looked for.
    pending,
    source,
    prepKey,
    choose,
    pin,
    markStep,
    setChecklist,
    carry: carryOffer,
    acceptCarry,
    dismissCarry,
    day,
    now,
    deadlineOf,
    cities,
    cityById,
    prefs,
  };
}
