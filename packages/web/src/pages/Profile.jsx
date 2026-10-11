import { useEffect, useRef, useState } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { LOCALES, t, tn } from '@agora/core';
import { useStore, displayName } from '../lib/store.jsx';
import { useCities } from '../lib/DataProvider.jsx';
import { cleanEmail, NAME_MAX } from '../lib/profiles.js';
import { downloadBlob } from '../lib/download.js';
import { distanceSummary, profileFileName, profileMeta, timesSummary, topicsSummary } from '../lib/setupSummary.js';
import { Avatar, Badge, Disclosure, Icon, Menu, PageHeader, Section, Sheet } from '../components/ui/index.js';
import { SETUP_STATE, setupTo } from '../components/shell/SetupHost.jsx';
import { originText } from '../components/home/SetupSheet.jsx';
import { placeName, placesOf } from '../lib/places.js';
import '../styles/pages/profile.css';

const TOAST_MS = 5000;

/** "Ana" stays "Ana" unless a profile already has that name: then "Ana (2)", "Ana (3)". */
function uniqueName(name, profiles) {
  const taken = new Set(profiles.map((p) => String(p.name || '').toLowerCase()));
  if (!name || !taken.has(name.toLowerCase())) return name;
  for (let n = 2; n < 100; n++) {
    const next = t('profile.copyName', { name, n });
    if (!taken.has(next.toLowerCase())) return next;
  }
  return name;
}

/**
 * Profiles and backup. A profile is a setup saved in this browser (no accounts, no server):
 * each person on a shared device keeps their own city, topics and prep. The export file is
 * the only way to move one, so backup sits right under the list.
 */
