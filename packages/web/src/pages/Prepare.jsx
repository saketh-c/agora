import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { Link, useLocation, useNavigate, useSearchParams } from 'react-router-dom';
import { checklist, daysBetween, t, tn, todayStr, weekdayName } from '@agora/core';
import { useStore } from '../lib/store.jsx';
import { PREP_STEPS, checkedItems } from '../lib/prep.js';
import { directionsUrl } from '../lib/ics.js';
import { asSentence, Disclosure, Icon, Linkified, PageHeader, ProgressLights, dayTimeText, meetingDeadline, monthDay, remoteState, speakMinutes, tidyTimes, timeText, whenText } from '../components/ui/index.js';
import MeetingPicker, { CarryNotice, ForLine, MeetingNotice } from '../components/prepare/MeetingPicker.jsx';
import CommentBuilder from '../components/prepare/CommentBuilder.jsx';
import Reference from '../components/prepare/Reference.jsx';
import { usePrepMeeting } from '../components/prepare/prepMeeting.js';
import { mmss } from '../components/prepare/TimeRuler.jsx';
import '../styles/pages/prepare.css';

const STEP_IDS = ['signup', 'write', 'practice', 'day', 'after'];
const ARRIVE_EARLY_MINUTES = 20;
const OPEN_MS = 240;
const CLOSE_MS = 180;

const reducedMotion = () => typeof window !== 'undefined' && window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

/** "1 of 4 done before Monday" (or before Oct 22, or "the meeting is today"). */
function progressText(summary, meeting, day) {
  const params = { done: summary.done, total: summary.total };
  if (!meeting || meeting.date < day) return t('prepare.progress.plain', params);
  if (meeting.date === day) return t('prepare.progress.today', params);
  const when = daysBetween(day, meeting.date) <= 6 ? weekdayName(meeting.date) : monthDay(meeting.date);
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
  if (ago < 7) return t('prepare.write.subSaved.day', { day: weekdayName(date) });
  return t('prepare.write.subSaved.date', { date: monthDay(date) });
}

/** 'HH:MM' minus some minutes, for "get there by". */
function minusMinutes(time, minutes) {
  const [h, m] = String(time || '').split(':').map(Number);
  if (!Number.isFinite(h) || !Number.isFinite(m)) return null;
  const total = Math.max(0, h * 60 + m - minutes);
  return `${String(Math.floor(total / 60)).padStart(2, '0')}:${String(total % 60).padStart(2, '0')}`;
}

/**
 * One expandable step (podium mock .step). Open, the card carries a 2px Ink ring drawn above
 * its content, so hovering the header only tints the header band inside it. The body grows
 * and shrinks smoothly (instantly with reduced motion); `hideSubOpen` drops a subtitle that the
 * open body repeats.
 */
