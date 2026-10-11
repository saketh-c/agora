import { Link } from 'react-router-dom';
import Icon from './Icon.jsx';
import DateTile, { tileTone } from './DateTile.jsx';
import MeetingStatus from './MeetingStatus.jsx';
import { distanceText, timeText, typeLabel, whenLong } from './meetingInfo.js';

/**
 * One meeting in a list (podium mock: Meetings rows, Home rows). Put rows in <ul className="group">
 * as <li><MeetingRow .../></li>.
 *
 * - Date tile (the light), the city, distance or "Your city", time + meeting type, and at most
 *   two status signals plus an optional amber deadline line.
 * - Navigates with `to`, or opens the detail with `onSelect(meeting)` (renders a button that
 *   says it opens a dialog). `selected` marks the row whose detail is showing.
 * - `title` overrides the city name (for example the meeting label on a city page).
 */
export default function MeetingRow({ meeting, city, to, onSelect, selected = false, homeCityId, distanceMiles, deadline, title, showTiming = true, className = '', ...rest }) {
  if (!meeting) return null;
  const dist = distanceText(meeting, { homeCityId, distanceMiles });
  const cancelled = meeting.status === 'cancelled';
  const cls = ['row', selected ? 'is-sel' : '', cancelled ? 'row--cancelled' : '', className].filter(Boolean).join(' ');
  const body = (
    <>
      <DateTile date={meeting.date} tone={tileTone(meeting)} />
      <span className="row__main">
        <span className="row__title">
          <span>{title || meeting.cityName}</span>
          {dist && <span className="row__dist">{dist}</span>}
        </span>
        <span className="row__meta">
          <span className="vh">{`${whenLong(meeting.date)}, `}</span>
          <span className="t num">{timeText(meeting.time)}</span>
          <span>{typeLabel(meeting)}</span>
        </span>
        <MeetingStatus meeting={meeting} city={city} deadline={deadline} showTiming={showTiming} />
      </span>
      <Icon name="chev-r" className="row__chev" />
    </>
  );
  if (to) {
    return (
      <Link className={cls} to={to} aria-current={selected ? 'true' : undefined} {...rest}>
        {body}
      </Link>
    );
  }
  return (
    <button type="button" className={cls} onClick={onSelect ? () => onSelect(meeting) : undefined} aria-haspopup="dialog" aria-current={selected ? 'true' : undefined} {...rest}>
      {body}
    </button>
  );
}
