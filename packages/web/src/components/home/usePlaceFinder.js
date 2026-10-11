import { useCallback, useEffect, useRef, useState } from 'react';
import { cityPoint, isInDfw, nearestCity, t } from '@agora/core';
import { lookupPlace, placeFromCity, placeFromDevice, placeFromLookup } from '../../lib/places.js';

/** About 100 meters of precision: enough to measure distance, not enough to identify a house. */
export function coarse(p) {
  return { lat: Math.round(p.lat * 1000) / 1000, lng: Math.round(p.lng * 1000) / 1000 };
}

const IDLE = { kind: 'idle', text: '' };

/** What to say when a lookup fails, by PlaceError code. */
export function lookupError(err, text) {
  const code = err && err.code;
  const place = (err && err.label) || text;
  if (code === 'empty') return t('home.where.typePlace');
  if (code === 'outside_area') return t('home.where.errors.placeOutside', { place });
  if (code === 'not_found') return t('home.where.errors.placeNotFound', { place: text });
  if (code === 'busy') return t('home.where.errors.busy');
  return t('home.where.errors.lookupOffline');
}

/** What to say when the browser cannot give a position (GeolocationPositionError codes). */
export function geoError(err) {
  if (err && err.code === 1) return t('home.where.errors.geoDenied');
  if (err && err.code === 3) return t('home.where.errors.geoTimeout');
  return t('home.where.errors.geoUnavailable');
}

/**
 * The device's position, precise (not snapped to a city), rounded to about 100 meters.
 * Resolves to a point in DFW or rejects with { message } ready to show.
 */
export function currentPosition() {
  return new Promise((resolve, reject) => {
    if (typeof navigator === 'undefined' || !navigator.geolocation) {
      reject(new Error(t('home.where.errors.geoUnsupported')));
      return;
    }
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        const p = coarse({ lat: pos.coords.latitude, lng: pos.coords.longitude });
        if (!isInDfw(p)) reject(new Error(t('home.where.errors.outside')));
        else resolve(p);
      },
      (err) => reject(new Error(geoError(err))),
      { enableHighAccuracy: true, timeout: 15000, maximumAge: 60000 },
    );
  });
}

/**
 * "Use my exact location" and the address lookup, shared by the first-visit question, the
 * setup sheet and Home's place switch.
 *
 * Both resolve to `onPlace({ place, city, school, location, label, source })`:
 *  - place: { label, lat, lng, kind: 'city' | 'address' | 'zip' | 'current', cityId? } (lib/places.js);
 *  - city: the covered city that contains it (when the lookup knows) or is nearest to it;
 *  - school: true when the lookup found a school;
 *  - location, label, source: the same place in the older shape ('hall' | 'device' | 'search').
 * A newer request, `cancel()`, or unmounting makes an older answer arrive to nothing, so a
 * late reply never overwrites a place picked since.
 *
 * `status` is { kind: 'idle' | 'busy' | 'error', text } for a live message under the control;
 * `busy` is 'locate' | 'lookup' | null.
 */
export default function usePlaceFinder({ cities, onPlace }) {
  const [status, setStatus] = useState(IDLE);
  const [busy, setBusy] = useState(null);
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

  const resolve = useCallback((place, { school = false } = {}) => {
    const list = citiesRef.current;
    const named = place.cityId ? list.find((c) => c.cityId === place.cityId) : null;
    const near = named ? { city: named } : nearestCity(list, place);
    setBusy(null);
    setStatus(IDLE);
    if (!near || !onPlaceRef.current) return;
    const source = place.kind === 'city' ? 'hall' : place.kind === 'current' ? 'device' : 'search';
    onPlaceRef.current({ place, city: near.city, school, location: { lat: place.lat, lng: place.lng }, label: place.label, source });
  }, []);

  const locate = useCallback(() => {
    const id = ++seq.current;
    if (abort.current) abort.current.abort();
    setBusy('locate');
    setStatus({ kind: 'busy', text: t('home.where.finding') });
    currentPosition().then(
      (p) => {
        if (id === seq.current) resolve(placeFromDevice(p));
      },
      (err) => {
        if (id === seq.current) fail(err.message);
      },
    );
  }, [fail, resolve]);

  /** Look up typed text (an address, ZIP code, school or a city's name). Runs only when asked. */
  const lookup = useCallback(
    async (raw) => {
      const text = String(raw || '').trim();
      const id = ++seq.current;
      if (abort.current) abort.current.abort();
      if (text.length < 2) return fail(t('home.where.typePlace'));
      const controller = typeof AbortController === 'function' ? new AbortController() : null;
      abort.current = controller;
      setBusy('lookup');
      setStatus({ kind: 'busy', text: t('home.where.lookingUpPlace', { place: text }) });
      try {
        const r = await lookupPlace(text, { cities: citiesRef.current, signal: controller ? controller.signal : undefined });
        if (id !== seq.current) return undefined;
        const place = placeFromLookup(r);
        if (!place) return fail(t('home.where.errors.placeOutside', { place: r.label || text }));
        resolve(place, { school: Boolean(r.school) });
      } catch (err) {
        if (id !== seq.current || (err && err.code === 'aborted')) return undefined;
        fail(lookupError(err, text));
      }
      return undefined;
    },
    [fail, resolve],
  );

  /** A covered city picked from the list: distances from its city hall. */
  const pickCity = useCallback(
    (city) => {
      seq.current += 1;
      if (abort.current) abort.current.abort();
      const place = placeFromCity(city);
      if (place && cityPoint(city)) resolve(place);
    },
    [resolve],
  );

  const showError = useCallback((text) => fail(text), [fail]);

  return { status, busy, locate, lookup, pickCity, cancel, showError };
}
