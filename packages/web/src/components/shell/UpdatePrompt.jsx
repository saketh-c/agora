import { useEffect, useState } from 'react';
import { t } from '@agora/core';
import Icon from '../ui/Icon.jsx';

/** While the app stays open, ask for a new version this often... */
const CHECK_EVERY_MS = 60 * 60 * 1000;
/** ...and whenever it comes back into view (or back online), at most this often. */
const MIN_GAP_MS = 5 * 60 * 1000;

/**
 * Keeps a long-open tab or an installed app current. The site is rebuilt several times a day
 * with new meeting data, but a tab or a home-screen app that is only ever brought back from the
 * background never loads a page again, so the browser never looks for the new build. This asks
 * the service worker to check when the app comes back into view and once an hour, and when a
 * new build has taken over, offers a refresh instead of reloading under the student's hands.
 *
 * With no service worker (development, or a browser without one) it does nothing.
 */
export default function UpdatePrompt() {
  const [ready, setReady] = useState(false);

  useEffect(() => {
    const sw = typeof navigator !== 'undefined' ? navigator.serviceWorker : null;
    if (!sw) return undefined;
    // The first worker to take control after a first visit is not an update.
    let hadController = Boolean(sw.controller);
    // The browser itself checks when the page loads, so the first check here waits.
    let last = Date.now();
    const check = (force) => {
      if (navigator.onLine === false) return;
      if (!force && Date.now() - last < MIN_GAP_MS) return;
      last = Date.now();
      sw.getRegistration()
        .then((reg) => (reg ? reg.update() : null))
        .catch(() => {
          /* offline or blocked: try again next time */
        });
    };
    const onVisible = () => {
      if (document.visibilityState === 'visible') check(false);
    };
    const onController = () => {
      if (!hadController) {
        hadController = true;
        return;
      }
      setReady(true);
    };
    const timer = setInterval(() => check(true), CHECK_EVERY_MS);
    sw.addEventListener('controllerchange', onController);
    document.addEventListener('visibilitychange', onVisible);
    window.addEventListener('online', onVisible);
    return () => {
      clearInterval(timer);
      sw.removeEventListener('controllerchange', onController);
      document.removeEventListener('visibilitychange', onVisible);
      window.removeEventListener('online', onVisible);
    };
  }, []);

  return (
    <div className="update" role="status" aria-live="polite">
      {ready && (
        <div className="toast update__toast">
          <Icon name="refresh" size={20} />
          <span className="update__text">{t('shell.update.ready')}</span>
          <button type="button" className="btn btn--text btn--sm" onClick={() => window.location.reload()}>
            {t('shell.update.refresh')}
          </button>
          <button type="button" className="iconbtn update__x" aria-label={t('shell.update.later')} onClick={() => setReady(false)}>
            <Icon name="x" size={20} />
          </button>
        </div>
      )}
    </div>
  );
}
