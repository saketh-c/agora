/**
 * Which script Practice starts with. Pure functions, tested in Node.
 *
 * Write keeps the draft in ui.commentDraft (the form, plus a hand edit or an AI rewrite) and
 * hands it over in ui.lastDraft when "Practice out loud" is pressed. Practice remembers its own
 * setup in ui.practice, including `draftAt`: the time of the Write draft it last adopted (or
 * deliberately set aside). A newer draft from Write is picked up automatically; the student's
 * own script, or an empty one they cleared, is kept until Write changes again.
 */

const isObj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const time = (iso) => {
  const n = Date.parse(iso || '');
  return Number.isFinite(n) ? n : -Infinity;
};
const str = (v) => (typeof v === 'string' ? v : '');

/** The longest script Practice keeps. */
export const SCRIPT_MAX = 6000;

/**
 * The newest draft from Write: { text, at, fields } or null.
 * - `commentDraft` is ui.commentDraft and `writeText` the text Write shows for it (composed for
 *   the meeting being prepared for);
 * - `lastDraft` is ui.lastDraft, used only when it is newer (or there is no saved draft).
 */
export function latestDraft({ commentDraft, writeText = '', lastDraft } = {}) {
  const cd = isObj(commentDraft) ? commentDraft : null;
  const ld = isObj(lastDraft) && str(lastDraft.text).trim() ? lastDraft : null;
  if (cd && str(writeText).trim() && !(ld && time(ld.at) > time(cd.at))) {
    return { text: str(writeText).slice(0, SCRIPT_MAX), at: str(cd.at), fields: { name: str(cd.name), school: str(cd.school), itemTitle: str(cd.itemTitle), ask: str(cd.ask) } };
  }
  if (ld) return { text: str(ld.text).slice(0, SCRIPT_MAX), at: str(ld.at), fields: isObj(ld.fields) ? ld.fields : {} };
  return null;
}

/**
 * The script to start with: { script, scriptFrom: 'draft' | 'own', draftAt }.
 * `saved` is ui.practice; `draft` is latestDraft().
 */
export function initialScript({ saved, draft } = {}) {
  const s = isObj(saved) ? saved : {};
  const own = str(s.script).slice(0, SCRIPT_MAX);
  if (draft && draft.text.trim()) {
    // Older saves compared the text instead of a time.
    const seen = typeof s.draftAt === 'string' ? s.draftAt === draft.at : str(s.draftText).trim() === draft.text.trim();
    if (!seen) return { script: draft.text, scriptFrom: 'draft', draftAt: draft.at };
    const from = own.trim() === draft.text.trim() && own.trim() ? 'draft' : 'own';
    return { script: own, scriptFrom: from, draftAt: draft.at };
  }
  return { script: own, scriptFrom: 'own', draftAt: typeof s.draftAt === 'string' ? s.draftAt : '' };
}

/** True when the script is exactly the Write draft (so the builder's fields apply to it). */
export function isFromDraft(script, draft) {
  return Boolean(draft && draft.text.trim() && str(script).trim() === draft.text.trim());
}

/** Paragraphs for the on-screen script while recording (single line breaks are kept inside them). */
export function scriptParagraphs(script) {
  return str(script)
    .replace(/\r\n?/g, '\n')
    .split(/\n[ \t]*\n/)
    .map((p) => p.trim())
    .filter(Boolean);
}
