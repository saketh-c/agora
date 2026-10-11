import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { buildComment, estimateSpeakingSeconds, isTopicId, timeOfDayFor, t, tn, topicList, getTopic } from '@agora/core';
import { useStore } from '../../lib/store.jsx';
import { api, apiAvailable } from '../../lib/api.js';
import { Badge, Chip, Icon, Notice, speakMinutes } from '../ui/index.js';
import TimeRuler from './TimeRuler.jsx';
import { DEFAULT_LIMIT_SECONDS } from './prepMeeting.js';

const POSITIONS = ['support', 'oppose', 'concerned', 'ask'];
const POSITION_KEY = { support: 'support', oppose: 'oppose', concerned: 'concerned', ask: 'askingForAction' };
const SAVE_DELAY_MS = 400;

/** The form, restored from the profile's saved draft (ui.commentDraft) or prefilled from the profile. */
function initialForm(saved, profile, prefs) {
  const s = saved && typeof saved === 'object' ? saved : {};
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

/** The draft text for a set of fields, greeting the council at the meeting's time of day. */
export function composeDraft(fields, { meeting, city } = {}) {
  const f = initialForm(fields, { name: '' }, { interests: [] });
  const firstRule = city && city.meetings && city.meetings[0] && city.meetings[0].recurrence;
  const timeOfDay = meeting && meeting.time ? timeOfDayFor(meeting.time) : firstRule ? timeOfDayFor(firstRule.time) : 'evening';
  return buildComment({ ...f, cityName: city ? city.name : '', timeOfDay });
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

/** Copy text, falling back to a hidden textarea where the Clipboard API is missing (plain http). */
async function copyText(text) {
  try {
    if (navigator.clipboard && window.isSecureContext) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    /* try the fallback */
  }
  try {
    const area = document.createElement('textarea');
    area.value = text;
    area.setAttribute('readonly', '');
    area.style.cssText = 'position:fixed;top:0;left:0;opacity:0;';
    document.body.appendChild(area);
    area.select();
    const ok = document.execCommand('copy');
    area.remove();
    return ok;
  } catch {
    return false;
  }
}

function Field({ id, label, optional, help, children }) {
  return (
    <div className="field">
      <label className="label" htmlFor={id}>
        {label}
        {optional && <span className="opt">{` ${t('prepare.write.optional')}`}</span>}
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

/**
 * The comment builder (podium mock "Write your comment"): who you are, what it's about, your
 * story and your ask, and the live draft timed against the council's limit.
 *
 * - The draft is the core template in the app language, rebuilt on every edit. An AI rewrite
 *   is shown only while the fields it was made from are unchanged, and only when the model
 *   really rewrote it; any edit brings back the live draft.
 * - The fields are saved in the profile (ui.commentDraft), so the draft survives navigation,
 *   a reload and a language switch. Mount it with key={profile.id}.
 * - "Practice out loud" hands the text to Practice through ui.lastDraft.
 */
export default function CommentBuilder({ meeting, city, practicing, prepKey, headingLevel = 2, idPrefix = 'cb' }) {
  const { profile, prefs, ui, setUi, setPrepStep, lang } = useStore();
  const navigate = useNavigate();
  const saved = ui.commentDraft;
  const [form, setForm] = useState(() => initialForm(saved, profile, prefs));
  // Groups that were already filled in start folded into a one-line summary (mock .bsum).
  const [open, setOpen] = useState(() => {
    const f = initialForm(saved, profile, prefs);
    const returning = Boolean(saved && typeof saved === 'object');
    return { who: !(returning && f.name.trim()), what: !returning };
  });
  const [polished, setPolished] = useState(null);
  const [ai, setAi] = useState({ status: 'idle', code: null });
  const [canPolish, setCanPolish] = useState(false);
  const [copied, setCopied] = useState(null);
  const fieldRefs = useRef({});
  const draftRef = useRef(null);
  const copyTimer = useRef(null);
  const abortRef = useRef(null);

  // Save the fields a moment after typing stops, and on the way out. Nothing is saved until
  // the person edits something, so "Draft saved" never appears for an untouched template.
  const setUiRef = useRef(setUi);
  setUiRef.current = setUi;
  const dirty = useRef(false);
  const pending = useRef(null);
  const flush = () => {
    if (pending.current) setUiRef.current({ commentDraft: pending.current });
    pending.current = null;
  };
  useEffect(() => {
    if (!dirty.current) return undefined;
    pending.current = { ...form, at: new Date().toISOString() };
    const timer = setTimeout(flush, SAVE_DELAY_MS);
    return () => clearTimeout(timer);
  }, [form]);
  useEffect(
    () => () => {
      flush();
      clearTimeout(copyTimer.current);
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

  const cityName = city ? city.name : '';
  const template = useMemo(
    () => composeDraft(form, { meeting, city }),
    // lang: buildComment writes in the app language.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [form, meeting, city, lang],
  );
  const usePolish = Boolean(polished && polished.base === template);
  const shown = usePolish ? polished.text : template;
  const seconds = estimateSpeakingSeconds(shown);
  const words = shown.trim().split(/\s+/).filter(Boolean).length;

  const minutes = practicing ? null : speakMinutes(city);
  const limitSeconds = minutes ? minutes * 60 : DEFAULT_LIMIT_SECONDS;
  const note = practicing || !city
    ? t('prepare.ruler.notePractice')
    : minutes
      ? t('prepare.ruler.noteCity', { city: city.name, minutes: tn('common.minutes', minutes) })
      : t('prepare.ruler.noteNoLimit', { city: city.name });

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
  const edit = (group, first) => {
    setOpen((o) => ({ ...o, [group]: true }));
    requestAnimationFrame(() => fieldRefs.current[first] && fieldRefs.current[first].focus());
  };

  const fields = () => ({ name: form.name, school: form.school, itemTitle: form.itemTitle, ask: form.ask });

  const practice = () => {
    setUi({
      lastDraft: { text: shown, cityId: city ? city.cityId : '', meetingId: meeting ? meeting.id : null, fields: fields(), at: new Date().toISOString() },
      commentDraft: { ...form, at: new Date().toISOString() },
    });
    pending.current = null;
    setPrepStep(prepKey, 'write', true);
    navigate('/prepare/practice');
  };

  const copy = async () => {
    const ok = await copyText(shown);
    clearTimeout(copyTimer.current);
    setCopied(ok ? 'ok' : 'fail');
    if (ok) {
      setPrepStep(prepKey, 'write', true);
      copyTimer.current = setTimeout(() => setCopied(null), 2500);
    } else if (draftRef.current) {
      // Select the draft so it can be copied by hand.
      const range = document.createRange();
      range.selectNodeContents(draftRef.current);
      const sel = window.getSelection();
      sel.removeAllRanges();
      sel.addRange(range);
    }
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
  const ids = { who: `${idPrefix}-who`, what: `${idPrefix}-what`, draft: `${idPrefix}-draft-h`, position: `${idPrefix}-position` };

  return (
    <div className="builder">
      <form className="builder__form" onSubmit={(e) => e.preventDefault()} aria-label={t('ui.prep.stepsLong.write')}>
        {open.who ? (
          <fieldset className="builder__group">
            <legend className="builder__gh">{t('prepare.write.who')}</legend>
            <Field id={`${idPrefix}-name`} label={t('prepare.write.name')}>
              <input className="input" autoComplete="name" maxLength={80} {...bind('name')} />
            </Field>
            <Field id={`${idPrefix}-school`} label={t('prepare.write.school')}>
              <input className="input" placeholder={t('prepare.write.schoolPlaceholder')} maxLength={120} {...bind('school')} />
            </Field>
          </fieldset>
        ) : (
          <Summary id={ids.who} title={t('prepare.write.who')} value={[form.name.trim(), form.school.trim()].filter(Boolean).join(', ')} onEdit={() => edit('who', 'name')} />
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
              <input className="input" placeholder={t('prepare.write.agendaItemPlaceholder')} maxLength={200} aria-describedby={`${idPrefix}-itemTitle-help`} {...bind('itemTitle')} />
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
            value={`${topicLabel}. ${form.itemTitle.trim() || t('prepare.write.notOnAgenda')}. ${t(`prepare.write.${POSITION_KEY[form.position]}`)}.`}
            onEdit={() => edit('what', 'topicId')}
          />
        )}

        <fieldset className={`builder__group${open.who && open.what ? '' : ' bopen'}`}>
          <legend className="builder__gh">{t('prepare.write.storyGroup')}</legend>
          <Field id={`${idPrefix}-story`} label={t('prepare.write.story')} help={t('prepare.write.storyHelp')}>
            <textarea className="textarea" rows={4} placeholder={t('prepare.write.storyPlaceholder')} maxLength={1200} aria-describedby={`${idPrefix}-story-help`} {...bind('story')} />
          </Field>
          <Field id={`${idPrefix}-ask`} label={t('prepare.write.ask')} help={t('prepare.write.askHelp')}>
            <input className="input" placeholder={t('prepare.write.askPlaceholder')} maxLength={300} aria-describedby={`${idPrefix}-ask-help`} {...bind('ask')} />
          </Field>
        </fieldset>
      </form>

      <section className="draft" aria-labelledby={ids.draft}>
        <div className="sec-head draft__head">
          <H className="t-heading" id={ids.draft}>
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
            <button type="button" className="btn btn--quiet btn--sm" onClick={() => setPolished(null)}>
              {t('prepare.write.useMine')}
            </button>
          </div>
        )}
        <div className="draft__text" ref={draftRef}>
          {shown.split(/\n{2,}/).map((para, i) => (
            <p key={i}>{para}</p>
          ))}
        </div>
        <div className="btn-row">
          <button type="button" className="btn btn--primary" onClick={practice}>
            <Icon name="mic" />
            {t('prepare.write.practice')}
          </button>
          <button type="button" className="btn btn--secondary" onClick={copy}>
            <Icon name={copied === 'ok' ? 'check' : 'copy'} />
            {copied === 'ok' ? t('prepare.write.copied') : t('prepare.write.copy')}
          </button>
          {canPolish && (
            <button type="button" className="btn btn--quiet" onClick={polish} disabled={ai.status === 'loading'} aria-describedby={`${idPrefix}-ai-note`}>
              {ai.status === 'loading' ? <span className="spinner" aria-hidden="true" /> : <Icon name="star" />}
              {ai.status === 'loading' ? t('prepare.write.polishing') : t('prepare.write.polish')}
            </button>
          )}
        </div>
        {canPolish && (
          <p className="draft__note" id={`${idPrefix}-ai-note`}>
            {t('prepare.write.polishNote')}
          </p>
        )}
        <div role="status" aria-live="polite" className="draft__status">
          {copied === 'ok' && <span className="vh">{t('prepare.write.copied')}</span>}
          {copied === 'fail' && <Notice tone="amber">{t('prepare.write.copyFailed')}</Notice>}
          {ai.status === 'error' && <Notice tone="amber">{aiMessage}</Notice>}
          {usePolish && <span className="vh">{t('prepare.write.polished')}</span>}
        </div>
      </section>
    </div>
  );
}
