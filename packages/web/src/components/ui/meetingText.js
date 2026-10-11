/**
 * Pure wording helpers for meeting rows (no data imports, so they run in the Node tests):
 * the meeting's own title, and numbers that never wrap away from their units.
 */
import { getLocale } from '@agora/core';

// Generic words in English meeting labels. A label made only of these is sentence-cased;
// anything else (a person, a commission, "Fourth-Tuesday") is left exactly as the city wrote it.
const GENERIC = new Set('a and as afternoon agenda briefing called city council day evening executive joint meeting meetings needed of open pre-council pre-meeting preliminary regular session sessions special study the town voting with work workshop worksession'.split(' '));

/**
 * The meeting's own name for a title under the council name: "City Council Regular Meeting"
 * becomes "Regular meeting" (sentence case, no repeated "City Council"). Translated labels
 * are already in sentence case and are only trimmed of the city's name. A label the language's
 * translation memory does not have yet is still English, and is tidied the English way.
 */
export function meetingTitle(meeting, lang = getLocale()) {
  if (!meeting) return '';
  let label = String(meeting.label || '').trim();
  if (meeting.cityName && label.toLowerCase().startsWith(`${meeting.cityName.toLowerCase()} `)) label = label.slice(meeting.cityName.length + 1);
  const translated = lang !== 'en' && typeof meeting.labelSource === 'string' && meeting.labelSource !== meeting.label;
  if (lang !== 'en' && (translated || !/^[\x00-\x7f]*$/.test(label))) return label.charAt(0).toLocaleUpperCase(lang) + label.slice(1);
  const stripped = label.replace(/^(?:city |town )?council /i, '');
  if (stripped && stripped !== label && /\S/.test(stripped)) label = stripped;
  const words = label.split(/([\s/()]+)/);
  const generic = words.every((w) => !/[A-Za-z]/.test(w) || GENERIC.has(w.toLowerCase()));
  if (!generic) return label.charAt(0).toUpperCase() + label.slice(1);
  const lower = words.map((w) => (/[A-Za-z]/.test(w) ? w.toLowerCase() : w)).join('');
  return lower.charAt(0).toUpperCase() + lower.slice(1);
}

/**
 * A number never wraps away from its unit ("3 min", "3 phút", "2.7 mi"), also when right-to-left
 * text has isolated the number ("\u20683\u2069 min").
 */
export const keepUnit = (text) => String(text).replace(/(\d\u2069?)\s+(?=\S)/g, '$1\u00a0');