export default function Profile() {
  const { profile, profiles, prefs, setupComplete, lang, setLang, switchProfile, createProfile, updateProfile, deleteProfile, exportProfile, importProfile } = useStore();
  const { cityById } = useCities();
  const location = useLocation();
  const [editing, setEditing] = useState(null); // { id } or { id: null } to add
  const [toDelete, setToDelete] = useState(null);
  const [toast, setToast] = useState(null);
  const [importError, setImportError] = useState('');
  const fileRef = useRef(null);

  useEffect(() => {
    if (!toast) return undefined;
    const timer = setTimeout(() => setToast(null), TOAST_MS);
    return () => clearTimeout(timer);
  }, [toast]);
  const say = (text) => setToast({ text, at: Date.now() });

  const meta = (p) => profileMeta(p, p.prefs && p.prefs.homeCityId ? cityById(p.prefs.homeCityId) : null);

  const download = (p) => {
    const data = exportProfile(p.id);
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    downloadBlob(profileFileName(displayName(p), p.id), blob);
    say(t('profile.exported', { name: displayName(p) }));
  };

  const onFile = async (e) => {
    const file = e.target.files && e.target.files[0];
    e.target.value = '';
    if (!file) return;
    setImportError('');
    try {
      const data = JSON.parse(await file.text());
      // Validate first (it throws on anything that is not an Agora profile), then give a
      // repeated import a name of its own instead of a second identical "Ana".
      if (!data || !data.profile || typeof data.profile !== 'object') throw new Error('bad_file');
      const name = uniqueName(String(data.profile.name || '').trim(), profiles);
      importProfile({ ...data, profile: { ...data.profile, name } });
      say(t('profile.imported', { name: name || t('profile.defaultName') }));
    } catch {
      // Whatever went wrong (not JSON, not a profile), say it in the app's language.
      setImportError(t('profile.importBadFile'));
    }
  };

  const confirmDelete = () => {
    const p = toDelete;
    if (!p) return;
    const name = displayName(p);
    deleteProfile(p.id);
    setToDelete(null);
    say(t('profile.deleted', { name }));
  };

  const editingProfile = editing && editing.id ? profiles.find((p) => p.id === editing.id) : null;

  return (
    <div className="wrap pf">
      <PageHeader title={t('profile.title')} lead={t('profile.lead')}>
        <p className="verified pf-privacy">
          <Icon name="shield" />
          <span>{t('profile.privacy')}</span>
        </p>
        <Disclosure variant="plain" title={t('profile.howTitle')} className="pf-how">
          <p>{t('profile.howBody')}</p>
        </Disclosure>
      </PageHeader>

      <div className="pf-cols">
        <div className="pf-col">
          <SetupSummary
            prefs={prefs}
            complete={setupComplete}
            name={profiles.length > 1 ? displayName(profile) : ''}
            city={prefs.homeCityId ? cityById(prefs.homeCityId) : null}
            places={placesOf(prefs, cityById)}
            lang={lang}
            setLang={setLang}
            setupLink={setupTo(location)}
          />

          <Section title={tn('profile.allTitle', profiles.length)} id="pf-list" className="pf-section">
            <ul className="group pf-list">
              {profiles.map((p) => {
                const active = p.id === profile.id;
                const name = displayName(p);
                return (
                  <li key={p.id} className="pf-row">
                    <Avatar name={p.name} size="lg" soft={!active} />
                    <div className="pf-row__main">
                      <p className="pf-row__name">
                        <span className="pf-row__n">{name}</span>
                        {active && (
                          <Badge tone="ink" icon="check">
                            {t('profile.inUse')}
                          </Badge>
                        )}
                      </p>
                      <p className="pf-row__meta">{meta(p)}</p>
                    </div>
                    <div className="pf-row__act">
                      {!active && (
                        <button
                          type="button"
                          className="btn btn--secondary btn--sm"
                          onClick={() => {
                            switchProfile(p.id);
                            say(t('profile.switched', { name }));
                          }}
                          aria-label={t('profile.switchTo', { name })}
                        >
                          {t('profile.switch')}
                        </button>
                      )}
                      <Menu
                        label={t('profile.moreFor', { name })}
                        buttonClassName="iconbtn"
                        button={<Icon name="dots" />}
                        items={[
                          { type: 'item', key: 'edit', icon: 'pen', label: t('profile.edit'), onSelect: () => setEditing({ id: p.id }) },
                          ...(active ? [{ type: 'link', key: 'setup', icon: 'tune', label: t('shell.profile.setup'), to: setupTo(location), state: SETUP_STATE, refocus: true }] : []),
                          { type: 'item', key: 'export', icon: 'download', label: t('profile.exportOne'), onSelect: () => download(p) },
                          { type: 'separator' },
                          { type: 'item', key: 'delete', icon: 'trash', label: t('profile.delete'), onSelect: () => setToDelete(p) },
                        ]}
                      />
                    </div>
                  </li>
                );
              })}
            </ul>
            <div className="btn-row pf-add">
              <button type="button" className="btn btn--secondary" onClick={() => setEditing({ id: null })} aria-haspopup="dialog">
                <Icon name="plus" size={20} />
                {t('profile.add')}
              </button>
            </div>
          </Section>
        </div>

        <Section title={t('profile.backupTitle')} id="pf-backup" className="pf-section">
          <div className="card pf-backup">
            <p>{t('profile.backupBody')}</p>
            <div className="btn-row">
              <button type="button" className="btn btn--secondary" onClick={() => download(profile)}>
                <Icon name="download" size={20} />
                {t('profile.exportButton', { name: displayName(profile) })}
              </button>
              <button type="button" className="btn btn--quiet" onClick={() => fileRef.current && fileRef.current.click()} aria-describedby={importError ? 'pf-import-err' : undefined}>
                <Icon name="upload" size={20} />
                {t('profile.importButton')}
              </button>
              <input ref={fileRef} type="file" className="vh" tabIndex={-1} aria-hidden="true" accept="application/json,.json" onChange={onFile} />
            </div>
            {importError && (
              <p className="err" id="pf-import-err" role="alert">
                <Icon name="alert" />
                {importError}
              </p>
            )}
          </div>
        </Section>
      </div>

      <ProfileSheet
        open={Boolean(editing)}
        profile={editingProfile}
        onClose={() => setEditing(null)}
        onSave={(values) => {
          if (editingProfile) {
            updateProfile(editingProfile.id, values);
            say(t('profile.saved'));
          } else {
            createProfile(values);
            say(t('profile.added', { name: values.name }));
          }
          setEditing(null);
        }}
      />

      <Sheet
        open={Boolean(toDelete)}
        onClose={() => setToDelete(null)}
        title={toDelete ? t('profile.deleteTitle', { name: displayName(toDelete) }) : ''}
        footer={
          <div className="btn-row pf-sheet-foot">
            <button type="button" className="btn btn--secondary btn--danger" onClick={confirmDelete}>
              <Icon name="trash" size={20} />
              {t('profile.delete')}
            </button>
            <button type="button" className="btn btn--quiet" onClick={() => setToDelete(null)}>
              {t('profile.cancel')}
            </button>
          </div>
        }
      >
        <p>{t('profile.deleteBody')}</p>
        {profiles.length === 1 && <p className="pf-last">{t('profile.deleteLast')}</p>}
      </Sheet>

      <div className="pf-toaster" role="status" aria-live="polite">
        {toast && (
          <div className="toast" key={toast.at}>
            <Icon name="check-f" size={20} />
            <span>{toast.text}</span>
          </div>
        )}
      </div>
    </div>
  );
}

