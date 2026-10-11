import { t } from '@agora/core';

/** 83 -> "1:23". */
export function mmss(seconds) {
  const s = Math.max(0, Math.round(Number(seconds) || 0));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

/** Seconds before the limit when the light turns amber. */
const AMBER_SECONDS = 30;

/** The podium light for a draft: 'go' with room to spare, 'amber' in the last 30 seconds, 'stop' past the limit. */
export function rulerTone(seconds, limitSeconds = 180) {
  const used = Math.max(0, Math.round(seconds || 0));
  const limit = Math.max(60, Math.round(limitSeconds || 180));
  return used > limit ? 'stop' : used > Math.max(0, limit - AMBER_SECONDS) ? 'amber' : 'go';
}

/**
 * The speaking-time ruler: the podium timer for a draft (podium mock "Your draft").
 * Green until the last 30 seconds, amber up to the limit, red past it. The track grows
 * when a draft runs long, so the fill never leaves the bar.
 *
 *   <TimeRuler seconds={82} limitSeconds={180} note="Timed at a steady 130 words a minute." />
 */
export default function TimeRuler({ seconds, limitSeconds = 180, note, className = '' }) {
  const used = Math.max(0, Math.round(seconds || 0));
  const limit = Math.max(60, Math.round(limitSeconds || 180));
  const amberAt = Math.max(0, limit - AMBER_SECONDS);
  // The limit sits at 6/7 of the track (3:00 of 3:30) until the draft needs more room.
  const scale = Math.max((limit * 7) / 6, Math.ceil((used + 15) / 30) * 30);
  const at = (v) => (Math.min(v, scale) / scale) * 100;
  const pct = (v) => `${at(v).toFixed(2)}%`;

  const tone = rulerTone(used, limit);
  const read =
    used > limit
      ? t('prepare.ruler.ofOver', { limit: mmss(limit), over: mmss(used - limit) })
      : used === limit
        ? t('prepare.ruler.ofExact', { limit: mmss(limit) })
        : t('prepare.ruler.ofSpare', { limit: mmss(limit), left: mmss(limit - used) });
  const light = { go: t('prepare.ruler.lightGo'), amber: t('prepare.ruler.lightAmber'), stop: t('prepare.ruler.lightStop') }[tone];

  // The fill is Ink up to the amber zone, then takes the color of the zone it runs into.
  let fill = 'var(--ink)';
  if (used > amberAt && used > 0) {
    const a = ((amberAt / used) * 100).toFixed(2);
    const b = ((Math.min(limit, used) / used) * 100).toFixed(2);
    fill = `linear-gradient(90deg, var(--ink) 0 ${a}%, var(--amber) ${a}% ${b}%, var(--stop) ${b}%)`;
  }

  // Minute ticks, plus the amber line and the limit; a minute tick that would crowd them is dropped.
  const step = scale <= 420 ? 60 : scale <= 900 ? 120 : 300;
  const marks = new Map();
  for (let v = 0; v <= scale - step / 2; v += step) marks.set(v, false);
  for (const key of [...marks.keys()]) {
    if (key && (Math.abs(at(key) - at(limit)) < 9 || Math.abs(at(key) - at(amberAt)) < 9)) marks.delete(key);
  }
  if (at(limit) - at(amberAt) >= 9) marks.set(amberAt, true);
  marks.set(limit, true);
  const ticks = [...marks.keys()].sort((x, y) => x - y);

  return (
    <div className={`ruler ${className}`.trim()} role="group" aria-label={t('prepare.ruler.label')}>
      <div className="ruler__top">
        <p className="ruler__read">
          <span className="t-title num">{mmss(used)}</span>
          <span className="ruler__of num">{read}</span>
        </p>
        <span className={`ruler__light${tone === 'go' ? '' : ` ruler__light--${tone}`}`}>
          <span className="dot" aria-hidden="true" />
          {light}
        </span>
      </div>
      <div className="ruler__track" role="img" aria-label={t('prepare.ruler.aria', { used: mmss(used), limit: mmss(limit) })}>
        <div className="ruler__zones" aria-hidden="true">
          <span style={{ flex: `0 0 ${pct(amberAt)}` }} />
          <span style={{ flex: `0 0 ${(at(limit) - at(amberAt)).toFixed(2)}%` }} />
          <span />
        </div>
        <div className="ruler__fill" style={{ width: pct(used), background: fill }} />
        <div className="ruler__limit" style={{ left: `calc(${pct(limit)} - 1.5px)` }} aria-hidden="true" />
      </div>
      <div className="ruler__ticks num" aria-hidden="true">
        {ticks.map((v) => (
          <span key={v} style={{ left: pct(v) }} className={v === amberAt && v !== limit ? 'is-warn' : undefined}>
            {mmss(v)}
          </span>
        ))}
      </div>
      {note && <p className="ruler__note">{note}</p>}
    </div>
  );
}
