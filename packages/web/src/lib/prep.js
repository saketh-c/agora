/**
 * Per-meeting preparation progress, stored per profile in `ui.prep`.
 *
 * Shape: ui.prep = { [meetingId]: { signup?: true, write?: true, practice?: true, day?: true,
 *                                   after?: true, checklist?: number[], at: ISO string } }
 * - Meeting ids are language-independent (`${cityId}:${date}:${slug}`), so progress survives a
 *   language switch, and each meeting keeps its own progress when the student switches between
 *   meetings and back.
 * - `checklist` holds the indexes of the "On the day" items checked for that meeting. Checking
 *   every item is what marks the `day` step done, so the two can never disagree.
 * Pure functions only, so they can be tested without a browser.
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
/** Steps that carry over to another meeting: the draft and the practice runs are not tied to one. */
export const CARRY_STEPS = Object.freeze(['write', 'practice']);
const CHECKLIST_MAX = 20;

const isPlainObject = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);

/** Sorted, unique, in-range item indexes. */
function cleanChecklist(list) {
  if (!Array.isArray(list)) return [];
  return [...new Set(list.filter((i) => Number.isInteger(i) && i >= 0 && i < CHECKLIST_MAX))].sort((a, b) => a - b);
}

/** Repair a stored ui.prep value: unknown steps and malformed entries are dropped. */
export function normalizePrep(raw) {
  if (!isPlainObject(raw)) return {};
  const entries = [];
  for (const [id, value] of Object.entries(raw)) {
    if (!id || typeof id !== 'string' || id.length > 200 || !isPlainObject(value)) continue;
    const entry = {};
    for (const step of ALL_STEPS) if (value[step] === true) entry[step] = true;
    const checklist = cleanChecklist(value.checklist);
    if (checklist.length) entry.checklist = checklist;
    const at = typeof value.at === 'string' && !Number.isNaN(Date.parse(value.at)) ? value.at : '';
    if (!Object.keys(entry).length) continue;
    entry.at = at;
    entries.push([id, entry]);
  }
  entries.sort((a, b) => String(b[1].at).localeCompare(String(a[1].at)));
  return Object.fromEntries(entries.slice(0, PREP_MAX_MEETINGS));
}

/** Put one meeting's entry back, or drop it when nothing is left in it. */
function withEntry(prep, meetingId, entry, now) {
  const next = { ...(prep || {}) };
  const keep = ALL_STEPS.some((s) => entry[s]) || (entry.checklist && entry.checklist.length);
  if (keep) next[meetingId] = { ...entry, at: now };
  else delete next[meetingId];
  return normalizePrep(next);
}

/** Set one step on or off for one meeting; returns a new ui.prep object. */
export function withPrepStep(prep, meetingId, step, done = true, now = new Date().toISOString()) {
  if (!meetingId || !ALL_STEPS.includes(step)) return prep || {};
  const current = { ...((prep && prep[meetingId]) || {}) };
  if (done) current[step] = true;
  else delete current[step];
  return withEntry(prep, meetingId, current, now);
}

/**
 * Set the "On the day" items checked for one meeting. The `day` step follows: done exactly
 * when all `total` items are checked.
 */
export function withPrepChecklist(prep, meetingId, checked, total, now = new Date().toISOString()) {
  if (!meetingId) return prep || {};
  const current = { ...((prep && prep[meetingId]) || {}) };
  const list = cleanChecklist(checked).filter((i) => i < total);
  if (list.length) current.checklist = list;
  else delete current.checklist;
  if (total > 0 && list.length >= total) current.day = true;
  else delete current.day;
  return withEntry(prep, meetingId, current, now);
}

/**
 * Copy the steps that are not tied to one meeting (Write and Practice) from one meeting to
 * another. Steps already done on the target stay done; nothing is ever unchecked.
 */
export function carryPrep(prep, fromId, toId, steps = CARRY_STEPS, now = new Date().toISOString()) {
  if (!fromId || !toId || fromId === toId) return prep || {};
  const from = (prep && prep[fromId]) || {};
  const to = { ...((prep && prep[toId]) || {}) };
  let changed = false;
  for (const s of steps) {
    if (ALL_STEPS.includes(s) && from[s] === true && to[s] !== true) {
      to[s] = true;
      changed = true;
    }
  }
  return changed ? withEntry(prep, toId, to, now) : prep || {};
}

/** The carry-over steps done for `fromId` but not yet for `toId`. */
export function carryableSteps(prep, fromId, toId, steps = CARRY_STEPS) {
  if (!fromId || !toId || fromId === toId) return [];
  const from = (prep && prep[fromId]) || {};
  const to = (prep && prep[toId]) || {};
  return steps.filter((s) => from[s] === true && to[s] !== true);
}

/**
 * Progress for one meeting: { steps: { signup, write, practice, day, after }, done, total, next,
 * checklist }. `next` is the first of the four counted steps not done yet, or null when all four
 * are. `checklist` is the checked item indexes, or null when this meeting never had any (a `day`
 * step marked done before checklists were kept per meeting then reads as fully checked).
 */
export function prepSummary(prep, meetingId) {
  const entry = (prep && meetingId && prep[meetingId]) || {};
  const steps = Object.fromEntries(ALL_STEPS.map((s) => [s, entry[s] === true]));
  const done = PREP_STEPS.filter((s) => steps[s]).length;
  const next = PREP_STEPS.find((s) => !steps[s]) || null;
  const checklist = Array.isArray(entry.checklist) ? cleanChecklist(entry.checklist) : null;
  return { steps, done, total: PREP_STEPS.length, next, checklist };
}

/** The checked "On the day" items for a summary, out of `total`. */
export function checkedItems(summary, total) {
  if (summary && Array.isArray(summary.checklist)) return summary.checklist.filter((i) => i < total);
  return summary && summary.steps && summary.steps.day ? Array.from({ length: total }, (_, i) => i) : [];
}
