import { useId } from 'react';
import { t } from '@agora/core';
import Disclosure from './ui/Disclosure.jsx';

/**
 * Chart pieces for the redesign, following the chart rules in styles/charts.css:
 *  - text is HTML at a fixed 12 or 14px, never inside a scaled SVG viewBox;
 *  - one accent hue (Ink) for what matters to you, grays for everything else;
 *  - direct labels and printed values instead of legends and hover tooltips;
 *  - a table view of the same numbers under every chart.
 *
 * Figure and StatTile keep their older signatures because Practice (timecharts.jsx) and
 * viz.jsx still use them.
 */

/** A big number with a one-line label. */
export function StatTile({ value, label }) {
  return (
    <div className="stat">
      <p className="stat__n num">{value}</p>
      <p className="stat__l">{label}</p>
    </div>
  );
}

/**
 * The frame every chart sits in: a takeaway title (an h2 by default), a one-line subtitle,
 * optional tools on the title row, the chart, a caption, and a table view.
 */
export function Figure({ title, id, note, foot, tools, table, tableTitle, level = 2, className = '', children }) {
  const auto = useId().replace(/[^a-zA-Z0-9_-]/g, '');
  const titleId = id || `fig-${auto}`;
  const H = `h${level}`;
  return (
    <figure className={`figure ${className}`.trim()} aria-labelledby={titleId}>
      <figcaption className="figure__head">
        <span className="figure__text">
          <H className="figure__t" id={titleId}>
            {title}
          </H>
          {note && <span className="figure__s">{note}</span>}
        </span>
        {tools}
      </figcaption>
      <div className="figure__body">{children}</div>
      {foot && <p className="figure__cap">{foot}</p>}
      {table && (
        <Disclosure variant="plain" title={tableTitle || t('insights.showAsTable')} className="figure__table">
          {table}
        </Disclosure>
      )}
    </figure>
  );
}

/**
 * Horizontal bars as HTML rows: label, bar, value. rows: [{ key, label, value, hi, sub }].
 * `hi` rows are Ink (yours); the rest are gray. Bars scale to `max` (default: the largest).
 */
export function BarList({ rows, max, format = (v) => String(v), label }) {
  const top = max || Math.max(1, ...rows.map((r) => r.value));
  return (
    <ul className="barlist" aria-label={label}>
      {rows.map((r) => (
        <li key={r.key || r.label} className={`barlist__row${r.hi ? ' is-hi' : ''}`}>
          <span className="barlist__lbl">
            {r.label}
            {r.sub && <span className="barlist__sub">{r.sub}</span>}
          </span>
          <span className="barlist__track" aria-hidden="true">
            <span className="barlist__fill" style={{ width: `${Math.max(r.value > 0 ? 2 : 0, (r.value / top) * 100)}%` }} />
          </span>
          <span className="barlist__val num">{format(r.value)}</span>
        </li>
      ))}
    </ul>
  );
}

/**
 * Steps of one hue by rank among the distinct non-zero values, so one busy peak does not
 * flatten every other cell into the same color. Returns v -> 0 (empty) .. steps.
 */
export function quantileLevels(values, steps = 4) {
  const distinct = [...new Set(values.filter((v) => v > 0))].sort((a, b) => a - b);
  if (!distinct.length) return () => 0;
  return (v) => {
    if (!(v > 0)) return 0;
    const i = distinct.indexOf(v);
    return Math.min(steps, 1 + Math.floor((Math.max(0, i) * steps) / distinct.length));
  };
}

/**
 * A grid of counts: rows by columns, every non-empty cell printed. rows/cols: [{ key, label }],
 * value(rowKey, colKey) -> number. Used for start time by weekday.
 */
export function Heatmap({ rows, cols, value, rowHeader, label }) {
  const all = [];
  for (const r of rows) for (const c of cols) all.push(value(r.key, c.key));
  const level = quantileLevels(all);
  return (
    <div className="heat" role="img" aria-label={label} style={{ '--heat-cols': cols.length }}>
      <span className="heat__corner" aria-hidden="true">
        {rowHeader}
      </span>
      {cols.map((c) => (
        <span key={c.key} className="heat__col" aria-hidden="true">
          {c.label}
        </span>
      ))}
      {rows.map((r) => (
        <div key={r.key} className="heat__row" aria-hidden="true">
          <span className="heat__lbl">{r.label}</span>
          {cols.map((c) => {
            const v = value(r.key, c.key);
            return (
              <span key={c.key} className={`heat__cell heat__cell--${level(v)}`}>
                {v > 0 ? v : ''}
              </span>
            );
          })}
        </div>
      ))}
    </div>
  );
}

/** A plain table for the table view. head: [{ label, num? }], rows: [[cells]]. */
export function ChartTable({ caption, head, rows }) {
  return (
    <div className="chart-table-wrap">
      <table className="chart-table">
        {caption && <caption className="vh">{caption}</caption>}
        <thead>
          <tr>
            {head.map((h, i) => (
              <th key={i} scope="col" className={h.num ? 'n' : undefined}>
                {h.label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((cells, i) => (
            <tr key={i}>
              {cells.map((c, j) =>
                j === 0 ? (
                  <th key={j} scope="row">
                    {c}
                  </th>
                ) : (
                  <td key={j} className={head[j] && head[j].num ? 'n' : undefined}>
                    {c}
                  </td>
                ),
              )}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
