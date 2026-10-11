import { useMemo } from 'react';
import { Link } from 'react-router-dom';
import { computeStats, formatMonthDay, formatTime, getTopic, hourOf, isDateStr, joinList, t, tn, upcomingMeetings, weekdayNames, weekdayShortNames, compareText } from '@agora/core';
import { SCHEDULES_VERIFIED_ON } from '../lib/data.js';
import useClock from '../components/home/useClock.js';
import { useCities } from '../lib/DataProvider.jsx';
import { useStore } from '../lib/store.jsx';
import { BarList, ChartTable, Figure, Heatmap, StatTile } from '../components/charts.jsx';
import { EmptyState, Icon, PageHeader } from '../components/ui/index.js';
import '../styles/pages/data.css';

/** Every number on this page comes from one list: the meetings in the next WINDOW days. */
const WINDOW = 30;
const RECENT_DAYS = 60;
const WEEK_ORDER = [1, 2, 3, 4, 5, 6, 0];

const inTen = (share) => t('insights.inTen', { n: Math.round(share * 10) });

function monthDayYear(dateStr) {
  return isDateStr(String(dateStr || '')) ? formatMonthDay(dateStr, { withYear: true }) : '';
}

/**
 * The data: when and how the councils meet, as a few charts with takeaway titles. Each chart
 * prints its numbers, highlights what is yours in Ink, and has a table view.
 */
