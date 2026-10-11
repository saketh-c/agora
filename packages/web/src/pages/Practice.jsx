import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { t, tn, estimateSpeakingSeconds } from '@agora/core';
import { useStore } from '../lib/store.jsx';
import { Disclosure, Icon, Notice, PageHeader } from '../components/ui/index.js';
import MeetingPicker, { CarryNotice, ForLine, MeetingNotice, forText } from '../components/prepare/MeetingPicker.jsx';
import { draftTextOf } from '../components/prepare/CommentBuilder.jsx';
import { usePrepMeeting } from '../components/prepare/prepMeeting.js';
import { EyeStrip, TimeChart, TimeRuler, lightFor, warnSeconds } from '../components/timecharts.jsx';
import { analyzeTranscript, paceSeries, PACE_TARGET } from '../lib/rehearse/speech.js';
import { ambientFloor, estimateSyllables, loudnessSeries, paceEstimateSeries, pitchStats, summarizeEnvelope, LONG_PAUSE_SEC, SYLLABLES_PER_WORD } from '../lib/rehearse/audio.js';
import { summarizeBody } from '../lib/rehearse/vision.js';
import { buildFindings, countsAsPractice, timedSeconds, MIN_TAKE_SEC } from '../lib/rehearse/coach.js';
import { deviceProblem, SPEECH_SUPPORTED, useRehearsalSession } from '../lib/rehearse/session.js';
import { MODEL_BASE, VISION_AVAILABLE } from '../lib/rehearse/models.js';
import { clock, coachParams, limitPhrase, megabytes, numberText, takeWhen } from '../lib/rehearse/format.js';
import { SCRIPT_MAX, initialScript, isFromDraft, latestDraft, scriptParagraphs } from '../lib/rehearse/script.js';
import { HISTORY_MAX } from '../lib/profiles.js';
// The "Getting ready for" line and the meeting picker share Prepare's styles.
import '../styles/pages/prepare.css';
import '../styles/pages/practice.css';

const DEFAULT_LIMIT_SEC = 180;
const HISTORY_SHOWN = 5;
const isObj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const LIVE = ['ready', 'countdown', 'recording', 'processing'];

/** The city's limit in seconds, or 3 minutes when it posts none (or no city is picked). */
function limitFor(city) {
  const n = city && city.publicComment && Number(city.publicComment.timeLimitMinutes);
  return Number.isFinite(n) && n > 0 ? Math.round(n * 60) : DEFAULT_LIMIT_SEC;
}

/**
 * Where the setup starts. The council: a ?city= link, then the meeting being prepared for
 * (the same one Home and Prepare show), then what this person picked last time, then home.
 * The script: the newest draft from Write, unless the student has since typed or cleared
 * their own (lib/rehearse/script.js).
 */
function initialSetup({ ui, params, cityById, homeCityId, ctx, draft }) {
  const saved = isObj(ui.practice) ? ui.practice : {};
  const valid = (id) => (typeof id === 'string' && id && cityById(id) ? id : null);
  let cityId = valid(params.get('city'));
  if (cityId === null && ctx.meeting) cityId = valid(ctx.meeting.cityId);
  if (cityId === null && typeof saved.cityId === 'string' && (saved.cityId === '' || valid(saved.cityId))) cityId = saved.cityId;
  if (cityId === null) cityId = valid(homeCityId) || '';
  return {
    cityId,
    ...initialScript({ saved, draft }),
    camera: typeof saved.camera === 'boolean' ? saved.camera : true,
    // Off unless chosen: the live transcript is the one feature that sends audio away.
    transcript: SPEECH_SUPPORTED && saved.transcript === true,
    showScript: saved.showScript !== false,
  };
}

/**
 * Practice: record yourself giving your comment against the city's limit and get told,
 * specifically, what to fix. Audio and video are analyzed on this device and thrown away;
 * a few numbers per run are kept in the profile. The live transcript is the one exception,
 * it uses the browser's speech service, and it is off unless switched on.
 *
 * A run that counts (heard, and long enough to coach) is saved to the history and marks the
 * Practice step for the meeting Prepare is getting ready for. Space starts and stops a take.
 */
