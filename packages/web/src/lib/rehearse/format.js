/**
 * One way to write practice times, numbers and dates, in the app's language. Pure, so the
 * report, the timer, the charts and the history can never disagree about a number.
 */
import { formatDate, formatTime, t, tn, joinList } from '@agora/core';

const LOCALE_TAG = { en: 'en-US', es: 'es-US', vi: 'vi-VN' };
const ZONE = 'America/Chicago';

export function localeTag(lang) {
  return LOCALE_TAG[lang] || 'en-US';
}

/** Whole seconds as m:ss ("2:05"). Callers pass the seconds they mean; this never re-rounds differently. */
export function clock(sec) {
  const s = Math.max(0, Math.round(Number(sec) || 0));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

/** A number with the language's decimal mark: 1.5 in English, 1,5 in Spanish and Vietnamese. */
export function numberText(n, lang, maxDigits = 1) {
  try {
    return new Intl.NumberFormat(localeTag(lang), { maximumFractionDigits: maxDigits }).format(n);
  } catch {
    return String(n);
  }
}

/** "45 seconds", "1 second"; a minute or more reads as a clock, "1:05". */
export function secondsPhrase(sec) {
  const s = Math.max(0, Math.round(Number(sec) || 0));
  return s < 60 ? tn('rehearse.secondsN', s) : clock(s);
}

/** A speaking limit: "3 minutes", or "2:30" when it is not whole minutes. */
export function limitPhrase(limitSec) {
  const s = Math.round(Number(limitSec) || 0);
  return s % 60 === 0 ? tn('common.minutes', s / 60) : clock(s);
}

/** When a take happened, in Central time and the app's language: { date: 'Sat, Oct 10', time: '5:06 PM' }. */
export function takeWhen(iso, lang) {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return { date: '', time: '' };
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat('en-US', { timeZone: ZONE, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' })
      .formatToParts(d)
      .map((p) => [p.type, p.value]),
  );
  const date = `${parts.year}-${parts.month}-${parts.day}`;
  return { date: formatDate(date, { locale: lang }), time: formatTime(`${parts.hour}:${parts.minute}`, lang) };
}

/** Megabytes with one decimal in the app's language. */
export function megabytes(bytes, lang) {
  return numberText(Math.max(0.1, bytes / 1024 / 1024), lang, 1);
}

/**
 * A coaching entry's parameters, ready for its sentence: seconds become words, decimals get
 * the right mark, and element keys become a spoken list ("your school and your ask").
 */
export function coachParams(params = {}, lang = 'en') {
  const out = { ...params };
  if (typeof params.over === 'number') out.over = secondsPhrase(params.over);
  if (typeof params.used === 'number') out.used = secondsPhrase(params.used);
  if (typeof params.left === 'number') out.left = secondsPhrase(params.left);
  if (typeof params.limit === 'number') out.limit = limitPhrase(params.limit);
  for (const k of ['sec', 'rate', 'semis']) if (typeof params[k] === 'number') out[k] = numberText(params[k], lang);
  if (Array.isArray(params.missing)) out.missing = joinList(params.missing.map((k) => t(`rehearse.elements.${k}`)), lang);
  if (Array.isArray(params.landed)) out.landed = joinList(params.landed.map((k) => t(`rehearse.elements.${k}`)), lang);
  if (Array.isArray(params.list)) out.list = params.list.map((w) => `"${w}"`).join(', ');
  return out;
}
