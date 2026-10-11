import { DFW_BOUNDS, nextMeetingFor, daysBetween, parseDate, tList, t } from '@agora/core';
import { c, padVisible, visibleLength } from './ui.js';

const LETTERS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz';

/**
 * How soon a city's next meeting is. Each bucket has its own glyph as well as a color, so
 * the map key still means something without color (NO_COLOR, a pipe, colorblind readers).
 */
const BUCKETS = {
  soon: { glyph: '*', color: (s) => c.green(s) },
  week: { glyph: '+', color: (s) => c.yellow(s) },
  later: { glyph: '-', color: (s) => c.blue(s) },
  none: { glyph: '?', color: (s) => c.gray(s) },
};

/** "Oct 13" / "13 de oct" / "13 thg 10": short enough for two legend columns in every language. */
function monthDay(dateStr) {
  const { m, d } = parseDate(dateStr);
  return t('cli.mapDate', { month: tList('format.monthsShort')[m - 1], day: d });
}

function bucketFor(days) {
  if (days == null) return 'none';
  if (days <= 3) return 'soon';
  if (days <= 10) return 'week';
  return 'later';
}

/**
 * One legend entry per city, A to Z by name: its letter, its next meeting where the public
 * can speak (the meetings students can take part in), and how soon that is.
 * @param {object[]} cities
 * @param {{today: string, next?: (city: object) => object | null, gap?: (city: object) => string | null}} opts
 *   `next` finds the meeting (defaults to the engine's next public-comment meeting) and `gap`
 *   names the date a city's published calendar ends when it has none.
 * @returns {Array<{letter: string, cityId: string, name: string, bucket: string, nextMeeting: object | null, calendarThrough: string | null, lat: number, lng: number}>}
 */
export function mapLegend(cities, { today, next, gap } = {}) {
  const find = next || ((city) => nextMeetingFor(city, today, { publicCommentOnly: true }));
  return [...cities]
    .sort((a, b) => a.name.localeCompare(b.name))
    .map((city, i) => {
      const meeting = find(city);
      const days = meeting ? daysBetween(today, meeting.date) : null;
      return {
        letter: LETTERS[i % LETTERS.length],
        cityId: city.cityId,
        name: city.name,
        bucket: bucketFor(days),
        nextMeeting: meeting ? { date: meeting.date, time: meeting.time, label: meeting.label } : null,
        calendarThrough: meeting || !gap ? null : gap(city),
        lat: city.cityHall.lat,
        lng: city.cityHall.lng,
      };
    });
}

/**
 * Draw the DFW cities on a character grid. Each city is a letter, colored by how soon it
 * next meets; a user location renders as '@'. Below the map, a key explains the glyphs and
 * the legend lists every city with the date of its next meeting where you can speak.
 * Lines stay within `maxWidth` columns (the legend drops to one column when two do not fit).
 */
export function renderAsciiMap(cities, { today, you = null, width = 72, height = 24, legend = null, maxWidth = 80 } = {}) {
  const entries = legend || mapLegend(cities, { today });
  const grid = Array.from({ length: height }, () => Array(width).fill(' '));
  const minLng = DFW_BOUNDS.minLng + 0.05;
  const maxLng = DFW_BOUNDS.maxLng - 0.05;
  const minLat = DFW_BOUNDS.minLat + 0.05;
  const maxLat = DFW_BOUNDS.maxLat - 0.15;

  const project = (p) => {
    const col = Math.round(((p.lng - minLng) / (maxLng - minLng)) * (width - 1));
    const row = Math.round(((maxLat - p.lat) / (maxLat - minLat)) * (height - 1));
    return { col: clamp(col, 0, width - 1), row: clamp(row, 0, height - 1) };
  };

  const place = (p, ch) => {
    let { col, row } = project(p);
    let tries = 0;
    while (grid[row][col] !== ' ' && tries < 8) {
      col = Math.min(width - 1, col + 1);
      if (grid[row][col] !== ' ' && tries % 3 === 2) row = Math.min(height - 1, row + 1);
      tries += 1;
    }
    grid[row][col] = ch;
  };

  for (const e of entries) place({ lat: e.lat, lng: e.lng }, BUCKETS[e.bucket].color(e.letter));
  if (you) place(you, c.bold(c.magenta('@')));

  const border = c.gray(`+${'-'.repeat(width)}+`);
  const lines = [c.gray('  N'), border, ...grid.map((row) => c.gray('|') + row.join('') + c.gray('|')), border];

  const keyParts = ['soon', 'week', 'later', 'none'].map((b) => `${BUCKETS[b].color(BUCKETS[b].glyph)} ${t(`cli.mapKey.${b}`)}`);
  if (you) keyParts.push(`${c.magenta('@')} ${t('cli.you')}`);
  const keyLines = [];
  for (const part of keyParts) {
    const last = keyLines.length - 1;
    if (last >= 0 && visibleLength(`${keyLines[last]}   ${part}`) <= maxWidth - 2) keyLines[last] = `${keyLines[last]}   ${part}`;
    else keyLines.push(part);
  }

  const cells = entries.map((e) => {
    const b = BUCKETS[e.bucket];
    const when = e.nextMeeting ? monthDay(e.nextMeeting.date) : e.calendarThrough ? t('cli.calendarEnds', { date: monthDay(e.calendarThrough) }) : t('cli.noneIn90');
    return { head: `${b.color(e.letter)} ${e.name}`, tail: `${b.color(b.glyph)} ${when}` };
  });
  const headWidth = Math.max(...cells.map((x) => visibleLength(x.head)));
  const cellWidth = headWidth + 1 + Math.max(...cells.map((x) => visibleLength(x.tail)));
  const gap = 3;
  const perRow = Math.max(1, Math.min(2, Math.floor((maxWidth - 2 + gap) / (cellWidth + gap))));
  const legendLines = [];
  for (let i = 0; i < cells.length; i += perRow) {
    const row = cells.slice(i, i + perRow).map((x) => padVisible(`${padVisible(x.head, headWidth)} ${x.tail}`, cellWidth));
    legendLines.push(`  ${row.join(' '.repeat(gap))}`.replace(/\s+$/, ''));
  }
  return [...lines, '', ...keyLines.map((l) => `  ${l}`), '', c.bold(t('cli.mapLegendHeading')), ...legendLines].join('\n');
}

function clamp(n, lo, hi) {
  return Math.max(lo, Math.min(hi, n));
}