export default function Practice() {
  const { profile, ui, setUi, lang } = useStore();
  const ctx = usePrepMeeting();
  const { cities, cityById } = ctx;
  const [params] = useSearchParams();
  const [picking, setPicking] = useState(false);

  // The newest draft from Write, composed for the meeting being prepared for.
  const draftCity = ctx.city || ctx.homeCity;
  const writeText = useMemo(
    () => draftTextOf(ui.commentDraft, { meeting: ctx.meeting, city: draftCity }),
    // lang: the template is written in the app language.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [ui.commentDraft, ctx.meeting, draftCity, lang],
  );
  const draft = useMemo(() => latestDraft({ commentDraft: ui.commentDraft, writeText, lastDraft: ui.lastDraft }), [ui.commentDraft, writeText, ui.lastDraft]);

  const [setup, setSetup] = useState(() => initialSetup({ ui, params, cityById, homeCityId: profile.prefs.homeCityId, ctx, draft }));
  const [report, setReport] = useState(null);
  const [announce, setAnnounce] = useState('');

  const city = setup.cityId ? cityById(setup.cityId) : null;
  const limitSec = limitFor(city);
  const history = Array.isArray(ui.rehearsals) ? ui.rehearsals : [];

  // Picking another meeting practices against that council's limit.
  const meetingKey = ctx.prepKey;
  const lastKey = useRef(meetingKey);
  useEffect(() => {
    if (lastKey.current === meetingKey) return;
    lastKey.current = meetingKey;
    setSetup((s) => ({ ...s, cityId: ctx.meeting ? ctx.meeting.cityId : '' }));
  }, [meetingKey, ctx.meeting]);

  // Remember the setup (debounced), so leaving for Write and coming back keeps it.
  const setUiRef = useRef(setUi);
  setUiRef.current = setUi;
  const firstSave = useRef(true);
  const pendingSave = useRef(null);
  useEffect(() => {
    if (firstSave.current) {
      firstSave.current = false;
      return undefined;
    }
    pendingSave.current = { ...setup, at: new Date().toISOString() };
    const id = setTimeout(() => {
      setUiRef.current({ practice: pendingSave.current });
      pendingSave.current = null;
    }, 500);
    return () => clearTimeout(id);
  }, [setup]);
  // Following "Edit in Write" right after typing still keeps what was typed.
  useEffect(
    () => () => {
      if (pendingSave.current) setUiRef.current({ practice: pendingSave.current });
    },
    [],
  );

  const setupRef = useRef(setup);
  setupRef.current = setup;
  const draftRef = useRef(draft);
  draftRef.current = draft;
  const ctxRef = useRef(ctx);
  ctxRef.current = ctx;

  /** Turn one finished take into the report, and keep its numbers when it counts. */
  const onTake = useCallback(
    (take) => {
      const s = setupRef.current;
      const d = draftRef.current;
      const takeCity = s.cityId ? cityById(s.cityId) : null;
      const limit = limitFor(takeCity);
      const perWord = SYLLABLES_PER_WORD[lang] || SYLLABLES_PER_WORD.en;
      const opts = { ambient: ambientFloor(take.ambient), perWord };
      const envelope = summarizeEnvelope(take.frames, take.dt, opts);
      const seconds = timedSeconds(take.durationSec, envelope);
      // Pace counts the time spent speaking, not the beat before the first word.
      const spanSec = envelope.firstSpeechSec !== null ? Math.max(1, Math.min(take.durationSec, envelope.lastSpeechSec + 0.5) - envelope.firstSpeechSec) : take.durationSec;
      const script = s.script.trim();
      // The builder's name, school, item and ask only apply to the script they came with.
      const fields = script && isFromDraft(script, d) && isObj(d.fields) ? d.fields : {};
      const speech = take.transcript ? analyzeTranscript(take.transcript, { lang, durationSec: spanSec, script, fields }) : null;
      const pitch = pitchStats(take.frames);
      const fps = take.durationSec > 0 ? take.samples.length / take.durationSec : 0;
      const body = take.camera && take.samples.length ? summarizeBody(take.samples, { fps: fps || 8, durationSec: take.durationSec }) : null;
      const syllables = estimateSyllables(take.frames, take.dt, opts);
      const estimatedWpm = spanSec > 0 ? Math.round((syllables / perWord / spanSec) * 60) : 0;
      const wpm = speech && speech.words ? speech.wpm : estimatedWpm;
      const coach = buildFindings({ speech, envelope, pitch, body, seconds, limitSec: limit, wpm, wpmEstimated: !(speech && speech.words), lang, hasScript: Boolean(script) });
      const counted = countsAsPractice(coach);
      const c = ctxRef.current;
      const bucket = seconds < 45 ? 2 : seconds < 120 ? 3 : 5;
      const result = {
        at: new Date().toISOString(),
        seconds,
        durationSec: take.durationSec,
        limitSec: limit,
        cityId: s.cityId,
        camera: take.camera,
        transcriptOn: take.transcriptOn,
        srState: take.srState,
        speech: speech && speech.words ? speech : null,
        envelope,
        body,
        wpm,
        wpmEstimated: !(speech && speech.words),
        pace: speech && speech.words ? paceSeries(take.wordsTimeline, take.durationSec, 15) : paceEstimateSeries(take.frames, take.dt, 15, opts),
        loudness: loudnessSeries(take.frames, take.dt, bucket, opts),
        coach,
        counted,
        // What the run counted for, said in the report.
        countedFor: counted && c.meeting ? forText(c) : null,
      };
      setReport(result);
      // A sound check, or a take where nothing was heard, is not practice: not saved, not counted.
      if (!counted) return;
      const summary = {
        at: result.at,
        cityId: s.cityId,
        limitSec: limit,
        durationSec: seconds,
        wpm,
        fillers: result.speech ? result.speech.fillerTotal : null,
        eyeContact: body && body.faceShare >= 0.5 ? Math.round(body.eyeContactShare * 100) : null,
        longPauses: envelope.longPauses,
        coverage: result.speech && result.speech.script ? Math.round(result.speech.script.coverage * 100) : null,
        findings: coach.findings.length,
      };
      setUi((current) => ({ rehearsals: [summary, ...(Array.isArray(current.rehearsals) ? current.rehearsals : [])].slice(0, HISTORY_MAX) }));
      c.markStep('practice', true);
    },
    [cityById, lang, setUi],
  );

  const session = useRehearsalSession({ lang, visionAvailable: VISION_AVAILABLE, modelBase: MODEL_BASE, onTake });
  const { phase } = session;
  const sessionRef = useRef(session);
  sessionRef.current = session;

  // Each phase hands focus to its main control or heading, and says what changed.
  const focusRef = useRef(null);
  const lastPhase = useRef(phase);
  useEffect(() => {
    if (lastPhase.current === phase) return;
    const from = lastPhase.current;
    lastPhase.current = phase;
    if (phase === 'starting' || (phase === 'setup' && from === 'starting')) return;
    const messages = {
      ready: session.camera ? t('rehearse.announce.ready') : t('rehearse.announce.readyMic'),
      countdown: t('rehearse.announce.starting'),
      recording: t('rehearse.announce.recording'),
      processing: t('rehearse.rec.processing'),
      report: t('rehearse.announce.report'),
    };
    setAnnounce(messages[phase] || '');
    const id = requestAnimationFrame(() => {
      // The setup form is long and the stage is short: without this a phone is left
      // scrolled past the camera. Phones bring the title and stage to the top; wider screens and the
      // report start from the top of the page.
      const title = document.querySelector('.pr .page-head h1');
      const phone = window.innerWidth < 900;
      // With the script on screen, a phone brings the timer, Stop and the script into view instead:
      // reading matters more than watching yourself while you speak.
      const timer = document.querySelector('.pr-stage.has-script .pr-timer');
      if (phone && timer && phase === 'countdown') timer.scrollIntoView({ block: 'start' });
      else if (phone && title && (phase === 'ready' || (phase === 'countdown' && from === 'ready'))) {
        title.scrollIntoView({ block: 'start' });
        // ...and the phase's main button sits above the tab bar.
        const button = document.querySelector('.pr-panel .btn--primary, .pr-panel .btn--secondary');
        const bar = document.querySelector('.tabbar');
        const floor = window.innerHeight - (bar ? bar.getBoundingClientRect().height : 0) - 12;
        if (button && button.getBoundingClientRect().bottom > floor) window.scrollBy(0, button.getBoundingClientRect().bottom - floor);
      } else if (phase === 'ready' || phase === 'report') window.scrollTo(0, 0);
      // Back on setup, focus lands on the button that starts again, scrolled into view.
      if (focusRef.current) focusRef.current.focus({ preventScroll: phase !== 'setup' });
    });
    return () => cancelAnimationFrame(id);
  }, [phase, session.camera]);

  // Space starts a take from the device check, cancels the countdown and stops the recording.
  // Inside a text field or on a button or link, Space keeps its usual job.
  useEffect(() => {
    if (phase !== 'ready' && phase !== 'countdown' && phase !== 'recording') return undefined;
    const onKey = (e) => {
      if (e.key !== ' ' || e.repeat || e.altKey || e.ctrlKey || e.metaKey || e.shiftKey || e.defaultPrevented) return;
      const el = e.target;
      if (el && el.closest && el.closest('input, textarea, select, button, a[href], summary, [contenteditable="true"], [role="button"], [role="switch"]')) return;
      if (document.querySelector('.sheet-layer')) return;
      e.preventDefault();
      const s = sessionRef.current;
      if (s.phase === 'ready') s.begin();
      else if (s.phase === 'countdown') s.cancel();
      else if (s.phase === 'recording') s.stop();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [phase]);

  // Announce the light changing during a take, once each.
  const light = phase === 'recording' ? lightFor(Math.floor(session.elapsed), limitSec) : 'go';
  useEffect(() => {
    if (light === 'amber') setAnnounce(t('rehearse.announce.amber'));
    if (light === 'stop') setAnnounce(t('rehearse.announce.over'));
  }, [light]);

  const start = () => session.prepare({ camera: setup.camera, transcript: setup.transcript });
  const live = LIVE.includes(phase);

  return (
    <div className="wrap pr">
      <PageHeader title={t('rehearse.title')} crumbs={[{ to: '/prepare', label: t('nav.prepare') }, { label: t('rehearse.crumb') }]} lead={phase === 'setup' || phase === 'starting' ? t('rehearse.lead') : null}>
        {!live && <ForLine ctx={ctx} onChange={() => setPicking(true)} />}
      </PageHeader>
      <p className="vh" role="status" aria-live="polite">
        {announce}
      </p>
      {!live && <MeetingNotice ctx={ctx} onPick={() => setPicking(true)} />}
      {!live && <CarryNotice ctx={ctx} />}

      {(phase === 'setup' || phase === 'starting') && (
        <Setup setup={setup} onChange={setSetup} cities={cities} city={city} limitSec={limitSec} draft={draft} session={session} onStart={start} focusRef={focusRef} history={history} cityById={cityById} lang={lang} onClearHistory={() => setUi({ rehearsals: [] })} />
      )}

      {live && <Stage session={session} setup={setup} onShowScript={(on) => setSetup((s) => ({ ...s, showScript: on }))} city={city} limitSec={limitSec} focusRef={focusRef} />}

      {phase === 'report' && report && (
        <Report report={report} city={report.cityId ? cityById(report.cityId) : null} playback={session.playback} lang={lang} onAgain={start} onChange={session.reset} focusRef={focusRef} history={history} cityById={cityById} onClearHistory={() => setUi({ rehearsals: [] })} />
      )}

      <MeetingPicker ctx={ctx} open={picking} onClose={() => setPicking(false)} />
    </div>
  );
}

// ---------------------------------------------------------------- Setup

function Switch({ id, checked, onChange, title, desc, disabled = false }) {
  return (
    <label className={`pr-switch${disabled ? ' is-disabled' : ''}`} htmlFor={id}>
      <span className="pr-switch__text">
        <span className="pr-switch__t" id={`${id}-t`}>
          {title}
        </span>
        <span className="pr-switch__s" id={`${id}-d`}>
          {desc}
        </span>
      </span>
      <span className="pr-switch__state" aria-hidden="true">
        {checked ? t('rehearse.setup.on') : t('rehearse.setup.off')}
      </span>
      <span className="pr-switch__ctl">
        <input id={id} type="checkbox" role="switch" checked={checked} disabled={disabled} aria-labelledby={`${id}-t`} aria-describedby={`${id}-d`} onChange={(e) => onChange(e.target.checked)} />
        <span className="pr-switch__track" aria-hidden="true">
          <span className="pr-switch__thumb">
            <Icon name="check" />
          </span>
        </span>
      </span>
    </label>
  );
}

/** "Space to start": shown where there is a keyboard (CSS hides it on touch screens). */
function KeyHint({ action }) {
  return (
    <p className="pr-keys">
      <kbd>{t('rehearse.keys.space')}</kbd>
      <span>{t(`rehearse.keys.${action}`)}</span>
    </p>
  );
}

function wordCount(text) {
  return String(text || '')
    .trim()
    .split(/\s+/)
    .filter(Boolean).length;
}

function Setup({ setup, onChange, cities, city, limitSec, draft, session, onStart, focusRef, history, cityById, lang, onClearHistory }) {
  const problem = useMemo(() => deviceProblem(), []);
  const starting = session.phase === 'starting';
  const error = session.error || problem;
  const sorted = useMemo(() => [...cities].sort((a, b) => a.name.localeCompare(b.name, lang)), [cities, lang]);
  const fromDraft = isFromDraft(setup.script, draft);
  const hasDraft = Boolean(draft && draft.text.trim());
  const scriptSec = setup.script.trim() ? estimateSpeakingSeconds(setup.script) : 0;
  const update = (patch) => onChange((s) => ({ ...s, ...patch }));
  const scriptRef = useRef(null);
  const submit = (e) => {
    e.preventDefault();
    if (!starting && !problem) onStart();
  };
  const useDraft = () => {
    update({ script: draft.text.slice(0, SCRIPT_MAX), scriptFrom: 'draft', draftAt: draft.at });
    requestAnimationFrame(() => scriptRef.current && scriptRef.current.focus());
  };
  const clearScript = () => {
    update({ script: '', scriptFrom: 'own', draftAt: draft ? draft.at : setup.draftAt });
    requestAnimationFrame(() => scriptRef.current && scriptRef.current.focus());
  };
  const limitLine = city ? t('rehearse.time.limitCity', { city: city.name, limit: limitPhrase(limitSec) }) : t('rehearse.time.limitGeneric', { limit: limitPhrase(limitSec) });
  const fallback = clock(DEFAULT_LIMIT_SEC);

  return (
    <div className="pr-setup">
      <form className="card pr-form" onSubmit={submit} aria-labelledby="pr-setup-h" noValidate>
        <h2 className="vh" id="pr-setup-h">
          {t('rehearse.setup.title')}
        </h2>
        <div className="field">
          <label className="label" htmlFor="pr-city">
            {t('rehearse.setup.city')}
          </label>
          <select id="pr-city" className="select" value={setup.cityId} onChange={(e) => update({ cityId: e.target.value })}>
            <option value="">{t('rehearse.setup.cityNone')}</option>
            {sorted.map((c) => {
              const min = c.publicComment && Number(c.publicComment.timeLimitMinutes);
              return (
                <option key={c.cityId} value={c.cityId}>
                  {Number.isFinite(min) && min > 0 ? t('rehearse.setup.cityOption', { city: c.name, min: numberText(min, lang) }) : t('rehearse.setup.cityOptionNoLimit', { city: c.name, limit: fallback })}
                </option>
              );
            })}
          </select>
          {city && !(city.publicComment && Number(city.publicComment.timeLimitMinutes) > 0) && <p className="help">{t('rehearse.setup.noLimit', { city: city.name })}</p>}
        </div>

        <div className="field">
          <label className="label" htmlFor="pr-script">
            {t('rehearse.setup.script')} <span className="opt">{t('rehearse.setup.optional')}</span>
          </label>
          <textarea
            id="pr-script"
            ref={scriptRef}
            className="textarea pr-script"
            value={setup.script}
            maxLength={SCRIPT_MAX}
            placeholder={t('rehearse.setup.scriptPlaceholder')}
            aria-describedby={fromDraft ? 'pr-script-from' : 'pr-script-help'}
            onChange={(e) => update({ script: e.target.value, scriptFrom: 'own' })}
          />
          {fromDraft && (
            <Notice
              icon="check"
              className="pr-from"
              action={
                <>
                  <Link className="btn btn--quiet btn--sm" to="/prepare/write">
                    {t('rehearse.setup.editInWrite')}
                  </Link>
                  <button type="button" className="btn btn--quiet btn--sm" onClick={clearScript}>
                    {t('rehearse.setup.clear')}
                  </button>
                </>
              }
            >
              <span id="pr-script-from">{tn('rehearse.setup.usingDraft', wordCount(setup.script))}</span>
            </Notice>
          )}
          {!fromDraft && (
            <p className="help pr-script__help" id="pr-script-help">
              {hasDraft ? (
                <>
                  <span>{t('rehearse.setup.scriptHelpDraft')}</span>{' '}
                  <button type="button" className="link" onClick={useDraft}>
                    {tn('rehearse.setup.useDraft', wordCount(draft.text))}
                  </button>
                </>
              ) : (
                <>
                  <span>{t('rehearse.setup.scriptHelp')}</span>{' '}
                  <Link className="link" to="/prepare/write">
                    {t('rehearse.setup.writeOne')}
                  </Link>
                </>
              )}
            </p>
          )}
        </div>

        <fieldset className="pr-measure">
          <legend className="label">{t('rehearse.setup.measure')}</legend>
          <Switch id="pr-camera" checked={setup.camera} onChange={(v) => update({ camera: v })} title={t('rehearse.setup.camera')} desc={VISION_AVAILABLE ? t('rehearse.setup.cameraDesc') : t('rehearse.setup.cameraVideo')} />
          <Switch id="pr-transcript" checked={setup.transcript} disabled={!SPEECH_SUPPORTED} onChange={(v) => update({ transcript: v })} title={t('rehearse.setup.transcript')} desc={SPEECH_SUPPORTED ? t('rehearse.setup.transcriptDesc') : t('rehearse.setup.transcriptNone')} />
          <Switch id="pr-show" checked={setup.showScript} onChange={(v) => update({ showScript: v })} title={t('rehearse.setup.showScript')} desc={t('rehearse.setup.showScriptDesc')} />
        </fieldset>

        <div className="pr-privacy">
          <p className="pr-privacy__line">
            <Icon name="shield" size={20} />
            <span>{setup.transcript ? t('rehearse.privacy.lineTranscript') : t('rehearse.privacy.line')}</span>
          </p>
          <Disclosure variant="plain" title={t('rehearse.privacy.more')}>
            <ul className="pr-bullets">
              <li>{t('rehearse.privacy.devices')}</li>
              <li>{t('rehearse.privacy.local')}</li>
              <li>{t('rehearse.privacy.saved')}</li>
              <li>{t('rehearse.privacy.transcript')}</li>
            </ul>
          </Disclosure>
        </div>

        {error && (
          <Notice tone="stop" role="alert" className="pr-error">
            {t(`rehearse.errors.${error}`)}
          </Notice>
        )}

        <button type="submit" className="btn btn--primary pr-go" ref={focusRef} disabled={Boolean(problem)} aria-busy={starting || undefined}>
          {starting ? <span className="spinner" aria-hidden="true" /> : <Icon name={setup.camera ? 'video' : 'mic'} />}
          {starting ? t('rehearse.setup.turningOn') : setup.camera ? t('rehearse.setup.turnOn') : t('rehearse.setup.turnOnMic')}
        </button>
      </form>

      <div className="pr-aside">
        <section className="card pr-time" aria-labelledby="pr-time-h">
          <h2 className="t-heading" id="pr-time-h">
            {t('rehearse.time.title')}
          </h2>
          {scriptSec > 0 ? (
            <TimeRuler seconds={scriptSec} limitSec={limitSec} note={`${t('rehearse.time.estimate')} ${limitLine}`} />
          ) : (
            <>
              {/* No script yet: the limit is a fact about the city, not a result, so it stays quiet. */}
              <p className="pr-time__limit">{limitLine}</p>
              <TimeRuler seconds={0} limitSec={limitSec} readout={false} note={t('rehearse.time.empty')} />
            </>
          )}
        </section>
        {history.length > 0 && <History rows={history} cityById={cityById} lang={lang} onClear={onClearHistory} />}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------- Device check, countdown, recording

function LevelMeter({ level, label, big = false }) {
  const n = big ? 32 : 20;
  const lit = Math.round(Math.max(0, Math.min(1, level)) * n);
  return (
    <div className={`pr-meter${big ? ' pr-meter--big' : ''}`} role="meter" aria-label={label} aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(level * 100)}>
      {Array.from({ length: n }, (_, i) => (
        <span key={i} className={i < lit ? 'is-on' : undefined} />
      ))}
    </div>
  );
}

function CheckRow({ state = 'ok', title, children }) {
  const icon = state === 'ok' ? 'check' : state === 'warn' ? 'alert' : state === 'off' ? 'minus' : null;
  return (
    <li className={`pr-checks__row is-${state}`}>
      <span className="pr-checks__ic" aria-hidden="true">
        {state === 'busy' ? <span className="spinner" /> : <Icon name={icon} />}
      </span>
      <span className="pr-checks__main">
        <span className="pr-checks__t">{title}</span>
        {children}
      </span>
    </li>
  );
}

/** The script on screen while recording, large and scrollable, like a teleprompter card. */
function Prompter({ script, show, onShow }) {
  const paras = scriptParagraphs(script);
  if (!paras.length) return null;
  return (
    <section className={`card pr-prompt${show ? '' : ' is-hidden'}`} aria-labelledby="pr-prompt-h">
      <div className="pr-prompt__head">
        <h2 className="pr-prompt__t" id="pr-prompt-h">
          {t('rehearse.rec.script')}
        </h2>
        <button type="button" className="btn btn--quiet btn--sm" aria-expanded={show} aria-controls="pr-prompt-text" onClick={() => onShow(!show)}>
          {show ? t('rehearse.rec.hideScript') : t('rehearse.rec.showScript')}
        </button>
      </div>
      {show && (
        // Scrollable, so it can take focus and scroll with the arrow keys.
        // eslint-disable-next-line jsx-a11y/no-noninteractive-tabindex
        <div className="pr-prompt__text" id="pr-prompt-text" tabIndex={0} role="region" aria-labelledby="pr-prompt-h">
          {paras.map((p, i) => (
            <p key={i}>{p}</p>
          ))}
        </div>
      )}
    </section>
  );
}

function Stage({ session, setup, onShowScript, city, limitSec, focusRef }) {
  const { phase, camera, models, level, micQuiet, elapsed, countdown, sr, faceFound, notice, videoRef } = session;
  const sec = Math.floor(elapsed);
  const light = phase === 'recording' ? lightFor(sec, limitSec) : 'wait';
  const left = limitSec - sec;
  const stateText = phase !== 'recording' ? t('rehearse.rec.startingIn', { n: countdown }) : light === 'stop' ? t('rehearse.rec.overBy', { over: clock(sec - limitSec) }) : light === 'amber' ? t('rehearse.rec.wrapUp', { left: clock(left) }) : t('rehearse.rec.left', { left: clock(left) });
  const where = city ? city.name : t('rehearse.history.just');
  const transcriptOn = setup.transcript && SPEECH_SUPPORTED;

  return (
    <div className={`pr-stage pr-stage--${phase}${setup.showScript && setup.script.trim() ? ' has-script' : ''}`}>
      <div className={`pr-view${camera ? '' : ' pr-view--audio'}`}>
        {camera ? (
          <video ref={videoRef} className="pr-view__video" muted playsInline autoPlay aria-label={t('rehearse.check.preview')} />
        ) : (
          <div className="pr-view__audio">
            <span className="pr-view__mic" style={{ '--lvl': level }} aria-hidden="true">
              <Icon name="mic" />
            </span>
            <LevelMeter level={level} big label={t('rehearse.check.micLevel')} />
            <span className="pr-view__cap">{t('rehearse.check.micOnly')}</span>
          </div>
        )}
        {camera && phase === 'ready' && (
          <div className="pr-guide" aria-hidden="true">
            <span />
          </div>
        )}
        {phase === 'countdown' && (
          <div className="pr-count" aria-hidden="true">
            <span key={countdown}>{countdown}</span>
          </div>
        )}
        {phase === 'recording' && (
          <span className="pr-rec">
            <span className="pr-rec__dot" aria-hidden="true" />
            {t('rehearse.rec.recording')}
          </span>
        )}
      </div>

      <div className="pr-panel">
        {phase === 'ready' && (
          <section className="card pr-check" aria-labelledby="pr-check-h">
            <h2 className="t-heading" id="pr-check-h" tabIndex={-1} ref={focusRef}>
              {camera ? t('rehearse.check.title') : t('rehearse.check.titleMic')}
            </h2>
            {notice && (
              <Notice tone="amber" icon="alert">
                {t(`rehearse.notices.${notice}`)}
              </Notice>
            )}
            <ul className="pr-checks">
              <CheckRow state={micQuiet ? 'warn' : 'ok'} title={t('rehearse.check.mic')}>
                {camera && <LevelMeter level={level} label={t('rehearse.check.micLevel')} />}
                <span className="pr-checks__s">{micQuiet ? t('rehearse.check.micQuiet') : t('rehearse.check.micHint')}</span>
              </CheckRow>
              {camera && (
                <CheckRow title={t('rehearse.check.camera')}>
                  <span className="pr-checks__s">{t('rehearse.check.framing')}</span>
                </CheckRow>
              )}
              {camera && (
                <CheckRow state={models === 'ready' ? 'ok' : models === 'loading' ? 'busy' : 'off'} title={models === 'ready' ? t('rehearse.check.trackReady') : models === 'loading' ? t('rehearse.check.trackLoading') : t('rehearse.check.trackOff')} />
              )}
            </ul>
            <div className="btn-row">
              <button type="button" className="btn btn--primary" onClick={session.begin} aria-keyshortcuts="Space">
                <Icon name="play" className="icon--fill" />
                {t('rehearse.check.start')}
              </button>
              <button type="button" className="btn btn--quiet" onClick={session.reset}>
                {t('common.back')}
              </button>
            </div>
            <p className="help">{t('rehearse.check.startHelp')}</p>
            <KeyHint action="toStart" />
          </section>
        )}

        {(phase === 'countdown' || phase === 'recording') && (
          <>
            <section className={`pr-timer pr-timer--${light}`} aria-labelledby="pr-timer-h">
              <h2 className="vh" id="pr-timer-h">
                {phase === 'recording' ? t('rehearse.rec.title') : t('rehearse.rec.getReady')}
              </h2>
              <p className="pr-timer__where">{phase === 'recording' ? where : t('rehearse.rec.getReady')}</p>
              <p className="pr-timer__clock" role="timer" aria-live="off">
                <span className="pr-timer__n num">{clock(phase === 'recording' ? sec : 0)}</span>
                <span className="pr-timer__of num">{t('rehearse.rec.of', { limit: clock(limitSec) })}</span>
              </p>
              <p className="pr-timer__state num">{stateText}</p>
              <div className="pr-timer__track" aria-hidden="true">
                <span className="pr-timer__warn" style={{ left: `${((limitSec - warnSeconds(limitSec)) / limitSec) * 100}%` }} />
                <span className="pr-timer__fill" style={{ width: `${Math.min(100, (sec / limitSec) * 100)}%` }} />
              </div>
            </section>
            {phase === 'countdown' ? (
              <button type="button" className="btn btn--secondary btn--block" onClick={session.cancel} ref={focusRef} aria-keyshortcuts="Space">
                {t('rehearse.rec.cancel')}
              </button>
            ) : (
              <button type="button" className="btn btn--primary btn--block" onClick={session.stop} ref={focusRef} aria-keyshortcuts="Space">
                <Icon name="stop" className="icon--fill" />
                {t('rehearse.rec.stop')}
              </button>
            )}
            <KeyHint action={phase === 'countdown' ? 'toCancel' : 'toStop'} />
            <Prompter script={setup.script} show={setup.showScript} onShow={onShowScript} />
            {phase === 'recording' && (transcriptOn || (camera && models === 'ready')) && (
              <section className="card pr-live" aria-label={t('rehearse.rec.transcript')}>
                {transcriptOn && (
                  <>
                    <div className="pr-live__head">
                      <span className="pr-live__t">{t('rehearse.rec.transcript')}</span>
                      {sr.words > 0 && <span className="pr-live__n num">{tn('rehearse.rec.words', sr.words)}</span>}
                    </div>
                    {sr.state === 'stalled' || sr.state === 'failed' ? (
                      <p className="pr-live__warn">
                        <Icon name="alert" size={18} />
                        <span>{sr.state === 'failed' ? t('rehearse.rec.failed') : t('rehearse.rec.stalled')}</span>
                      </p>
                    ) : (
                      <p className="pr-live__text" aria-live="off">
                        {sr.final || sr.interim ? (
                          <>
                            {sr.final} <span className="muted">{sr.interim}</span>
                          </>
                        ) : (
                          <span className="muted">{t('rehearse.rec.listening')}</span>
                        )}
                      </p>
                    )}
                  </>
                )}
                {camera && models === 'ready' && faceFound !== null && (
                  <p className={`pr-live__face${faceFound ? ' is-on' : ''}`}>
                    <span className="pr-dot" aria-hidden="true" />
                    {faceFound ? t('rehearse.rec.faceIn') : t('rehearse.rec.faceOut')}
                  </p>
                )}
              </section>
            )}
          </>
        )}

        {phase === 'processing' && (
          <section className="card pr-wait" aria-labelledby="pr-wait-h">
            <span className="spinner" aria-hidden="true" />
            <h2 className="t-heading" id="pr-wait-h" tabIndex={-1} ref={focusRef}>
              {t('rehearse.rec.processing')}
            </h2>
          </section>
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------- Report

/** WebM from MediaRecorder carries no duration, so the scrubber cannot seek until it is found. */
function fixDuration(e) {
  const el = e.currentTarget;
  if (Number.isFinite(el.duration)) return;
  const restore = () => {
    if (!Number.isFinite(el.duration)) return;
    el.removeEventListener('durationchange', restore);
    el.removeEventListener('timeupdate', restore);
    el.currentTime = 0;
  };
  el.addEventListener('durationchange', restore);
  el.addEventListener('timeupdate', restore);
  el.currentTime = 1e101;
}

function Stat({ value, label }) {
  return (
    <div className="pr-stat">
      <dt>{label}</dt>
      <dd className="num">{value}</dd>
    </div>
  );
}

function Transcript({ speech }) {
  const script = speech.script;
  const skipped = script ? script.skippedCount : 0;
  return (
    <Disclosure title={t('rehearse.report.transcript')} summary={tn('rehearse.report.transcriptWords', speech.words)} className="pr-said">
      <p className="help">{t('rehearse.report.transcriptNote')}</p>
      <p className="pr-said__text">
        {speech.marked.map((m, i) => (
          <span key={i}>
            {m.filler ? <mark className="pr-filler">{m.text}</mark> : m.text}{' '}
          </span>
        ))}
      </p>
      {script && skipped > 0 && (
        <div className="pr-skipped">
          <h3 className="pr-skipped__t">{tn('rehearse.skippedTitle', skipped)}</h3>
          <ul>
            {script.skipped.map((line) => (
              <li key={line}>{line}</li>
            ))}
          </ul>
          {skipped > script.skipped.length && <p className="help">{t('rehearse.skippedMore', { n: skipped - script.skipped.length })}</p>}
        </div>
      )}
    </Disclosure>
  );
}

function BodyFacts({ body }) {
  const pct = (v) => t('rehearse.body.pct', { pct: Math.round(v * 100) });
  const rows = [[t('rehearse.body.face'), body.faceShare > 0 ? pct(body.faceShare) : t('rehearse.body.notSeen')]];
  if (body.faceShare > 0) {
    rows.push([t('rehearse.body.facing'), pct(body.eyeContactShare)]);
    rows.push([t('rehearse.body.down'), pct(body.lookingDownShare)]);
  }
  if (body.poseShare > 0) {
    rows.push([t('rehearse.body.sway'), body.swayStd < 0.02 ? t('rehearse.body.low') : body.swayStd < 0.035 ? t('rehearse.body.some') : t('rehearse.body.high')]);
    rows.push([t('rehearse.body.hands'), pct(body.handsVisibleShare)]);
    rows.push([t('rehearse.body.handsFace'), pct(body.handsNearFaceShare)]);
  }
  return (
    <Disclosure title={t('rehearse.report.bodyTitle')} summary={t('rehearse.report.bodySum')} className="pr-bodyfacts">
      <dl className="facts">
        {rows.map(([k, v]) => (
          <div key={k}>
            <dt>{k}</dt>
            <dd>{v}</dd>
          </div>
        ))}
      </dl>
    </Disclosure>
  );
}

function Report({ report, city, playback, lang, onAgain, onChange, focusRef, history, cityById, onClearHistory }) {
  const { speech, envelope, body, coach, seconds, limitSec } = report;
  const heard = coach.heard;
  const short = seconds < MIN_TAKE_SEC;
  const [lo, hi] = PACE_TARGET[lang] || PACE_TARGET.en;
  const limitLine = city ? t('rehearse.time.limitCity', { city: city.name, limit: limitPhrase(limitSec) }) : t('rehearse.time.limitGeneric', { limit: limitPhrase(limitSec) });
  const eyeMeasured = body && body.faceShare >= 0.5;

  const stats = [];
  if (heard && !short) {
    if (report.wpm > 0) stats.push([report.wpmEstimated ? t('rehearse.report.statPaceEst') : t('rehearse.report.statPace'), report.wpm]);
    if (speech) stats.push([t('rehearse.report.statFillers'), speech.fillerTotal]);
    stats.push([t('rehearse.report.statPauses'), envelope.longPauses]);
    if (eyeMeasured) stats.push([t('rehearse.report.statEye'), `${Math.round(body.eyeContactShare * 100)}%`]);
    else if (speech && speech.script) stats.push([t('rehearse.report.statScript'), `${Math.round(speech.script.coverage * 100)}%`]);
  }

  const showCharts = heard && seconds >= 30;
  const pauseSpans = envelope.pauses.filter((p) => p.dur >= LONG_PAUSE_SEC).map((p) => ({ start: p.start, end: p.end }));
  const transcriptLost = report.transcriptOn && !speech;

  return (
    <div className="pr-report">
      <div className="pr-report__grid">
        <div className="pr-report__main">
          <section className="card pr-result" aria-labelledby="pr-result-h">
            <h2 className="t-heading" id="pr-result-h" tabIndex={-1} ref={focusRef}>
              {t('rehearse.report.title')}
            </h2>
            {heard ? (
              <TimeRuler seconds={seconds} limitSec={limitSec} note={limitLine} />
            ) : (
              // Nothing was heard, so there is no time to praise: say what to fix, plainly.
              <>
                <p className="pr-result__miss">{t('rehearse.report.notHeardTitle')}</p>
                <p className="pr-result__plain">{`${t('rehearse.report.notHeardBody')} ${t('rehearse.report.takeLength', { time: clock(seconds) })}`}</p>
              </>
            )}
            {stats.length > 0 && (
              <dl className="pr-stats">
                {stats.map(([label, value]) => (
                  <Stat key={label} label={label} value={value} />
                ))}
              </dl>
            )}
            <p className={`pr-result__saved${report.counted ? '' : ' is-not'}`}>
              <Icon name={report.counted ? 'check' : 'info'} size={20} />
              <span>{report.counted ? (report.countedFor ? t('rehearse.report.countedFor', { meeting: report.countedFor }) : t('rehearse.report.counted')) : t('rehearse.report.notSaved', { n: MIN_TAKE_SEC })}</span>
            </p>
          </section>

          {!heard ? null : (
            <>
              <section className="pr-block" aria-labelledby="pr-fix-h">
                <div className="sec-head">
                  <h2 className="t-heading" id="pr-fix-h">
                    {t('rehearse.report.toFix')}
                  </h2>
                </div>
                {coach.findings.length === 0 ? (
                  <p className="card pr-none">{t('rehearse.report.toFixNone')}</p>
                ) : (
                  <ol className="pr-finds">
                    {coach.findings.map((f, i) => {
                      const p = coachParams(f.params, lang);
                      return (
                        <li key={f.id} className="pr-find">
                          <span className="pr-find__n" aria-hidden="true">
                            {i + 1}
                          </span>
                          <div className="pr-find__body">
                            <h3 className="pr-find__t">{t(`rehearse.findings.${f.id}.title`, p)}</h3>
                            <p className="pr-find__d">{t(`rehearse.findings.${f.id}.detail`, p)}</p>
                            <p className="pr-find__try">
                              <strong>{t('rehearse.report.tryThis')}</strong> {t(`rehearse.findings.${f.id}.drill`, p)}
                            </p>
                          </div>
                        </li>
                      );
                    })}
                  </ol>
                )}
              </section>

              {coach.strengths.length > 0 && (
                <section className="pr-block" aria-labelledby="pr-good-h">
                  <div className="sec-head">
                    <h2 className="t-heading" id="pr-good-h">
                      {t('rehearse.report.wentWell')}
                    </h2>
                  </div>
                  <ul className="pr-wins">
                    {coach.strengths.map((s) => (
                      <li key={s.id}>
                        <Icon name="check" />
                        <span>{t(`rehearse.strengths.${s.id}`, coachParams(s.params, lang))}</span>
                      </li>
                    ))}
                  </ul>
                </section>
              )}
            </>
          )}

          <div className="btn-row pr-again">
            <button type="button" className="btn btn--primary" onClick={onAgain}>
              <Icon name="refresh" />
              {t('rehearse.report.again')}
            </button>
            <button type="button" className="btn btn--secondary" onClick={onChange}>
              {t('rehearse.report.change')}
            </button>
            <Link className="link pr-back" to="/prepare">
              {t('rehearse.report.backToSteps')}
            </Link>
          </div>
        </div>

        <div className="pr-report__side">
          {playback && (
            <section className="card pr-play" aria-labelledby="pr-play-h">
              <h2 className="t-heading" id="pr-play-h">
                {playback.video ? t('rehearse.report.play.watch') : t('rehearse.report.play.listen')}
              </h2>
              <p className="help pr-play__note">{t('rehearse.report.play.note')}</p>
              {playback.video ? (
                <video className="pr-play__media" controls playsInline preload="metadata" src={playback.url} onLoadedMetadata={fixDuration} />
              ) : (
                <audio className="pr-play__audio" controls preload="metadata" src={playback.url} onLoadedMetadata={fixDuration} />
              )}
              <a className="btn btn--secondary btn--sm pr-play__dl" href={playback.url} download={`agora-practice.${playback.ext}`}>
                <Icon name="download" />
                {t('rehearse.report.play.download', { mb: megabytes(playback.size, lang) })}
              </a>
            </section>
          )}
          {speech && <Transcript speech={speech} />}
          {transcriptLost && heard && <Notice icon="info">{t('rehearse.report.transcriptMissing')}</Notice>}
          {body && body.frames > 0 && <BodyFacts body={body} />}
        </div>
      </div>

      {showCharts && (report.pace.length > 1 || report.loudness.length > 1 || (body && body.faceShare >= 0.3)) && (
        <section className="section pr-over" aria-labelledby="pr-over-h">
          <div className="sec-head">
            <h2 className="t-heading" id="pr-over-h">
              {t('rehearse.report.overTime')}
            </h2>
          </div>
          <div className="pr-figs">
            {report.pace.length > 1 && (
              <TimeChart
                title={t('rehearse.charts.pace')}
                note={report.wpmEstimated ? t('rehearse.charts.paceEstNote') : t('rehearse.charts.paceNote')}
                points={report.pace}
                xMax={report.durationSec}
                band={[lo, hi]}
                bandLabel={t('rehearse.charts.band', { lo, hi })}
                valueLabel={t('rehearse.charts.paceValue')}
                lang={lang}
              />
            )}
            {report.loudness.length > 1 && (
              <TimeChart
                title={t('rehearse.charts.volume')}
                note={t('rehearse.charts.volumeNote')}
                points={report.loudness}
                xMax={report.durationSec}
                yMax={100}
                unit="%"
                spans={pauseSpans}
                spanLabel={t('rehearse.charts.pauses')}
                valueLabel={t('rehearse.charts.volumeValue')}
                lang={lang}
              />
            )}
            {body && body.faceShare >= 0.3 && (
              <EyeStrip title={t('rehearse.charts.eye')} note={t('rehearse.charts.eyeNote')} cells={body.timeline} labels={{ on: t('rehearse.charts.eyeOn'), off: t('rehearse.charts.eyeOff'), none: t('rehearse.charts.eyeNone') }} />
            )}
          </div>
        </section>
      )}

      {history.length > 0 && <History rows={history} cityById={cityById} lang={lang} onClear={onClearHistory} className="section" />}
    </div>
  );
}

// ---------------------------------------------------------------- History

function History({ rows, cityById, lang, onClear, className = '' }) {
  const [confirm, setConfirm] = useState(false);
  const [all, setAll] = useState(false);
  const shown = all ? rows : rows.slice(0, HISTORY_SHOWN);
  return (
    <section className={`pr-hist ${className}`.trim()} aria-labelledby="pr-hist-h">
      <div className="sec-head">
        <h2 className="t-heading" id="pr-hist-h">
          {tn('rehearse.historyTitle', rows.length)}
        </h2>
        {!confirm && (
          <button type="button" className="see" onClick={() => setConfirm(true)}>
            {t('rehearse.history.clear')}
          </button>
        )}
      </div>
      {confirm && (
        <Notice
          tone="card"
          icon="trash"
          role="alert"
          className="pr-hist__confirm"
          action={
            <>
              <button
                type="button"
                className="btn btn--secondary btn--danger btn--sm"
                onClick={() => {
                  setConfirm(false);
                  onClear();
                }}
              >
                {t('rehearse.history.clearYes')}
              </button>
              <button type="button" className="btn btn--quiet btn--sm" onClick={() => setConfirm(false)}>
                {t('rehearse.history.keep')}
              </button>
            </>
          }
        >
          {tn('rehearse.history.clearAsk', rows.length)}
        </Notice>
      )}
      <ul className="group pr-hist__list">
        {shown.map((r, i) => {
          const c = r.cityId ? cityById(r.cityId) : null;
          const limit = Number(r.limitSec) > 0 ? Number(r.limitSec) : limitFor(c);
          const secs = Math.round(Number(r.durationSec) || 0);
          const when = takeWhen(r.at, lang);
          return (
            <li key={`${r.at}-${i}`} className="pr-hrow">
              <span className={`pr-dot pr-dot--${lightFor(secs, limit)}`} aria-hidden="true" />
              <span className="pr-hrow__main">
                <span className="pr-hrow__top">
                  <span className="pr-hrow__t num">{t('rehearse.history.time', { time: clock(secs), limit: clock(limit) })}</span>
                  <span className="pr-hrow__when">{when.date && t('ui.dateTime', { date: when.date, time: when.time })}</span>
                </span>
                <span className="pr-hrow__meta">
                  <span>{c ? c.name : t('rehearse.history.just')}</span>
                  {r.wpm > 0 && <span>{tn('rehearse.history.wpm', r.wpm)}</span>}
                  {typeof r.fillers === 'number' && <span>{tn('rehearse.history.fillers', r.fillers)}</span>}
                  {typeof r.eyeContact === 'number' && <span>{t('rehearse.history.eye', { pct: r.eyeContact })}</span>}
                </span>
              </span>
            </li>
          );
        })}
      </ul>
      {rows.length > HISTORY_SHOWN && !all && (
        <button type="button" className="btn btn--quiet btn--sm pr-hist__more" onClick={() => setAll(true)}>
          {t('common.showAll', { n: rows.length })}
        </button>
      )}
      <p className="help pr-hist__note">{t('rehearse.history.note')}</p>
    </section>
  );
}