export default function Insights() {
  const { prefs, lang } = useStore();
  const { cities, cityById } = useCities();
  // "The next 30 days" moves with the clock, also in a tab left open.
  const { today, now } = useClock();
  const homeCity = prefs.homeCityId ? cityById(prefs.homeCityId) : null;
  const interests = prefs.interests || [];
  const time = (h, m = 0) => formatTime(`${h}:${String(m).padStart(2, '0')}`, lang, { compact: true });

  const stats = useMemo(() => computeStats(cities, { today, days: WINDOW, now }), [cities, today, now]);
  const meetings = useMemo(() => upcomingMeetings(cities, { from: today, days: WINDOW, now }), [cities, today, now]);

  // Start time by weekday, from the same meetings.
  const heat = useMemo(() => {
    const grid = new Map();
    for (const m of meetings) {
      const key = `${m.weekday}:${hourOf(m.time)}`;
      grid.set(key, (grid.get(key) || 0) + 1);
    }
    const days = WEEK_ORDER.filter((wd) => meetings.some((m) => m.weekday === wd));
    const hours = meetings.map((m) => hourOf(m.time));
    const from = hours.length ? Math.min(...hours) : 17;
    const to = hours.length ? Math.max(...hours) : 19;
    let peak = null;
    for (const [key, n] of grid) if (!peak || n > peak.n) peak = { key, n };
    const [pd, ph] = peak ? peak.key.split(':').map(Number) : [null, null];
    return { grid, days, from, to, peak: peak ? { weekday: pd, hour: ph, n: peak.n } : null, empty: WEEK_ORDER.filter((wd) => !days.includes(wd)) };
  }, [meetings]);

  // Councils that meet while students are in class.
  const school = useMemo(() => {
    const rows = cities.map((c) => {
      const mine = meetings.filter((m) => m.cityId === c.cityId);
      return { city: c, during: mine.filter((m) => m.isSchoolHours).length, other: mine.filter((m) => !m.isSchoolHours).length };
    });
    rows.sort((a, b) => b.during - a.during || compareText(a.city.name, b.city.name, lang));
    return { rows, during: rows.filter((r) => r.during > 0) };
  }, [cities, meetings, lang]);

  // Speaking time per person.
  const limits = useMemo(() => {
    const groups = new Map();
    for (const c of cities) {
      const n = (c.publicComment && c.publicComment.timeLimitMinutes) || 0;
      if (!groups.has(n)) groups.set(n, []);
      groups.get(n).push(c);
    }
    const list = [...groups.entries()].map(([n, list]) => ({ n, cities: list.sort((a, b) => compareText(a.name, b.name, lang)) }));
    list.sort((a, b) => (a.n === 0) - (b.n === 0) || a.n - b.n);
    const mode = [...list].filter((g) => g.n > 0).sort((a, b) => b.cities.length - a.cities.length)[0];
    return { list, mode: mode ? mode.n : 3 };
  }, [cities, lang]);

  // Agenda topics: upcoming when the cities have posted them, otherwise the last 60 days.
  const topics = useMemo(() => {
    const upcoming = stats.upcomingTopicCounts.filter((x) => x.topicId !== 'other');
    const recent = stats.recentTopicCounts.filter((x) => x.topicId !== 'other');
    const useUpcoming = upcoming.reduce((s, x) => s + x.count, 0) >= 10;
    return { upcoming: useUpcoming, rows: (useUpcoming ? upcoming : recent).map((x) => ({ id: x.topicId, label: getTopic(x.topicId).label, value: x.count })) };
    // lang: topic labels are read in the current language.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stats, lang]);

  const dayName = (wd) => weekdayNames()[wd];
  const dayShort = (wd) => weekdayShortNames()[wd];
  const homeLimit = homeCity ? (homeCity.publicComment && homeCity.publicComment.timeLimitMinutes) || 0 : null;
  const homeSchool = homeCity ? school.rows.find((r) => r.city.cityId === homeCity.cityId) : null;

  return (
    <div className="wrap dt">
      <PageHeader title={t('insights.heading')} lead={t('insights.lead', { n: cities.length, days: tn('common.days', WINDOW) })} />

      <div className="dt-stats">
        <StatTile value={stats.totals.meetings} label={t('insights.statMeetings', { n: WINDOW })} />
        <StatTile value={inTen(stats.totals.eveningShare)} label={t('insights.statEvening', { time: time(17) })} />
        <StatTile value={inTen(stats.totals.speakableShare)} label={t('insights.statSpeak')} />
      </div>

      <div className="dt-grid">
        <Figure
          className="dt-fig dt-fig--school"
          title={school.during.length ? tn('insights.schoolTitle', school.during.length, { councils: tn('meetings.councils', cities.length) }) : t('insights.schoolNone')}
          note={t('insights.schoolSub', { n: WINDOW })}
          foot={
            <>
              <span className="dt-cap-line">
                {homeSchool && homeSchool.during === 0
                  ? tn('insights.schoolRestYours', cities.length - school.during.length, { city: homeCity.name })
                  : tn('insights.schoolRest', cities.length - school.during.length)}
              </span>
              <span className="dt-cap-line">{t('insights.schoolDef', { from: time(7, 30), to: time(16) })}</span>
            </>
          }
          table={
            <ChartTable
              caption={t('insights.schoolSub', { n: WINDOW })}
              head={[{ label: t('insights.colCity') }, { label: t('insights.colDuring'), num: true }, { label: t('insights.colOther'), num: true }]}
              rows={school.rows.map((r) => [r.city.name, r.during, r.other])}
            />
          }
        >
          <BarList label={t('insights.schoolSub', { n: WINDOW })} rows={school.during.map((r) => ({ key: r.city.cityId, label: r.city.name, value: r.during, hi: homeCity && r.city.cityId === homeCity.cityId }))} />
        </Figure>

        <Figure
          className="dt-fig dt-fig--heat"
          title={heat.peak ? t('insights.heatTitle', { day: dayName(heat.peak.weekday), time: time(heat.peak.hour) }) : t('insights.heatEmpty')}
          note={t('insights.heatSub', { n: WINDOW })}
          foot={heat.empty.length > 0 && heat.days.length > 0 ? t('insights.heatNone', { days: joinList(heat.empty.map(dayName)) }) : null}
          table={
            <ChartTable
              caption={t('insights.heatSub', { n: WINDOW })}
              head={[{ label: t('insights.colWeekday') }, { label: t('insights.colTime') }, { label: t('insights.colMeetings'), num: true }]}
              rows={[...heat.grid.entries()]
                .map(([key, n]) => ({ wd: Number(key.split(':')[0]), h: Number(key.split(':')[1]), n }))
                .sort((a, b) => WEEK_ORDER.indexOf(a.wd) - WEEK_ORDER.indexOf(b.wd) || a.h - b.h)
                .map((x) => [dayName(x.wd), time(x.h), x.n])}
            />
          }
        >
          {heat.days.length > 0 && (
            <Heatmap
              label={t('insights.heatSub', { n: WINDOW })}
              rowHeader={t('insights.colTime')}
              cols={heat.days.map((wd) => ({ key: wd, label: dayShort(wd) }))}
              rows={Array.from({ length: heat.to - heat.from + 1 }, (_, i) => heat.from + i).map((h) => ({ key: h, label: time(h) }))}
              value={(h, wd) => heat.grid.get(`${wd}:${h}`) || 0}
            />
          )}
        </Figure>

        <Figure
          className="dt-fig dt-fig--limits"
          title={tn('insights.limitTitle', limits.mode)}
          note={t('insights.limitSub')}
          foot={homeCity ? (homeLimit ? tn('insights.limitYours', homeLimit, { city: homeCity.name }) : t('insights.limitYoursNone', { city: homeCity.name })) : null}
          table={
            <ChartTable
              caption={t('insights.limitSub')}
              head={[{ label: t('insights.colLimit') }, { label: t('insights.colCouncils'), num: true }, { label: t('insights.colCities') }]}
              rows={limits.list.map((g) => [g.n ? tn('common.minutes', g.n) : t('insights.limitNone'), g.cities.length, joinList(g.cities.map((c) => c.name))])}
            />
          }
        >
          <BarList
            label={t('insights.limitSub')}
            max={cities.length}
            rows={limits.list.map((g) => ({ key: String(g.n), label: g.n ? tn('common.minutes', g.n) : t('insights.limitNone'), value: g.cities.length, hi: homeLimit !== null ? homeLimit === g.n : g.n === limits.mode }))}
          />
        </Figure>

        <Figure
          className="dt-fig dt-fig--topics"
          title={topics.rows.length ? t(topics.upcoming ? 'insights.topicsTitleUpcoming' : 'insights.topicsTitleRecent', { topic: topics.rows[0].label }) : t('insights.topicsEmptyTitle')}
          note={topics.upcoming ? t('insights.topicsSubUpcoming') : t('insights.topicsSubRecent', { n: RECENT_DAYS })}
          foot={topics.rows.length ? (interests.some((id) => topics.rows.some((r) => r.id === id)) ? t('insights.topicsYours') : t('insights.topicsOverlap')) : null}
          table={
            topics.rows.length ? (
              <ChartTable
                caption={topics.upcoming ? t('insights.topicsSubUpcoming') : t('insights.topicsSubRecent', { n: RECENT_DAYS })}
                head={[{ label: t('insights.colTopic') }, { label: t('insights.colItems'), num: true }]}
                rows={topics.rows.map((r) => [r.label, r.value])}
              />
            ) : null
          }
        >
          {topics.rows.length ? (
            <BarList label={t('insights.colItems')} rows={topics.rows.map((r) => ({ key: r.id, label: r.label, value: r.value, hi: interests.includes(r.id) }))} />
          ) : (
            <EmptyState icon="cal" className="empty--floor" title={t('insights.topicsEmptyTitle')}>
              {t('insights.topicsEmptyBody')}
            </EmptyState>
          )}
        </Figure>
      </div>

      <p className="verified dt-source">
        <Icon name="shield" />
        <span>
          {t('insights.source', { date: monthDayYear(SCHEDULES_VERIFIED_ON) })}{' '}
          <Link className="link" to="/about#data">
            {t('insights.sourceLink')}
          </Link>
        </span>
      </p>
    </div>
  );
}
