import { useEffect, useId, useRef, useState } from 'react';
import { t } from '@agora/core';
import { clock, numberText } from '../lib/rehearse/format.js';

/**
 * Practice charts, drawn to the chart rules (styles/charts.css): text is real 12px type
 * (the SVG is sized in CSS pixels, never scaled by a viewBox), one ink line plus grays,
 * direct labels instead of legends, and a table view of the same numbers.
 *
 *   <TimeRuler seconds limitSec />           the podium timer as a ruler
 *   <TimeChart title points xMax band spans/> a line over the take, with a target band
 *   <EyeStrip title cells />                 one cell per second: facing the room or not
 */

/** The amber stretch before the limit: the last 30 seconds, or a quarter of a short limit. */
export function warnSeconds(limitSec) {
  return Math.min(30, Math.round(limitSec / 4));
}

/** 'go' | 'amber' | 'stop' for a time against a limit: the podium light. */
export function lightFor(seconds, limitSec) {
  if (seconds > limitSec) return 'stop';
  if (seconds > limitSec - warnSeconds(limitSec)) return 'amber';
  return 'go';
}

function rulerTicks(limitSec, max) {
  const pct = (s) => (s / max) * 100;
  const marks = [0];
  for (let s = 60; s < limitSec; s += 60) marks.push(s);
  marks.push(limitSec - warnSeconds(limitSec), limitSec);
  const sorted = [...new Set(marks)].sort((a, b) => a - b);
  // Keep 0 and the limit; drop anything that would crowd its neighbor.
  const out = [];
  for (const s of sorted) {
    const prev = out[out.length - 1];
    if (s !== limitSec && s !== 0 && (pct(limitSec) - pct(s) < 9 || (prev !== undefined && pct(s) - pct(prev) < 9))) continue;
    out.push(s);
  }
  return out.map((s) => ({ s, left: pct(s) }));
}

/**
 * Time against the city's limit on the podium ruler: big readout, the light, the track with
 * green, amber and red zones, and the limit marker.
 * `note` is the line under it; `readout={false}` draws the track alone (the live timer has
 * its own giant clock).
 */
export function TimeRuler({ seconds, limitSec, note, label, readout = true, className = '' }) {
  const s = Math.max(0, Math.round(seconds));
  const max = Math.max(limitSec * (7 / 6), s * 1.04);
  const pct = (x) => `${((x / max) * 100).toFixed(2)}%`;
  const light = lightFor(s, limitSec);
  const warn = warnSeconds(limitSec);
  const of = s > limitSec ? t('rehearse.ruler.over', { limit: clock(limitSec), over: clock(s - limitSec) }) : t('rehearse.ruler.spare', { limit: clock(limitSec), left: clock(limitSec - s) });
  return (
    <div className={`ruler ${className}`.trim()} role="group" aria-label={label || t('rehearse.ruler.label')}>
      {readout && (
        <div className="ruler__top">
          <p className="ruler__read">
            <span className="t-title num">{clock(s)}</span>
            <span className="ruler__of num">{of}</span>
          </p>
          <span className={`ruler__light${light === 'go' ? '' : ` ruler__light--${light}`}`}>
            <span className="dot" aria-hidden="true" />
            {t(`rehearse.ruler.light.${light}`)}
          </span>
        </div>
      )}
      <div className="ruler__track" role="img" aria-label={t('rehearse.ruler.aria', { time: clock(s), limit: clock(limitSec) })}>
        <div className="ruler__zones" aria-hidden="true">
          <span style={{ flex: `0 0 ${pct(limitSec - warn)}` }} />
          <span style={{ flex: `0 0 ${pct(warn)}` }} />
          <span />
        </div>
        <div className="ruler__fill" style={{ width: pct(Math.min(s, max)) }} />
        <div className="ruler__limit" style={{ left: pct(limitSec) }} aria-hidden="true" />
      </div>
      <div className="ruler__ticks num" aria-hidden="true">
        {rulerTicks(limitSec, max).map((tick) => (
          <span key={tick.s} style={{ left: `${tick.left.toFixed(2)}%` }}>
            {clock(tick.s)}
          </span>
        ))}
      </div>
      {note && <p className="ruler__note">{note}</p>}
    </div>
  );
}

