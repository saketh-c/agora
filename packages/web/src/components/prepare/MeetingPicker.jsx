import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { cityPoint, haversineMiles, normalizePrefs, relativeDays, t, tn } from '@agora/core';
import { DateTile, EmptyState, Icon, MeetingStatus, Notice, Sheet, councilName, distanceText, tileTone, timeText, whenLong, whenText } from '../ui/index.js';
import { PRACTICE_ONLY } from '../../lib/prep.js';
import { PICKER_PAGE, pickerMeetings } from './prepPick.js';

/** "Plano City Council, Mon, Oct 12, 7:00 PM" or "Just practicing, 3:00 limit". */
export function forText(ctx) {
  if (!ctx.meeting) return t('prepare.practicing');
  return t('prepare.meetingLine', { council: councilName(ctx.meeting), when: whenText(ctx.meeting.date, ctx.meeting.time) });
}

/**
 * The "Getting ready for" card with its Change button (podium mock .forline). While the
 * meeting from the address is still being looked for (ctx.pending), it says so.
 */
export function ForLine({ ctx, onChange }) {
  return (
    <div className="forline">
      <p className="forline__t">
        <span>{t('prepare.forLabel')}</span>
        {ctx.pending ? (
          <strong className="forline__finding">
            <span className="spinner" aria-hidden="true" />
            {t('prepare.finding')}
          </strong>
        ) : (
          <strong className="num">{forText(ctx)}</strong>
        )}
      </p>
      {onChange && (
        <button type="button" className="btn btn--quiet btn--sm" onClick={onChange} aria-haspopup="dialog" aria-label={t('prepare.changeLabel')}>
          {t('prepare.change')}
        </button>
      )}
    </div>
  );
}

/**
 * After switching meetings: "You already wrote your comment. Count it for this meeting too?"
 * The draft and the practice runs are not tied to one meeting, so they can carry over.
 */
export function CarryNotice({ ctx }) {
  const { carry } = ctx;
  if (!carry) return null;
  const kind = carry.steps.length > 1 ? 'both' : carry.steps[0];
  // The notice goes away after either choice; focus lands back on Change, just above it.
  const then = (fn) => () => {
    fn();
    requestAnimationFrame(() => {
      const el = document.querySelector('.forline .btn');
      if (el) el.focus();
    });
  };
  return (
    <Notice
      tone="card"
      icon="check"
      className="prep-notice prep-carry"
      role="status"
      action={
        <>
          <button type="button" className="btn btn--secondary btn--sm" onClick={then(ctx.acceptCarry)}>
            {kind === 'both' ? t('prepare.carry.yesBoth') : t('prepare.carry.yes')}
          </button>
          <button type="button" className="btn btn--quiet btn--sm" onClick={then(ctx.dismissCarry)}>
            {t('prepare.carry.no')}
          </button>
        </>
      }
    >
      {t(`prepare.carry.${kind}`)}
    </Notice>
  );
}

/**
 * Above every Prepare page: the meeting is over (or gone), with the way on. A meeting that
 * already happened points at the next one Home would suggest; a bad or cancelled one opens the
 * picker.
 */
