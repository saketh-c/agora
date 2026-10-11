import { useEffect, useId, useMemo, useRef, useState } from 'react';
import { useLocation } from 'react-router-dom';
import { normalizePrefs, t, sentenceGap } from '@agora/core';
import { useCities } from '../../lib/DataProvider.jsx';
import { useStore } from '../../lib/store.jsx';
import { Chip, Icon, Segmented, Sheet } from '../ui/index.js';
import { milesChoices } from '../../lib/distance.js';
import { activeOrigin, placeFromDevice, placeName, placesOf, withPlaces } from '../../lib/places.js';
import PlaceField, { PlacePrivacy } from './PlaceField.jsx';
import TopicPicker from './TopicPicker.jsx';
import { currentPosition } from './usePlaceFinder.js';

const TIMES = ['evenings', 'daytime', 'weekends'];
const ANY = 'any';

/**
 * Where distances are measured from, in words: "Distances from Plano East Senior High School,
 * Plano." Older saved setups (prefs.location only) read as their Home. `city` is the home
 * city's record, when there is one.
 */
export function originText(prefs, city) {
  if (!prefs || !prefs.location) return '';
  const o = activeOrigin(prefs, (id) => (city && city.cityId === id ? city : null));
  if (!o) return '';
  const { id, place } = o;
  if (id === 'here') return t('home.setup.fromHere');
  if (place.kind === 'current') return city ? t('home.setup.fromDevice', { city: city.name }) : t('home.setup.fromDeviceOnly');
  if (place.kind === 'city') return t('home.setup.fromHall', { city: place.label });
  return place.label ? t('home.setup.fromPlace', { place: place.label }) : '';
}

/** Compare what Save would store, so closing with no real change never asks. */
const snapshot = (p) => JSON.stringify(normalizePrefs(p));

/** One saved place as a row: icon, name, what it is, and Change (plus Remove for School). */
function PlaceRow({ slot, place, onEdit, onRemove, editRef }) {
  const title = t(`home.places.${slot}`);
  const empty = slot === 'home' ? t('home.setup.homeEmpty') : t('home.setup.schoolEmpty');
  return (
    <div className={`pslot${place ? '' : ' pslot--empty'}`}>
      <span className="pslot__ic" aria-hidden="true">
        <Icon name={slot === 'home' ? 'home' : 'school'} />
      </span>
      <span className="pslot__txt">
        <span className="pslot__t">
          {title}
          {slot === 'school' && !place && <span className="opt"> {t('home.setup.optional')}</span>}
        </span>
        <span className="pslot__v">{place ? placeName(place) : empty}</span>
      </span>
      <span className="pslot__do">
        <button type="button" ref={editRef} className="btn btn--quiet btn--sm" onClick={onEdit} aria-label={t(`home.setup.${place ? 'change' : 'add'}${slot === 'home' ? 'Home' : 'School'}`)}>
          {place ? t('home.setup.change') : t('home.setup.add')}
        </button>
        {place && onRemove && (
          <button type="button" className="iconbtn pslot__rm" onClick={onRemove} aria-label={t('home.setup.removeSchool')}>
            <Icon name="x" />
          </button>
        )}
      </span>
    </div>
  );
}

/** Single-choice chips (radio group): the distance scale plus "Any distance". */
function DistanceChips({ value, onChange, label }) {
  const name = `miles-${useId().replace(/[^a-zA-Z0-9_-]/g, '')}`;
  const options = [...milesChoices(value).map((n) => ({ value: n, label: t('ui.milesShort', { n }) })), { value: ANY, label: t('home.setup.any') }];
  const current = value == null ? ANY : Number(value);
  return (
    <div className="chipwrap" role="radiogroup" aria-label={label}>
      {options.map((o) => {
        const on = o.value === current;
        return (
          <label key={o.value} className={`chip choice${on ? ' is-on' : ''}`}>
            <input type="radio" className="vh" name={name} checked={on} onChange={() => onChange(o.value === ANY ? null : o.value)} />
            {on && <Icon name="check" size={20} />}
            {o.label}
          </label>
        );
      })}
    </div>
  );
}

/**
 * "Your city, topics and times": one sheet that edits every setup answer: Home and School,
 * where distances are measured from, topics, times, how far and two facts about you. It works
 * on a draft and saves on "Save"; closing with unsaved changes asks first. Opened by
 * /?setup=1 (the Profile menu, Home's "Change" links, the old /start link). A link may pass
 * history state { editPlace: 'home' | 'school' } to open that place's field.
 */
