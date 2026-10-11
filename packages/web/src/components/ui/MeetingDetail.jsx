import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { formatDate, getLocale, joinItems, joinSentences, labelValue, liveMeetingFor, relativeDays, stripIsolates, t, todayStr } from '@agora/core';
import Icon from './Icon.jsx';
import Badge from './Badge.jsx';
import Notice from './Notice.jsx';
import Disclosure from './Disclosure.jsx';
import Linkified from './Linkified.jsx';
import AddToCalendar from './AddToCalendar.jsx';
import { directionsUrl } from '../../lib/ics.js';
import { copyText } from '../../lib/clipboard.js';
import { rawCity } from '../../lib/data.js';
import { asSentence, canSpeakAnswer, councilName, deadlineText, distanceText, meetingDeadline, meetingTitle, monthDay, remoteState, schoolTiming, whenText } from './meetingInfo.js';
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

/** The address of a meeting in this app, for sharing. */
export function meetingLink(meeting) {
  const base = (import.meta.env && import.meta.env.BASE_URL) || '/';
  const path = `${base.endsWith('/') ? base : `${base}/`}meetings?meeting=${encodeURIComponent(meeting.id)}`;
  return typeof window !== 'undefined' ? new URL(path, window.location.origin).href : path;
}

/**
 * Share a meeting: the system share sheet where there is one (phones, ChromeOS, Windows),
 * otherwise copy the link and say so. It sits in the bar of the sheet or panel, next to Close
 * (Sheet's `barEnd`); "Link copied" shows beside it for a few seconds, over the bar only, so it
 * never covers the meeting's date. Renders nothing for a cancelled meeting.
 *
 *   <Sheet barStart={<MeetingDetailBadge ... />} barEnd={<MeetingShare meeting={m} />} ...>
 */
