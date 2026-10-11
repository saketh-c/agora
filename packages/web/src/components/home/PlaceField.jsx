import { useEffect, useId, useRef, useState } from 'react';
import { cityPoint, t, tn } from '@agora/core';
import { apiAvailable } from '../../lib/api.js';
import { CityPicker, Icon, matchCities } from '../ui/index.js';
import usePlaceFinder, { ZIP_RE } from './usePlaceFinder.js';

const fold = (s) =>
  String(s || '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .trim();

/** A city record as a place: distances measure from its city hall. */
export function cityPlace(city) {
  return { city, location: cityPoint(city), label: city.name, source: 'hall' };
}

/**
 * "Where do you live or go to school?": a type-ahead over the covered cities, "Use my
 * location", and a ZIP code lookup when this build has an API (never on the static deploy).
 *
 * variant="ask"    the first-visit card: the question as a heading, "Find my meetings",
 *                  then the city count and the ZIP switch.
 * variant="sheet"  inside the setup sheet: a form label, a help line (`help`), and quiet
 *                  "Use my location" / ZIP controls under the field.
 *
 * `onPlace({ city, location, label, source })` gets the chosen place; source is 'hall' (a city
 * picked from the list), 'device' (browser location) or 'search' (a ZIP code).
 */
export default function PlaceField({ cities, value, onPlace, variant = 'ask', help, autoFocus = false }) {
  const uid = useId().replace(/[^a-zA-Z0-9_-]/g, '');
  const inputId = `place-${uid}`;
  const msgId = `place-msg-${uid}`;
  const [mode, setMode] = useState('city'); // 'city' | 'zip'
  const [typed, setTyped] = useState('');
  const [zip, setZip] = useState('');
  const inputRef = useRef(null);
  const zipRef = useRef(null);
  const finder = usePlaceFinder({ cities, onPlace });
  const { status, busy } = finder;
  const error = status.kind === 'error';
  const ask = variant === 'ask';

  const pickCity = (city) => {
    finder.cancel();
    if (onPlace) onPlace(cityPlace(city));
  };

  const focusInput = () => {
    const el = mode === 'zip' ? zipRef.current : inputRef.current;
    if (el) el.focus();
  };

  const submit = (e) => {
    if (e) e.preventDefault();
    if (mode === 'zip') return finder.lookupZip(zip);
    const text = typed.trim();
    if (!text) {
      finder.showError(t('home.where.typeCity'));
      return focusInput();
    }
    if (ZIP_RE.test(text) && apiAvailable) return finder.lookupZip(text);
    const matches = matchCities(cities, text, 40);
    const exact = matches.find((c) => fold(c.name) === fold(text));
    if (exact || matches.length === 1) return pickCity(exact || matches[0]);
    finder.showError(matches.length ? t('home.where.pickCity') : t('ui.cityPicker.none', { n: cities.length }));
    return focusInput();
  };

  // After switching between city and ZIP, the cursor goes into the field that replaced the old one.
  const focusAfterSwitch = useRef(false);
  useEffect(() => {
    if (!focusAfterSwitch.current) return;
    focusAfterSwitch.current = false;
    const el = mode === 'zip' ? zipRef.current : inputRef.current;
    if (el) el.focus();
  }, [mode, inputRef]);

  const switchMode = () => {
    finder.cancel();
    focusAfterSwitch.current = true;
    setMode(mode === 'city' ? 'zip' : 'city');
  };

  const zipInput = (
    <div className="search">
      <Icon name="pin" />
      <input
        ref={zipRef}
        id={inputId}
        type="text"
        inputMode="numeric"
        autoComplete="postal-code"
        pattern="[0-9]*"
        maxLength={5}
        enterKeyHint="go"
        placeholder={t('home.where.zipPlaceholder')}
        value={zip}
        aria-describedby={msgId}
        aria-invalid={error || undefined}
        onChange={(e) => {
          setZip(e.target.value.replace(/\D/g, '').slice(0, 5));
          if (error) finder.cancel();
        }}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && !ask) {
            e.preventDefault();
            finder.lookupZip(zip);
          }
        }}
      />
    </div>
  );

  const cityInput = (
    <CityPicker
      id={inputId}
      cities={cities}
      value={value}
      inputRef={inputRef}
      autoFocus={autoFocus}
      placeholder={t('home.where.cityPlaceholder')}
      describedBy={msgId}
      onSelect={pickCity}
      onQueryChange={(text) => {
        setTyped(text);
        if (error) finder.cancel();
      }}
    />
  );

  const message = (
    <p id={msgId} className={`place__msg${error ? ' err' : ''}`} aria-live="polite">
      {status.kind === 'busy' && <span className="spinner" aria-hidden="true" />}
      {error && <Icon name="alert" />}
      {status.text}
    </p>
  );

  const locateButton = (
    <button type="button" className={`btn btn--quiet${ask ? '' : ' btn--sm'}`} onClick={finder.locate} aria-busy={busy === 'locate' || undefined} disabled={busy === 'locate'}>
      {busy === 'locate' ? <span className="spinner" aria-hidden="true" /> : <Icon name="locate" size={20} />}
      {t('home.where.useLocation')}
    </button>
  );

  const zipSwitch = apiAvailable ? (
    <button type="button" className="link place__switch" onClick={switchMode}>
      {mode === 'city' ? t('home.where.useZip') : t('home.where.useCity')}
    </button>
  ) : null;

  if (ask) {
    return (
      <form className="ask" onSubmit={submit} noValidate>
        <label className="ask__q t-heading" htmlFor={inputId}>
          {mode === 'zip' ? t('home.where.zipQuestion') : t('home.where.question')}
        </label>
        {mode === 'zip' ? zipInput : cityInput}
        {message}
        <div className="btn-row ask__do">
          <button type="submit" className="btn btn--primary" aria-busy={busy === 'zip' || undefined}>
            {busy === 'zip' && <span className="spinner" aria-hidden="true" />}
            {t('home.where.find')}
          </button>
          {locateButton}
        </div>
        <p className="ask__alt">
          {tn('home.where.cities', cities.length)} {zipSwitch}
        </p>
      </form>
    );
  }

  return (
    <div className="place">
      <label className="label" htmlFor={inputId}>
        {mode === 'zip' ? t('home.where.zipQuestion') : t('home.where.question')}
      </label>
      {mode === 'zip' ? (
        <div className="place__zip">
          {zipInput}
          <button type="button" className="btn btn--secondary" onClick={() => finder.lookupZip(zip)} aria-busy={busy === 'zip' || undefined}>
            {busy === 'zip' && <span className="spinner" aria-hidden="true" />}
            {t('home.where.lookUp')}
          </button>
        </div>
      ) : (
        cityInput
      )}
      {message}
      {help && status.kind === 'idle' && <p className="help">{help}</p>}
      <div className="place__alt">
        {locateButton}
        {zipSwitch}
      </div>
    </div>
  );
}
