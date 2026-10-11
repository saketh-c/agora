/** Build an .ics file for one meeting and hand it to the browser as a download. */
import { BRAND, t } from '@agora/core';
import { downloadBlob } from './download.js';

function stamp(date) {
  return date.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z');
}

function escapeText(s) {
  return String(s || '')
    .replace(/\\/g, '\\\\')
    .replace(/\n/g, '\\n')
    .replace(/,/g, '\\,')
    .replace(/;/g, '\\;');
}

export function buildIcs(meeting, city) {
  const start = new Date(meeting.startISO);
  const end = new Date(start.getTime() + (meeting.durationMinutes || 120) * 60000);
  const url = city && city.agendaPortal && city.agendaPortal.url ? city.agendaPortal.url : city ? city.website : '';
  // Every fixed phrase comes from the dictionaries, so an es or vi event is not half English.
  const description = [
    `${meeting.cityName} ${meeting.label}.`,
    city && city.publicComment && city.publicComment.summary ? t('ui.ics.howToSpeak', { text: city.publicComment.summary }) : '',
    url ? t('ui.ics.agenda', { url }) : '',
    t('ui.ics.addedFrom', { app: BRAND.name }),
  ]
    .filter(Boolean)
    .join('\n');
  return [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    `PRODID:-//${BRAND.name}//EN`,
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    'BEGIN:VEVENT',
    `UID:${meeting.id}@agora`,
    `DTSTAMP:${stamp(new Date())}`,
    `DTSTART:${stamp(start)}`,
    `DTEND:${stamp(end)}`,
    `SUMMARY:${escapeText(`${meeting.cityName} ${meeting.label}`)}`,
    `LOCATION:${escapeText(meeting.location)}`,
    `DESCRIPTION:${escapeText(description)}`,
    url ? `URL:${url}` : '',
    'BEGIN:VALARM',
    'TRIGGER:-P1D',
    'ACTION:DISPLAY',
    `DESCRIPTION:${escapeText(t('ui.ics.reminder', { city: meeting.cityName }))}`,
    'END:VALARM',
    'END:VEVENT',
    'END:VCALENDAR',
  ]
    .filter(Boolean)
    .join('\r\n');
}

export function downloadIcs(meeting, city) {
  const blob = new Blob([buildIcs(meeting, city)], { type: 'text/calendar;charset=utf-8' });
  downloadBlob(`${meeting.cityId}-council-${meeting.date}.ics`, blob);
}

export function directionsUrl(meeting) {
  const q = encodeURIComponent(meeting.location || `${meeting.lat},${meeting.lng}`);
  return `https://www.google.com/maps/dir/?api=1&destination=${q}`;
}
