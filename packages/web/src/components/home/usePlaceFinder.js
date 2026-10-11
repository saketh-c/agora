import { useCallback, useEffect, useRef, useState } from 'react';
import { isInDfw, nearestCity, t } from '@agora/core';
import { api } from '../../lib/api.js';

/** About 100 meters of precision: enough to measure distance, not enough to identify a house. */
export function coarse(p) {
  return { lat: Math.round(p.lat * 1000) / 1000, lng: Math.round(p.lng * 1000) / 1000 };
}

export const ZIP_RE = /^\d{5}$/;

const IDLE = { kind: 'idle', text: '' };

/** What to say when a ZIP lookup fails, by the API's error code. */
function zipError(err, zip) {
  const code = err && err.code;
  if (code === 'outside_area') return t('home.where.errors.zipOutside', { zip });
  if (code === 'not_found') return t('home.where.errors.zipNotFound', { zip });
  if (code === 'rate_limited' || code === 'busy') return t('home.where.errors.busy');
  return t('home.where.errors.offline');
}

/** What to say when the browser cannot give a position (GeolocationPositionError codes). */
function geoError(err) {
  if (err && err.code === 1) return t('home.where.errors.geoDenied');
  if (err && err.code === 3) return t('home.where.errors.geoTimeout');
  return t('home.where.errors.geoUnavailable');
}

/**
 * "Use my location" and the ZIP lookup, shared by the first-visit question and the setup sheet.
 *
 * Both resolve to a place: { city, location, label, source } where source is 'device' (browser
 * location, rounded) or 'search' (a ZIP code through the API), and `city` is the covered city
 * nearest to it. `onPlace(place)` receives it. A newer request, `cancel()`, or unmounting makes
 * an older answer arrive to nothing, so a late reply never overwrites a city picked since.
 *
 * `status` is { kind: 'idle' | 'busy' | 'error', text } for a live message under the control.
 */
export default function usePlaceFinder({ cities, onPlace }) {
  const [status, setStatus] = useState(IDLE);
  const [busy, setBusy] = useState(null); // 'locate' | 'zip' | null
  const seq = useRef(0);
  const abort = useRef(null);
  const onPlaceRef = useRef(onPlace);
  onPlaceRef.current = onPlace;
  const citiesRef = useRef(cities);
  citiesRef.current = cities;

  const cancel = useCallback(() => {
    seq.current += 1;
    if (abort.current) abort.current.abort();
    abort.current = null;
    setBusy(null);
    setStatus(IDLE);
  }, []);

  useEffect(
    () => () => {
      seq.current += 1;
      if (abort.current) abort.current.abort();
    },
    [],
  );

  const fail = useCallback((text) => {
    setBusy(null);
    setStatus({ kind: 'error', text });
  }, []);

  const resolve = useCallback((point, label, source, cityId) => {
    const list = citiesRef.current;
    const named = cityId ? list.find((c) => c.cityId === cityId) : null;
    const near = named ? { city: named } : nearestCity(list, point);
    setBusy(null);
    setStatus(IDLE);
    if (near && onPlaceRef.current) onPlaceRef.current({ city: near.city, location: point, label, source });
  }, []);

  const locate = useCallback(() => {
    const id = ++seq.current;
    if (abort.current) abort.current.abort();
    if (typeof navigator === 'undefined' || !navigator.geolocation) return fail(t('home.where.errors.geoUnsupported'));
    setBusy('locate');
    setStatus({ kind: 'busy', text: t('home.where.finding') });
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        if (id !== seq.current) return;
        const p = coarse({ lat: pos.coords.latitude, lng: pos.coords.longitude });
        if (!isInDfw(p)) return fail(t('home.where.errors.outside'));
        resolve(p, '', 'device', null);
      },
      (err) => {
        if (id !== seq.current) return;
        fail(geoError(err));
      },
      { timeout: 10000, maximumAge: 600000 },
    );
    return undefined;
  }, [fail, resolve]);

  const lookupZip = useCallback(
    async (raw) => {
      const zip = String(raw || '').trim();
      const id = ++seq.current;
      if (abort.current) abort.current.abort();
      if (!ZIP_RE.test(zip)) return fail(t('home.where.typeZip'));
      const controller = typeof AbortController === 'function' ? new AbortController() : null;
      abort.current = controller;
      setBusy('zip');
      setStatus({ kind: 'busy', text: t('home.where.lookingUp', { zip }) });
      try {
        const r = await api.geocode(zip, { signal: controller ? controller.signal : undefined });
        if (id !== seq.current) return undefined;
        const p = coarse(r);
        if (!isInDfw(p)) return fail(t('home.where.errors.zipOutside', { zip }));
        resolve(p, r.label || zip, 'search', r.cityId || null);
      } catch (err) {
        if (id !== seq.current || (err && err.code === 'aborted')) return undefined;
        fail(zipError(err, zip));
      }
      return undefined;
    },
    [fail, resolve],
  );

  const showError = useCallback((text) => fail(text), [fail]);

  return { status, busy, locate, lookupZip, cancel, showError };
}
