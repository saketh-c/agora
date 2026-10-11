import { useEffect, useState } from 'react';
import { useLocation, useNavigate, useSearchParams } from 'react-router-dom';
import { t } from '@agora/core';
import { useStore } from '../../lib/store.jsx';
import SetupSheet from '../home/SetupSheet.jsx';

/** History state on a link that opened the sheet, so closing it steps back to where you were. */
export const SETUP_STATE = { setupSheet: true };

/** Fired on window after a save; `detail.completed` is true when the save finished setup. */
export const SETUP_SAVED = 'agora:setup-saved';

/**
 * The address that opens "Your city, topics and times" over the current page: the same path,
 * query and hash plus ?setup=1. Pass it with `state={SETUP_STATE}`.
 */
export function setupTo(location) {
  const params = new URLSearchParams(location.search);
  params.set('setup', '1');
  return { pathname: location.pathname, search: `?${params}`, hash: location.hash };
}

/**
 * The setup sheet for every route. ?setup=1 on any address opens it over that page (the
 * Profile menu, Home's "Change", a Profiles row, the old /start link), so a student never loses
 * their place: closing or saving steps back to the page as it was, with its search, filters
 * and open meeting.
 */
export default function SetupHost() {
  const [params, setParams] = useSearchParams();
  const location = useLocation();
  const navigate = useNavigate();
  const { setupComplete } = useStore();
  const [said, setSaid] = useState('');

  // Clear the spoken confirmation, so the same words are announced again next time.
  useEffect(() => {
    if (!said) return undefined;
    const timer = setTimeout(() => setSaid(''), 4000);
    return () => clearTimeout(timer);
  }, [said]);

  const close = () => {
    if (location.state && location.state.setupSheet) {
      navigate(-1);
      return;
    }
    const next = new URLSearchParams(params);
    next.delete('setup');
    setParams(next, { replace: true, state: location.state });
  };

  return (
    <>
      <SetupSheet
        open={params.get('setup') === '1'}
        onClose={close}
        onSaved={() => {
          setSaid(t('home.setup.saved'));
          window.dispatchEvent(new CustomEvent(SETUP_SAVED, { detail: { completed: !setupComplete } }));
        }}
      />
      <p className="vh" role="status" aria-live="polite">
        {said}
      </p>
    </>
  );
}
