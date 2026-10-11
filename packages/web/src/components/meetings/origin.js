/**
 * Where Meetings measures distance from: the profile's Home or School (lib/places.js), where
 * you are right now (asked once; kept for this browser session and, once chosen, saved as the
 * profile's place like Home's place switch does), a covered city, or a looked-up address
 * carried in the URL (?near=pt&at=lat,lng&atl=label).
 */
import { cityPoint, t } from '@agora/core';
import { placeLabel } from '../../lib/places.js';
import { round3 } from '../../lib/meetingFilters.js';

const HERE_KEY = 'agora.meetings.here.v1';
const HERE_MAX_AGE_MS = 30 * 60 * 1000;

/** The position found earlier in this session, if it is recent: { lat, lng, at } (at: when, ISO). */
export function readHere() {
  try {
    const v = JSON.parse(sessionStorage.getItem(HERE_KEY) || 'null');
    if (v && Number.isFinite(v.lat) && Number.isFinite(v.lng) && Date.now() - v.at < HERE_MAX_AGE_MS) return { lat: v.lat, lng: v.lng, at: new Date(v.at).toISOString() };
  } catch {
    /* private mode or junk: ask again */
  }
  return null;
}

function saveHere(p) {
  try {
    sessionStorage.setItem(HERE_KEY, JSON.stringify({ lat: p.lat, lng: p.lng, at: Date.now() }));
  } catch {
    /* memory still has it */
  }
}

/** Ask the device where it is. Resolves { lat, lng } (about 100 m); rejects with code 'denied' | 'failed'. */
export function locate() {
  return new Promise((resolve, reject) => {
    if (typeof navigator === 'undefined' || !navigator.geolocation) {
      reject(Object.assign(new Error('unsupported'), { code: 'failed' }));
      return;
    }
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        const p = { lat: round3(pos.coords.latitude), lng: round3(pos.coords.longitude) };
        saveHere(p);
        resolve(p);
      },
      (err) => reject(Object.assign(new Error('geolocation'), { code: err && err.code === 1 ? 'denied' : 'failed' })),
      { enableHighAccuracy: true, timeout: 15000, maximumAge: 120000 },
    );
  });
}

/**
 * The origin for a `near` value: { id, lat, lng, label, name?, detail } or null when that place
 * is not known. `label` reads inside a sentence ("Within 15 mi of home", "2.1 mi from where you
 * are"); `name` is Home or School on their own (a map label); `detail` says what the place is
 * ("K Avenue, Plano").
 */
export function resolveOrigin(near, { saved, here, pt, cityById }) {
  if (!near) return null;
  if (near === 'home' || near === 'school') {
    const place = saved && saved[near];
    if (!place) return null;
    const detail = place.kind === 'city' && place.label ? t('common.cityHallOf', { city: place.label }) : placeLabel(place);
    return { id: near, lat: place.lat, lng: place.lng, name: t(`meetings.from.${near}`), label: t(`meetings.from.${near}In`), detail, cityId: place.cityId || null };
  }
  if (near === 'here') {
    const p = here || (saved && saved.here);
    return p ? { id: 'here', lat: p.lat, lng: p.lng, label: t('meetings.from.hereLabel'), detail: '' } : null;
  }
  if (near === 'pt') return pt ? { id: 'pt', lat: pt.lat, lng: pt.lng, label: pt.label || t('meetings.from.other'), detail: pt.label || '' } : null;
  const city = cityById(near);
  const p = city ? cityPoint(city) : null;
  return p ? { id: near, lat: p.lat, lng: p.lng, label: city.name, detail: t('common.cityHallOf', { city: city.name }), cityId: city.cityId } : null;
}
