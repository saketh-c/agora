/**
 * Calendar exports for one meeting: an .ics file (RFC 5545), and "add event" links for Google
 * Calendar and Outlook, which work on a Chromebook or a phone where a downloaded .ics does
 * nothing. Pure except downloadIcs (tested in test/ics.test.js).
 *
 * The .ics holds the meeting with two reminders (the day before and two hours before) and,
 * when the city closes speaker sign-up ahead of time, a second event at that deadline with
 * its own reminder, because the deadline decides whether you get to speak at all.
 */
import { BRAND, formatDate, formatTime, stripIsolates, t, toISO } from '@agora/core';
import { downloadBlob } from './download.js';

/**
 * The sign-up deadline needs the city's English rules (see components/ui/meetingInfo.js),
 * which this file does not load, so the UI registers how to find it. Callers can also pass
 * `deadline` ({ date, time, passed }) or `deadline: null` directly.
 */
let resolveDeadline = null;
export function setDeadlineResolver(fn) {
  resolveDeadline = typeof fn === 'function' ? fn : null;
}

function deadlineFor(meeting, opts) {
  if (opts && 'deadline' in opts) return opts.deadline || null;
  try {
    return resolveDeadline ? resolveDeadline(meeting) : null;
  } catch {
    return null;
  }
}

/** 20261013T000000Z */
export function stamp(date) {
  return date.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z');
}

/**
 * Text for a calendar file, which is UTF-8 in every language. The bidi isolates the app puts
 * around values in Arabic sentences are left out: a calendar app lays the text out itself.
 */
function escapeText(s) {
  return stripIsolates(s)
    .replace(/\\/g, '\\\\')
    .replace(/\r\n?|\n/g, '\\n')
    .replace(/,/g, '\\,')
    .replace(/;/g, '\\;');
}

const encoder = typeof TextEncoder === 'function' ? new TextEncoder() : null;
const octets = (s) => (encoder ? encoder.encode(s).length : unescape(encodeURIComponent(s)).length);

/**
 * Fold one content line at 75 octets (RFC 5545 section 3.1): CRLF plus one space starts each
 * continuation, and a multi-byte character is never split.
 */
export function foldLine(line) {
  if (octets(line) <= 75) return line;
  const parts = [];
  let current = '';
  let size = 0;
  let limit = 75;
  for (const ch of line) {
    const n = octets(ch);
    if (size + n > limit) {
      parts.push(current);
      current = '';
      size = 0;
      limit = 74; // the leading space counts
    }
    current += ch;
    size += n;
  }
  if (current) parts.push(current);
  return parts.join('\r\n ');
}

function meetingTimes(meeting) {
  const start = new Date(meeting.startISO);
  const end = new Date(start.getTime() + (meeting.durationMinutes || 120) * 60000);
  return { start, end };
}

function agendaUrlOf(city) {
  return city && city.agendaPortal && city.agendaPortal.url ? city.agendaPortal.url : city ? city.website || '' : '';
}

function signupUrlOf(city) {
  return (city && city.publicComment && city.publicComment.registrationUrl) || '';
}

const titleOf = (meeting) => `${meeting.cityName} ${meeting.label}`.trim();
const councilOf = (meeting) => t('ui.council', { city: meeting.cityName });

/** "Mon, Oct 12, 4:00 PM" in the app language (Central time wall clock, like the schedule). */
const whenOf = (date, time) => t('ui.dateTime', { date: formatDate(date), time: formatTime(time) });

/** The plain-text body shared by the .ics description and the Google/Outlook links. */
export function eventDetails(meeting, city, opts = {}) {
  const deadline = deadlineFor(meeting, opts);
  const url = agendaUrlOf(city);
  const signup = signupUrlOf(city);
  const open = deadline && !deadline.passed;
  return [
    `${titleOf(meeting)}.`,
    open ? t('ui.ics.deadline', { when: whenOf(deadline.date, deadline.time) }) : '',
    open && signup ? t('ui.ics.signupLink', { url: signup }) : '',
    city && city.publicComment && city.publicComment.summary ? t('ui.ics.howToSpeak', { text: city.publicComment.summary }) : '',
    url ? t('ui.ics.agenda', { url }) : '',
    t('ui.ics.addedFrom', { app: BRAND.name }),
  ]
    .filter(Boolean)
    .join('\n');
}

/**
 * The .ics text. Options: `deadline` (see above), `now` (a Date, for DTSTAMP; tests pin it).
 */
