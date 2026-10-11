import { useMemo } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { calendarThrough, cityPoint, describeRecurrence, haversineMiles, nextMeetingFor, normalizePrefs, t, tn } from '@agora/core';
import { cityMatches, fold } from '../lib/cityMatch.js';
import useClock from '../components/home/useClock.js';
import { useSkipLink } from '../components/shell/PageMeta.jsx';
import { useCities } from '../lib/DataProvider.jsx';
import { useStore } from '../lib/store.jsx';
import CityEmblem from '../components/CityEmblem.jsx';
import { Chip, distanceText, EmptyState, Icon, Menu, PageHeader, whenText } from '../components/ui/index.js';
// The list bar and sort button are shared with Meetings, so this page loads its styles too.
import '../styles/pages/meetings.css';
import '../styles/pages/cities.css';

/** The meeting rule that produced an occurrence, so the schedule line describes the meeting shown above it. */
function ruleFor(city, occurrence) {
  const rules = city.meetings || [];
  return (occurrence && rules.find((r) => r.label === occurrence.label)) || rules.find((r) => r.openToPublicComment !== false) || rules[0] || null;
}

export default function Cities() {
  const { prefs, lang } = useStore();
  const { cities } = useCities();
  const [params, setParams] = useSearchParams();
  // The next meeting moves on when one ends, also in a tab left open.
  const { today, now } = useClock();
  useSkipLink('cities-list', t('shell.skip.results'));
  const P = useMemo(() => normalizePrefs(prefs), [prefs]);

  const q = params.get('q') || '';
  const counties = useMemo(() => [...new Set(cities.map((c) => c.county))].sort(), [cities]);
  const picked = (params.get('county') || '').split(',').filter((c) => counties.includes(c));
  const sortParam = params.get('sort');
  const sort = sortParam === 'az' || sortParam === 'soon' || (sortParam === 'near' && P.location) ? sortParam : P.location ? 'near' : 'az';

  const set = (key, value) =>
    setParams(
      (prev) => {
        const next = new URLSearchParams(prev);
        if (value) next.set(key, value);
        else next.delete(key);
        return next;
      },
      { replace: true },
    );

  // Per city: the next meeting where the public can speak, the rule it comes from, and how far it is.
  const rows = useMemo(
    () =>
      cities.map((city) => {
        const next = nextMeetingFor(city, today, { publicCommentOnly: true, horizonDays: 90, now });
        const rule = ruleFor(city, next);
        return {
          city,
          next,
          through: next ? null : calendarThrough(city),
          schedule: rule ? describeRecurrence(rule.recurrence) : '',
          miles: P.location ? haversineMiles(P.location, cityPoint(city)) : null,
        };
      }),
    // describeRecurrence speaks the app language.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [cities, today, now, P.location, lang],
  );

  const shown = useMemo(() => {
    const query = fold(q);
    const list = rows.filter((r) => (!query || cityMatches(r.city, query)) && (!picked.length || picked.includes(r.city.county)));
    const when = (r) => (r.next ? `${r.next.date} ${r.next.time}` : '9');
    list.sort((a, b) => {
      if (sort === 'near' && a.miles != null && b.miles != null && a.miles !== b.miles) return a.miles - b.miles;
      if (sort === 'soon' && when(a) !== when(b)) return when(a).localeCompare(when(b));
      return a.city.name.localeCompare(b.city.name);
    });
    return list;
    // picked is derived from the URL on every render; its string is the stable key.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rows, q, picked.join(','), sort]);

  const toggleCounty = (c) => set('county', (picked.includes(c) ? picked.filter((x) => x !== c) : [...picked, c]).join(','));
  const sortLabel = { near: t('cities.sortNear'), az: t('cities.sortAz'), soon: t('cities.sortSoon') };
  const sortItems = [...(P.location ? ['near'] : []), 'az', 'soon'].map((key) => ({ type: 'radio', label: sortLabel[key], checked: sort === key, onSelect: () => set('sort', key) }));

  return (
    <div className="wrap cities">
      <PageHeader title={t('cities.title')} lead={t('cities.lead', { n: cities.length })} crumbs={[{ to: '/meetings', label: t('nav.meetings') }, { label: t('cities.title') }]} />

      <div className="cities__tools">
        <div className={`search${q ? ' search--has-clear' : ''}`}>
          <Icon name="search" />
          <input type="search" value={q} onChange={(e) => set('q', e.target.value)} placeholder={t('cities.searchPlaceholder')} aria-label={t('cities.searchLabel')} enterKeyHint="search" autoComplete="off" />
          {q && (
            <button type="button" className="iconbtn search__clear" aria-label={t('cities.clearSearch')} onClick={() => set('q', '')}>
              <Icon name="x" size={20} />
            </button>
          )}
        </div>
        <div className="chipbar cities__counties" role="group" aria-label={t('cities.countyLabel')}>
          {counties.map((c) => (
            <Chip key={c} pressed={picked.includes(c)} onClick={() => toggleCounty(c)}>
              {t('ui.cityPicker.county', { county: c })}
            </Chip>
          ))}
        </div>
      </div>

      <div className="listbar">
        <Menu
          label={`${t('cities.sort')}: ${sortLabel[sort]}`}
          buttonClassName="sortbtn"
          align="start"
          button={
            <>
              {sortLabel[sort]}
              <Icon name="chev-d" size={20} />
            </>
          }
          items={sortItems}
        />
        <span className="count-l num" role="status" aria-live="polite">
          {tn('cities.count', shown.length)}
        </span>
      </div>

      {shown.length ? (
        <ul className="group cities__list" id="cities-list">
          {shown.map(({ city, next, through, schedule, miles }) => {
            const dist = distanceText({ cityId: city.cityId }, { homeCityId: P.homeCityId, distanceMiles: miles });
            return (
              <li key={city.cityId}>
                <Link className="row crow" to={`/city/${city.cityId}`}>
                  <CityEmblem city={city} size={44} />
                  <span className="row__main">
                    <span className="row__title">
                      <span>{city.name}</span>
                      {dist && <span className="row__dist">{dist}</span>}
                    </span>
                    <span className="row__meta">
                      <span>{t('ui.cityPicker.county', { county: city.county })}</span>
                      {schedule && <span>{schedule}</span>}
                    </span>
                    <span className="row__status">
                      {next ? (
                        <span className="st st--go">
                          <Icon name="mic" />
                          {t('cities.nextSpeak', { when: whenText(next.date, next.time) })}
                        </span>
                      ) : through ? (
                        <span className="st st--plain">
                          <Icon name="cal" />
                          {t('cities.calendarNotPosted', { year: Number(through.slice(0, 4)) + 1 })}
                        </span>
                      ) : (
                        <span className="st st--plain">
                          <Icon name="eye" />
                          {t('cities.noSpeak')}
                        </span>
                      )}
                    </span>
                  </span>
                  <Icon name="chev-r" className="row__chev" />
                </Link>
              </li>
            );
          })}
        </ul>
      ) : (
        <EmptyState
          icon="search"
          title={t('cities.emptyTitle')}
          actions={
            <button
              type="button"
              className="btn btn--primary"
              onClick={() =>
                setParams(
                  (prev) => {
                    const next = new URLSearchParams(prev);
                    next.delete('q');
                    next.delete('county');
                    return next;
                  },
                  { replace: true },
                )
              }
            >
              {t('cities.clearSearch')}
            </button>
          }
        >
          {t('cities.emptyBody', { n: cities.length })}
        </EmptyState>
      )}
    </div>
  );
}
