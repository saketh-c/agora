import { Link } from 'react-router-dom';
import { formatDate, getLocale, relativeDays, t } from '@agora/core';
import Icon from './Icon.jsx';
import Badge from './Badge.jsx';
import Notice from './Notice.jsx';
import Disclosure from './Disclosure.jsx';
import Linkified from './Linkified.jsx';
import { downloadIcs, directionsUrl } from '../../lib/ics.js';
import { rawCity } from '../../lib/data.js';
import { asSentence, canSpeakAnswer, councilName, deadlineText, meetingDeadline, meetingTitle, remoteState, schoolTiming, whenText } from './meetingInfo.js';
import { tidyTimes, writtenContact } from './cityText.js';

/** A translated sentence with one {param} replaced by a React node (a link). */
function withNode(text, param, node) {
  const [before, after] = String(text).split(`{${param}}`);
  return (
    <>
      {before}
      {node}
      {after}
    </>
  );
}

/**
 * A meeting's note is either about this date (a status change, a special session, "still on
 * Election Day") or the city's standing note about every meeting of that kind. Only the first
 * belongs next to the date; the standing note is background, kept behind "More from the city".
 */
function noteKind(meeting, city) {
  const note = meeting.note || '';
  if (!note) return null;
  const rules = [...((city && city.meetings) || []), ...((rawCity(meeting.cityId) || {}).meetings || [])];
  return rules.some((r) => r && r.notes === note) ? 'rule' : 'date';
}

/**
 * Everything about one meeting, as the content of a Sheet (phones) or the side panel over
 * the map (desktop Meetings). Follows the podium mock's right-hand panel:
 * council + meeting name, when (+ relative day), where; the "Can I speak?" answer; the primary
 * action "Prepare to speak" (to /prepare?meeting=<id>), Add to calendar, Directions; the facts
 * list (When, Agenda, Watch, Can't go?); and the city guide link.
 *
 * Put the heading id in the Sheet's `labelledBy`:
 *   <Sheet open labelledBy="md-h" barStart={<MeetingDetailBadge ... />} onClose={...}>
 *     <MeetingDetail meeting={m} city={city} today={today} headingId="md-h" />
 *   </Sheet>
 *
 * For a watch-only meeting pass `nextSpeakable` (the next occurrence at this council that is
 * open to comment) and `onOpenMeeting(next)` to let people jump to it.
 */
