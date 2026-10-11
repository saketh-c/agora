/**
 * How far a student can travel, in miles. One scale everywhere: the setup sheet asks it
 * ("How far can you go?", saved as prefs.maxMiles) and the Meetings filters start from it.
 */
export const MILES = [5, 10, 15, 25];

/** The choices to offer: the scale, plus a saved value that is not on it (set in the CLI, say). */
export function milesChoices(current) {
  const n = Number(current);
  return [...new Set([...MILES, ...(Number.isFinite(n) && n > 0 ? [n] : [])])].sort((a, b) => a - b);
}
