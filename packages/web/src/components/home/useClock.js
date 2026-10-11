import { useEffect, useState } from 'react';
import { today as todayFn } from '../../lib/data.js';

/** The current minute as an ISO string, so `now`-based memos change at most once a minute. */
function minuteIso() {
  const d = new Date();
  d.setSeconds(0, 0);
  return d.toISOString();
}

/**
 * { today, now }: the Central-time date and the current minute. Refreshes every minute and when
 * the tab comes back into view, so a meeting that ends while Home is open drops off, and a tab
 * left open overnight shows the new day.
 */
export default function useClock() {
  const [now, setNow] = useState(minuteIso);
  useEffect(() => {
    const tick = () => setNow(minuteIso());
    const timer = setInterval(tick, 60000);
    const onVisible = () => {
      if (document.visibilityState === 'visible') tick();
    };
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      clearInterval(timer);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, []);
  // today() reads the clock itself; `now` changing is what makes this re-evaluate.
  return { today: todayFn(), now };
}
