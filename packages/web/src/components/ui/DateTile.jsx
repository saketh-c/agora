import { parseDate, tList } from '@agora/core';

/**
 * The date tile: weekday over day number. The tile is the light, so its color is a signal:
 * go (you can speak), watch (watch only), stop (cancelled), amber, quiet (neutral).
 * Decorative: put the full date in text next to it for screen readers.
 */
export default function DateTile({ date, tone = 'go', size, className = '' }) {
  if (!date) return null;
  const { y, m, d } = parseDate(date);
  const weekday = new Date(Date.UTC(y, m - 1, d)).getUTCDay();
  const dow = tList('format.weekdaysShort')[weekday] || '';
  return (
    <span className={`tile${tone && tone !== 'go' ? ` tile--${tone}` : ''}${size === 'lg' ? ' tile--lg' : ''} ${className}`.trim()} aria-hidden="true">
      <span className="tile__dow">{dow}</span>
      <span className="tile__day num">{d}</span>
    </span>
  );
}

/** The tile tone for a meeting occurrence. */
export function tileTone(meeting) {
  if (!meeting) return 'quiet';
  if (meeting.status === 'cancelled') return 'stop';
  return meeting.openToPublicComment ? 'go' : 'watch';
}
