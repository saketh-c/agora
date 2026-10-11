import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { upcomingMeetings, nextMeetingFor, t, tn } from '@agora/core';
import { useCities } from '../lib/DataProvider.jsx';
import { useStore } from '../lib/store.jsx';
import { today as todayFn, nowIso } from '../lib/data.js';
import { PREP_STEPS } from '../lib/prep.js';
import { usePageTitle } from '../components/shell/PageMeta.jsx';
import {
  Avatar,
  Badge,
  Chip,
  CityPicker,
  DateTile,
  Disclosure,
  EmptyState,
  Icon,
  ICON_NAMES,
  MeetingDetail,
  MeetingDetailBadge,
  MeetingShare,
  MeetingRow,
  MeetingStatus,
  Menu,
  NewsList,
  Notice,
  PageHeader,
  ProgressLights,
  Section,
  Segmented,
  Sheet,
  meetingDeadline,
  whenText,
  councilName,
  canSpeakText,
} from '../components/ui/index.js';
import './ui-gallery.css';

/**
 * /__ui: every shared component in its states, with real city data, for screenshots and
 * review. Not linked from the app. Specimen captions are for the people building the app.
 */

const SWATCHES = [
  ['--floor', '#F2F3F6', 'Floor', 'page'],
  ['--card', '#FFFFFF', 'Card', 'surfaces'],
  ['--well', '#E8EAF0', 'Well', 'tracks, watch-only'],
  ['--hairline', '#D9DCE4', 'Hairline', 'dividers'],
  ['--edge', '#858A99', 'Edge', 'control borders, 3:1'],
  ['--muted', '#61667A', 'Muted', 'tertiary text'],
  ['--slate', '#474C5E', 'Slate', 'secondary text'],
  ['--ink', '#15182B', 'Ink', 'text, primary, focus'],
  ['--go', '#1ED28A', 'Go', 'you can speak (fill)'],
  ['--amber', '#FFBD2E', 'Amber', 'deadlines (fill)'],
  ['--stop', '#D7263F', 'Stop', 'cancelled (fill)'],
  ['--go-ink', '#0A6E49', 'Go ink', 'green text'],
];

const NEWS = [
  { title: 'Plano sets aside $500,000 for a backup generator at Tom Muehlenbeck Recreation Center', link: 'https://example.org/1', sourceName: 'Community Impact', publishedAt: '2026-09-15T15:00:00Z' },
  { title: 'DART leaders brief Garland council on ridership and growth near stations', link: 'https://example.org/2', sourceName: 'KERA News', publishedAt: '2026-09-15T20:00:00Z' },
  { title: 'Lewisville swears in a new class of its Youth Action Council', link: 'https://example.org/3', sourceName: 'The Cross Timbers Gazette', publishedAt: '2026-09-16T12:00:00Z' },
];

function Box({ cap, children, floor = false, className = '' }) {
  return (
    <div className={`cs-box${floor ? ' cs-box--floor' : ''} ${className}`.trim()}>
      {cap && <p className="cs-cap">{cap}</p>}
      {children}
    </div>
  );
}

function Spec({ title, lead, children }) {
  return (
    <section className="cs-sec" aria-label={title}>
      <h2 className="t-heading">{title}</h2>
      {lead && <p className="cs-lead">{lead}</p>}
      {children}
    </section>
  );
}

