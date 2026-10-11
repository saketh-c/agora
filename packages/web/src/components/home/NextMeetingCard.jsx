import { Link } from 'react-router-dom';
import { getLocale, lowerFirst, t, tn } from '@agora/core';
import { PREP_STEPS } from '../../lib/prep.js';
import { AddToCalendar, Badge, Icon, ProgressLights, councilName, deadlineText, meetingDeadline, meetingTitle, speakMinutes, timeText, whenText } from '../ui/index.js';
import { HOME_DAYS, daysUntil } from './homeData.js';

/** The step after "Continue:". English capitalizes after the colon; Spanish and Vietnamese do not. */
function continueStep(step) {
  const label = t(`ui.prep.stepsLong.${step}`);
  return getLocale() === 'en' ? label : lowerFirst(label);
}

/**
 * Where "Continue" goes for each prep step: Write and Practice have their own pages; the hub
 * opens the Sign up and On the day cards with ?step= and scrolls to them.
 */
export function prepRoute(step, meetingId) {
  const q = `?meeting=${encodeURIComponent(meetingId)}`;
  if (step === 'write') return `/prepare/write${q}`;
  if (step === 'practice') return `/prepare/practice${q}`;
  if (step === 'signup' || step === 'day') return `/prepare${q}&step=${step}#step-${step}`;
  return `/prepare${q}`;
}

/**
 * The meeting's own name without the council it belongs to, which the card already names
 * ("Regular meeting", not "Regular meeting of the City Council"). A bare "Meeting" adds nothing
 * after the council's name, so it comes back empty.
 */
export function shortTitle(title) {
  const s = String(title || '')
    .replace(/\s+(?:del?|of the)\s+(?:concejo|consejo|ayuntamiento|city council|council)(?:\s+municipal)?\s*$/i, '')
    .replace(/\s+của\s+hội đồng(?:\s+thành phố)?\s*$/i, '')
    .trim();
  return /\s/.test(s) ? s : '';
}

/**
 * "Your next meeting": the screen's one bold moment (the Go color field). A countdown, when and
 * which council, how far it is (`where`, a sentence), the two facts that decide whether you can
 * speak (time limit, sign-up deadline), prep progress for this meeting, and the next step.
 * `onDetails` opens the meeting's details; `onPick` offers other meetings. With no meeting to
 * point at, a quiet card that says so and offers Meetings.
 */
export default function NextMeetingCard({ meeting, city, today, now, prep, onContinue, setupLink, where, onDetails, onPick }) {
  if (!meeting) {
    return (
      <section className="next next--none" aria-labelledby="next-h">
        <div className="next__top">
          <h2 className="next__label" id="next-h">
            {t('home.next.label')}
          </h2>
        </div>
        <p className="next__none t-heading">{t('home.next.noneTitle')}</p>
        <p className="next__nonebody">{t('home.next.noneBody', { n: HOME_DAYS })}</p>
        <div className="next__actions">
          <Link className="btn btn--primary" to="/meetings">
            {t('home.next.findMeeting')}
          </Link>
          {setupLink}
        </div>
      </section>
    );
  }

  const n = daysUntil(meeting, today);
  const minutes = speakMinutes(city);
  const deadline = meetingDeadline(meeting, now);
  const steps = PREP_STEPS.map((id) => ({
    id,
    label: t(`ui.prep.steps.${id}`),
    done: Boolean(prep.steps[id]),
    stateLabel: prep.steps[id] ? t('ui.prep.done') : t('ui.prep.notDone'),
  }));
  const allDone = !prep.next;
  // On the day itself, "closes today at 4:00 PM" says more than the weekday does.
  const deadlineLabel = deadline && !deadline.passed && deadline.date === today ? t('home.next.closesToday', { time: timeText(deadline.time) }) : deadlineText(deadline, 'closes');
  const title = shortTitle(meetingTitle(meeting));
  const who = title ? t('home.next.who', { council: councilName(meeting), meeting: lowerFirst(title) }) : councilName(meeting);

  return (
    <section className="next" aria-labelledby="next-h">
      <div className="next__top">
        <h2 className="next__label" id="next-h">
          {t('home.next.label')}
        </h2>
      </div>
      <div className="next__grid">
        <div className="next__info">
          <p className="next__count">
            {n === 0 ? (
              <span className="next__word" aria-hidden="true">
                {t('home.next.today')}
              </span>
            ) : (
              <>
                <span className="t-hero num" aria-hidden="true">
                  {n}
                </span>
                <span className="unit" aria-hidden="true">
                  {tn('home.next.days', n)}
                </span>
              </>
            )}
            <span className="vh">{n === 0 ? t('home.next.today') : tn('home.next.inDays', n)}</span>
          </p>
          <p className="next__when num">{whenText(meeting.date, meeting.time)}</p>
          <p className="next__who">{who}</p>
          {where && (
            <p className="next__where">
              <Icon name="pin" size={20} />
              <bdi>{where}</bdi>
            </p>
          )}
          {(onDetails || onPick) && (
            <p className="next__links">
              {onDetails && (
                <button type="button" className="next__link" onClick={() => onDetails(meeting)} aria-haspopup="dialog">
                  {t('home.next.details')}
                </button>
              )}
              {onPick && (
                <button type="button" className="next__link" onClick={onPick} aria-haspopup="dialog">
                  {t('home.next.pick')}
                </button>
              )}
            </p>
          )}
        </div>
        <div className="next__facts">
          <Badge tone="ink" icon="mic">
            {minutes ? tn('home.next.canSpeakFor', minutes) : t('home.next.canSpeak')}
          </Badge>
          {deadline && (
            <Badge tone={deadline.passed ? 'stop' : 'amber'} icon="clock">
              {deadlineLabel}
            </Badge>
          )}
        </div>
      </div>
      <div className="next__do">
        <p className="next__prephead">{allDone ? t('home.next.ready') : t('ui.prep.progress', { done: prep.done, n: prep.total })}</p>
        <ProgressLights steps={steps} label={t('ui.prep.progressLabel')} />
        <div className="next__actions">
          <Link className="btn btn--primary" to={prepRoute(prep.next, meeting.id)} onClick={onContinue}>
            {allDone ? t('home.next.review') : t('ui.prep.continue', { step: continueStep(prep.next) })}
          </Link>
          {/* Google Calendar, Outlook or an .ics file, like the meeting details (works on a Chromebook). */}
          <AddToCalendar meeting={meeting} city={city} now={now} className="btn btn--secondary" />
        </div>
      </div>
    </section>
  );
}