/** Add a profile, or edit one's name and email. Checks the same rules the store applies. */
function ProfileSheet({ open, profile, onClose, onSave }) {
  const [values, setValues] = useState({ name: '', email: '' });
  const [errors, setErrors] = useState({});
  const nameRef = useRef(null);
  const forId = useRef(undefined);
  const key = open ? (profile ? profile.id : 'new') : null;
  if (forId.current !== key) {
    forId.current = key;
    if (open) {
      setValues({ name: profile ? profile.name : '', email: profile ? profile.email : '' });
      setErrors({});
    }
  }

  const submit = (e) => {
    e.preventDefault();
    const name = values.name.trim();
    const email = values.email.trim();
    const next = {};
    if (!name) next.name = t('profile.errors.name');
    if (email && !cleanEmail(email)) next.email = t('profile.errors.email');
    setErrors(next);
    if (next.name || next.email) {
      const first = next.name ? 'pf-name' : 'pf-email';
      document.getElementById(first)?.focus();
      return;
    }
    onSave({ name, email });
  };

  const set = (k) => (e) => {
    setValues((v) => ({ ...v, [k]: e.target.value }));
    if (errors[k]) setErrors((x) => ({ ...x, [k]: '' }));
  };

  return (
    <Sheet
      open={open}
      onClose={onClose}
      title={profile ? t('profile.editTitle') : t('profile.addTitle')}
      initialFocusRef={nameRef}
      footer={
        <div className="btn-row pf-sheet-foot">
          <button type="submit" form="pf-form" className="btn btn--primary">
            {profile ? t('profile.save') : t('profile.addButton')}
          </button>
          <button type="button" className="btn btn--quiet" onClick={onClose}>
            {t('profile.cancel')}
          </button>
        </div>
      }
    >
      <form id="pf-form" className="pf-form" onSubmit={submit} noValidate>
        {!profile && <p className="help">{t('profile.addHelp')}</p>}
        <div className="field">
          <label className="label" htmlFor="pf-name">
            {t('profile.nameLabel')}
          </label>
          <input ref={nameRef} id="pf-name" className="input" value={values.name} onChange={set('name')} maxLength={NAME_MAX} placeholder={t('profile.namePlaceholder')} autoComplete="off" aria-invalid={Boolean(errors.name)} aria-describedby={errors.name ? 'pf-name-err' : undefined} />
          {errors.name && (
            <p className="err" id="pf-name-err">
              <Icon name="alert" />
              {errors.name}
            </p>
          )}
        </div>
        <div className="field">
          <label className="label" htmlFor="pf-email">
            {t('profile.emailLabel')} <span className="opt">{t('profile.optional')}</span>
          </label>
          <input id="pf-email" type="email" className="input" value={values.email} onChange={set('email')} placeholder={t('profile.emailPlaceholder')} autoComplete="email" inputMode="email" aria-invalid={Boolean(errors.email)} aria-describedby={`pf-email-help${errors.email ? ' pf-email-err' : ''}`} />
          <p className="help" id="pf-email-help">
            {t('profile.emailHelp')}
          </p>
          {errors.email && (
            <p className="err" id="pf-email-err">
              <Icon name="alert" />
              {errors.email}
            </p>
          )}
        </div>
      </form>
    </Sheet>
  );
}

