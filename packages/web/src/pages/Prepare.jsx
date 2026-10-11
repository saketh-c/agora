import { useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { checklist, daysBetween, t, tList, tn, todayStr, weekdayOf } from '@agora/core';
import { useStore } from '../lib/store.jsx';
import { PREP_STEPS } from '../lib/prep.js';
import { directionsUrl } from '../lib/ics.js';
import { asSentence, Disclosure, Icon, Linkified, Notice, PageHeader, ProgressLights, dayTimeText, meetingDeadline, monthDay, remoteState, speakMinutes, tidyTimes, timeText, whenText } from '../components/ui/index.js';
import MeetingPicker, { ForLine } from '../components/prepare/MeetingPicker.jsx';
import CommentBuilder, { composeDraft } from '../components/prepare/CommentBuilder.jsx';
import Reference from '../components/prepare/Reference.jsx';
import { usePrepMeeting } from '../components/prepare/prepMeeting.js';
import { mmss } from '../components/prepare/TimeRuler.jsx';
import '../styles/pages/prepare.css';

const STEP_IDS = ['signup', 'write', 'practice', 'day', 'after'];
const ARRIVE_EARLY_MINUTES = 20;

/** "1 of 4 done before Monday" (or before Oct 22, or "the meeting is today"). */
function progressText(summary, meeting, day) {
  const params = { done: summary.done, total: summary.total };
  if (!meeting || meeting.date < day) return t('prepare.progress.plain', params);
  if (meeting.date === day) return t('prepare.progress.today', params);
  const when = daysBetween(day, meeting.date) <= 6 ? tList('format.weekdays')[weekdayOf(meeting.date)] : monthDay(meeting.date);
  return t('prepare.progress.before', { ...params, day: when });
}

/** "Draft saved Thursday", from the saved draft's timestamp, in Central time. */
function savedText(at, day) {
  const time = Date.parse(at || '');
  if (!Number.isFinite(time)) return '';
  const date = todayStr('America/Chicago', new Date(time));
  const ago = daysBetween(date, day);
  if (ago <= 0) return t('prepare.write.subSaved.today');
  if (ago === 1) return t('prepare.write.subSaved.yesterday');
  if (ago < 7) return t('prepare.write.subSaved.day', { day: tList('format.weekdays')[weekdayOf(date)] });
  return t('prepare.write.subSaved.date', { date: monthDay(date) });
}

/** 'HH:MM' minus some minutes, for "get there by". */
function minusMinutes(time, minutes) {
  const [h, m] = String(time || '').split(':').map(Number);
  if (!Number.isFinite(h) || !Number.isFinite(m)) return null;
  const total = Math.max(0, h * 60 + m - minutes);
  return `${String(Math.floor(total / 60)).padStart(2, '0')}:${String(total % 60).padStart(2, '0')}`;
}

function StepCard({ id, n, title, sub, state, quietState = false, done, open, onToggle, children }) {
  const bodyId = `step-${id}-body`;
  return (
    <li className={`step${done ? ' is-done' : ''}${open ? ' is-open' : ''}`} id={`step-${id}`}>
      <h3 className="step__h">
        <button type="button" className="step__head" aria-expanded={open} aria-controls={bodyId} onClick={onToggle}>
          <span className="step__num" aria-hidden="true">
            {done ? <Icon name="check" /> : n}
          </span>
          <span className="step__txt">
            <span className="step__t">{title}</span>
            {sub && <span className="step__s">{sub}</span>}
          </span>
          <span className="step__state">
            <span className={quietState ? 'step__statetxt step__statetxt--quiet' : 'step__statetxt'}>{state}</span>
            <Icon name="chev-d" />
          </span>
        </button>
      </h3>
      <div className="step__body" id={bodyId} hidden={!open}>
        {children}
      </div>
    </li>
  );
}

function DoneCheck({ step, checked, onChange }) {
  return (
    <label className="check-row step__check">
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} />
      <span>{t(`prepare.markDone.${step}`)}</span>
    </label>
  );
}