export default function UiGallery() {
  usePageTitle('Components');
  const { cities, cityById } = useCities();
  const { prefs, lang } = useStore();
  const today = todayFn();
  const now = nowIso();
  const [chips, setChips] = useState({ after: true, speak: true, remote: false });
  const [view, setView] = useState('list');
  const [sheet, setSheet] = useState(null);
  const [selected, setSelected] = useState(null);
  const [picked, setPicked] = useState(null);

  const sample = useMemo(() => {
    const plano = cityById('plano');
    const list = upcomingMeetings(cities, { from: today, days: 30, now });
    const go = (plano && nextMeetingFor(plano, today, { publicCommentOnly: true, now })) || list.find((m) => m.openToPublicComment);
    const watch = list.find((m) => !m.openToPublicComment && m.status !== 'cancelled');
    const watchCity = watch ? cityById(watch.cityId) : null;
    const nextForWatch = watchCity ? nextMeetingFor(watchCity, today, { publicCommentOnly: true, now }) : null;
    const others = list.filter((m) => m.openToPublicComment && m.cityId !== 'plano').slice(0, 3);
    const cancelled = others[2] ? { ...others[2], id: `${others[2].id}:x`, status: 'cancelled', note: 'Cancelled for the holiday. The council meets the following Tuesday instead.', movedTo: others[2].date } : null;
    const during = list.find((m) => m.isSchoolHours && m.openToPublicComment);
    return { go, watch, nextForWatch, others, cancelled, during };
    // lang: labels inside the occurrences are localized.
  }, [cities, cityById, today, now, lang]); // eslint-disable-line react-hooks/exhaustive-deps

  const city = (m) => (m ? cityById(m.cityId) : null);
  const goDeadline = meetingDeadline(sample.go, now);
  const stepLabels = PREP_STEPS.map((id, i) => ({ id, label: t(`ui.prep.steps.${id}`), done: i === 1 }));

  return (
    <div className="wrap">
      <div className="cs-intro">
        <h1 className="t-title">Components</h1>
        <p>Every shared component, in its states, with real data. Phone below 1024px, desktop above.</p>
      </div>

      <Spec title="Color" lead="Ink on Card on Floor. Color is the podium timer light: Go, Amber, Stop.">
        <div className="cs-grid cs-grid--4">
          {SWATCHES.map(([v, hex, name, use]) => (
            <div className="swatch" key={v}>
              <div className="swatch__c" style={{ background: `var(${v})`, color: ['--ink', '--slate', '--muted', '--edge', '--stop', '--go-ink'].includes(v) ? 'var(--card)' : 'var(--ink)', boxShadow: 'inset 0 -1px 0 rgb(21 24 43 / .08)' }}>
                {name}
              </div>
              <div className="swatch__m">
                <strong>{hex}</strong>
                {use}
              </div>
            </div>
          ))}
        </div>
      </Spec>

      <Spec title="Type" lead="Mona Sans at 125% width, weight 800 for display; Public Sans for text. Seven sizes.">
        <Box className="typespec">
          <div>
            <p className="cs-cap">Hero 40/44, 72/76 desktop</p>
            <p className="t-hero">Your turn to speak at city hall.</p>
          </div>
          <div>
            <p className="cs-cap">Title 28/32, 40/44 desktop</p>
            <p className="t-title">Plano City Council</p>
          </div>
          <div>
            <p className="cs-cap">Vietnamese title (taller line for tone marks)</p>
            <p className="t-title" lang="vi">
              Hội đồng Thành phố Plano, lượt của bạn
            </p>
          </div>
          <div>
            <p className="cs-cap">Heading 20/28 bold</p>
            <p className="t-heading">Coming up for you</p>
          </div>
          <div>
            <p className="cs-cap">Body 16/24</p>
            <p className="t-body">Sign up online before 4:00 PM on meeting day. You can&apos;t sign up at the door.</p>
          </div>
          <div>
            <p className="cs-cap">Small 14/20 and caption 12/16</p>
            <p className="t-small slate">Verified Sep 10, 2026 from official city pages.</p>
            <p className="t-caption slate">Sign up</p>
          </div>
        </Box>
      </Spec>

      <Spec title="Brand and icons">
        <div className="cs-grid cs-grid--2">
          <Box cap="Mark and wordmark">
            <div className="cs-states">
              <Link className="brand" to="/" aria-label="Agora home">
                <svg className="brand__mark" viewBox="0 0 28 28" aria-hidden="true" style={{ width: 56, height: 56 }}>
                  <rect className="mark-body" x="2" y="2.5" width="24" height="4.5" rx="1.6" />
                  <rect className="mark-body" x="3.5" y="9" width="4.2" height="15" rx="1.2" />
                  <rect className="mark-body" x="20.3" y="9" width="4.2" height="15" rx="1.2" />
                  <path className="mark-body" d="M9.6 16.2h8.8l-1.15 7.8h-6.5z" />
                  <circle className="mark-head" cx="14" cy="11.6" r="3.1" />
                  <rect className="mark-body" x="1.5" y="24.6" width="25" height="2" rx="1" />
                </svg>
                <span className="brand__word" style={{ fontSize: 44 }}>
                  agora
                </span>
              </Link>
            </div>
          </Box>
          <Box cap={`Icons (${ICON_NAMES.length}), 24px, 2px stroke`}>
            <div className="cs-states" style={{ gap: 12 }}>
              {ICON_NAMES.map((n) => (
                <span key={n} title={n}>
                  <Icon name={n} />
                </span>
              ))}
            </div>
          </Box>
        </div>
      </Spec>

      <Spec title="Buttons" lead="One filled button per region. Secondary is outlined; tertiary is text.">
        <div className="cs-grid cs-grid--2">
          <Box cap="Primary: rest, hover, pressed, focus, disabled">
            <div className="cs-states">
              <button type="button" className="btn btn--primary">Prepare to speak</button>
              <button type="button" className="btn btn--primary force-hover">Hover</button>
              <button type="button" className="btn btn--primary force-press">Pressed</button>
              <button type="button" className="btn btn--primary force-focus">Focus</button>
              <button type="button" className="btn btn--primary" disabled>
                Disabled
              </button>
            </div>
          </Box>
          <Box cap="Secondary, text, danger, small, loading">
            <div className="cs-states">
              <button type="button" className="btn btn--secondary">
                <Icon name="cal-plus" />
                {t('ui.addToCalendar')}
              </button>
              <button type="button" className="btn btn--quiet">
                <Icon name="nav" />
                {t('ui.directions')}
              </button>
              <button type="button" className="btn btn--secondary btn--danger">Delete</button>
              <button type="button" className="btn btn--secondary btn--sm">
                <Icon name="ext" size={20} />
                Open the sign-up form
              </button>
              <button type="button" className="btn btn--primary" aria-busy="true">
                <span className="spinner" aria-hidden="true" />
                Polishing
              </button>
            </div>
          </Box>
          <Box cap="Icon buttons and links">
            <div className="cs-states">
              <button type="button" className="iconbtn" aria-label="Close">
                <Icon name="x" />
              </button>
              <button type="button" className="iconbtn iconbtn--filled" aria-label="Show my location">
                <Icon name="locate" />
              </button>
              <a className="link" href="#buttons">
                Open the agenda
              </a>
              <a className="see" href="#buttons">
                {t('ui.seeAll')}
              </a>
            </div>
          </Box>
          <div className="cs-onfield on-go">
            <p className="cs-cap" style={{ color: 'var(--ink)' }}>
              On the Go field
            </p>
            <div className="cs-states">
              <button type="button" className="btn btn--primary">Continue: Sign up to speak</button>
              <button type="button" className="btn btn--secondary">
                <Icon name="cal-plus" />
                {t('ui.addToCalendar')}
              </button>
            </div>
          </div>
        </div>
      </Spec>

      <Spec title="Chips, segmented control, search, city picker">
        <div className="cs-grid cs-grid--2">
          <Box cap="Filter chips (toggle with aria-pressed), count, menu, disabled">
            <div className="chipwrap">
              <Chip icon="sliders" count={1} aria-haspopup="dialog">
                Filters
              </Chip>
              <Chip menu aria-haspopup="menu">
                Next 2 weeks
              </Chip>
              <Chip pressed={chips.after} onClick={() => setChips((c) => ({ ...c, after: !c.after }))}>
                {t('ui.timing.after')}
              </Chip>
              <Chip pressed={chips.speak} onClick={() => setChips((c) => ({ ...c, speak: !c.speak }))}>
                {t('ui.canSpeak')}
              </Chip>
              <Chip pressed={chips.remote} onClick={() => setChips((c) => ({ ...c, remote: !c.remote }))}>
                Remote OK
              </Chip>
              <Chip disabled>Disabled</Chip>
            </div>
          </Box>
          <Box cap="Segmented (radio group; arrow keys move)">
            <div className="cs-states">
              <Segmented
                label="View"
                value={view}
                onChange={setView}
                options={[
                  { value: 'list', label: 'List', icon: 'list' },
                  { value: 'map', label: 'Map', icon: 'map' },
                ]}
              />
            </div>
          </Box>
          <Box cap="Search">
            <div className="search">
              <Icon name="search" />
              <input type="search" placeholder="Search a city or topic" aria-label="Search meetings" />
            </div>
          </Box>
          <Box cap="City picker (combobox): type, arrows, Enter">
            <CityPicker cities={cities} value={picked} label="Where do you live or go to school?" labelHidden placeholder="Type a city, like Plano" onSelect={(c) => setPicked(c.cityId)} />
            <p className="help" style={{ marginTop: 8 }} role="status">
              {picked ? `Picked: ${cityById(picked).name}` : 'Nothing picked yet.'}
            </p>
          </Box>
        </div>
      </Spec>

      <Spec title="Status: badges, signals, date tiles">
        <div className="cs-grid cs-grid--2">
          <Box cap="Badge tones">
            <div className="badges">
              <Badge tone="go" icon="mic">
                {canSpeakText(city(sample.go))}
              </Badge>
              <Badge tone="amber" icon="clock">
                Sign-up closes Mon, 4:00 PM
              </Badge>
              <Badge tone="amber-soft" icon="clock">
                Closes soon
              </Badge>
              <Badge tone="stop" icon="xc">
                {t('ui.cancelled')}
              </Badge>
              <Badge tone="neutral" icon="moon">
                {t('ui.timing.after')}
              </Badge>
              <Badge tone="ink" icon="check">
                {t('ui.yourCity')}
              </Badge>
              <Badge tone="plain" icon="eye">
                {t('ui.watchOnly')}
              </Badge>
            </div>
          </Box>
          <Box cap="Date tiles: go, watch, stop, amber, quiet, large">
            <div className="cs-states">
              {['go', 'watch', 'stop', 'amber', 'quiet'].map((tone) => (
                <DateTile key={tone} date={today} tone={tone} />
              ))}
              <DateTile date={today} size="lg" />
            </div>
          </Box>
          <Box cap="MeetingStatus, row variant: can speak + timing + deadline; watch only; cancelled">
            <div style={{ display: 'grid', gap: 12 }}>
              <MeetingStatus meeting={sample.go} city={city(sample.go)} deadline={goDeadline} />
              {sample.during && <MeetingStatus meeting={sample.during} city={city(sample.during)} />}
              {sample.watch && <MeetingStatus meeting={sample.watch} city={city(sample.watch)} />}
              {sample.cancelled && <MeetingStatus meeting={sample.cancelled} city={city(sample.cancelled)} />}
            </div>
          </Box>
          <Box cap="MeetingStatus, badges variant with remote">
            <MeetingStatus variant="badges" showRemote meeting={sample.go} city={city(sample.go)} deadline={goDeadline} />
          </Box>
        </div>
      </Spec>

      <Spec title="Meeting rows" lead="Date tile, city, time + type, at most two signals, optional amber deadline. Links or buttons.">
        <div className="cs-grid cs-grid--2">
          <div>
            <p className="cs-cap">Buttons that open the detail (selected row marked)</p>
            <ul className="group">
              {[sample.go, ...sample.others.slice(0, 2), sample.watch, sample.cancelled].filter(Boolean).map((m) => (
                <li key={m.id}>
                  <MeetingRow meeting={m} city={city(m)} homeCityId={prefs.homeCityId || 'plano'} distanceMiles={m.cityId === 'plano' ? null : 2.7 + m.cityName.length / 3} deadline={meetingDeadline(m, now)} selected={selected === m.id} onSelect={(x) => setSelected(x.id)} />
                </li>
              ))}
            </ul>
          </div>
          <div>
            <p className="cs-cap">Links (Home: Coming up for you)</p>
            <Section title="Coming up for you" see={{ to: '/meetings' }}>
              <ul className="group">
                {sample.others.map((m) => (
                  <li key={m.id}>
                    <MeetingRow meeting={m} city={city(m)} to={`/city/${m.cityId}`} distanceMiles={2.7 + m.cityName.length / 4} />
                  </li>
                ))}
              </ul>
            </Section>
          </div>
        </div>
      </Spec>

      <Spec title="Meeting detail" lead="The content of the sheet (phone) and the side panel (desktop Meetings).">
        <div className="cs-grid cs-grid--3">
          <div className="panel">
            <div className="sheet__bar">
              <MeetingDetailBadge meeting={sample.go} homeCityId="plano" />
              <button type="button" className="iconbtn" aria-label={t('common.close')} style={{ margin: '-8px -8px 0 0' }}>
                <Icon name="x" />
              </button>
            </div>
            <div style={{ marginTop: 12 }}>
              <MeetingDetail meeting={sample.go} city={city(sample.go)} today={today} now={now} headingId="md-go" />
            </div>
          </div>
          {sample.watch && (
            <div className="panel">
              <MeetingDetail meeting={sample.watch} city={city(sample.watch)} today={today} now={now} headingId="md-watch" nextSpeakable={sample.nextForWatch} onOpenMeeting={() => setSheet('detail')} />
            </div>
          )}
          {sample.cancelled && (
            <div className="panel">
              <MeetingDetail meeting={sample.cancelled} city={city(sample.cancelled)} today={today} now={now} headingId="md-cancelled" />
            </div>
          )}
        </div>
      </Spec>

      <Spec title="Sheets and menus" lead="Sheets: bottom sheet on phones, dialog or side panel on desktop. Focus is trapped; Escape closes; focus returns.">
        <div className="cs-grid cs-grid--2">
          <Box cap="Open a sheet">
            <div className="btn-row">
              <button type="button" className="btn btn--primary" id="open-detail" onClick={() => setSheet('detail')}>
                Open meeting detail
              </button>
              <button type="button" className="btn btn--secondary" id="open-filters" onClick={() => setSheet('filters')}>
                <Icon name="sliders" />
                Filters
              </button>
              <button type="button" className="btn btn--quiet" id="open-side" onClick={() => setSheet('side')}>
                Side panel
              </button>
            </div>
          </Box>
          <Box cap="Menu button (roving focus, typeahead)">
            <div className="cs-states">
              <Menu
                label="Sort"
                buttonClassName="chip chip--menu"
                align="start"
                button={
                  <>
                    Best for you
                    <Icon name="chev-d" size={20} />
                  </>
                }
                items={[
                  { type: 'radio', label: 'Best for you', checked: true },
                  { type: 'radio', label: 'Soonest', checked: false },
                  { type: 'separator' },
                  { type: 'link', to: '/cities', label: 'Browse all 39 cities', icon: 'book' },
                ]}
              />
            </div>
          </Box>
          <Box cap="Menu, static (as rendered)" floor>
            <div className="menu cs-menu-static" style={{ width: 264 }}>
              <div className="menu__head">
                <Avatar name="Ana" size="lg" />
                <span>
                  <span className="menu__name">Ana</span>
                  <span className="menu__sub">{t('shell.profile.onThisDevice')}</span>
                </span>
              </div>
              <div role="menu" aria-label="Profile">
                <div className="menu__group">{t('shell.profile.switchTo')}</div>
                <button type="button" role="menuitem" className="menu__item">
                  <Icon name="swap" />
                  <span className="menu__label">Debate team</span>
                </button>
                <div role="separator" className="menu__sep" />
                <button type="button" role="menuitem" className="menu__item">
                  <Icon name="sliders" />
                  <span className="menu__label">{t('shell.profile.setup')}</span>
                </button>
                <button type="button" role="menuitemradio" aria-checked="true" className="menu__item">
                  <span className="menu__label" lang="vi">
                    Tiếng Việt
                  </span>
                  <Icon name="check" className="check" />
                </button>
              </div>
            </div>
          </Box>
          <Box cap="Avatars">
            <div className="cs-states">
              <Avatar name="Ana" />
              <Avatar name="Ana" size="lg" />
              <Avatar name="" />
              <Avatar name="Minh" soft />
            </div>
          </Box>
        </div>
      </Spec>

      <Spec title="Page header, sections, cards">
        <Box floor>
          <PageHeader title="Plano City Council" crumbs={[{ to: '/meetings', label: t('nav.meetings') }, { to: '/cities', label: t('shell.titles.cities') }, { label: 'Plano' }]} lead="Mayor John B. Muns and 7 council members, all elected citywide." actions={<Badge tone="ink" icon="check">{t('ui.yourCity')}</Badge>} titleId="cs-ph" />
        </Box>
        <div className="cs-grid cs-grid--2" style={{ marginTop: 16 }}>
          <div className="meetcard">
            <div className="meetcard__top">
              <DateTile date={sample.go.date} size="lg" />
              <div>
                <p className="meetcard__t">{sample.go.label}</p>
                <p className="meetcard__w num">
                  <strong>{whenText(sample.go.date, sample.go.time)}</strong>
                </p>
              </div>
            </div>
            <MeetingStatus variant="badges" showRemote meeting={sample.go} city={city(sample.go)} />
            <div className="btn-row">
              <Link className="btn btn--primary" to={`/prepare?meeting=${encodeURIComponent(sample.go.id)}`}>
                {t('ui.prepareToSpeak')}
              </Link>
              <span className="btn-row btn-row--tight">
                <button type="button" className="btn btn--quiet">
                  <Icon name="cal-plus" />
                  {t('ui.addToCalendar')}
                </button>
              </span>
            </div>
            <p className="meetcard__also">
              <Icon name="eye" />
              <span>Before it, at 5:00 PM: a preliminary open meeting. You can watch, but there is no public comment.</span>
            </p>
          </div>
          <div className="howto">
            <ol>
              <li>
                <div>
                  <strong>Sign up online before 4:00 PM on meeting day.</strong> The form opens at 5:00 PM the Tuesday before.
                  <br />
                  <a className="btn btn--secondary btn--sm" href="#cards">
                    <Icon name="ext" size={20} />
                    Open the sign-up form
                  </a>
                </div>
              </li>
              <li>
                <div>
                  <strong>Pick what you&apos;ll talk about.</strong> An agenda item, or any city topic at the end.
                </div>
              </li>
              <li>
                <div>
                  <strong>Speak for up to 3 minutes, in person.</strong>
                </div>
              </li>
            </ol>
          </div>
          <div className="post">
            <span className="post__kind">
              <Icon name="bulb" />
              Guide, Plano
            </span>
            <p className="post__t">How to find the Plano speaker sign-up before the 4 PM cutoff</p>
            <p className="post__b">Plano does not let you sign up at the door, and the online form closes at 4 PM on meeting day.</p>
            <span className="post__by">
              <Avatar name="Agora" />
              <span>
                <strong>Agora team</strong>
              </span>
            </span>
            <span className="post__foot">
              <span className="st st--plain">
                <Icon name="thumb" />0 found this helpful
              </span>
              <span>Sep 8</span>
            </span>
          </div>
          <div className="card">
            <p className="verified">
              <Icon name="shield" />
              Verified Sep 10, 2026 from official city pages. Confirm the time before you go.
            </p>
          </div>
        </div>
      </Spec>

      <Spec title="The Go field: Your next meeting" lead="The one bold surface per screen.">
        <section className="next" aria-labelledby="cs-next-h">
          <div className="next__top">
            <h3 className="next__label" id="cs-next-h">
              Your next meeting
            </h3>
          </div>
          <div className="next__grid">
            <div className="next__info">
              <p className="next__count">
                <span className="t-hero num">2</span>
                <span className="unit">days</span>
              </p>
              <p className="next__when num">{whenText(sample.go.date, sample.go.time)}</p>
              <p className="next__who">{`${councilName(sample.go)}, ${sample.go.label}`}</p>
              <div className="next__facts">
                <Badge tone="ink" icon="mic">
                  You can speak for 3 minutes
                </Badge>
                <Badge tone="amber" icon="clock">
                  Sign-up closes Mon, 4:00 PM
                </Badge>
              </div>
            </div>
            <div className="next__do">
              <p className="next__prephead">{t('ui.prep.progress', { done: 1, total: 4 })}</p>
              <ProgressLights steps={stepLabels} label={t('ui.prep.progressLabel')} />
              <div className="next__actions">
                <Link className="btn btn--primary" to="/prepare">
                  {t('ui.prep.continue', { step: t('ui.prep.stepsLong.signup') })}
                </Link>
                <button type="button" className="btn btn--secondary">
                  <Icon name="cal-plus" />
                  {t('ui.addToCalendar')}
                </button>
              </div>
            </div>
          </div>
        </section>
      </Spec>

      <Spec title="Steps and the speaking-time ruler">
        <div className="cs-grid cs-grid--2">
          <ol className="steps">
            <li className="step">
              <button type="button" className="step__head" aria-expanded="false">
                <span className="step__num">1</span>
                <span>
                  <span className="step__t">{t('ui.prep.stepsLong.signup')}</span>
                  <span className="step__s">
                    <span className="st st--amber">
                      <Icon name="clock" />
                      Closes Mon, 4:00 PM
                    </span>
                    <span>Online only</span>
                  </span>
                </span>
                <span className="step__state">
                  Not started
                  <Icon name="chev-d" />
                </span>
              </button>
            </li>
            <li className="step is-done is-open">
              <button type="button" className="step__head" aria-expanded="true">
                <span className="step__num">
                  <Icon name="check" />
                  <span className="vh">Done:</span>
                </span>
                <span>
                  <span className="step__t">{t('ui.prep.stepsLong.write')}</span>
                  <span className="step__s">Draft saved Thursday</span>
                </span>
                <span className="step__state">
                  {t('ui.prep.done')}
                  <Icon name="chev-d" />
                </span>
              </button>
              <div className="step__body">
                <p className="slate">The comment builder opens here.</p>
              </div>
            </li>
          </ol>
          <div className="ruler card" role="group" aria-label="Speaking time">
            <div className="ruler__top">
              <p className="ruler__read">
                <span className="t-title num">1:45</span>
                <span className="ruler__of num">of 3:00, 1:15 to spare</span>
              </p>
              <span className="ruler__light">
                <span className="dot" aria-hidden="true" />
                Green light: room to spare
              </span>
            </div>
            <div className="ruler__track" role="img" aria-label="Your draft runs 1:45 against a 3:00 limit.">
              <div className="ruler__zones" aria-hidden="true">
                <span style={{ flex: '0 0 71.43%' }} />
                <span style={{ flex: '0 0 14.29%' }} />
                <span />
              </div>
              <div className="ruler__fill" style={{ width: '50%' }} />
              <div className="ruler__limit" style={{ left: '85.71%' }} aria-hidden="true" />
            </div>
            <div className="ruler__ticks num" aria-hidden="true">
              <span style={{ left: 0 }}>0:00</span>
              <span style={{ left: '28.57%' }}>1:00</span>
              <span style={{ left: '57.14%' }}>2:00</span>
              <span style={{ left: '85.71%' }}>3:00</span>
            </div>
            <p className="ruler__note">Timed at a steady 130 words a minute.</p>
          </div>
        </div>
      </Spec>

      <Spec title="Disclosures, notices, empty states">
        <div className="cs-grid cs-grid--2">
          <div>
            <Disclosure title="Full rules from the city" summary="Public hearings, time limits, and the April 2026 rule change">
              <p className="slate">Public hearing items: the applicant gets 15 minutes plus a 5 minute rebuttal, other speakers 3 minutes each within a 30 minute total.</p>
            </Disclosure>
            <Disclosure title="2nd and 4th Mondays at 7:00 PM" summary="Next 4 meetings" defaultOpen>
              <p className="slate">Open by default.</p>
            </Disclosure>
            <div style={{ marginTop: 16 }}>
              <Disclosure variant="plain" title="How this works">
                Your video never leaves this device. The analysis runs in your browser.
              </Disclosure>
            </div>
          </div>
          <div style={{ display: 'grid', gap: 8, alignContent: 'start' }}>
            <Notice>Agenda posts by the Tuesday before.</Notice>
            <Notice tone="amber" title="Sign-up closes at 4:00 PM.">
              There is no sign-up at the door.
            </Notice>
            <Notice tone="go" title="Saved.">
              Your draft is on this device.
            </Notice>
            <Notice
              tone="stop"
              title={`${t('ui.cancelled')}.`}
              action={
                <a className="link" href="#notices">
                  Check the city calendar
                </a>
              }
            >
              The Nov 3 meeting moved to Tue, Nov 10.
            </Notice>
            <div className="toast" role="status">
              <Icon name="check-f" />
              Copied to your clipboard
              <button type="button" className="btn">
                Undo
              </button>
            </div>
          </div>
          <EmptyState
            icon="cal"
            title="No meetings match these filters"
            actions={
              <>
                <button type="button" className="btn btn--primary">
                  Clear filters
                </button>
                <Link className="btn btn--quiet" to="/cities">
                  Browse all cities
                </Link>
              </>
            }
          >
            Try a longer time range, or turn off After school.
          </EmptyState>
          <EmptyState icon="offline" title="You are offline">
            Headlines need a connection. Meetings and city guides still work.
          </EmptyState>
          <div>
            <p className="cs-cap">Loading rows (skeleton)</p>
            <ul className="group" aria-hidden="true">
              <li>
                <span className="skel skel--row" />
              </li>
              <li>
                <span className="skel skel--row" />
              </li>
            </ul>
          </div>
        </div>
      </Spec>

      <Spec title="Lists: news and link rows">
        <div className="cs-grid cs-grid--2">
          <Section title="In the news" see={{ to: '/news' }}>
            <NewsList items={NEWS} lang={lang} />
          </Section>
          <Section title="Reference">
            <ul className="group">
              {[
                ['bulb', 'Speaking tips', '6 tips, like leading with your name, school, and item number'],
                ['book', "Words you'll hear", 'Consent agenda, public hearing, quorum, and 13 more'],
              ].map(([ic, a, b]) => (
                <li key={a}>
                  <a className="lrow lrow--icon" href="#lists">
                    <span className="lrow__ic">
                      <Icon name={ic} />
                    </span>
                    <span>
                      <span className="lrow__t">{a}</span>
                      <span className="lrow__m">{b}</span>
                    </span>
                    <Icon name="chev-r" />
                  </a>
                </li>
              ))}
            </ul>
          </Section>
        </div>
      </Spec>

      <Spec title="Forms">
        <div className="cs-grid cs-grid--2">
          <Box>
            <div className="field">
              <label className="label" htmlFor="cs-name">
                Your name
              </label>
              <input className="input" id="cs-name" defaultValue="Ana Nguyen" />
            </div>
            <div className="field">
              <label className="label" htmlFor="cs-item">
                Agenda item <span className="opt">(optional)</span>
              </label>
              <input className="input" id="cs-item" placeholder="Comments of Public Interest" />
              <p className="help">Not on the agenda? Plano hears other topics at the end of the first meeting of the month.</p>
            </div>
            <div className="field">
              <label className="label" htmlFor="cs-topic">
                Topic
              </label>
              <select className="select" id="cs-topic" defaultValue="parks">
                <option value="parks">Parks and recreation</option>
                <option value="transit">Buses, trains, and biking</option>
              </select>
            </div>
          </Box>
          <Box>
            <div className="field">
              <label className="label" htmlFor="cs-ask">
                What exactly are you asking for?
              </label>
              <input className="input" id="cs-ask" aria-invalid="true" aria-describedby="cs-ask-err" defaultValue="" />
              <p className="err" id="cs-ask-err">
                <Icon name="alert" />
                Write one clear ask. Start with a verb.
              </p>
            </div>
            <div className="field">
              <label className="label" htmlFor="cs-story">
                Your story, in a sentence or two
              </label>
              <textarea className="textarea" id="cs-story" defaultValue="Last spring, my friends and I wanted to start a free Saturday fitness meetup for teens at Oak Point Park." />
            </div>
            <label className="check-row">
              <input type="checkbox" defaultChecked />
              <span>Bring two copies of your comment for the city secretary</span>
            </label>
            <div className="field">
              <label className="label" htmlFor="cs-dis">
                Disabled
              </label>
              <input className="input" id="cs-dis" disabled defaultValue="Plano" />
            </div>
          </Box>
        </div>
      </Spec>

      <Spec title="Charts and map pins" lead="Chart text stays 12/14px; one accent hue plus grays; a table view for every chart.">
        <div className="cs-grid cs-grid--2">
          <figure className="figure">
            <figcaption>
              <p className="figure__t">Most councils meet after school</p>
              <p className="figure__s">Meetings in the next 30 days that start during school hours</p>
            </figcaption>
            <div className="figure__body">
              <div className="barlist">
                {[
                  ['Dallas', 6, true],
                  ['Fort Worth', 4],
                  ['Denton', 3],
                  ['Plano', 0],
                ].map(([n, v, hi]) => (
                  <div key={n} className={`barlist__row${hi ? ' is-hi' : ''}`}>
                    <span className="barlist__lbl">{n}</span>
                    <span className="barlist__track">
                      <span className="barlist__fill" style={{ display: 'block', width: `${(v / 6) * 100}%` }} />
                    </span>
                    <span className="barlist__val">{v}</span>
                  </div>
                ))}
              </div>
            </div>
            <Disclosure variant="plain" title="Show as a table">
              <table className="chart-table">
                <thead>
                  <tr>
                    <th scope="col">City</th>
                    <th scope="col" className="n">
                      Meetings
                    </th>
                  </tr>
                </thead>
                <tbody>
                  <tr>
                    <td>Dallas</td>
                    <td className="n">6</td>
                  </tr>
                  <tr>
                    <td>Plano</td>
                    <td className="n">0</td>
                  </tr>
                </tbody>
              </table>
            </Disclosure>
          </figure>
          <div>
            <div className="cs-grid cs-grid--2">
              <div className="stat">
                <p className="stat__n num">8 in 10</p>
                <p className="stat__l">council meetings start at 5 PM or later</p>
              </div>
              <div className="stat">
                <p className="stat__n num">{tn('ui.cityPicker.count', cities.length)}</p>
                <p className="stat__l">in Dallas-Fort Worth</p>
              </div>
            </div>
            <div className="cs-pins" style={{ marginTop: 16 }}>
              <span className="pin" title="City hall" />
              <span className="pin pin--go" title="You can speak" />
              <span className="pin pin--watch" title="Watch only" />
              <span className="pin pin--you" title="You" />
              <span className="pin pin--sel" style={{ position: 'relative' }}>
                <Icon name="mic-f" size={20} />
                <span className="pin-label">Plano, Mon 7:00 PM</span>
              </span>
            </div>
          </div>
        </div>
      </Spec>

      <Sheet open={sheet === 'detail'} onClose={() => setSheet(null)} labelledBy="sheet-md-h" barStart={<MeetingDetailBadge meeting={sample.go} homeCityId="plano" />} barEnd={<MeetingShare meeting={sample.go} />}>
        <MeetingDetail meeting={sample.go} city={city(sample.go)} today={today} now={now} headingId="sheet-md-h" />
      </Sheet>
      <Sheet
        open={sheet === 'filters'}
        onClose={() => setSheet(null)}
        title="Filters"
        footer={
          <button type="button" className="btn btn--primary btn--block" onClick={() => setSheet(null)}>
            Show 24 meetings
          </button>
        }
      >
        <fieldset>
          <legend className="label">When</legend>
          <div className="chipwrap">
            <Chip pressed={false}>This week</Chip>
            <Chip pressed>Next 2 weeks</Chip>
            <Chip pressed={false}>Next 30 days</Chip>
          </div>
        </fieldset>
        <fieldset style={{ marginTop: 24 }}>
          <legend className="label">Topics</legend>
          <div className="chipwrap">
            <Chip pressed>Parks and recreation</Chip>
            <Chip pressed={false}>Housing and rent</Chip>
            <Chip pressed={false}>Youth programs</Chip>
          </div>
        </fieldset>
        <label className="check-row" style={{ marginTop: 16 }}>
          <input type="checkbox" />
          <span>Remote comment OK</span>
        </label>
      </Sheet>
      <Sheet open={sheet === 'side'} onClose={() => setSheet(null)} variant="side" title="Side panel">
        <p className="slate">A tall panel on desktop; a bottom sheet on phones.</p>
        <div className="btn-row" style={{ marginTop: 16 }}>
          <button type="button" className="btn btn--secondary" onClick={() => setSheet(null)}>
            Done
          </button>
        </div>
      </Sheet>
    </div>
  );
}
