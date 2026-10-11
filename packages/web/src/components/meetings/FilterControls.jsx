import { useEffect, useRef, useState } from 'react';
import { addDays, isDateStr, t, weekdayNames, weekdayShortNames } from '@agora/core';
import { Chip, CityPicker, Icon } from '../ui/index.js';
import ChoiceChips from './ChoiceChips.jsx';
import { MAX_DAYS_AHEAD, TIMES, WEEK_ORDER, WHEN, fold, mileChoices } from '../../lib/meetingFilters.js';

/**
 * A date field that lets someone type a date one part at a time: what they type stays as typed,
 * and only a whole date inside [min, max] is applied (so "0002" on the way to "2026" never
 * jumps the field back).
 */
function DateField({ id, label, value, min, max, onCommit }) {
  const [text, setText] = useState(value);
  useEffect(() => setText(value), [value]);
  return (
    <div className="field">
      <label className="label" htmlFor={id}>
        {label}
      </label>
      <input
        id={id}
        type="date"
        className="input"
        min={min}
        max={max}
        value={text}
        onChange={(e) => {
          const v = e.target.value;
          setText(v);
          if (isDateStr(v) && v >= min && v <= max) onCommit(v);
        }}
        onBlur={() => setText(value)}
      />
    </div>
  );
}

/**
 * Every Meetings filter, grouped: When (presets or two dates), days of the week, time of day
 * (and After school), where distance is measured from and how far, speaking, topics, and
 * places (counties and cities). Changes apply at once; the same controls are the desktop's
 * inline panel and the phone's sheet.
 *
 * `section` ({ name: 'when' | 'distance' }, a new object each time) scrolls that group into
 * view and focuses its first control when the controls open from a chip ("Pick dates",
 * "Measure from somewhere else").
 */
