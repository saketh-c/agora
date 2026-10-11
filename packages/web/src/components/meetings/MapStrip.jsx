import { useEffect, useRef } from 'react';

/**
 * The phone map's list: meeting cards in a row that scrolls sideways and snaps. The card in
 * view lights up its pin (`onActive(cityId)`); tapping a pin scrolls to that city's first card
 * (`activeCity`); tapping a card opens the meeting.
 *
 *   <MapStrip label="Meetings on the map" meetings={list} activeCity="plano" onActive={setHot}
 *             renderRow={(m, i) => <MeetingRow ... />} />
 */
export default function MapStrip({ meetings, renderRow, activeCity, onActive, label }) {
  const ref = useRef(null);
  const onActiveRef = useRef(onActive);
  onActiveRef.current = onActive;
  const steering = useRef(0);
  const lastActive = useRef(activeCity);

  // A pin was tapped: bring its city's first card into view (unless a card of it already is).
  useEffect(() => {
    const root = ref.current;
    if (!root || !activeCity || activeCity === lastActive.current) return;
    lastActive.current = activeCity;
    const card = root.querySelector(`[data-city="${CSS.escape(activeCity)}"]`);
    if (!card) return;
    const box = root.getBoundingClientRect();
    const r = card.getBoundingClientRect();
    if (r.left >= box.left - 2 && r.right <= box.right + 2) return;
    steering.current = Date.now();
    const reduce = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    root.scrollTo({ left: root.scrollLeft + (r.left - box.left) - 16, behavior: reduce ? 'auto' : 'smooth' });
  }, [activeCity]);

  // Swiping: the card most in view becomes the active city.
  useEffect(() => {
    const root = ref.current;
    if (!root || typeof IntersectionObserver !== 'function') return undefined;
    const seen = new Map();
    const io = new IntersectionObserver(
      (entries) => {
        for (const e of entries) seen.set(e.target, e.intersectionRatio);
        if (Date.now() - steering.current < 700) return;
        let best = null;
        let ratio = 0.55;
        for (const [el, r] of seen) {
          if (r > ratio) {
            best = el;
            ratio = r;
          }
        }
        if (best && best.dataset.city && best.dataset.city !== lastActive.current) {
          lastActive.current = best.dataset.city;
          onActiveRef.current(best.dataset.city);
        }
      },
      { root, threshold: [0, 0.55, 0.8, 1] },
    );
    for (const li of root.children) io.observe(li);
    return () => io.disconnect();
  }, [meetings]);

  if (!meetings.length) return null;
  return (
    <ul className="mtg-strip" ref={ref} aria-label={label}>
      {meetings.map((m, i) => (
        <li key={m.id} data-city={m.cityId} className={m.cityId === activeCity ? 'is-active' : undefined}>
          {renderRow(m, i)}
        </li>
      ))}
    </ul>
  );
}
