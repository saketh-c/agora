import { Link } from 'react-router-dom';
import { relativeDays, t } from '@agora/core';
import { DateTile, EmptyState, Icon, MeetingStatus, Sheet, councilName, meetingDeadline, tileTone, timeText, whenLong, whenText } from '../ui/index.js';
import { PRACTICE_ONLY } from '../../lib/prep.js';

/** "Plano City Council, Mon, Oct 12, 7:00 PM" or "Just practicing, 3:00 limit". */
export function forText(ctx) {
  if (!ctx.meeting) return t('prepare.practicing');
  return t('prepare.meetingLine', { council: councilName(ctx.meeting), when: whenText(ctx.meeting.date, ctx.meeting.time) });
}

/** The "Getting ready for" card with its Change button (podium mock .forline). */
export function ForLine({ ctx, onChange }) {
  return (
    <div className="forline">
      <p className="forline__t">
        <span>{t('prepare.forLabel')}</span>
        <strong className="num">{forText(ctx)}</strong>
      </p>
      <button type="button" className="btn btn--quiet btn--sm" onClick={onChange} aria-haspopup="dialog" aria-label={t('prepare.changeLabel')}>
        {t('prepare.change')}
      </button>
    </div>
  );
}

/** One choice in the picker: a meeting row, or "Just practicing". */
function Choice({ selected, onPick, children }) {
  return (
    <li>
      <button type="button" className={`row prep-pick__row${selected ? ' is-sel' : ''}`} aria-current={selected ? 'true' : undefined} onClick={onPick}>
        {children}
        {selected ? <Icon name="check" className="prep-pick__check" label={t('prepare.picker.selected')} /> : <span aria-hidden="true" />}
      </button>
    </li>
  );
}

/**
 * The sheet behind Change: your next meetings where you can speak (one per council) or
 * "Just practicing", plus a way out to Meetings for anything else.
 */
export default function MeetingPicker({ ctx, open, onClose }) {
  const { options, meeting, practicing, day, now, cityById } = ctx;
  const pick = (id) => {
    ctx.choose(id);
    onClose();
  };

  return (
    <Sheet open={open} onClose={onClose} title={t('prepare.picker.title')}>
      {options.length > 0 ? (
        <ul className="group group--floor prep-pick" aria-label={t('prepare.picker.next')}>
          {options.map((m) => (
            <Choice key={m.id} selected={Boolean(meeting && meeting.id === m.id)} onPick={() => pick(m.id)}>
              <DateTile date={m.date} tone={tileTone(m)} />
              <span className="row__main">
                <span className="row__title">
                  <span>{councilName(m)}</span>
                </span>
                <span className="row__meta">
                  <span className="vh">{`${whenLong(m.date)}, `}</span>
                  <span className="t num">{timeText(m.time)}</span>
                  <span>{relativeDays(m.date, day)}</span>
                </span>
                <MeetingStatus meeting={m} city={cityById(m.cityId)} deadline={meetingDeadline(m, now)} />
              </span>
            </Choice>
          ))}
        </ul>
      ) : (
        <EmptyState icon="cal" title={t('prepare.picker.noneTitle')} className="empty--floor">
          {t('prepare.picker.none')}
        </EmptyState>
      )}
      <ul className="group group--floor prep-pick prep-pick--practice">
        <Choice selected={practicing} onPick={() => pick(PRACTICE_ONLY)}>
          <span className="tile tile--quiet prep-pick__tile" aria-hidden="true">
            <Icon name="mic" />
          </span>
          <span className="row__main">
            <span className="row__title">
              <span>{t('prepare.picker.practicing')}</span>
            </span>
            <span className="row__meta">
              <span>{t('prepare.picker.practicingSub')}</span>
            </span>
          </span>
        </Choice>
      </ul>
      <p className="prep-pick__more">
        <Link className="link" to="/meetings" onClick={onClose}>
          {t('prepare.picker.findAnother')}
        </Link>
      </p>
    </Sheet>
  );
}