export function MeetingShare({ meeting }) {
  const [said, setSaid] = useState('');
  const timer = useRef(null);
  useEffect(() => () => clearTimeout(timer.current), []);
  const say = (text) => {
    setSaid(text);
    clearTimeout(timer.current);
    timer.current = setTimeout(() => setSaid(''), 4000);
  };
  const share = async () => {
    const url = meetingLink(meeting);
    // Shared text leaves the app: plain text, without the bidi isolates the screen uses.
    const title = stripIsolates(councilName(meeting));
    const text = stripIsolates(labelValue(councilName(meeting), joinItems([meetingTitle(meeting), whenText(meeting.date, meeting.time)])));
    if (typeof navigator !== 'undefined' && typeof navigator.share === 'function') {
      try {
        await navigator.share({ title, text, url });
        return;
      } catch (err) {
        // Closing the share sheet is not a failure; anything else falls back to copying.
        if (err && err.name === 'AbortError') return;
      }
    }
    say((await copyText(url)) ? t('ui.linkCopied') : t('ui.copyFailed'));
  };
  if (!meeting || meeting.status === 'cancelled') return null;
  return (
    <span className="md__sharebox">
      <span className={`md__said${said ? ' is-on' : ''}`} role="status" aria-live="polite">
        {said ? (
          <>
            <Icon name="check" size={18} />
            {said}
          </>
        ) : null}
      </span>
      <button type="button" className="iconbtn md__share" aria-label={t('ui.shareLabel')} title={t('ui.share')} onClick={share}>
        <Icon name="share" />
      </button>
    </span>
  );
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
 *
 * Optional: `distance` ({ miles, from }: "2.7 mi from Home") and `reasons` (strings: why a
 * ranked list put this meeting near the top; leave out what the distance line or the "Your
 * city" badge already says). Share goes in the bar of the sheet or panel (MeetingShare); Add
 * to calendar offers Google Calendar, Outlook and an .ics file; when the city takes sign-ups
 * online and sign-up is still open, the green answer links straight to the form.
 */
export default function MeetingDetail({ meeting, city, today, now, headingId = 'md-h', nextSpeakable, onOpenMeeting, hideCityLink = false, distance, reasons, className = '' }) {
  if (!meeting) return null;
  const pc = (city && city.publicComment) || {};
  const cancelled = meeting.status === 'cancelled';
  const canSpeak = meeting.openToPublicComment && !cancelled;
  const deadline = canSpeak ? meetingDeadline(meeting, now) : null;
  const remote = remoteState(city);
  const timing = schoolTiming(meeting);
  const agendaUrl = city && city.agendaPortal && city.agendaPortal.url;
  // This meeting's own agenda, once the city's agenda site has posted it (core/src/agendas.js).
  const live = liveMeetingFor(city, meeting);
  const posted = live && live.agendaUrl ? live : null;
  const watchUrl = meeting.virtualUrl || (city && city.liveStream && city.liveStream.url) || '';
  const watchName = city && city.liveStream && city.liveStream.name;
  const moved = meeting.status === 'rescheduled' || Boolean(meeting.movedFrom);
  const kind = noteKind(meeting, city);
  // A note about this date goes next to the date, unless the notice or the red answer already says it.
  const dateNote = kind === 'date' && !cancelled && !moved ? meeting.note : '';
  const ruleNote = kind === 'rule' ? meeting.note : '';
  const written = canSpeak ? pc.writtenCommentMethod || '' : '';
  const signupUrl = canSpeak && pc.registrationUrl && !(deadline && deadline.passed) ? pc.registrationUrl : '';
  const away = distance && distance.miles != null ? distanceText(meeting, { distanceMiles: distance.miles }) : '';
  const why = (reasons || []).filter(Boolean).slice(0, 3);
  const contact = written ? writtenContact(written) : null;
  // Addresses stay in English in every language (see core/i18n/data.js), so screen readers
  // should read them with an English voice.
  const lang = getLocale();

  return (
    <div className={className || undefined}>
      <div className="md__head">
        <div className="md__headtext">
          <p className="md__council">{councilName(meeting)}</p>
          <h2 className="t-heading md__title" id={headingId}>
            {meetingTitle(meeting)}
          </h2>
        </div>
      </div>
      <p className="md__when num">
        <strong>{whenText(meeting.date, meeting.time)}</strong>
        {today && <span className="slate">{relativeDays(meeting.date, today)}</span>}
      </p>
      {meeting.location && (
        // The address is English in every language; <bdi> keeps its own order in right-to-left text.
        <p className="md__where">
          <bdi lang={lang !== 'en' ? 'en' : undefined}>{meeting.location}</bdi>
        </p>
      )}
      {away && distance.from ? (
        <p className="md__dist num">
          <Icon name="pin" size={18} />
          {t('ui.distanceFrom', { distance: away, place: distance.from })}
        </p>
      ) : null}

      {moved ? (
        <Notice tone="amber" icon="moved" className="md__notice">
          {/* "Moved from Tue, Oct 6." ends its sentence before the city's own note. */}
          {kind === 'date' ? joinSentences([meeting.movedFrom ? t('ui.movedFrom', { date: formatDate(meeting.movedFrom) }) : t('ui.rescheduled'), meeting.note]) : meeting.movedFrom ? t('ui.movedFrom', { date: formatDate(meeting.movedFrom) }) : t('ui.rescheduled')}
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
        <div className="answer on-go">
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
          {signupUrl && (
            <a className="btn btn--secondary btn--sm" href={signupUrl} target="_blank" rel="noopener noreferrer">
              {t('ui.signUpOnline')}
              <Icon name="ext" />
              <span className="vh">{t('ui.opensNewTab')}</span>
            </a>
          )}
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
            <AddToCalendar meeting={meeting} city={city} now={now} />
            <a className="btn btn--quiet" href={directionsUrl(meeting)} target="_blank" rel="noopener noreferrer">
              <Icon name="nav" />
              {t('ui.directions')}
              <span className="vh">{t('ui.opensNewTab')}</span>
            </a>
          </div>
        )}
      </div>

      {why.length > 0 && !cancelled ? (
        <div className="md__why">
          <p className="md__whyt">{t('ui.whyTitle')}</p>
          <ul>
            {why.map((text) => (
              <li key={text}>
                <Icon name="check" size={18} />
                <span>{text.charAt(0).toLocaleUpperCase(lang) + text.slice(1)}</span>
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      <dl className="facts">
        <div>
          <dt>{t('ui.facts.when')}</dt>
          <dd>
            <p>{t(`ui.timingSentence.${timing}`)}</p>
            {dateNote ? <p className="facts__note">{dateNote}</p> : null}
          </dd>
        </div>
        {(posted || agendaUrl) && (
          <div>
            <dt>{t('ui.facts.agenda')}</dt>
            <dd>
              <a className="link" href={posted ? posted.agendaUrl : agendaUrl} target="_blank" rel="noopener noreferrer">
                {posted ? (posted.agendaPostedOn ? t('live.agendaPosted', { date: monthDay(posted.agendaPostedOn).replace(/ /g, '\u00a0') }) : t('live.agendaPostedUndated')) : t('ui.openAgenda')}
                <span className="vh">{t('ui.opensNewTab')}</span>
              </a>
              {posted && posted.fetchedAt ? <p className="facts__note">{t('live.checked', { date: monthDay(todayStr('America/Chicago', new Date(posted.fetchedAt))).replace(/ /g, '\u00a0') })}</p> : null}
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
