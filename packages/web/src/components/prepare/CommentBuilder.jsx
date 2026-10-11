import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { buildComment, estimateSpeakingSeconds, getTopic, isTopicId, joinItems, joinSentences, sentenceGap, speakingRate, speechUnits, t, timeOfDayFor, tn, topicList } from '@agora/core';
import { useStore } from '../../lib/store.jsx';
import { api, apiAvailable } from '../../lib/api.js';
import { copyText } from '../../lib/clipboard.js';
import { Badge, Chip, Icon, Notice, speakMinutes, writtenContact } from '../ui/index.js';
import { commentEmail } from '../ui/cityText.js';
import { rawCity } from '../../lib/data.js';
import TimeRuler, { mmss, rulerTone } from './TimeRuler.jsx';
import { DEFAULT_LIMIT_SECONDS } from './prepMeeting.js';
import { inputDir } from '../../lib/textDir.js';

const POSITIONS = ['support', 'oppose', 'concerned', 'ask'];
const POSITION_KEY = { support: 'support', oppose: 'oppose', concerned: 'concerned', ask: 'askingForAction' };
const SAVE_DELAY_MS = 400;
/** The longest text kept when the draft is edited by hand (about 8 minutes of speech). */
export const CUSTOM_MAX = 6000;
const isObj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);

/** The form, restored from the profile's saved draft (ui.commentDraft) or prefilled from the profile. */
function initialForm(saved, profile, prefs) {
  const s = isObj(saved) ? saved : {};
  const text = (k, fallback = '') => (typeof s[k] === 'string' ? s[k].slice(0, k === 'story' ? 1200 : 300) : fallback);
  const interest = (prefs.interests || []).find((id) => isTopicId(id));
  return {
    name: text('name', profile.name || ''),
    school: text('school'),
    topicId: isTopicId(s.topicId) ? s.topicId : interest || 'other',
    itemTitle: text('itemTitle'),
    position: POSITIONS.includes(s.position) ? s.position : 'ask',
    story: text('story'),
    ask: text('ask'),
  };
}

/** Text typed over the draft by hand (a string, possibly empty), or null when the form writes it. */
function savedCustom(saved) {
  return isObj(saved) && typeof saved.custom === 'string' ? saved.custom.slice(0, CUSTOM_MAX) : null;
}

/** A saved AI rewrite: { text, base } where base is the template it was made from. */
function savedPolish(saved) {
  const p = isObj(saved) && isObj(saved.polished) ? saved.polished : null;
  return p && typeof p.text === 'string' && typeof p.base === 'string' ? { text: p.text, base: p.base } : null;
}

/** The draft text for a set of fields, greeting the council at the meeting's time of day. */
export function composeDraft(fields, { meeting, city } = {}) {
  const f = initialForm(fields, { name: '' }, { interests: [] });
  const firstRule = city && city.meetings && city.meetings[0] && city.meetings[0].recurrence;
  const timeOfDay = meeting && meeting.time ? timeOfDayFor(meeting.time) : firstRule ? timeOfDayFor(firstRule.time) : 'evening';
  return buildComment({ ...f, cityName: city ? city.name : '', timeOfDay });
}

/**
 * The text Write is showing for a saved draft: the student's own edit, else the AI rewrite
 * while the fields it came from are unchanged, else the template. '' when nothing is saved.
 */
export function draftTextOf(saved, { meeting, city } = {}) {
  if (!isObj(saved)) return '';
  const custom = savedCustom(saved);
  if (custom !== null) return custom;
  const template = composeDraft(saved, { meeting, city });
  const polish = savedPolish(saved);
  return polish && polish.base === template ? polish.text : template;
}

let aiCheck = null;
/** Whether "Polish with AI" can work here: the build has an API and the server has AI turned on. */
function aiReady() {
  if (!apiAvailable) return Promise.resolve(false);
  if (!aiCheck) {
    aiCheck = api
      .health()
      .then((h) => Boolean(h && h.ai === true))
      .catch(() => {
        aiCheck = null;
        return false;
      });
  }
  return aiCheck;
}

