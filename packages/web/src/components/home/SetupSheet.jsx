import { useEffect, useId, useRef, useState } from 'react';
import { cityPoint, haversineMiles, t } from '@agora/core';
import { useCities } from '../../lib/DataProvider.jsx';
import { useStore } from '../../lib/store.jsx';
import { Chip, Icon, Segmented, Sheet } from '../ui/index.js';
import { milesChoices } from '../../lib/distance.js';
import PlaceField from './PlaceField.jsx';
import TopicPicker from './TopicPicker.jsx';

const TIMES = ['evenings', 'daytime', 'weekends'];

/**
 * Where distances are measured from, in words. Older saved setups have no `locationSource`:
 * a location at the home city's hall reads as the hall, anything else by its saved label.
 */
export function originText(prefs, city) {
  if (!prefs.location) return '';
  const source = prefs.locationSource;
  if (source === 'device') return city ? t('home.setup.fromDevice', { city: city.name }) : t('home.setup.fromDeviceOnly');
  if (source === 'search' && prefs.locationLabel) return t('home.setup.fromPlace', { place: prefs.locationLabel });
  const atHall = city && haversineMiles(prefs.location, cityPoint(city)) < 0.3;
  if (city && (source === 'hall' || atHall || !prefs.locationLabel)) return t('home.setup.fromHall', { city: city.name });
  return prefs.locationLabel ? t('home.setup.fromPlace', { place: prefs.locationLabel }) : '';
}

/**
 * "Your city, topics and times": one sheet that edits every setup answer. It works on a draft
 * and saves on "Save", so closing it changes nothing. Opened by /?setup=1 (the Profile menu,
 * the old /start link) and by Home's own "Change" links.
 */
export default function SetupSheet({ open, onClose, onSaved }) {
  const { prefs, profile, setPrefs, completeSetup } = useStore();
  const { cities, cityById } = useCities();
  const [draft, setDraft] = useState(prefs);
  const [timeError, setTimeError] = useState(false);
  const timesRef = useRef(null);
  const uid = useId().replace(/[^a-zA-Z0-9_-]/g, '');

  // A fresh draft every time the sheet opens, and if another tab switches the active profile.
  useEffect(() => {
    if (open) {
      setDraft(prefs);
      setTimeError(false);
    }
    // prefs is read only at those moments on purpose: edits stay in the draft until Save.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, profile.id]);

  const city = draft.homeCityId ? cityById(draft.homeCityId) : null;
  const patch = (p) => setDraft((d) => ({ ...d, ...p }));

  const setPlace = (place) =>
    patch({ homeCityId: place.city.cityId, location: place.location, locationLabel: place.label || '', locationSource: place.source });

  const toggleTime = (key) => {
    const availability = { ...draft.availability, [key]: !draft.availability[key] };
    patch({ availability });
    if (TIMES.some((k) => availability[k])) setTimeError(false);
  };

  const save = () => {
    if (!TIMES.some((k) => draft.availability[k])) {
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

  const miles = milesChoices(Number(draft.maxMiles) || 15);
  const timeLabels = {
    evenings: t('home.setup.evenings'),
    daytime: t('home.setup.daytime'),
    weekends: t('home.setup.weekends'),
  };

  return (
    <Sheet
      open={open}
      onClose={onClose}
      title={t('shell.profile.setup')}
      footer={
        <button type="button" className="btn btn--primary btn--block" onClick={save}>
          {t('home.setup.save')}
        </button>
      }
    >
      <div className="setup" key={profile.id}>
        <PlaceField variant="sheet" cities={cities} value={draft.homeCityId} onPlace={setPlace} help={originText(draft, city)} />

        <fieldset className="setup__group">
          <legend className="label">
            {t('home.setup.topics')} <span className="opt">{t('home.setup.optional')}</span>
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

        <div className="setup__group">
          <p className="label" aria-hidden="true">
            {t('home.setup.distance')}
          </p>
          <Segmented
            block
            label={t('home.setup.distance')}
            value={Number(draft.maxMiles) || 15}
            onChange={(maxMiles) => patch({ maxMiles })}
            options={miles.map((n) => ({ value: n, label: t('ui.milesShort', { n }) }))}
          />
        </div>

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
