import { Link } from 'react-router-dom';
import { relativeDays, t } from '@agora/core';
import { DateTile, EmptyState, Icon, MeetingStatus, Sheet, councilName, distanceText, tileTone, timeText, whenLong } from '../ui/index.js';

/** One choice: a meeting, or "Best match for you". The current one carries a check. */
function Choice({ selected, onPick, children }) {
  return (
    <li>
      <button type="button" className={`row home-pick__row${selected ? ' is-sel' : ''}`} aria-current={selected ? 'true' : undefined} onClick={onPick}>
        {children}
        {selected ? <Icon name="check" className="home-pick__check" label={t('home.pick.selected')} /> : <span aria-hidden="true" />}
      </button>
    </li>
  );
}

/**
 * "Pick another meeting" from Home's next-meeting card: Agora's best match, or one of the
 * meetings Prepare's picker offers (prepPick.pickerMeetings: the home council's next dates,
 * then other councils at times that work and within the distance limit; any past the limit say
 * so). The choice is the same one Prepare uses (ui.prepMeeting), so Home and Prepare get ready
 * for the same meeting.
 *
 * `lists` is { home, others } from pickerMeetings; `current` the chosen meeting when neither
 * list has it; `chosenId` the saved choice (null for the best match); `onChoose(id | null)`;
 * `deadlineOf(meeting)`; `homeCityId` marks "Your city"; `maxMiles` names the limit.
 */
export default function NextPicker({ open, onClose, lists, current, chosenId, onChoose, today, deadlineOf, cityById, homeCityId, maxMiles, hasPlace }) {
  const pick = (id) => {
    onChoose(id);
    onClose();
  };
  const home = (lists && lists.home) || [];
  const others = (lists && lists.others) || [];
  const all = [...(current ? [current] : []), ...home, ...others];
  const chosen = all.some((m) => m.id === chosenId) ? chosenId : null;
  const homeCity = homeCityId ? cityById(homeCityId) : null;
  const limit = maxMiles != null ? t('ui.milesShort', { n: maxMiles }) : '';
  const row = (m) => {
    const dist = distanceText(m, { homeCityId });
    return (
      <Choice key={m.id} selected={chosen === m.id} onPick={() => pick(m.id)}>
        <DateTile date={m.date} tone={tileTone(m)} />
        <span className="row__main">
          <span className="row__title">
            <span>{councilName(m)}</span>
            {dist && <span className="row__dist">{dist}</span>}
          </span>
          <span className="row__meta">
            <span className="vh">{`${whenLong(m.date)}, `}</span>
            <span className="t num">{timeText(m.time)}</span>
            <span>{relativeDays(m.date, today)}</span>
            {m.pastLimit && limit ? <span>{t('ui.pastLimit', { max: limit })}</span> : null}
          </span>
          <MeetingStatus meeting={m} city={cityById(m.cityId)} deadline={deadlineOf(m)} />
        </span>
      </Choice>
    );
  };

  return (
    <Sheet open={open} onClose={onClose} title={t('home.pick.title')}>
      <ul className="group group--floor home-pick">
        <Choice selected={!chosen} onPick={() => pick(null)}>
          <span className="tile tile--quiet home-pick__tile" aria-hidden="true">
            <Icon name="star" />
          </span>
          <span className="row__main">
            <span className="row__title">
              <span>{t('home.pick.auto')}</span>
            </span>
            <span className="row__meta">
              <span>{t('home.pick.autoSub')}</span>
            </span>
          </span>
        </Choice>
      </ul>
      {current && (
        <>
          <h3 className="day-head">{t('home.next.label')}</h3>
          <ul className="group group--floor home-pick">{row(current)}</ul>
        </>
      )}
      {home.length > 0 && (
        <>
          <h3 className="day-head">{t('prepare.picker.inCity', { city: homeCity ? homeCity.name : '' })}</h3>
          <ul className="group group--floor home-pick">{home.map(row)}</ul>
        </>
      )}
      {others.length > 0 && (
        <>
          <h3 className="day-head">{hasPlace && !others[0].pastLimit ? t('prepare.picker.nearby') : t('prepare.picker.others')}</h3>
          <ul className="group group--floor home-pick">{others.map(row)}</ul>
        </>
      )}
      {!all.length && (
        <EmptyState icon="cal" title={t('home.pick.noneTitle')} className="empty--floor">
          {t('home.pick.none')}
        </EmptyState>
      )}
      <p className="home-pick__more">
        <Link className="link" to="/meetings" onClick={onClose}>
          {t('home.pick.more')}
        </Link>
      </p>
    </Sheet>
  );
}