/** A mailto: link with a subject and the draft as the body (CRLF line breaks, per RFC 6068). */
export function mailtoHref(email, subject, body) {
  const enc = (s) => encodeURIComponent(String(s || '').replace(/\r?\n/g, '\r\n'));
  return `mailto:${email}?subject=${enc(subject)}&body=${enc(body)}`;
}

function Field({ id, label, optional, help, children }) {
  return (
    <div className="field">
      <label className="label" htmlFor={id}>
        {label}
        {optional && <span className="opt">{`${sentenceGap(label, t('prepare.write.optional'))}${t('prepare.write.optional')}`}</span>}
      </label>
      {children}
      {help && (
        <p className="help" id={`${id}-help`}>
          {help}
        </p>
      )}
    </div>
  );
}

function Summary({ id, title, value, onEdit }) {
  return (
    <div className="bsum">
      <span className="bsum__ic" aria-hidden="true">
        <Icon name="check" />
      </span>
      <span className="bsum__txt">
        <span className="bsum__t" id={id}>
          {title}
        </span>
        <span className="bsum__v">{value}</span>
      </span>
      <button type="button" className="btn btn--quiet btn--sm" onClick={onEdit} aria-describedby={id}>
        {t('prepare.write.edit')}
      </button>
    </div>
  );
}

const reducedMotion = () => typeof window !== 'undefined' && window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

/**
 * The comment builder (podium mock "Write your comment"): who you are, what it's about, your
 * story and your ask, and the live draft timed against the council's limit.
 *
 * - The draft is the core template in the app language, rebuilt on every edit. An AI rewrite
 *   is shown only while the fields it was made from are unchanged, and only when the model
 *   really rewrote it; any edit brings back the live draft.
 * - "Edit text" lets the student change the final words by hand. From then on the form no
 *   longer rewrites the text (a notice says so, with a way back), and the ruler times the edit.
 * - Fields, a hand edit and an AI rewrite are saved in the profile (ui.commentDraft), so the
 *   draft survives navigation, a reload and a language switch. Mount it with key={profile.id}.
 * - On phones a compact timer bar follows the form, so the time stays in sight while typing.
 * - `ctx` is usePrepMeeting(): acting on the draft marks the Write step for that meeting.
 */
