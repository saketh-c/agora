/**
 * Per-meeting preparation progress, stored per profile in `ui.prep`.
 *
 * Shape: ui.prep = { [meetingId]: { signup?: true, write?: true, practice?: true, day?: true,
 *                                   after?: true, at: ISO string of the last change } }
 * Meeting ids are language-independent (`${cityId}:${date}:${slug}`), so progress survives a
 * language switch. Pure functions only, so they can be tested without a browser.
 */

/** The four steps that count toward "N of 4 prep steps done", in order. */
export const PREP_STEPS = Object.freeze(['signup', 'write', 'practice', 'day']);
/** Tracked but not counted: sharing how it went happens after the meeting. */
export const PREP_EXTRA_STEPS = Object.freeze(['after']);
const ALL_STEPS = [...PREP_STEPS, ...PREP_EXTRA_STEPS];
/** Old entries are dropped beyond this many meetings, most recently changed kept first. */
export const PREP_MAX_MEETINGS = 40;
/** The pseudo meeting id for "Just practicing", with no real meeting attached. */
export const PRACTICE_ONLY = 'practice';

const isPlainObject = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);

/** Repair a stored ui.prep value: unknown steps and malformed entries are dropped. */
export function normalizePrep(raw) {
  if (!isPlainObject(raw)) return {};
  const entries = [];
  for (const [id, value] of Object.entries(raw)) {
    if (!id || typeof id !== 'string' || id.length > 200 || !isPlainObject(value)) continue;
    const entry = {};
    for (const step of ALL_STEPS) if (value[step] === true) entry[step] = true;
    const at = typeof value.at === 'string' && !Number.isNaN(Date.parse(value.at)) ? value.at : '';
    if (!Object.keys(entry).length) continue;
    entry.at = at;
    entries.push([id, entry]);
  }
  entries.sort((a, b) => String(b[1].at).localeCompare(String(a[1].at)));
  return Object.fromEntries(entries.slice(0, PREP_MAX_MEETINGS));
}

/** Set one step on or off for one meeting; returns a new ui.prep object. */
export function withPrepStep(prep, meetingId, step, done = true, now = new Date().toISOString()) {
  if (!meetingId || !ALL_STEPS.includes(step)) return prep || {};
  const current = { ...((prep && prep[meetingId]) || {}) };
  if (done) current[step] = true;
  else delete current[step];
  current.at = now;
  const next = { ...(prep || {}) };
  const anyStep = ALL_STEPS.some((s) => current[s]);
  if (anyStep) next[meetingId] = current;
  else delete next[meetingId];
  return normalizePrep(next);
}

/**
 * Progress for one meeting: { steps: { signup, write, practice, day, after }, done, total, next }.
 * `next` is the first of the four counted steps not done yet, or null when all four are.
 */
export function prepSummary(prep, meetingId) {
  const entry = (prep && meetingId && prep[meetingId]) || {};
  const steps = Object.fromEntries(ALL_STEPS.map((s) => [s, entry[s] === true]));
  const done = PREP_STEPS.filter((s) => steps[s]).length;
  const next = PREP_STEPS.find((s) => !steps[s]) || null;
  return { steps, done, total: PREP_STEPS.length, next };
}