function StepCard({ id, n, title, sub, hideSubOpen = false, state, quietState = false, done, open, onToggle, children }) {
  const bodyId = `step-${id}-body`;
  const bodyRef = useRef(null);
  const anim = useRef(null);
  const prevOpen = useRef(open);
  const [closing, setClosing] = useState(false);
  const shownOpen = open && !closing;

  const settle = () => {
    if (anim.current) anim.current.cancel();
    anim.current = null;
    if (bodyRef.current) bodyRef.current.style.overflow = '';
  };

  useLayoutEffect(() => {
    // Only a change animates (and running twice in development changes nothing).
    if (prevOpen.current === open) return;
    prevOpen.current = open;
    const el = bodyRef.current;
    settle();
    if (!open || !el || reducedMotion() || typeof el.animate !== 'function') return;
    const h = el.offsetHeight;
    el.style.overflow = 'hidden';
    const a = el.animate([{ height: '0px', opacity: 0 }, { height: `${h}px`, opacity: 1 }], { duration: OPEN_MS, easing: 'cubic-bezier(.2, 0, 0, 1)' });
    anim.current = a;
    a.onfinish = settle;
  }, [open]);
  useEffect(() => () => settle(), []);

  const toggle = () => {
    const el = bodyRef.current;
    if (closing) {
      // Pressed again while closing: stay open.
      settle();
      setClosing(false);
      return;
    }
    if (!open || !el || reducedMotion() || typeof el.animate !== 'function') {
      onToggle();
      return;
    }
    settle();
    setClosing(true);
    el.style.overflow = 'hidden';
    const a = el.animate([{ height: `${el.offsetHeight}px`, opacity: 1 }, { height: '0px', opacity: 0 }], { duration: CLOSE_MS, easing: 'cubic-bezier(.3, 0, .8, .15)', fill: 'forwards' });
    anim.current = a;
    // The layout effect for the closed state removes the animation once the body is hidden.
    a.onfinish = () => {
      setClosing(false);
      onToggle();
    };
  };

  return (
    <li className={`step${done ? ' is-done' : ''}${shownOpen ? ' is-open' : ''}`} id={`step-${id}`}>
      <h3 className="step__h">
        <button type="button" className="step__head" aria-expanded={shownOpen} aria-controls={bodyId} onClick={toggle}>
          <span className="step__num" aria-hidden="true">
            {done ? <Icon name="check" /> : n}
          </span>
          <span className="step__txt">
            <span className="step__t">{title}</span>
            {sub && <span className={`step__s${hideSubOpen ? ' step__s--dup' : ''}`}>{sub}</span>}
          </span>
          <span className="step__state">
            <span className={quietState ? 'step__statetxt step__statetxt--quiet' : 'step__statetxt'}>{state}</span>
            <Icon name="chev-d" />
          </span>
        </button>
      </h3>
      <div className="step__body" id={bodyId} ref={bodyRef} hidden={!open}>
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


/**
 * A meeting from a shared link that only a city's agenda site lists is known once the live
 * agendas load: until then the page says it is looking, instead of showing another meeting's
 * steps or "That meeting is over".
 */
function PrepareLoading({ ctx }) {
  return (
    <div className="wrap prep">
      <PageHeader title={t('nav.prepare')}>
        <ForLine ctx={ctx} />
      </PageHeader>
      <div className="page-loading prep-loading" role="status">
        <span className="vh">{t('prepare.finding')}</span>
        <span className="page-loading__line page-loading__line--short" aria-hidden="true" />
        <span className="page-loading__block" aria-hidden="true" />
      </div>
    </div>
  );
}

export default function Prepare() {
  const ctx = usePrepMeeting();
  // The steps mount once the meeting is known, so which step starts open fits that meeting.
  return ctx.pending ? <PrepareLoading ctx={ctx} /> : <PrepareSteps ctx={ctx} />;
}

function PrepareSteps({ ctx }) {
  const { meeting, city, homeCity, practicing, past, prepKey, day, now } = ctx;
  const { profile, ui, prepFor, lang } = useStore();
  const navigate = useNavigate();
  const { hash } = useLocation();
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
  const setDone = (step) => (on) => ctx.markStep(step, on);
  const stateFor = (step, inProgress = false) => (summary.steps[step] ? t('ui.prep.done') : inProgress ? t('prepare.state.inProgress') : t('prepare.state.notStarted'));
  // "Not started" is the default, so narrow phones hide it (visually only) to give the title room.
  const quiet = (step, inProgress = false) => !summary.steps[step] && !inProgress;

  // A link to one step (Home's Continue: ?step=day#step-day) lands on it, open.
  useEffect(() => {
    const asked = params.get('step');
    if (!STEP_IDS.includes(asked)) return undefined;
    setOpenSteps((list) => (list.includes(asked) ? list : [...list, asked]));
    if (hash !== `#step-${asked}`) return undefined;
    const id = requestAnimationFrame(() => {
      const el = document.getElementById(`step-${asked}`);
      if (el) el.scrollIntoView({ block: 'start' });
    });
    return () => cancelAnimationFrame(id);
  }, [params, hash]);

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

  // On the day: the checklist is kept per meeting; checking every item marks the step done.
  const items = checklist();
  const checked = new Set(checkedItems(summary, items.length));
  const toggleItem = (i, on) => {
    const next = new Set(checked);
    if (on) next.add(i);
    else next.delete(i);
    ctx.setChecklist([...next], items.length);
  };
  const arrive = meeting ? minusMinutes(meeting.time, ARRIVE_EARLY_MINUTES) : null;

  // Practice picks up the latest draft from Write by itself; saving the meeting here makes the
  // run count for it.
  const startPractice = () => {
    ctx.pin();
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

      <MeetingNotice ctx={ctx} onPick={() => setPicking(true)} />
      <CarryNotice ctx={ctx} />

      <div className="prep-prog">
        <p className="prep-prog__h">{progressText(summary, meeting, day)}</p>
        <ProgressLights steps={lights} label={t('ui.prep.progressLabel')} onLight />
      </div>

      <h2 className="vh">{t('prepare.stepsHeading')}</h2>
      <ol className="steps">
        <StepCard id="signup" n={1} title={t('ui.prep.stepsLong.signup')} sub={signupSub} hideSubOpen={Boolean(meeting)} state={stateFor('signup')} quietState={quiet('signup')} done={summary.steps.signup} open={isOpen('signup')} onToggle={() => toggle('signup')}>
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
                  <a className="btn btn--primary" href={pc.registrationUrl} target="_blank" rel="noopener noreferrer" onClick={ctx.pin}>
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
          <CommentBuilder key={profile.id} ctx={ctx} meeting={meeting} city={city || homeCity} practicing={practicing} headingLevel={4} idPrefix="hub" />
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
                    <p>
                      <bdi lang={lang !== 'en' ? 'en' : undefined}>{meeting.location}</bdi>
                    </p>
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