export default function CommentBuilder({ ctx, meeting, city, practicing, headingLevel = 2, idPrefix = 'cb' }) {
  const { profile, prefs, ui, setUi, lang } = useStore();
  const navigate = useNavigate();
  const saved = ui.commentDraft;
  const [form, setForm] = useState(() => initialForm(saved, profile, prefs));
  const [custom, setCustom] = useState(() => savedCustom(saved));
  const [polished, setPolished] = useState(() => savedPolish(saved));
  // Groups that were already filled in start folded into a one-line summary (mock .bsum).
  const [open, setOpen] = useState(() => {
    const f = initialForm(saved, profile, prefs);
    const returning = isObj(saved);
    return { who: !(returning && f.name.trim()), what: !returning };
  });
  const [ai, setAi] = useState({ status: 'idle', code: null });
  const [canPolish, setCanPolish] = useState(false);
  const [status, setStatus] = useState(null);
  const [confirmRebuild, setConfirmRebuild] = useState(false);
  const [draftInView, setDraftInView] = useState(false);
  const [barCompact, setBarCompact] = useState(false);
  const barRef = useRef(null);
  const barNeed = useRef(0);
  const fieldRefs = useRef({});
  const draftRef = useRef(null);
  const sectionRef = useRef(null);
  const editRef = useRef(null);
  const statusTimer = useRef(null);
  const abortRef = useRef(null);

  // Save a moment after typing stops, and on the way out. Nothing is saved until the person
  // edits something, so "Draft saved" never appears for an untouched template.
  const setUiRef = useRef(setUi);
  setUiRef.current = setUi;
  const dirty = useRef(false);
  const pending = useRef(null);
  const flush = () => {
    if (pending.current) setUiRef.current({ commentDraft: pending.current });
    pending.current = null;
  };
  const snapshot = () => {
    const out = { ...form, at: new Date().toISOString() };
    if (custom !== null) out.custom = custom;
    if (polished) out.polished = polished;
    return out;
  };
  useEffect(() => {
    if (!dirty.current) return undefined;
    pending.current = snapshot();
    const timer = setTimeout(flush, SAVE_DELAY_MS);
    return () => clearTimeout(timer);
    // snapshot reads exactly these three.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [form, custom, polished]);
  useEffect(
    () => () => {
      flush();
      clearTimeout(statusTimer.current);
      if (abortRef.current) abortRef.current.abort();
    },
    [],
  );

  useEffect(() => {
    let alive = true;
    aiReady().then((ok) => alive && setCanPolish(ok));
    return () => {
      alive = false;
    };
  }, []);

  // The phone timer bar steps aside once the draft itself is on screen.
  useEffect(() => {
    const el = sectionRef.current;
    if (!el || typeof IntersectionObserver === 'undefined') return undefined;
    const io = new IntersectionObserver(([entry]) => setDraftInView(entry.isIntersecting), { rootMargin: '0px 0px -96px 0px' });
    io.observe(el);
    return () => io.disconnect();
  }, []);

  const cityName = city ? city.name : '';
  const template = useMemo(
    () => composeDraft(form, { meeting, city }),
    // lang: buildComment writes in the app language.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [form, meeting, city, lang],
  );
  const editing = custom !== null;
  const usePolish = !editing && Boolean(polished && polished.base === template);
  const shown = editing ? custom : usePolish ? polished.text : template;
  // Timed and counted in the draft's language: words, or characters in Chinese.
  const seconds = estimateSpeakingSeconds(shown, lang);
  const words = speechUnits(shown, lang);

  // The phone timer bar keeps "0:40 of 3:00" on one line: where "See draft" does not fit beside
  // it (narrow phones, longer languages) the pill shows only its arrow and keeps the words for
  // screen readers. Measured after each render, before paint, and when the bar changes size.
  const barCheck = useRef(() => {});
  useLayoutEffect(() => {
    barCheck.current = () => {
      const bar = barRef.current;
      const width = bar ? bar.clientWidth : 0;
      if (!width) return;
      if (!barCompact) {
        const cs = getComputedStyle(bar);
        const gap = parseFloat(cs.columnGap) || 0;
        const parts = [...bar.children].map((el) => (el.classList.contains('draft-bar__t') ? el.scrollWidth : el.getBoundingClientRect().width));
        barNeed.current = parseFloat(cs.paddingLeft) + parseFloat(cs.paddingRight) + parts.reduce((a, b) => a + b, 0) + gap * Math.max(0, parts.length - 1);
        if (barNeed.current > width + 0.5) setBarCompact(true);
      } else if (width >= barNeed.current) setBarCompact(false);
    };
    barCheck.current();
  });
  useEffect(() => {
    const bar = barRef.current;
    if (!bar || typeof ResizeObserver !== 'function') return undefined;
    const ro = new ResizeObserver(() => barCheck.current());
    ro.observe(bar);
    return () => ro.disconnect();
  }, []);

  // The hand-edited text grows with what is typed, so it never scrolls inside itself.
  useLayoutEffect(() => {
    const el = editRef.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${el.scrollHeight + 2}px`;
  }, [custom, editing]);

  const minutes = practicing ? null : speakMinutes(city);
  const limitSeconds = minutes ? minutes * 60 : DEFAULT_LIMIT_SECONDS;
  const rate = speakingRate(lang);
  const note = practicing || !city
    ? t('prepare.ruler.notePractice', { n: rate })
    : minutes
      ? t('prepare.ruler.noteCity', { city: city.name, minutes: tn('common.minutes', minutes), n: rate })
      : t('prepare.ruler.noteNoLimit', { city: city.name, n: rate });

  const flash = (kind, ms = 2500) => {
    clearTimeout(statusTimer.current);
    setStatus(kind);
    if (ms) statusTimer.current = setTimeout(() => setStatus(null), ms);
  };
  const markWritten = () => {
    if (ctx) ctx.markStep('write', true);
  };

  const update = (key, value) => {
    dirty.current = true;
    setForm((f) => ({ ...f, [key]: value }));
    if (polished) setPolished(null);
    if (ai.status === 'error') setAi({ status: 'idle', code: null });
  };
  const bind = (key) => ({
    id: `${idPrefix}-${key}`,
    value: form[key],
    onChange: (e) => update(key, e.target.value),
    ref: (el) => {
      fieldRefs.current[key] = el;
    },
  });
  // A text field: typed text runs its own way once it has a letter; an empty field follows
  // the page, so an Arabic placeholder and caret start on the right (lib/textDir.js).
  const textBind = (key) => ({ ...bind(key), dir: inputDir(form[key]) });
  const edit = (group, first) => {
    setOpen((o) => ({ ...o, [group]: true }));
    requestAnimationFrame(() => fieldRefs.current[first] && fieldRefs.current[first].focus());
  };

  const startEditing = () => {
    dirty.current = true;
    setCustom(shown);
    setConfirmRebuild(false);
    requestAnimationFrame(() => {
      const el = editRef.current;
      if (el) {
        el.focus();
        el.setSelectionRange(el.value.length, el.value.length);
      }
    });
  };
  // The confirm step swaps the buttons, so focus follows to the safe choice and back.
  const focusLater = (selector) =>
    requestAnimationFrame(() => {
      const el = sectionRef.current && sectionRef.current.querySelector(selector);
      if (el) el.focus();
    });
  const askRebuild = () => {
    setConfirmRebuild(true);
    focusLater('[data-act="keep"]');
  };
  const keepEditing = () => {
    setConfirmRebuild(false);
    focusLater('[data-act="rebuild"]');
  };
  const rebuild = () => {
    dirty.current = true;
    setCustom(null);
    setConfirmRebuild(false);
    flash('rebuilt');
    focusLater('.draft__editbtn');
  };

  const fields = () => ({ name: form.name, school: form.school, itemTitle: form.itemTitle, ask: form.ask });

  const practice = () => {
    const at = new Date().toISOString();
    setUi({
      lastDraft: { text: shown, cityId: city ? city.cityId : '', meetingId: meeting ? meeting.id : null, fields: fields(), at },
      commentDraft: { ...snapshot(), at },
    });
    pending.current = null;
    markWritten();
    navigate('/prepare/practice');
  };

  const selectDraft = () => {
    if (editing && editRef.current) {
      editRef.current.focus();
      editRef.current.select();
      return;
    }
    if (!draftRef.current) return;
    const range = document.createRange();
    range.selectNodeContents(draftRef.current);
    const sel = window.getSelection();
    sel.removeAllRanges();
    sel.addRange(range);
  };

  const copy = async () => {
    const ok = await copyText(shown);
    if (ok) {
      markWritten();
      flash('copied');
    } else {
      flash('copyFailed', 0);
      // Select the draft so it can be copied by hand.
      selectDraft();
    }
  };

  // Can't be there? The city's own way to send a written comment: an email address (a mailto
  // with the subject and the draft filled in) or an online form (the draft is copied first).
  const contact = city && city.publicComment ? writtenContact(city.publicComment.writtenCommentMethod) : null;
  // The subject and any details the city asks for are read from its English text and written
  // in English, for city staff (Duncanville wants 'Public Comment - Tuesday, [date]').
  const english = city ? rawCity(city.cityId) || city : null;
  const email = english ? commentEmail({ method: english.publicComment && english.publicComment.writtenCommentMethod, cityName: english.name, meeting, name: form.name }) : null;
  const onForm = async () => {
    const ok = await copyText(shown);
    markWritten();
    flash(ok ? 'formCopied' : 'formNotCopied', 6000);
  };

  const polish = async () => {
    if (abortRef.current) abortRef.current.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    const base = template;
    setAi({ status: 'loading', code: null });
    try {
      const r = await api.comment(
        { name: form.name, school: form.school, cityId: city ? city.cityId : '', cityName, topicId: form.topicId, itemTitle: form.itemTitle, position: form.position, story: form.story, ask: form.ask, useAi: true },
        { signal: controller.signal },
      );
      const text = r && r.ai && r.ai.source === 'claude' && typeof r.ai.text === 'string' ? r.ai.text.trim() : '';
      // Only a real rewrite counts: the template coming back unchanged is not "polished".
      const rewritten = text && text !== base.trim() && text !== String((r && r.draft) || '').trim();
      if (rewritten) {
        dirty.current = true;
        setPolished({ text, base });
        setAi({ status: 'idle', code: null });
      } else setAi({ status: 'error', code: (r && r.aiError) || 'unavailable' });
    } catch (err) {
      if (err && err.code === 'aborted') return;
      setAi({ status: 'error', code: (err && err.code) || 'unavailable' });
    }
  };
  const aiMessage = ai.code === 'rate_limited' || ai.code === 'busy' ? t('prepare.write.aiBusy') : ai.code === 'declined' ? t('prepare.write.aiDeclined') : t('prepare.write.aiOff');

  const topics = topicList();
  const topicLabel = getTopic(form.topicId).label;
  const H = `h${headingLevel}`;
  const ids = { who: `${idPrefix}-who`, what: `${idPrefix}-what`, draft: `${idPrefix}-draft-h`, position: `${idPrefix}-position`, edit: `${idPrefix}-edit` };
  const tone = rulerTone(seconds, limitSeconds);
  // The bar steps aside once the draft shows, so focus moves on to the draft's heading.
  const toDraft = () => {
    const el = sectionRef.current;
    if (!el) return;
    el.scrollIntoView({ block: 'start', behavior: reducedMotion() ? 'auto' : 'smooth' });
    const heading = document.getElementById(ids.draft);
    if (heading) heading.focus({ preventScroll: true });
  };

  return (
    <div className="builder">
      <form className="builder__form" onSubmit={(e) => e.preventDefault()} aria-label={t('ui.prep.stepsLong.write')}>
        {open.who ? (
          <fieldset className="builder__group">
            <legend className="builder__gh">{t('prepare.write.who')}</legend>
            <Field id={`${idPrefix}-name`} label={t('prepare.write.name')}>
              <input className="input" autoComplete="name" maxLength={80} {...textBind('name')} />
            </Field>
            <Field id={`${idPrefix}-school`} label={t('prepare.write.school')}>
              <input className="input" placeholder={t('prepare.write.schoolPlaceholder')} maxLength={120} {...textBind('school')} />
            </Field>
          </fieldset>
        ) : (
          <Summary id={ids.who} title={t('prepare.write.who')} value={joinItems([form.name.trim(), form.school.trim()])} onEdit={() => edit('who', 'name')} />
        )}

        {open.what ? (
          <fieldset className="builder__group">
            <legend className="builder__gh">{t('prepare.write.what')}</legend>
            <Field id={`${idPrefix}-topicId`} label={t('prepare.write.topic')}>
              <select className="select" {...bind('topicId')}>
                {topics.map((x) => (
                  <option key={x.id} value={x.id}>
                    {x.label}
                  </option>
                ))}
              </select>
            </Field>
            <Field id={`${idPrefix}-itemTitle`} label={t('prepare.write.agendaItem')} optional help={t('prepare.write.agendaHelp')}>
              <input className="input" placeholder={t('prepare.write.agendaItemPlaceholder')} maxLength={200} aria-describedby={`${idPrefix}-itemTitle-help`} {...textBind('itemTitle')} />
            </Field>
            <div className="field">
              <span className="label" id={ids.position}>
                {t('prepare.write.position')}
              </span>
              <div className="chipwrap" role="group" aria-labelledby={ids.position}>
                {POSITIONS.map((p) => (
                  <Chip key={p} pressed={form.position === p} onClick={() => update('position', p)}>
                    {t(`prepare.write.${POSITION_KEY[p]}`)}
                  </Chip>
                ))}
              </div>
            </div>
          </fieldset>
        ) : (
          <Summary
            id={ids.what}
            title={t('prepare.write.what')}
            value={joinSentences([topicLabel, form.itemTitle.trim() || t('prepare.write.notOnAgenda'), t(`prepare.write.${POSITION_KEY[form.position]}`)])}
            onEdit={() => edit('what', 'topicId')}
          />
        )}

        <fieldset className={`builder__group${open.who && open.what ? '' : ' bopen'}`}>
          <legend className="builder__gh">{t('prepare.write.storyGroup')}</legend>
          <Field id={`${idPrefix}-story`} label={t('prepare.write.story')} help={t('prepare.write.storyHelp')}>
            <textarea className="textarea" rows={4} placeholder={t('prepare.write.storyPlaceholder')} maxLength={1200} aria-describedby={`${idPrefix}-story-help`} {...textBind('story')} />
          </Field>
          <Field id={`${idPrefix}-ask`} label={t('prepare.write.ask')} help={t('prepare.write.askHelp')}>
            <input className="input" placeholder={t('prepare.write.askPlaceholder')} maxLength={300} aria-describedby={`${idPrefix}-ask-help`} {...textBind('ask')} />
          </Field>
        </fieldset>

        {/* Phones: the time stays in sight while typing; it steps aside when the draft shows. */}
        <div className="draft-bar-anchor">
          <button
            type="button"
            ref={barRef}
            className={`draft-bar${draftInView ? ' is-away' : ''}${barCompact ? ' is-compact' : ''}`}
            onClick={toDraft}
            tabIndex={draftInView ? -1 : undefined}
            aria-hidden={draftInView || undefined}
          >
            <span className={`draft-bar__dot draft-bar__dot--${tone}`} aria-hidden="true" />
            <span className="draft-bar__t num">{t('prepare.write.bar', { used: mmss(seconds), limit: mmss(limitSeconds) })}</span>
            <span className="draft-bar__go">
              <span className={barCompact ? 'vh' : undefined}>{t('prepare.write.barSee')}</span>
              <Icon name="chev-d" size={20} />
            </span>
          </button>
        </div>
      </form>

      <section className="draft" aria-labelledby={ids.draft} ref={sectionRef}>
        <div className="sec-head draft__head">
          <H className="t-heading" id={ids.draft} tabIndex={-1} data-route-focus="">
            {t('prepare.write.draft')}
          </H>
          <span className="slate t-small num">{tn('prepare.write.words', words)}</span>
        </div>
        <TimeRuler seconds={seconds} limitSeconds={limitSeconds} note={note} className="draft__ruler" />
        {usePolish && (
          <div className="draft__ai">
            <Badge tone="neutral" icon="star">
              {t('prepare.write.polished')}
            </Badge>
            <button
              type="button"
              className="btn btn--quiet btn--sm"
              onClick={() => {
                dirty.current = true;
                setPolished(null);
              }}
            >
              {t('prepare.write.useMine')}
            </button>
          </div>
        )}
        {editing ? (
          <>
            <label className="vh" htmlFor={ids.edit}>
              {t('prepare.write.editLabel')}
            </label>
            <textarea
              id={ids.edit}
              ref={editRef}
              dir={inputDir(custom)}
              className="textarea draft__edit"
              value={custom}
              maxLength={CUSTOM_MAX}
              rows={8}
              aria-describedby={`${ids.edit}-note`}
              onChange={(e) => {
                dirty.current = true;
                setCustom(e.target.value);
              }}
            />
            <Notice
              tone="card"
              icon="pen"
              className="draft__mode"
              action={
                confirmRebuild ? (
                  <>
                    <button type="button" className="btn btn--secondary btn--sm" onClick={rebuild}>
                      {t('prepare.write.rebuildYes')}
                    </button>
                    <button type="button" className="btn btn--quiet btn--sm" data-act="keep" onClick={keepEditing}>
                      {t('prepare.write.rebuildNo')}
                    </button>
                  </>
                ) : (
                  <button type="button" className="btn btn--quiet btn--sm" data-act="rebuild" onClick={askRebuild}>
                    {t('prepare.write.rebuild')}
                  </button>
                )
              }
            >
              <span id={`${ids.edit}-note`}>{confirmRebuild ? t('prepare.write.rebuildAsk') : t('prepare.write.editingNote')}</span>
            </Notice>
          </>
        ) : (
          <div className="draft__card">
            <div className="draft__text" ref={draftRef}>
              {shown.split(/\n{2,}/).map((para, i) => (
                <p key={i}>{para}</p>
              ))}
            </div>
            <button type="button" className="btn btn--quiet btn--sm draft__editbtn" onClick={startEditing}>
              <Icon name="pen" />
              {t('prepare.write.editText')}
            </button>
          </div>
        )}
        <div className="btn-row">
          <button type="button" className="btn btn--primary" onClick={practice}>
            <Icon name="mic" />
            {t('prepare.write.practice')}
          </button>
          <button type="button" className="btn btn--secondary" onClick={copy}>
            <Icon name={status === 'copied' ? 'check' : 'copy'} />
            {status === 'copied' ? t('prepare.write.copied') : t('prepare.write.copy')}
          </button>
          {canPolish && !editing && (
            <button type="button" className="btn btn--quiet" onClick={polish} disabled={ai.status === 'loading'} aria-describedby={`${idPrefix}-ai-note`}>
              {ai.status === 'loading' ? <span className="spinner" aria-hidden="true" /> : <Icon name="star" />}
              {ai.status === 'loading' ? t('prepare.write.polishing') : t('prepare.write.polish')}
            </button>
          )}
        </div>
        {canPolish && !editing && (
          <p className="draft__note" id={`${idPrefix}-ai-note`}>
            {t('prepare.write.polishNote')}
          </p>
        )}
        {contact && city && (
          <p className="draft__alt">
            <Icon name="mail" size={20} />
            <span>
              {`${t('prepare.write.cantGo')}${sentenceGap(t('prepare.write.cantGo'))}`}
              {contact.kind === 'email' ? (
                <a className="link" href={mailtoHref(contact.email, email.subject, email.lead ? `${email.lead}\n\n${shown}` : shown)} onClick={markWritten}>
                  {t('prepare.write.emailIt', { city: city.name })}
                </a>
              ) : (
                <a className="link" href={contact.href} target="_blank" rel="noopener noreferrer" onClick={onForm}>
                  {t('prepare.write.formIt', { city: city.name })}
                  <span className="vh">{t('ui.opensNewTab')}</span>
                </a>
              )}
              {contact.kind === 'email' && email.asks.length > 0 && <span className="draft__altnote">{t(email.asks.includes('address') ? 'prepare.write.asksNameAddress' : 'prepare.write.asksName', { city: city.name })}</span>}
              {email.readAloud && <span className="draft__altnote">{t(email.readAloud === 'notAlways' ? 'prepare.write.notAlwaysReadAloud' : 'prepare.write.notReadAloud', { city: city.name })}</span>}
            </span>
          </p>
        )}
        <div role="status" aria-live="polite" className="draft__status">
          {status === 'copied' && <span className="vh">{t('prepare.write.copied')}</span>}
          {status === 'rebuilt' && <span className="vh">{t('prepare.write.rebuilt')}</span>}
          {status === 'copyFailed' && <Notice tone="amber">{t('prepare.write.copyFailed')}</Notice>}
          {status === 'formCopied' && <Notice tone="go">{t('prepare.write.formCopied')}</Notice>}
          {status === 'formNotCopied' && <Notice tone="amber">{t('prepare.write.formNotCopied')}</Notice>}
          {ai.status === 'error' && <Notice tone="amber">{aiMessage}</Notice>}
          {usePolish && <span className="vh">{t('prepare.write.polished')}</span>}
        </div>
      </section>
    </div>
  );
}
