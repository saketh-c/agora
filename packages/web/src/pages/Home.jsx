import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useLocation, useNavigate, useSearchParams } from 'react-router-dom';
import { nextMeetingFor, t } from '@agora/core';
import { useCities } from '../lib/DataProvider.jsx';
import { useStore } from '../lib/store.jsx';
import { MeetingDetail, MeetingDetailBadge, MeetingShare, Sheet } from '../components/ui/index.js';
import HomeFirst from '../components/home/HomeFirst.jsx';
import HomeReturning from '../components/home/HomeReturning.jsx';
import useClock from '../components/home/useClock.js';
import { SETUP_SAVED } from '../components/shell/SetupHost.jsx';
import { findMeeting } from '../components/home/homeData.js';
import '../styles/pages/home.css';

/** The meeting named by ?meeting=<id>, in a sheet (phones) or a side panel (desktop). */
function MeetingSheet({ id, onClose, onOpenMeeting }) {
  const { cityById } = useCities();
  const { prefs } = useStore();
  const { today, now } = useClock();
  const found = useMemo(() => findMeeting(cityById, id), [cityById, id]);
  // Keep showing the last meeting while the sheet animates closed.
  const last = useRef(null);
  if (found) last.current = found;
  const meeting = found || last.current;
  const city = meeting ? cityById(meeting.cityId) : null;
  const nextSpeakable = useMemo(
    () => (meeting && city && !meeting.openToPublicComment ? nextMeetingFor(city, today, { publicCommentOnly: true, now }) : null),
    [meeting, city, today, now],
  );
  return (
    <Sheet open={Boolean(found)} onClose={onClose} variant="side" labelledBy="home-md-h" barStart={meeting ? <MeetingDetailBadge meeting={meeting} homeCityId={prefs.homeCityId} /> : null} barEnd={meeting ? <MeetingShare meeting={meeting} /> : null}>
      {meeting && <MeetingDetail meeting={meeting} city={city} today={today} now={now} headingId="home-md-h" nextSpeakable={nextSpeakable} onOpenMeeting={onOpenMeeting} />}
    </Sheet>
  );
}

/**
 * Home ( / ). Before setup: the first-visit question and three meetings you can speak at. After:
 * your next meeting and what is coming up. ?meeting=<id> opens a meeting's details in a sheet
 * that Back closes. (?setup=1, "Your city, topics and times", is the shell's: see SetupHost.)
 */
export default function Home() {
  const { setupComplete, profile, resetSetup } = useStore();
  const [params, setParams] = useSearchParams();
  const navigate = useNavigate();
  const location = useLocation();
  // The profile that just finished setup here: its returning view takes focus on arrival.
  const [arrived, setArrived] = useState(null);
  const [saved, setSaved] = useState('');
  // What the first-visit answer saved, so the returning view can confirm it with Undo.
  const [confirm, setConfirm] = useState(null);
  // After Undo, the first-visit question takes the cursor again.
  const [undone, setUndone] = useState(null);

  // Clear the spoken confirmation, so the same words are announced again next time.
  useEffect(() => {
    if (!saved) return undefined;
    const timer = setTimeout(() => setSaved(''), 4000);
    return () => clearTimeout(timer);
  }, [saved]);

  // Setup finished in the shell's sheet ("Your city, topics and times"): the returning view
  // that replaces the first-visit one takes focus, as it does after the question card.
  useEffect(() => {
    const onSaved = (e) => {
      if (e.detail && e.detail.completed) setArrived(profile.id);
    };
    window.addEventListener(SETUP_SAVED, onSaved);
    return () => window.removeEventListener(SETUP_SAVED, onSaved);
  }, [profile.id]);

  const openMeeting = useCallback(
    (meeting) => {
      const next = new URLSearchParams(params);
      next.set('meeting', meeting.id);
      // Opening one meeting from another replaces it, so Back still closes the sheet in one step.
      const replace = params.has('meeting');
      setParams(next, { replace, state: replace ? location.state : { homeSheet: true } });
    },
    [params, setParams, location.state],
  );

  /** Close a sheet: step back if we opened it, otherwise drop its parameter in place. */
  const closeParam = useCallback(
    (key) => {
      if (location.state && location.state.homeSheet) {
        navigate(-1);
        return;
      }
      const next = new URLSearchParams(params);
      next.delete(key);
      setParams(next, { replace: true });
    },
    [location.state, navigate, params, setParams],
  );

  return (
    <div className="home-page">
      {setupComplete ? (
        <HomeReturning
          key={profile.id}
          focusHeading={arrived === profile.id}
          onOpenMeeting={openMeeting}
          confirm={confirm && confirm.profileId === profile.id ? confirm : null}
          onDismissConfirm={() => setConfirm(null)}
          onUndo={() => {
            if (!confirm) return;
            resetSetup(confirm.before);
            setConfirm(null);
            setArrived(null);
            setUndone(profile.id);
            setSaved(t('home.confirm.undone'));
          }}
        />
      ) : (
        <HomeFirst
          key={profile.id}
          onOpenMeeting={openMeeting}
          focusPlace={undone === profile.id}
          onDone={(info) => {
            setArrived(profile.id);
            setUndone(null);
            setConfirm({ ...info, profileId: profile.id });
            setSaved(t('home.setup.ready', { city: info.city.name }));
          }}
        />
      )}
      <p className="vh" role="status" aria-live="polite">
        {saved}
      </p>
      <MeetingSheet id={params.get('meeting')} onClose={() => closeParam('meeting')} onOpenMeeting={openMeeting} />
    </div>
  );
}