export default function FilterControls({
  idBase,
  f,
  update,
  today,
  win,
  topics,
  cities,
  counties,
  saved,
  origin,
  savedMiles,
  onNear,
  hereStatus,
  lookup,
  onAddPlace,
  section,
}) {
  const whenRef = useRef(null);
  const distRef = useRef(null);
  const otherRef = useRef(null);
  const nearIsOther = Boolean(f.near) && !['home', 'school', 'here'].includes(f.near);
  const [otherOpen, setOtherOpen] = useState(nearIsOther);
  const shortDays = weekdayShortNames();
  const longDays = weekdayNames();
  const max = addDays(today, MAX_DAYS_AHEAD);

  useEffect(() => {
    if (nearIsOther) setOtherOpen(true);
  }, [nearIsOther]);

  // Opened for one group: bring it into view and put focus on its first control.
  useEffect(() => {
    const name = section && section.name;
    const box = name === 'when' ? whenRef.current : name === 'distance' ? distRef.current : null;
    if (!box) return undefined;
    let raf = 0;
    let tries = 0;
    const reduce = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const go = () => {
      // "Pick dates" switches to custom dates in the same click: wait (a few frames at most)
      // for the date fields, then start in "From".
      const date = name === 'when' ? box.querySelector('input[type="date"]') : null;
      if (name === 'when' && !date && tries++ < 6) {
        raf = requestAnimationFrame(go);
        return;
      }
      box.scrollIntoView({ block: 'start', behavior: reduce ? 'auto' : 'smooth' });
      const target = date || box.querySelector('input:checked') || box.querySelector('input, button');
      if (target) target.focus({ preventScroll: true });
    };
    raf = requestAnimationFrame(go);
    return () => cancelAnimationFrame(raf);
    // Only when a section is asked for.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [section]);

  const pickWhen = (w) => {
    if (w === 'custom') update({ when: 'custom', from: win.from, to: win.to });
    else update({ when: w, from: '', to: '' });
  };
  const setFrom = (v) => update({ when: 'custom', from: v, to: win.to < v ? v : win.to });
  const setTo = (v) => update({ when: 'custom', to: v, from: win.from });
  const toggle = (key, value) => update({ [key]: f[key].includes(value) ? f[key].filter((x) => x !== value) : [...f[key], value] });

  const nearChoice = otherOpen || nearIsOther ? 'other' : f.near || '';
  const nearOptions = [
    ...(saved.home ? [{ value: 'home', label: t('meetings.from.home') }] : []),
    ...(saved.school ? [{ value: 'school', label: t('meetings.from.school') }] : []),
    { value: 'here', label: t('meetings.from.here') },
    { value: 'other', label: t('meetings.from.other') },
  ];
  const chooseNear = (v) => {
    if (v === 'other') {
      setOtherOpen(true);
      requestAnimationFrame(() => otherRef.current && otherRef.current.focus());
      return;
    }
    setOtherOpen(false);
    onNear(v);
  };

  const helpId = `${idBase}-from-help`;
  let fromHelp = null;
  if (hereStatus === 'locating') {
    fromHelp = (
      <p className="help mtg-filters__status" role="status">
        <span className="spinner" aria-hidden="true" /> {t('meetings.from.locating')}
      </p>
    );
  } else if (hereStatus === 'denied' || hereStatus === 'failed') {
    fromHelp = (
      <p className="err" role="alert">
        <Icon name="alert" />
        {t(`meetings.from.${hereStatus}`)}
      </p>
    );
  } else if (origin) {
    fromHelp = <p className="help">{t('meetings.from.measuring', { place: origin.detail || origin.label })}</p>;
  }

  const miles = mileChoices(savedMiles, f.miles);
  const selectedCities = f.cities.map((id) => cities.find((c) => c.cityId === id)).filter(Boolean);

  return (
    <div className="mtg-filters">
      <fieldset ref={whenRef} className="mtg-filters__group">
        <legend className="label">{t('meetings.when.label')}</legend>
        <ChoiceChips name={`${idBase}-when`} value={f.when} onChange={pickWhen} options={[...WHEN, 'custom'].map((w) => ({ value: w, label: t(`meetings.when.${w}`) }))} />
        {f.when === 'custom' && (
          <div className="mtg-dates">
            <DateField id={`${idBase}-from`} label={t('meetings.when.from')} value={win.from} min={today} max={max} onCommit={setFrom} />
            <DateField id={`${idBase}-to`} label={t('meetings.when.to')} value={win.to} min={win.from} max={max} onCommit={setTo} />
            <p className="help mtg-dates__help">{t('meetings.when.rangeHelp')}</p>
          </div>
        )}
      </fieldset>

      <fieldset className="mtg-filters__group">
        <legend className="label">{t('meetings.days.label')}</legend>
        <div className="chipwrap">
          {WEEK_ORDER.map((i) => (
            <Chip key={i} pressed={f.dow.includes(i)} aria-label={longDays[i]} onClick={() => toggle('dow', i)}>
              {shortDays[i]}
            </Chip>
          ))}
        </div>
      </fieldset>

      <fieldset className="mtg-filters__group">
        <legend className="label">{t('meetings.time.label')}</legend>
        <div className="chipwrap">
          {TIMES.map((x) => (
            <Chip key={x} pressed={f.time.includes(x)} onClick={() => toggle('time', x)}>
              {t(`meetings.time.${x}`)}
            </Chip>
          ))}
        </div>
        <p className="help">{t('meetings.time.help')}</p>
        <label className="check-row">
          <input type="checkbox" checked={f.after} onChange={(e) => update({ after: e.target.checked })} />
          <span>{t('meetings.time.afterLong')}</span>
        </label>
      </fieldset>

      <fieldset ref={distRef} className="mtg-filters__group" aria-describedby={helpId}>
        <legend className="label">{t('meetings.from.label')}</legend>
        <ChoiceChips name={`${idBase}-near`} value={nearChoice} onChange={chooseNear} options={nearOptions} />
        {(otherOpen || nearIsOther) && (
          <form
            className="mtg-other"
            onSubmit={(e) => {
              // Enter with no city highlighted: a city typed in full, or a place to look up.
              e.preventDefault();
              const text = otherRef.current ? otherRef.current.value.trim() : '';
              if (!text) return;
              const city = cities.find((c) => fold(c.name) === fold(text) || c.cityId === fold(text));
              if (city) update({ near: city.cityId, pt: null });
              else if (lookup.available) lookup.run(text);
            }}
          >
            <CityPicker
              cities={cities}
              value={nearIsOther && f.near !== 'pt' ? f.near : null}
              label={t('meetings.from.fieldLabel')}
              placeholder={t('meetings.from.placeholder')}
              icon="pin"
              inputRef={otherRef}
              describedBy={`${idBase}-other-help`}
              invalid={lookup.state.status === 'error'}
              onSelect={(city) => update({ near: city.cityId, pt: null })}
              onQueryChange={() => lookup.state.status === 'error' && lookup.reset()}
              lookup={lookup.available ? { label: (text) => t('meetings.from.lookup', { place: text }), onLookup: lookup.run } : undefined}
            />
            <p className="help" id={`${idBase}-other-help`}>
              {lookup.available ? t('meetings.from.otherHelp') : t('meetings.from.otherHelpCity', { n: cities.length })}
            </p>
            {lookup.state.status === 'looking' && (
              <p className="help mtg-filters__status" role="status">
                <span className="spinner" aria-hidden="true" /> {t('meetings.from.looking', { place: lookup.state.query })}
              </p>
            )}
            {lookup.state.status === 'error' && (
              <p className="err" role="alert">
                <Icon name="alert" />
                {lookup.state.message}
              </p>
            )}
            {lookup.available && (
              <button type="submit" className="btn btn--secondary btn--sm mtg-other__go" disabled={lookup.state.status === 'looking'}>
                {t('meetings.from.lookupButton')}
              </button>
            )}
          </form>
        )}
        <div id={helpId}>{fromHelp}</div>
      </fieldset>

      <fieldset className="mtg-filters__group">
        <legend className="label">{t('meetings.distance.label')}</legend>
        {origin ? (
          <ChoiceChips
            name={`${idBase}-miles`}
            value={f.miles == null ? 'any' : f.miles}
            onChange={(v) => update({ miles: v === 'any' ? null : v })}
            options={[...miles.map((n) => ({ value: n, label: t('ui.milesShort', { n }) })), { value: 'any', label: t('meetings.distance.any') }]}
          />
        ) : (
          <p className="help">
            {t('meetings.distance.needsPlace')}{' '}
            <button type="button" className="link" onClick={onAddPlace}>
              {t('meetings.from.addHome')}
            </button>
          </p>
        )}
      </fieldset>

      <fieldset className="mtg-filters__group">
        <legend className="label">{t('meetings.speaking.label')}</legend>
        <label className="check-row">
          <input type="checkbox" checked={f.speak} onChange={(e) => update({ speak: e.target.checked })} />
          <span>{t('meetings.speaking.speakLong')}</span>
        </label>
        <label className="check-row">
          <input type="checkbox" checked={f.remote} onChange={(e) => update({ remote: e.target.checked })} />
          <span>{t('meetings.speaking.remoteLong')}</span>
        </label>
      </fieldset>

      <fieldset className="mtg-filters__group">
        <legend className="label">{t('meetings.topics')}</legend>
        <p className="help">{t('meetings.topicsHelp')}</p>
        <div className="chipwrap">
          {topics.map((tp) => (
            <Chip key={tp.id} pressed={f.topics.includes(tp.id)} onClick={() => toggle('topics', tp.id)}>
              {tp.label}
            </Chip>
          ))}
        </div>
      </fieldset>

      <fieldset className="mtg-filters__group">
        <legend className="label">{t('meetings.where.label')}</legend>
        <div className="chipwrap">
          {counties.map((c) => (
            <Chip key={c.key} pressed={f.counties.includes(c.key)} onClick={() => toggle('counties', c.key)}>
              {t('meetings.where.county', { county: c.name })}
            </Chip>
          ))}
        </div>
        <CityPicker
          key={f.cities.join(',')}
          className="mtg-addcity"
          cities={cities.filter((c) => !f.cities.includes(c.cityId))}
          value={null}
          label={t('meetings.where.cities')}
          placeholder={t('meetings.where.citiesPlaceholder')}
          icon="plus"
          onSelect={(city) => update({ cities: [...f.cities, city.cityId] })}
        />
        {selectedCities.length > 0 && (
          <ul className="chipwrap mtg-picked">
            {selectedCities.map((c) => (
              <li key={c.cityId}>
                <button type="button" className="chip is-on mtg-x" aria-label={t('meetings.remove', { filter: c.name })} onClick={() => update({ cities: f.cities.filter((x) => x !== c.cityId) })}>
                  {c.name}
                  <Icon name="x" size={20} />
                </button>
              </li>
            ))}
          </ul>
        )}
      </fieldset>
    </div>
  );
}
