/**
 * Whether a youth program is taking applications, from the structured fields on each
 * `youthPrograms[]` entry in the city data (the free-text `applyWindow` says the same thing in
 * words, for people):
 *  - applyStatus: 'open' (a window is open now), 'rolling' (accepted any time), 'closed' (this
 *    cycle is over) or 'unknown' (the city does not say). Missing means unknown.
 *  - applyBy: YYYY-MM-DD. For an open window, the deadline; for a closed one, the day it closed.
 *  - applyOpens: YYYY-MM or YYYY-MM-DD, when the next window is expected to open.
 * build-data and validateCity reject any other values.
 */
import { daysBetween, isDateStr } from './schedule.js';

export const APPLY_STATUSES = Object.freeze(['open', 'rolling', 'closed', 'unknown']);
/** An open window with this many days or fewer left is "closing soon". */
export const CLOSING_SOON_DAYS = 14;

const MONTH_RE = /^\d{4}-(?:0[1-9]|1[0-2])$/;

/** A YYYY-MM month or a YYYY-MM-DD date. */
export function isMonthOrDate(s) {
  return isDateStr(s) || MONTH_RE.test(String(s || ''));
}

/**
 * Where a program's application stands on `today` (YYYY-MM-DD):
 * { state, applyBy, applyOpens, daysLeft, canApply }, where state is one of
 *  - 'closing': open, with CLOSING_SOON_DAYS or fewer days left (daysLeft says how many);
 *  - 'open', 'rolling': taking applications;
 *  - 'closed': this cycle is over, including an open window whose deadline has passed;
 *  - 'unknown': the city does not say, or a closed program's next window should have opened
 *    by now (the data cannot tell whether it did).
 */
export function youthApplyState(program, today) {
  const p = program || {};
  const status = APPLY_STATUSES.includes(p.applyStatus) ? p.applyStatus : 'unknown';
  const applyBy = isDateStr(p.applyBy) ? p.applyBy : null;
  const applyOpens = isMonthOrDate(p.applyOpens) ? p.applyOpens : null;
  const known = isDateStr(today);
  let state = status;
  let daysLeft = null;
  if (status === 'open' && applyBy && known) {
    daysLeft = daysBetween(today, applyBy);
    if (daysLeft < 0) {
      state = 'closed';
      daysLeft = null;
    } else if (daysLeft <= CLOSING_SOON_DAYS) state = 'closing';
  }
  if (status === 'closed' && applyOpens && known && today >= (applyOpens.length === 7 ? `${applyOpens}-01` : applyOpens)) state = 'unknown';
  return { state, applyBy, applyOpens, daysLeft, canApply: state === 'open' || state === 'closing' || state === 'rolling' };
}

/** Sort key: programs you can apply to first (closing soon, open, rolling), then unknown, then closed. */
export function youthApplyRank(state) {
  const order = { closing: 0, open: 1, rolling: 2, unknown: 3, closed: 4 };
  return Object.prototype.hasOwnProperty.call(order, state) ? order[state] : 3;
}