export function buildIcs(meeting, city, opts = {}) {
  const { start, end } = meetingTimes(meeting);
  const url = agendaUrlOf(city);
  const deadline = deadlineFor(meeting, opts);
  const dtstamp = stamp(opts.now instanceof Date ? opts.now : new Date());
  const alarm = (trigger, text) => ['BEGIN:VALARM', `TRIGGER:${trigger}`, 'ACTION:DISPLAY', `DESCRIPTION:${escapeText(text)}`, 'END:VALARM'];
  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    `PRODID:-//${BRAND.name}//EN`,
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    'BEGIN:VEVENT',
    `UID:${meeting.id}@agora`,
    `DTSTAMP:${dtstamp}`,
    `DTSTART:${stamp(start)}`,
    `DTEND:${stamp(end)}`,
    `SUMMARY:${escapeText(titleOf(meeting))}`,
    meeting.location ? `LOCATION:${escapeText(meeting.location)}` : '',
    `DESCRIPTION:${escapeText(eventDetails(meeting, city, { deadline }))}`,
    url ? `URL:${url}` : '',
    ...alarm('-P1D', t('ui.ics.reminder', { city: meeting.cityName })),
    ...alarm('-PT2H', t('ui.ics.startsSoon', { city: meeting.cityName })),
    'END:VEVENT',
  ];
  if (deadline && !deadline.passed && deadline.date && deadline.time) {
    const at = new Date(toISO(deadline.date, deadline.time));
    const signup = signupUrlOf(city);
    const body = [t('ui.ics.signupBody', { when: whenOf(deadline.date, deadline.time), council: councilOf(meeting), meeting: whenOf(meeting.date, meeting.time) }), signup ? t('ui.ics.signupLink', { url: signup }) : ''].filter(Boolean).join('\n');
    lines.push(
      'BEGIN:VEVENT',
      `UID:${meeting.id}-signup@agora`,
      `DTSTAMP:${dtstamp}`,
      `DTSTART:${stamp(at)}`,
      `DTEND:${stamp(new Date(at.getTime() + 15 * 60000))}`,
      `SUMMARY:${escapeText(t('ui.ics.signupTitle', { council: councilOf(meeting) }))}`,
      `DESCRIPTION:${escapeText(body)}`,
      signup ? `URL:${signup}` : '',
      ...alarm('-PT2H', t('ui.ics.signupReminder', { city: meeting.cityName })),
      'END:VEVENT',
    );
  }
  lines.push('END:VCALENDAR');
  return `${lines.filter(Boolean).map(foldLine).join('\r\n')}\r\n`;
}

export function icsFileName(meeting) {
  return `${meeting.cityId}-council-${meeting.date}.ics`;
}

export function downloadIcs(meeting, city, opts = {}) {
  const blob = new Blob([buildIcs(meeting, city, opts)], { type: 'text/calendar;charset=utf-8' });
  downloadBlob(icsFileName(meeting), blob);
}

/** Google Calendar's "create event" link, prefilled. */
export function googleCalendarUrl(meeting, city, opts = {}) {
  const { start, end } = meetingTimes(meeting);
  const params = new URLSearchParams({
    action: 'TEMPLATE',
    text: titleOf(meeting),
    dates: `${stamp(start)}/${stamp(end)}`,
    details: stripIsolates(eventDetails(meeting, city, opts)),
    location: meeting.location || '',
    ctz: 'America/Chicago',
  });
  return `https://calendar.google.com/calendar/render?${params}`;
}

/**
 * Outlook's "new event" link, prefilled: outlook.live.com for personal accounts, or with
 * { work: true } outlook.office.com for school and work (Microsoft 365) accounts.
 */
export function outlookUrl(meeting, city, opts = {}) {
  const { start, end } = meetingTimes(meeting);
  const iso = (d) => d.toISOString().replace(/\.\d{3}Z$/, 'Z');
  const params = new URLSearchParams({
    path: '/calendar/action/compose',
    rru: 'addevent',
    subject: titleOf(meeting),
    startdt: iso(start),
    enddt: iso(end),
    body: stripIsolates(eventDetails(meeting, city, opts)),
    location: meeting.location || '',
  });
  return `https://outlook.${opts.work ? 'office' : 'live'}.com/calendar/0/action/compose?${params}`;
}

export function directionsUrl(meeting) {
  const q = encodeURIComponent(meeting.location || `${meeting.lat},${meeting.lng}`);
  return `https://www.google.com/maps/dir/?api=1&destination=${q}`;
}