export default function SetupSheet({ open, onClose, onSaved }) {
  const { prefs, profile, setPrefs, completeSetup } = useStore();
  const { cities, cityById } = useCities();
  const location = useLocation();
  const [draft, setDraft] = useState(prefs);
  const [editing, setEditing] = useState(null);
  const [timeError, setTimeError] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [here, setHere] = useState({ kind: 'idle', text: '' });
  const timesRef = useRef(null);
  const saveRef = useRef(null);
  const editRefs = { home: useRef(null), school: useRef(null) };
  const refocus = useRef(null);
  const uid = useId().replace(/[^a-zA-Z0-9_-]/g, '');

  // A fresh draft every time the sheet opens, and if another tab switches the active profile.
  useEffect(() => {
    if (open) {
      setDraft(prefs);
      setTimeError(false);
      setConfirming(false);
      setHere({ kind: 'idle', text: '' });
      const wanted = location.state && location.state.editPlace;
      const s = placesOf(prefs, cityById);
      setEditing(wanted === 'home' || wanted === 'school' ? wanted : !s.home && !s.school ? 'home' : null);
    }
    // prefs is read only at those moments on purpose: edits stay in the draft until Save.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, profile.id]);

  // After a place is chosen or editing is cancelled, focus goes back to that row's button.
  useEffect(() => {
    if (editing || !refocus.current) return;
    const el = editRefs[refocus.current] && editRefs[refocus.current].current;
    refocus.current = null;
    if (el) el.focus();
  });

  const places = useMemo(() => placesOf(draft, cityById), [draft, cityById]);
  const council = draft.homeCityId ? cityById(draft.homeCityId) : null;
  const patch = (p) => setDraft((d) => ({ ...d, ...p }));
  const update = (placesPatch) => setDraft((d) => withPlaces(d, placesPatch, cities));
  const dirty = open && snapshot(draft) !== snapshot(prefs);

  const choosePlace = (slot) => ({ place }) => {
    update({ [slot]: place });
    refocus.current = slot;
    setEditing(null);
  };

  const cancelEdit = (slot) => {
    refocus.current = slot;
    setEditing(null);
  };

  const removeSchool = () => {
    update({ school: null });
    refocus.current = 'school';
  };

  const setOrigin = (origin) => {
    if (origin !== 'here') {
      setHere({ kind: 'idle', text: '' });
      update({ origin });
      return;
    }
    setHere({ kind: 'busy', text: t('home.where.finding') });
    currentPosition().then(
      (p) => {
        update({ here: placeFromDevice(p), origin: 'here' });
        setHere({ kind: 'idle', text: '' });
      },
      (err) => setHere({ kind: 'error', text: err.message }),
    );
  };

  const toggleTime = (key) => {
    const availability = { ...draft.availability, [key]: !draft.availability[key] };
    patch({ availability });
    if (TIMES.some((k) => availability[k])) setTimeError(false);
  };

  const save = () => {
    if (!TIMES.some((k) => draft.availability[k])) {
      setConfirming(false);
      setTimeError(true);
      const first = timesRef.current && timesRef.current.querySelector('button');
      if (first) first.focus();
      return;
    }
    if (draft.homeCityId || draft.location) completeSetup(draft);
    else setPrefs(draft);
    if (onSaved) onSaved();
    onClose();
  };

  /** Close, unless there are unsaved changes: then ask once (a second close discards them). */
  const requestClose = () => {
    if (dirty && !confirming) {
      setConfirming(true);
      requestAnimationFrame(() => saveRef.current && saveRef.current.focus());
      return;
    }
    onClose();
  };

  const timeLabels = {
    evenings: t('home.setup.evenings'),
    daytime: t('home.setup.daytime'),
    weekends: t('home.setup.weekends'),
  };

  const originOptions = [
    places.home && { value: 'home', label: t('home.places.home'), icon: 'home' },
    places.school && { value: 'school', label: t('home.places.school'), icon: 'school' },
    { value: 'here', label: t('home.places.hereShort'), icon: 'locate' },
  ].filter(Boolean);

  const footer = confirming ? (
    <div className="setup__confirm" role="alert">
      <p className="setup__ask">{t('home.setup.unsaved')}</p>
      <div className="btn-row">
        <button type="button" ref={saveRef} className="btn btn--primary" onClick={save}>
          {t('home.setup.save')}
        </button>
        <button type="button" className="btn btn--quiet" onClick={onClose}>
          {t('home.setup.discard')}
        </button>
      </div>
    </div>
  ) : (
    <button type="button" ref={saveRef} className="btn btn--primary btn--block" onClick={save}>
      {t('home.setup.save')}
    </button>
  );

  const slotField = (slot) =>
    editing === slot ? (
      <PlaceField
        key={slot}
        variant="sheet"
        cities={cities}
        label={t(`home.setup.${slot}Label`)}
        autoFocus
        onPlace={choosePlace(slot)}
        onCancel={places[slot] || slot === 'school' ? () => cancelEdit(slot) : undefined}
      />
    ) : (
      <PlaceRow slot={slot} place={places[slot]} editRef={editRefs[slot]} onEdit={() => setEditing(slot)} onRemove={slot === 'school' ? removeSchool : undefined} />
    );

  return (
    <Sheet open={open} onClose={requestClose} title={t('shell.profile.setup')} footer={footer}>
      <div className="setup" key={profile.id}>
        <fieldset className="setup__group">
          <legend className="label">{t('home.setup.places')}</legend>
          <div className="pslots">
            {slotField('home')}
            {slotField('school')}
          </div>
          {council && !editing && <p className="help setup__council">{t('home.setup.council', { city: council.name })}</p>}
          <PlacePrivacy />
        </fieldset>

        {(places.home || places.school) && (
          <div className="setup__group">
            <p className="label" aria-hidden="true">
              {t('home.places.switchLabel')}
            </p>
            <Segmented block label={t('home.places.switchLabel')} value={places.origin} onChange={setOrigin} options={originOptions} className="setup__from" />
            <p className={`place__msg${here.kind === 'error' ? ' err' : ''}`} aria-live="polite">
              {here.kind === 'busy' && <span className="spinner" aria-hidden="true" />}
              {here.kind === 'error' && <Icon name="alert" />}
              {here.text}
            </p>
            {here.kind === 'idle' && <p className="help">{originText(draft, council)}</p>}
          </div>
        )}

        <fieldset className="setup__group">
          <legend className="label">
            {t('home.setup.topics')}
            {sentenceGap(t('home.setup.topics'), t('home.setup.optional'))}
            <span className="opt">{t('home.setup.optional')}</span>
          </legend>
          <TopicPicker all value={draft.interests} onChange={(interests) => patch({ interests })} label={t('home.setup.topics')} />
        </fieldset>

        <fieldset className="setup__group" aria-describedby={timeError ? `times-err-${uid}` : undefined}>
          <legend className="label">{t('home.setup.when')}</legend>
          <div className="chipwrap" ref={timesRef}>
            {TIMES.map((key) => (
              <Chip key={key} pressed={Boolean(draft.availability[key])} onClick={() => toggleTime(key)}>
                {timeLabels[key]}
              </Chip>
            ))}
          </div>
          {timeError && (
            <p className="err setup__err" id={`times-err-${uid}`} role="alert">
              <Icon name="alert" />
              {t('home.setup.whenError')}
            </p>
          )}
        </fieldset>

        <fieldset className="setup__group">
          <legend className="label">{t('home.setup.distance')}</legend>
          <DistanceChips value={draft.maxMiles} onChange={(maxMiles) => patch({ maxMiles })} label={t('home.setup.distance')} />
          <p className="help">{draft.maxMiles == null ? t('home.setup.anyHelp') : t('home.setup.distanceHelp')}</p>
        </fieldset>

        <fieldset className="setup__group">
          <legend className="label">{t('home.setup.about')}</legend>
          <label className="check-row">
            <input type="checkbox" checked={draft.student !== false} onChange={(e) => patch({ student: e.target.checked })} />
            <span>
              <span className="check-row__t">{t('home.setup.student')}</span>
              <span className="help">{t('home.setup.studentSub')}</span>
            </span>
          </label>
          <label className="check-row">
            <input type="checkbox" checked={draft.virtualOk !== false} onChange={(e) => patch({ virtualOk: e.target.checked })} />
            <span>
              <span className="check-row__t">{t('home.setup.remote')}</span>
              <span className="help">{t('home.setup.remoteSub')}</span>
            </span>
          </label>
        </fieldset>
      </div>
    </Sheet>
  );
}