export default function MeetingDetail({ meeting, city, today, now, headingId = 'md-h', nextSpeakable, onOpenMeeting, hideCityLink = false, className = '' }) {
  if (!meeting) return null;
  const pc = (city && city.publicComment) || {};
  const cancelled = meeting.status === 'cancelled';
  const canSpeak = meeting.openToPublicComment && !cancelled;
  const deadline = canSpeak ? meetingDeadline(meeting, now) : null;
  const remote = remoteState(city);
  const timing = schoolTiming(meeting);
  const agendaUrl = city && city.agendaPortal && city.agendaPortal.url;
  const watchUrl = meeting.virtualUrl || (city && city.liveStream && city.liveStream.url) || '';
  const watchName = city && city.liveStream && city.liveStream.name;
  const moved = meeting.status === 'rescheduled' || Boolean(meeting.movedFrom);
  const kind = noteKind(meeting, city);
  // A note about this date goes next to the date, unless the notice or the red answer already says it.
  const dateNote = kind === 'date' && !cancelled && !moved ? meeting.note : '';
  const ruleNote = kind === 'rule' ? meeting.note : '';
  const written = canSpeak ? pc.writtenCommentMethod || '' : '';
  const contact = written ? writtenContact(written) : null;
  // Addresses stay in English in every language (see core/i18n/data.js), so screen readers
  // should read them with an English voice.
  const lang = getLocale();

  return (
    <div className={className || undefined}>
      <p className="md__council">{councilName(meeting)}</p>
      <h2 className="t-heading md__title" id={headingId}>
        {meetingTitle(meeting)}
      </h2>
      <p className="md__when num">
        <strong>{whenText(meeting.date, meeting.time)}</strong>
        {today && <span className="slate">{relativeDays(meeting.date, today)}</span>}
      </p>
      {meeting.location && (
        <p className="md__where" lang={lang !== 'en' ? 'en' : undefined}>
          {meeting.location}
        </p>
      )}

      {moved ? (
        <Notice tone="amber" icon="moved" className="md__notice">
          {meeting.movedFrom ? t('ui.movedFrom', { date: formatDate(meeting.movedFrom) }) : t('ui.rescheduled')}
          {kind === 'date' ? ` ${meeting.note}` : ''}
        </Notice>
      ) : null}

      {cancelled ? (
        <div className="answer answer--stop">
          <p className="answer__q">{t('ui.answerStillOn')}</p>
          <p className="answer__a t-title">{t('ui.cancelled')}</p>
          <ul>
            {meeting.movedTo && (
              <li>
                <Icon name="moved" />
                <span>{t('ui.movedTo', { date: formatDate(meeting.movedTo) })}</span>
              </li>
            )}
            <li>
              <Icon name="info" />
              <span>{kind === 'date' ? meeting.note : t('ui.checkCityCalendar')}</span>
            </li>
          </ul>
        </div>
      ) : canSpeak ? (
        <div className="answer">
          <p className="answer__q">{t('ui.answerQuestion')}</p>
          <p className="answer__a t-title">{canSpeakAnswer(city)}</p>
          <ul>
            {deadline ? (
              <li>
                <Icon name="clock" />
                <span>
                  <strong>{asSentence(deadlineText(deadline, 'closes'))}</strong>
                  {deadline.passed ? null : ` ${t('ui.noDoorSignup')}`}
                </span>
              </li>
            ) : pc.deadline ? (
              <li>
                <Icon name="clock" />
                <span>
                  <strong>{t('ui.signupLabel')}</strong> {tidyTimes(pc.deadline)}
                </span>
              </li>
            ) : null}
            <li>
              <Icon name={remote === 'yes' ? 'video' : 'user'} />
              <span>{t(`ui.remoteLong.${remote}`)}</span>
            </li>
          </ul>
        </div>
      ) : (
        <div className="answer answer--watch">
          <p className="answer__q">{t('ui.answerQuestion')}</p>
          <p className="answer__a t-title">{t('ui.watchOnly')}</p>
          <p className="answer__sub">{t('ui.noPublicComment')}</p>
          {nextSpeakable && (
            <ul>
              <li>
                <Icon name="mic" />
                <span>
                  <strong>{t('ui.nextChance')}</strong> {whenText(nextSpeakable.date, nextSpeakable.time)}
                </span>
              </li>
            </ul>
          )}
          {nextSpeakable && onOpenMeeting && (
            <button type="button" className="btn btn--secondary btn--sm" onClick={() => onOpenMeeting(nextSpeakable)}>
              {t('ui.seeThatMeeting')}
            </button>
          )}
        </div>
      )}

      <div className="md__actions">
        {canSpeak && (
          <Link className="btn btn--primary btn--block" to={`/prepare?meeting=${encodeURIComponent(meeting.id)}`}>
            {t('ui.prepareToSpeak')}
          </Link>
        )}
        {!cancelled && (
          <div className="btn-row">
            <button type="button" className="btn btn--secondary" onClick={() => downloadIcs(meeting, city)}>
              <Icon name="cal-plus" />
              {t('ui.addToCalendar')}
            </button>
            <a className="btn btn--quiet" href={directionsUrl(meeting)} target="_blank" rel="noopener noreferrer">
              <Icon name="nav" />
              {t('ui.directions')}
              <span className="vh">{t('ui.opensNewTab')}</span>
            </a>
          </div>
        )}
      </div>

      <dl className="facts">
        <div>
          <dt>{t('ui.facts.when')}</dt>
          <dd>
            <p>{t(`ui.timingSentence.${timing}`)}</p>
            {dateNote ? <p className="facts__note">{dateNote}</p> : null}
          </dd>
        </div>
        {agendaUrl && (
          <div>
            <dt>{t('ui.facts.agenda')}</dt>
            <dd>
              <a className="link" href={agendaUrl} target="_blank" rel="noopener noreferrer">
                {t('ui.openAgenda')}
                <span className="vh">{t('ui.opensNewTab')}</span>
              </a>
            </dd>
          </div>
        )}
        {watchUrl && (
          <div>
            <dt>{t('ui.facts.watch')}</dt>
            <dd>
              <a className="link" href={watchUrl} target="_blank" rel="noopener noreferrer">
                {watchName || t('ui.watchLive')}
                <span className="vh">{t('ui.opensNewTab')}</span>
              </a>
            </dd>
          </div>
        )}
        {contact && (
          <div>
            <dt>{t('ui.facts.cantGo')}</dt>
            <dd>
              {contact.kind === 'email' ? (
                withNode(
                  t('ui.cantGoEmail'),
                  'email',
                  <a className="link" href={`mailto:${contact.email}`}>
                    {contact.email}
                  </a>,
                )
              ) : (
                <a className="link" href={contact.href} target="_blank" rel="noopener noreferrer">
                  {t('ui.cantGoForm')}
                  <span className="vh">{t('ui.opensNewTab')}</span>
                </a>
              )}
            </dd>
          </div>
        )}
      </dl>

      {(ruleNote || written) && (
        <Disclosure variant="plain" title={t('ui.moreFromCity')} className="md__more">
          {ruleNote && (
            <p>
              <Linkified text={ruleNote} />
            </p>
          )}
          {written && (
            <p>
              <strong>{t('ui.facts.cantGo')}</strong> <Linkified text={written} />
            </p>
          )}
        </Disclosure>
      )}

      {!hideCityLink && city && (
        <ul className="group group--floor md__guide">
          <li>
            <Link className="lrow lrow--icon" to={`/city/${city.cityId}`}>
              <span className="lrow__ic">
                <Icon name="book" />
              </span>
              <span>
                <span className="lrow__t">{t('ui.cityGuide', { city: city.name })}</span>
                <span className="lrow__m">{t('ui.cityGuideSub')}</span>
              </span>
              <Icon name="chev-r" />
            </Link>
          </li>
        </ul>
      )}
    </div>
  );
}

/** The badge for the top bar of the sheet or panel: "Your city" when it is the home city. */
export function MeetingDetailBadge({ meeting, homeCityId }) {
  if (!meeting || !homeCityId || meeting.cityId !== homeCityId) return null;
  return (
    <Badge tone="ink" icon="check">
      {t('ui.yourCity')}
    </Badge>
  );
}
