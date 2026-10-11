/**
 * Which meeting Prepare is getting ready for, shared by the hub (/prepare) and Write
 * (/prepare/write).
 *
 * Order of precedence:
 *  1. ?meeting=<id> in the address (from "Prepare to speak" on a meeting), or 'practice';
 *  2. ?city=<id> (old /learn?tab=comment&city= links): that council's next meeting you can speak at;
 *  3. the meeting saved in the profile (ui.prepMeeting), while it is at most 14 days old;
 *  4. the first of "your next meetings": the home city's next speakable meeting, then the
 *     best matches, one per council. With no home city it is "Just practicing".
 * A meeting picked from the address is saved, so coming back to /prepare keeps it.
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { addDays, expandCityMeetings, hasEnded, matchMeetings, nextMeetingFor, upcomingMeetings } from '@agora/core';
import { useStore } from '../../lib/store.jsx';
import { useCities } from '../../lib/DataProvider.jsx';
import { nowIso, today } from '../../lib/data.js';
import { PRACTICE_ONLY } from '../../lib/prep.js';

/** A saved meeting stays selected this many days after it happened (for "share how it went"). */
const KEEP_PAST_DAYS = 14;
/** Seconds each speaker gets when there is no meeting, or the city publishes no limit. */
export const DEFAULT_LIMIT_SECONDS = 180;

export const isSpeakable = (m) => Boolean(m && m.openToPublicComment && m.status !== 'cancelled');

/** Look up one occurrence by its language-independent id (`${cityId}:${date}:${slug}`). */
export function findMeeting(cityById, id) {
  const [cityId, date] = String(id || '').split(':');
  const city = cityId ? cityById(cityId) : null;
  if (!city || !/^\d{4}-\d{2}-\d{2}$/.test(date || '')) return null;
  return expandCityMeetings(city, date, date).find((o) => o.id === id) || null;
}

/** Up to `limit` upcoming meetings you can speak at, one per council, home city first. */
export function nextSpeakableMeetings({ cities, cityById, prefs, day, now, limit = 3 }) {
  const list = [];
  const councils = new Set();
  const add = (m) => {
    if (list.length >= limit || !isSpeakable(m) || councils.has(m.cityId) || hasEnded(m, now)) return;
    councils.add(m.cityId);
    list.push(m);
  };
  const home = prefs.homeCityId ? cityById(prefs.homeCityId) : null;
  if (home) add(nextMeetingFor(home, day, { publicCommentOnly: true, now }));
  if (prefs.homeCityId || prefs.location) {
    for (const m of matchMeetings(cities, prefs, { today: day, now, perCity: 1 })) add(m);
  }
  if (list.length < limit) for (const m of upcomingMeetings(cities, { from: day, days: 30, now })) add(m);
  return list;
}

export function usePrepMeeting() {
  const [params, setParams] = useSearchParams();
  const { prefs, prepMeetingId, setPrepMeeting } = useStore();
  const { cities, cityById } = useCities();
  // One "now" per visit keeps the lists stable while the page is open.
  const [now] = useState(nowIso);
  const day = today();
  const urlId = params.get('meeting');
  const cityParam = params.get('city');

  const options = useMemo(() => nextSpeakableMeetings({ cities, cityById, prefs, day, now }), [cities, cityById, prefs, day, now]);

  // An old builder link names only a council: use its next meeting you can speak at.
  const fromCity = useMemo(() => {
    if (urlId || !cityParam) return null;
    const city = cityById(cityParam);
    return city ? nextMeetingFor(city, day, { publicCommentOnly: true, now }) : null;
  }, [urlId, cityParam, cityById, day, now]);

  const askedId = urlId || (fromCity && fromCity.id) || null;
  const wanted = askedId || prepMeetingId || null;
  const found = useMemo(() => (wanted && wanted !== PRACTICE_ONLY ? findMeeting(cityById, wanted) : null), [wanted, cityById]);

  let meeting = null;
  let practicing = wanted === PRACTICE_ONLY;
  let problem = null;
  if (!practicing && wanted) {
    const tooOld = !found || found.date < addDays(day, -KEEP_PAST_DAYS);
    if (found && !tooOld && found.status !== 'cancelled') meeting = found;
    else if (askedId === wanted || (found && found.status === 'cancelled')) problem = found && found.status === 'cancelled' ? 'cancelled' : 'notFound';
  }
  if (!meeting && !practicing) {
    if (prefs.homeCityId && options[0]) meeting = options[0];
    else practicing = true;
  }

  // Keep a meeting chosen in the address, so /prepare remembers it next time.
  useEffect(() => {
    if (askedId && askedId !== prepMeetingId && (askedId === PRACTICE_ONLY || (meeting && meeting.id === askedId))) setPrepMeeting(askedId);
  }, [askedId, prepMeetingId, meeting, setPrepMeeting]);

  const choose = useCallback(
    (id) => {
      setPrepMeeting(id || PRACTICE_ONLY);
      if (params.has('meeting') || params.has('city')) {
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
    [params, setParams, setPrepMeeting],
  );

  const city = meeting ? cityById(meeting.cityId) : null;
  const homeCity = prefs.homeCityId ? cityById(prefs.homeCityId) : null;
  // The meeting being prepared for, listed first in the picker even when it is not one of the next three.
  const choices = meeting && !options.some((m) => m.id === meeting.id) && !hasEnded(meeting, now) ? [meeting, ...options] : options;

  return {
    meeting,
    city,
    homeCity,
    practicing,
    past: Boolean(meeting && hasEnded(meeting, now)),
    problem,
    options: choices,
    choose,
    prepKey: meeting ? meeting.id : PRACTICE_ONLY,
    day,
    now,
    cityById,
  };
}
