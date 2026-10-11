/**
 * How far a student can travel, in miles. One scale everywhere: the setup sheet asks it
 * ("How far can you go?", saved as prefs.maxMiles) and the Meetings filters start from it.
 * prefs.maxMiles === null means any distance (no limit); the engine treats it that way too.
 */
export const MILES = [5, 10, 15, 25, 40, 60];

/**
 * The choices to offer: the scale, plus saved or linked values that are not on it (set in the
 * CLI, or a ?miles= link). null (any distance) and junk are left out.
 */
export function milesChoices(...current) {
  const extra = current.map(Number).filter((n, i) => current[i] != null && Number.isFinite(n) && n > 0);
  return [...new Set([...MILES, ...extra])].sort((a, b) => a - b);
}
