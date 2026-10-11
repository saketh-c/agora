import { readFileSync, writeFileSync, renameSync, rmSync, existsSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { defaultPrefs, normalizePrefs } from '@agora/core';

export const PREFS_PATH = process.env.AGORA_PREFS || path.join(os.homedir(), '.agora.json');

/**
 * Read saved preferences. A file that exists but cannot be read or parsed is reported in
 * `error` (instead of looking like "nothing saved"), so the CLI can warn before setup
 * replaces it.
 * @returns {{prefs: object, saved: boolean, error: string | null}}
 */
export function loadPrefs(file = PREFS_PATH) {
  if (!existsSync(file)) return { prefs: defaultPrefs(), saved: false, error: null };
  try {
    return { prefs: normalizePrefs(JSON.parse(readFileSync(file, 'utf8'))), saved: true, error: null };
  } catch (e) {
    return { prefs: defaultPrefs(), saved: false, error: e.message };
  }
}

/**
 * Save preferences. The file holds a home location, so it is readable only by its owner
 * (0600), and it is written to a temporary file and renamed into place so an interrupted
 * write never leaves half a file behind.
 */
export function savePrefs(prefs, file = PREFS_PATH) {
  const tmp = `${file}.${process.pid}.tmp`;
  try {
    writeFileSync(tmp, `${JSON.stringify(normalizePrefs(prefs), null, 2)}\n`, { mode: 0o600 });
    renameSync(tmp, file);
  } catch (e) {
    rmSync(tmp, { force: true });
    throw e;
  }
  return file;
}