export function MeetingNotice({ ctx, onPick, pastText = true }) {
  const { problem, past, upcoming } = ctx;
  if (problem) {
    return (
      <Notice
        tone="neutral"
        icon="info"
        className="prep-notice"
        role="status"
        action={
          <button type="button" className="btn btn--quiet btn--sm" onClick={onPick} aria-haspopup="dialog">
            {t('prepare.signup.pickButton')}
          </button>
        }
      >
        {t(`prepare.notice.${problem}`)}
      </Notice>
    );
  }
  if (!past || !pastText) return null;
  return (
    <Notice
      tone="neutral"
      className="prep-notice"
      action={
        upcoming ? (
          <button type="button" className="btn btn--quiet btn--sm" onClick={() => ctx.choose(upcoming.id)}>
            {t('prepare.notice.nextOne', { council: councilName(upcoming), when: whenText(upcoming.date, upcoming.time) })}
          </button>
        ) : (
          <button type="button" className="btn btn--quiet btn--sm" onClick={onPick} aria-haspopup="dialog">
            {t('prepare.signup.pickButton')}
          </button>
        )
      }
    >
      {t('prepare.notice.past')}
    </Notice>
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

function MeetingChoice({ m, ctx, selected, onPick }) {
  const city = ctx.cityById(m.cityId);
  const origin = ctx.prefs && ctx.prefs.location;
  const miles = origin && city ? haversineMiles(origin, cityPoint(city)) : null;
  const away = distanceText(m, { homeCityId: ctx.prefs && ctx.prefs.homeCityId, distanceMiles: miles });
  const limit = m.pastLimit ? t('ui.milesShort', { n: normalizePrefs(ctx.prefs).maxMiles }) : '';
  return (
    <Choice selected={selected} onPick={onPick}>
      <DateTile date={m.date} tone={tileTone(m)} />
      <span className="row__main">
        <span className="row__title">
          <span>{councilName(m)}</span>
        </span>
        <span className="row__meta">
          <span className="vh">{`${whenLong(m.date)}, `}</span>
          <span className="t num">{timeText(m.time)}</span>
          <span>{relativeDays(m.date, ctx.day)}</span>
          {away && <span className="num">{away}</span>}
          {limit ? <span>{t('ui.pastLimit', { max: limit })}</span> : null}
        </span>
        <MeetingStatus meeting={m} city={city} deadline={ctx.deadlineOf(m)} />
      </span>
    </Choice>
  );
}

/**
 * The sheet behind Change: a search over every council, the home council's next dates, the
 * next meetings at other councils nearby (ten at a time), and "Just practicing", plus a way
 * out to Meetings for anything else.
 */
export default function MeetingPicker({ ctx, open, onClose }) {
  const { meeting, practicing, cities, cityById, prefs, day, now, deadlineOf } = ctx;
  const [query, setQuery] = useState('');
  const [limit, setLimit] = useState(PICKER_PAGE);
  useEffect(() => {
    if (!open) {
      setQuery('');
      setLimit(PICKER_PAGE);
    }
  }, [open]);

  const lists = useMemo(
    () => (open ? pickerMeetings({ cities, cityById, prefs, today: day, now, deadlineOf, query, limit }) : { home: [], others: [], more: false }),
    [open, cities, cityById, prefs, day, now, deadlineOf, query, limit],
  );
  const searching = Boolean(query.trim());
  const listed = new Set([...lists.home, ...lists.others].map((m) => m.id));
  // The meeting being prepared for stays on top, even when it is not one of the suggestions.
  const current = !searching && meeting && !listed.has(meeting.id) ? meeting : null;
  const homeCity = prefs.homeCityId ? cityById(prefs.homeCityId) : null;
  const count = lists.home.length + lists.others.length;

  const pick = (id) => {
    ctx.choose(id);
    onClose();
  };
  const row = (m) => <MeetingChoice key={m.id} m={m} ctx={ctx} selected={Boolean(meeting && meeting.id === m.id)} onPick={() => pick(m.id)} />;

  return (
    <Sheet open={open} onClose={onClose} title={t('prepare.picker.title')} className="prep-pick-sheet">
      <div className={`search prep-pick__search${query ? ' search--has-clear' : ''}`}>
        <Icon name="search" />
        <input
          type="search"
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            setLimit(PICKER_PAGE);
          }}
          placeholder={t('prepare.picker.searchPlaceholder')}
          aria-label={t('prepare.picker.searchLabel')}
          aria-describedby="prep-pick-count"
          enterKeyHint="search"
          autoComplete="off"
        />
        {query && (
          <button type="button" className="iconbtn search__clear" aria-label={t('prepare.picker.clearSearch')} onClick={() => setQuery('')}>
            <Icon name="x" />
          </button>
        )}
      </div>
      <p className="vh" id="prep-pick-count" role="status" aria-live="polite">
        {searching ? tn('prepare.picker.found', count) : ''}
      </p>

      {current && (
        <>
          <h3 className="day-head">{t('prepare.forLabel')}</h3>
          <ul className="group group--floor prep-pick">{row(current)}</ul>
        </>
      )}

      {lists.home.length > 0 && (
        <>
          <h3 className="day-head">{t('prepare.picker.inCity', { city: homeCity ? homeCity.name : '' })}</h3>
          <ul className="group group--floor prep-pick">{lists.home.map(row)}</ul>
        </>
      )}

      {lists.others.length > 0 && (
        <>
          <h3 className="day-head">{searching ? t('prepare.picker.matches') : prefs.location && !lists.others[0].pastLimit ? t('prepare.picker.nearby') : t('prepare.picker.others')}</h3>
          <ul className="group group--floor prep-pick">{lists.others.map(row)}</ul>
          {lists.more && (
            <button type="button" className="btn btn--quiet btn--sm prep-pick__more-btn" onClick={() => setLimit((n) => n + PICKER_PAGE)}>
              {t('prepare.picker.showMore')}
            </button>
          )}
        </>
      )}

      {count === 0 &&
        (searching ? (
          <EmptyState icon="search" title={t('prepare.picker.noMatchTitle', { q: query.trim() })} className="empty--floor">
            {t('prepare.picker.noMatch')}
          </EmptyState>
        ) : (
          <EmptyState icon="cal" title={t('prepare.picker.noneTitle')} className="empty--floor">
            {t('prepare.picker.none')}
          </EmptyState>
        ))}

      <h3 className="day-head">{t('prepare.picker.noMeeting')}</h3>
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