export default function Prepare() {
  const ctx = usePrepMeeting();
  const { meeting, city, homeCity, practicing, past, problem, prepKey, day, now } = ctx;
  const { profile, ui, setUi, prepFor, setPrepStep, lang } = useStore();
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const [picking, setPicking] = useState(false);
  const summary = prepFor(prepKey);
  const [openSteps, setOpenSteps] = useState(() => {
    const asked = params.get('step');
    if (STEP_IDS.includes(asked)) return [asked];
    if (past && !summary.steps.after) return ['after'];
    if (practicing && (!summary.next || summary.next === 'signup')) return ['write'];
    return summary.next ? [summary.next] : [];
  });
  const toggle = (id) => setOpenSteps((list) => (list.includes(id) ? list.filter((x) => x !== id) : [...list, id]));
  const isOpen = (id) => openSteps.includes(id);
  const setDone = (step) => (on) => setPrepStep(prepKey, step, on);
  const stateFor = (step, inProgress = false) => (summary.steps[step] ? t('ui.prep.done') : inProgress ? t('prepare.state.inProgress') : t('prepare.state.notStarted'));
  // "Not started" is the default, so narrow phones hide it (visually only) to give the title room.
  const quiet = (step, inProgress = false) => !summary.steps[step] && !inProgress;

  // Sign up: the city's real deadline (structured for a few cities, the city's own words otherwise).
  const pc = (city && city.publicComment) || {};
  const deadline = meeting ? meetingDeadline(meeting, now) : null;
  const minutes = speakMinutes(city);
  const signupSub = !meeting ? (
    <span>{t('prepare.signup.pickFirst')}</span>
  ) : deadline ? (
    <>
      <span className={`st st--${deadline.passed ? 'stop' : 'amber'}`}>
        <Icon name="clock" />
        {deadline.passed ? t('ui.signupClosed') : t('prepare.signup.closes', { when: dayTimeText(deadline.date, deadline.time) })}
      </span>
      {pc.registrationUrl && <span>{t('prepare.signup.online')}</span>}
    </>
  ) : (
    <span className="step__clamp">{pc.deadline ? tidyTimes(pc.deadline) : t('prepare.signup.askCity')}</span>
  );

  // Write
  const draft = ui.commentDraft;
  const saved = draft && typeof draft === 'object' ? savedText(draft.at, day) : '';
  const limitText = mmss(practicing || !minutes ? 180 : minutes * 60);

  // On the day: the checklist is kept per profile (ui.checklist); checking every item marks the step done.
  const items = checklist();
  const checked = new Set((ui.checklist || []).filter((i) => Number.isInteger(i) && i >= 0 && i < items.length));
  const toggleItem = (i, on) => {
    const next = new Set(checked);
    if (on) next.add(i);
    else next.delete(i);
    setUi({ checklist: [...next].sort((a, b) => a - b) });
    const all = next.size === items.length;
    if (all !== summary.steps.day) setPrepStep(prepKey, 'day', all);
  };
  const arrive = meeting ? minusMinutes(meeting.time, ARRIVE_EARLY_MINUTES) : null;

  // Practice: hand over the saved draft so Practice opens with it, unless the builder already
  // handed over a newer one (which may be the AI-polished version).
  const startPractice = () => {
    const last = ui.lastDraft;
    const writtenAt = draft && typeof draft === 'object' ? Date.parse(draft.at || '') : NaN;
    const handedAt = last && typeof last === 'object' ? Date.parse(last.at || '') : NaN;
    if (Number.isFinite(writtenAt) && !(handedAt >= writtenAt)) {
      const forCity = city || homeCity;
      setUi({
        lastDraft: {
          text: composeDraft(draft, { meeting, city: forCity }),
          cityId: forCity ? forCity.cityId : '',
          meetingId: meeting ? meeting.id : null,
          fields: { name: draft.name || '', school: draft.school || '', itemTitle: draft.itemTitle || '', ask: draft.ask || '' },
          at: new Date().toISOString(),
        },
      });
    }
    navigate('/prepare/practice');
  };

  const lights = PREP_STEPS.map((id) => ({
    id,
    label: t(`ui.prep.steps.${id}`),
    done: summary.steps[id],
    stateLabel: summary.steps[id] ? t('ui.prep.done') : t('ui.prep.notDone'),
  }));

  return (
    <div className="wrap prep">
      <PageHeader title={t('nav.prepare')}>
        <ForLine ctx={ctx} onChange={() => setPicking(true)} />
      </PageHeader>

      {problem && (
        <Notice
          tone="neutral"
          icon="info"
          className="prep-notice"
          role="status"
          action={
            <button type="button" className="link" onClick={() => setPicking(true)}>
              {t('prepare.signup.pickButton')}
            </button>
          }
        >
          {t(`prepare.notice.${problem}`)}
        </Notice>
      )}
      {!problem && past && (
        <Notice tone="neutral" className="prep-notice">
          {t('prepare.notice.past')}
        </Notice>
      )}

      <div className="prep-prog">
        <p className="prep-prog__h">{progressText(summary, meeting, day)}</p>
        <ProgressLights steps={lights} label={t('ui.prep.progressLabel')} onLight />
      </div>

      <h2 className="vh">{t('prepare.stepsHeading')}</h2>
      <ol className="steps">
        <StepCard id="signup" n={1} title={t('ui.prep.stepsLong.signup')} sub={signupSub} state={stateFor('signup')} quietState={quiet('signup')} done={summary.steps.signup} open={isOpen('signup')} onToggle={() => toggle('signup')}>
          {meeting ? (
            <>
              <dl className="facts prep-facts">
                <div>
                  <dt>{t('prepare.signup.deadline')}</dt>
                  <dd>
                    {deadline ? (
                      <p>
                        <strong className={deadline.passed ? 'prep-late' : undefined}>{deadline.passed ? t('ui.signupClosed') : asSentence(whenText(deadline.date, deadline.time))}</strong>
                        {deadline.passed ? null : ` ${t('ui.noDoorSignup')}`}
                      </p>
                    ) : (
                      <p>{pc.deadline ? <Linkified text={pc.deadline} /> : t('prepare.signup.askCity')}</p>
                    )}
                  </dd>
                </div>
                {pc.howToRegister && !pc.registrationUrl && (
                  <div>
                    <dt>{t('prepare.signup.how')}</dt>
                    <dd>
                      <p>
                        <Linkified text={pc.howToRegister} />
                      </p>
                    </dd>
                  </div>
                )}
                <div>
                  <dt>{t('prepare.signup.atMic')}</dt>
                  <dd>{`${minutes ? `${tn('common.minutes', minutes)}.` : t('prepare.signup.noLimit')} ${t(`ui.remoteLong.${remoteState(city)}`)}`}</dd>
                </div>
              </dl>
              <div className="btn-row step__actions">
                {pc.registrationUrl && !(deadline && deadline.passed) && (
                  <a className="btn btn--primary" href={pc.registrationUrl} target="_blank" rel="noopener noreferrer">
                    <Icon name="ext" size={20} />
                    {t('prepare.signup.openForm')}
                    <span className="vh">{t('ui.opensNewTab')}</span>
                  </a>
                )}
                <Link className={pc.registrationUrl ? 'link prep-link' : 'btn btn--secondary'} to={`/city/${city.cityId}`}>
                  {t('ui.cityGuide', { city: city.name })}
                </Link>
              </div>
              {pc.howToRegister && pc.registrationUrl && (
                <Disclosure variant="plain" title={t('city.fullRules')} className="prep-rules">
                  <p>
                    <Linkified text={pc.howToRegister} />
                  </p>
                </Disclosure>
              )}
              <DoneCheck step="signup" checked={summary.steps.signup} onChange={setDone('signup')} />
            </>
          ) : (
            <>
              <p className="step__lead">{t('prepare.signup.pickBody')}</p>
              <div className="btn-row step__actions">
                <button type="button" className="btn btn--secondary" onClick={() => setPicking(true)} aria-haspopup="dialog">
                  {t('prepare.signup.pickButton')}
                </button>
              </div>
            </>
          )}
        </StepCard>

        <StepCard
          id="write"
          n={2}
          title={t('ui.prep.stepsLong.write')}
          sub={<span>{saved || t('prepare.write.subNew', { limit: limitText })}</span>}
          state={stateFor('write', Boolean(saved))}
          quietState={quiet('write', Boolean(saved))}
          done={summary.steps.write}
          open={isOpen('write')}
          onToggle={() => toggle('write')}
        >
          <CommentBuilder key={profile.id} meeting={meeting} city={city || homeCity} practicing={practicing} prepKey={prepKey} headingLevel={4} idPrefix="hub" />
          <DoneCheck step="write" checked={summary.steps.write} onChange={setDone('write')} />
        </StepCard>

        <StepCard id="practice" n={3} title={t('ui.prep.stepsLong.practice')} sub={<span>{t('prepare.practice.sub')}</span>} state={stateFor('practice')} quietState={quiet('practice')} done={summary.steps.practice} open={isOpen('practice')} onToggle={() => toggle('practice')}>
          <p className="step__lead">{t('prepare.practice.body')}</p>
          <div className="btn-row step__actions">
            <button type="button" className="btn btn--primary" onClick={startPractice}>
              <Icon name="mic" />
              {t('prepare.practice.start')}
            </button>
          </div>
          <DoneCheck step="practice" checked={summary.steps.practice} onChange={setDone('practice')} />
        </StepCard>

        <StepCard
          id="day"
          n={4}
          title={t('ui.prep.stepsLong.day')}
          sub={<span>{checked.size ? t('prepare.day.count', { done: checked.size, total: items.length }) : t('prepare.day.sub')}</span>}
          state={stateFor('day', checked.size > 0)}
          quietState={quiet('day', checked.size > 0)}
          done={summary.steps.day}
          open={isOpen('day')}
          onToggle={() => toggle('day')}
        >
          {meeting && (
            <dl className="facts prep-facts prep-facts--day">
              {meeting.location && (
                <div>
                  <dt>{t('prepare.day.where')}</dt>
                  <dd>
                    {/* Addresses stay in English in every language. */}
                    <p lang={lang !== 'en' ? 'en' : undefined}>{meeting.location}</p>
                    <p>
                      <a className="link" href={directionsUrl(meeting)} target="_blank" rel="noopener noreferrer">
                        {t('ui.directions')}
                        <span className="vh">{t('ui.opensNewTab')}</span>
                      </a>
                    </p>
                  </dd>
                </div>
              )}
              {arrive && (
                <div>
                  <dt>{t('prepare.day.arrive')}</dt>
                  <dd>{t('prepare.day.arriveBy', { time: timeText(arrive) })}</dd>
                </div>
              )}
            </dl>
          )}
          <fieldset className="prep-check">
            <legend className="vh">{t('prepare.day.checklist')}</legend>
            {items.map((item, i) => (
              <label key={item} className="check-row">
                <input type="checkbox" checked={checked.has(i)} onChange={(e) => toggleItem(i, e.target.checked)} />
                <span>{item}</span>
              </label>
            ))}
          </fieldset>
        </StepCard>

        <StepCard
          id="after"
          n={5}
          title={t('ui.prep.stepsLong.after')}
          sub={<span>{meeting && !past ? t('prepare.after.opens', { date: monthDay(meeting.date) }) : t('prepare.after.sub')}</span>}
          state={summary.steps.after ? t('ui.prep.done') : meeting && !past ? t('prepare.state.later') : t('prepare.state.notStarted')}
          quietState={!summary.steps.after && !(meeting && !past)}
          done={summary.steps.after}
          open={isOpen('after')}
          onToggle={() => toggle('after')}
        >
          <p className="step__lead">{t('prepare.after.body')}</p>
          <div className="btn-row step__actions">
            <Link className="btn btn--secondary" to="/community">
              <Icon name="share" />
              {t('prepare.after.share')}
            </Link>
          </div>
          <DoneCheck step="after" checked={summary.steps.after} onChange={setDone('after')} />
        </StepCard>
      </ol>

      <Reference />

      <MeetingPicker ctx={ctx} open={picking} onClose={() => setPicking(false)} />
    </div>
  );
}