/** The width of an element in CSS pixels, kept current. */
function useWidth(fallback = 600) {
  const ref = useRef(null);
  const [width, setWidth] = useState(fallback);
  useEffect(() => {
    const el = ref.current;
    if (!el) return undefined;
    const read = () => setWidth(Math.max(200, Math.floor(el.getBoundingClientRect().width)));
    read();
    if (typeof ResizeObserver === 'undefined') return undefined;
    const ro = new ResizeObserver(read);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return [ref, width];
}

function niceTicks(max, count = 4) {
  if (!(max > 0)) return [];
  const mag = Math.pow(10, Math.floor(Math.log10(max / count)));
  const norm = max / count / mag;
  const step = (norm <= 1 ? 1 : norm <= 2 ? 2 : norm <= 2.5 ? 2.5 : norm <= 5 ? 5 : 10) * mag;
  const out = [];
  for (let v = step; v <= max + step * 1e-6; v += step) out.push(Number(v.toPrecision(12)));
  return out;
}

function timeStep(xMax, room) {
  for (const step of [5, 10, 15, 30, 60, 120, 300]) if (xMax / step <= room) return step;
  return 600;
}

/** Title row of a figure, with the chart/table switch. */
function FigureHead({ title, note, id, table, onTable }) {
  return (
    <div className="pr-fig__head">
      <figcaption id={id}>
        <span className="figure__t">{title}</span>
        {note && <span className="figure__s">{note}</span>}
      </figcaption>
      {onTable && (
        <button type="button" className="btn btn--quiet btn--sm pr-fig__tool" aria-pressed={table} onClick={() => onTable(!table)}>
          {table ? t('rehearse.charts.showChart') : t('rehearse.charts.showTable')}
        </button>
      )}
    </div>
  );
}

/**
 * One measurement over the take. points: [{t, v}], t in seconds. band: [lo, hi] shaded as
 * the target, labeled bandLabel. spans: [{start, end}] shaded as moments (long pauses),
 * labeled spanLabel. Values show with `unit` after them.
 */
export function TimeChart({ title, note, points, xMax, yMax, unit = '', band, bandLabel, spans = [], spanLabel, valueLabel, lang }) {
  const id = useId();
  const [table, setTable] = useState(false);
  const [ref, width] = useWidth();
  const height = 184;
  const fmt = (v) => `${numberText(v, lang, 0)}${unit}`;
  const tMax = Math.max(1, xMax || Math.max(...points.map((p) => p.t), 1));
  const vTop = yMax || Math.max(...points.map((p) => p.v), band ? band[1] : 0, 1) * 1.15;
  const ticks = niceTicks(vTop);
  const axisMax = Math.max(vTop, ticks[ticks.length - 1] || vTop);
  // Room for the widest y label at 12px (about 7.5px a character), so "100%" never clips.
  const padL = Math.ceil(12 + 7.5 * Math.max(2, ...ticks.map((v) => fmt(v).length)));
  const padR = 12;
  const padT = 22;
  const padB = 26;
  const plotW = Math.max(40, width - padL - padR);
  const plotH = height - padT - padB;
  const x = (tt) => padL + (Math.min(Math.max(tt, 0), tMax) / tMax) * plotW;
  const y = (v) => padT + plotH - (Math.min(v, axisMax) / axisMax) * plotH;
  const step = timeStep(tMax, Math.max(2, Math.floor(plotW / 64)));
  const xTicks = [];
  for (let s = 0; s <= tMax + 0.01; s += step) xTicks.push(s);
  const path = points.map((p, i) => `${i ? 'L' : 'M'}${x(p.t).toFixed(1)} ${y(p.v).toFixed(1)}`).join(' ');
  const firstSpan = spans.find((sp) => x(sp.end) - x(sp.start) >= 2);

  return (
    <figure className="figure pr-fig" aria-labelledby={`${id}-cap`}>
      <FigureHead title={title} note={note} id={`${id}-cap`} table={table} onTable={setTable} />
      <div className="figure__body" ref={ref}>
        {table ? (
          <table className="chart-table">
            <caption className="vh">{title}</caption>
            <thead>
              <tr>
                <th scope="col">{t('rehearse.charts.time')}</th>
                <th scope="col" className="n">
                  {valueLabel}
                </th>
              </tr>
            </thead>
            <tbody>
              {points.map((p, i) => (
                <tr key={i}>
                  <td className="num">{clock(p.t)}</td>
                  <td className="n">{fmt(p.v)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <svg className="chart pr-chart" width={width} height={height} role="img" aria-labelledby={`${id}-cap`}>
            {spans.map((sp, i) => (
              <rect key={i} className="pr-chart__span" x={x(sp.start)} y={padT} width={Math.max(2, x(sp.end) - x(sp.start))} height={plotH} />
            ))}
            {band && <rect className="pr-chart__band" x={padL} y={y(band[1])} width={plotW} height={Math.max(0, y(band[0]) - y(band[1]))} />}
            {ticks.map((v) => (
              <g key={v}>
                <line className="grid" x1={padL} x2={padL + plotW} y1={y(v)} y2={y(v)} />
                <text x={padL - 8} y={y(v) + 4} textAnchor="end">
                  {fmt(v)}
                </text>
              </g>
            ))}
            <line className="axis" x1={padL} x2={padL + plotW} y1={padT + plotH} y2={padT + plotH} />
            {xTicks.map((s, i) => (
              <text key={s} x={x(s)} y={height - 6} textAnchor={i === 0 ? 'start' : s + step > tMax + 0.01 && x(s) > padL + plotW - 20 ? 'end' : 'middle'}>
                {clock(s)}
              </text>
            ))}
            {band && bandLabel && (
              <text className="pr-chart__bandlbl" x={padL + plotW - 4} y={y(band[1]) - 6} textAnchor="end">
                {bandLabel}
              </text>
            )}
            {firstSpan && spanLabel && (
              <text className="pr-chart__spanlbl" x={Math.min(x(firstSpan.start), padL + plotW - 4)} y={padT - 8} textAnchor={x(firstSpan.start) > padL + plotW - 80 ? 'end' : 'start'}>
                {spanLabel}
              </text>
            )}
            {points.length > 1 && <path className="pr-chart__line" d={path} />}
            {points.map((p, i) => (
              <circle key={i} className="pr-chart__dot" cx={x(p.t)} cy={y(p.v)} r={points.length > 24 ? 2 : 3.5} />
            ))}
          </svg>
        )}
      </div>
    </figure>
  );
}

/** Group seconds into at most `max` cells, each true when most of its known seconds were. */
function bucketCells(cells, max = 90) {
  if (cells.length <= max) return { cells, per: 1 };
  const per = Math.ceil(cells.length / max);
  const out = [];
  for (let i = 0; i < cells.length; i += per) {
    const part = cells.slice(i, i + per).filter((c) => c !== null);
    out.push(part.length ? part.filter(Boolean).length * 2 >= part.length : null);
  }
  return { cells: out, per };
}

/**
 * One cell per second (grouped on long takes): ink when facing the room, gray when looking
 * away or down, a thin line when no face was found. Labels sit under the strip.
 */
export function EyeStrip({ title, note, cells, labels }) {
  const id = useId();
  const [table, setTable] = useState(false);
  const { cells: shown } = bucketCells(cells);
  const on = cells.filter((c) => c === true).length;
  const known = cells.filter((c) => c !== null).length;
  return (
    <figure className="figure pr-fig" aria-labelledby={`${id}-cap`}>
      <FigureHead title={title} note={note} id={`${id}-cap`} table={table} onTable={setTable} />
      <div className="figure__body">
        {table ? (
          <table className="chart-table">
            <caption className="vh">{title}</caption>
            <tbody>
              <tr>
                <th scope="row">{labels.on}</th>
                <td className="n">{t('rehearse.charts.seconds', { n: on })}</td>
              </tr>
              <tr>
                <th scope="row">{labels.off}</th>
                <td className="n">{t('rehearse.charts.seconds', { n: known - on })}</td>
              </tr>
              <tr>
                <th scope="row">{labels.none}</th>
                <td className="n">{t('rehearse.charts.seconds', { n: cells.length - known })}</td>
              </tr>
            </tbody>
          </table>
        ) : (
          <>
            <div className="pr-strip" role="img" aria-label={t('rehearse.charts.stripAria', { on, known, total: cells.length })} style={{ '--cells': shown.length }}>
              {shown.map((c, i) => (
                <span key={i} className={c === true ? 'is-on' : c === false ? 'is-off' : 'is-none'} />
              ))}
            </div>
            <div className="pr-strip__axis num" aria-hidden="true">
              <span>0:00</span>
              <span>{clock(cells.length)}</span>
            </div>
            <ul className="pr-key">
              <li>
                <span className="pr-key__sw is-on" aria-hidden="true" />
                {labels.on}
              </li>
              <li>
                <span className="pr-key__sw is-off" aria-hidden="true" />
                {labels.off}
              </li>
              <li>
                <span className="pr-key__sw is-none" aria-hidden="true" />
                {labels.none}
              </li>
            </ul>
          </>
        )}
      </div>
    </figure>
  );
}
