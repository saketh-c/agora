import { useId, useRef, useState } from 'react';
import { t, tn } from '@agora/core';
import { CityPicker, Icon, matchCities } from '../ui/index.js';
import usePlaceFinder from './usePlaceFinder.js';

const fold = (s) =>
  String(s || '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .trim();

const OSM_COPYRIGHT = 'https://www.openstreetmap.org/copyright';

/**
 * "Your places stay on this device." plus the OpenStreetMap credit the address search needs,
 * as fine print. `lead` goes first (the city count on the first-visit card).
 */
export function PlacePrivacy({ lead, className = '' }) {
  return (
    <p className={`place__private ${className}`.trim()}>
      {lead ? `${lead} ` : ''}
      {t('home.where.private')}{' '}
      <a href={OSM_COPYRIGHT} target="_blank" rel="noopener noreferrer">
        {t('home.where.osm')}
        <span className="vh"> {t('ui.opensNewTab')}</span>
      </a>
    </p>
  );
}

/**
 * One field for a place: type a covered city (type-ahead), or a ZIP code, street address or
 * school and look it up (only when submitted), or "Use my exact location".
 *
 * variant="ask"    the first-visit card: the question as a heading, "Find my meetings", the
 *                  city count and the privacy line.
 * variant="sheet"  in the setup sheet: a form label (`label`), an optional help line (`help`),
 *                  "Look up" and "Use my exact location" under the field, and `onCancel`.
 *
 * `onPlace({ place, city, school, location, label, source })` gets the chosen place (see
 * usePlaceFinder). `allowCurrent` hides "Use my exact location" when false.
 */
export default function PlaceField({ cities, value, onPlace, variant = 'ask', label, help, autoFocus = false, onCancel, allowCurrent = true }) {
  const uid = useId().replace(/[^a-zA-Z0-9_-]/g, '');
  const inputId = `place-${uid}`;
  const msgId = `place-msg-${uid}`;
  const [typed, setTyped] = useState('');
  const inputRef = useRef(null);
  const finder = usePlaceFinder({ cities, onPlace });
  const { status, busy } = finder;
  const error = status.kind === 'error';
  const ask = variant === 'ask';

  const focusInput = () => inputRef.current && inputRef.current.focus();

  /** Submit: a covered city by name, else look the text up (an address, ZIP code or school). */
  const submit = (e) => {
    if (e) e.preventDefault();
    const text = typed.trim();
    if (!text) {
      finder.showError(t('home.where.typePlace'));
      return focusInput();
    }
    const matches = matchCities(cities, text, 40);
    const exact = matches.find((c) => fold(c.name) === fold(text) || c.cityId === fold(text));
    if (exact) return finder.pickCity(exact);
    // Words with no number or comma that start a city's name ("fris") mean that city; when
    // several cities fit ("park"), ask which. Anything else is a place to look up.
    if (!/\d/.test(text) && !text.includes(',') && matches.length) {
      if (matches.length === 1) return finder.pickCity(matches[0]);
      finder.showError(t('home.where.pickCity'));
      return focusInput();
    }
    return finder.lookup(text);
  };

  const lookup = {
    label: (q) => t('home.where.lookupRow', { q }),
    hint: t('home.where.lookupHint'),
    noMatch: t('home.where.enterToLookUp'),
    onLookup: (q) => finder.lookup(q),
  };

  const input = (
    <CityPicker
      id={inputId}
      cities={cities}
      value={value}
      inputRef={inputRef}
      autoFocus={autoFocus}
      icon="pin"
      placeholder={t('home.where.placeholder')}
      describedBy={msgId}
      invalid={error}
      lookup={lookup}
      onSelect={finder.pickCity}
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

  const locateButton = allowCurrent ? (
    <button type="button" className={`btn btn--quiet${ask ? '' : ' btn--sm'}`} onClick={finder.locate} aria-busy={busy === 'locate' || undefined} disabled={busy === 'locate'}>
      {busy === 'locate' ? <span className="spinner" aria-hidden="true" /> : <Icon name="locate" size={20} />}
      {t('home.where.useLocation')}
    </button>
  ) : null;

  if (ask) {
    return (
      <form className="ask" onSubmit={submit} noValidate>
        <label className="ask__q t-heading" htmlFor={inputId}>
          {t('home.where.question')}
        </label>
        {input}
        {message}
        <div className="btn-row ask__do">
          <button type="submit" className="btn btn--primary" aria-busy={busy === 'lookup' || undefined}>
            {busy === 'lookup' && <span className="spinner" aria-hidden="true" />}
            {t('home.where.find')}
          </button>
          {locateButton}
        </div>
        <PlacePrivacy className="ask__alt" lead={tn('home.where.cities', cities.length)} />
      </form>
    );
  }

  return (
    <form className="place" onSubmit={submit} noValidate>
      <label className="label" htmlFor={inputId}>
        {label || t('home.where.question')}
      </label>
      <div className="place__row">
        {input}
        <button type="submit" className="btn btn--secondary place__go" aria-busy={busy === 'lookup' || undefined}>
          {busy === 'lookup' && <span className="spinner" aria-hidden="true" />}
          {t('home.where.lookUp')}
        </button>
      </div>
      {message}
      {help && status.kind === 'idle' && <p className="help">{help}</p>}
      <div className="place__alt">
        {locateButton}
        {onCancel && (
          <button type="button" className="btn btn--quiet btn--sm" onClick={onCancel}>
            {t('home.setup.cancel')}
          </button>
        )}
      </div>
    </form>
  );
}