/**
 * The profile in use, in words: place, distance, times, topics and language, with one way to
 * change them (the setup sheet, over this page). Language changes right here.
 */
function SetupSummary({ prefs, complete, name, city, places, lang, setLang, setupLink }) {
  const current = LOCALES.find((l) => l.code === lang) || LOCALES[0];
  const title = name ? t('profile.setup.titleFor', { name }) : t('profile.setup.title');
  const home = places.home ? placeName(places.home) : '';
  const rows = [
    {
      key: 'home',
      icon: 'home',
      label: t('profile.setup.home'),
      value: home || t('profile.setup.noPlace'),
      sub: home && city ? t('profile.setup.council', { city: city.name }) : home ? '' : t('profile.setup.notSet'),
      // Without a place nothing can be "near you": the one thing to do is finish setup.
      action: complete ? null : (
        <Link className="btn btn--primary btn--sm pf-set__act" to={setupLink} state={SETUP_STATE}>
          {t('profile.setup.start')}
        </Link>
      ),
    },
    ...(places.school ? [{ key: 'school', icon: 'school', label: t('profile.setup.school'), value: placeName(places.school) }] : []),
    { key: 'distance', icon: 'nav', label: t('profile.setup.distance'), value: distanceSummary(prefs), sub: originText(prefs, city) },
    { key: 'times', icon: 'clock', label: t('profile.setup.times'), value: timesSummary(prefs) },
    { key: 'topics', icon: 'bulb', label: t('profile.setup.topics'), value: topicsSummary(prefs) },
  ];
  return (
    <section className="pf-section pf-setup" aria-labelledby="pf-setup-h">
      <div className="sec-head">
        <h2 className="t-heading" id="pf-setup-h">
          {title}
        </h2>
        {complete && (
          <Link className="see" to={setupLink} state={SETUP_STATE} aria-describedby="pf-setup-h">
            {t('profile.setup.edit')}
          </Link>
        )}
      </div>
      <dl className="group pf-set">
        {rows.map((r) => (
          <div key={r.key} className="pf-set__row">
            <Icon name={r.icon} className="pf-set__ic" />
            <dt className="pf-set__l">{r.label}</dt>
            <dd className="pf-set__v">
              {r.value}
              {r.sub && <span className="pf-set__sub">{r.sub}</span>}
              {r.action}
            </dd>
          </div>
        ))}
        <div className="pf-set__row pf-set__row--lang">
          <Icon name="globe" className="pf-set__ic" />
          <dt className="pf-set__l">{t('profile.setup.language')}</dt>
          <dd className="pf-set__v">
            <Menu
              align="start"
              label={t('shell.languagesButton', { language: current.nativeName })}
              menuLabel={t('shell.languages')}
              buttonClassName="chip chip--menu pf-set__lang"
              button={
                <>
                  <span lang={current.code}>{current.nativeName}</span>
                  <Icon name="chev-d" size={20} />
                </>
              }
              items={LOCALES.map((l) => ({ type: 'radio', key: l.code, label: l.nativeName, lang: l.code, checked: l.code === lang, onSelect: () => setLang(l.code) }))}
            />
          </dd>
        </div>
      </dl>
    </section>
  );
}
