/**
 * The icon set: 24px grid, 2px stroke, round caps and joins (from the podium mock).
 * Icons are decorative (aria-hidden) unless `label` is given.
 *
 *   <Icon name="mic" />                  24px line icon
 *   <Icon name="mic" size={20} />        20px (also 16 and 18)
 *   <Icon name="home-f" />               filled variants end in -f (tab bar active state)
 *
 * Size is a class (icon--20 etc.), so a parent rule such as `.badge .icon` can still size it.
 */

// Line icons: each entry is a list of SVG children.
const p = (d) => ({ t: 'path', d });
const c = (cx, cy, r) => ({ t: 'circle', cx, cy, r });
const r = (x, y, width, height, rx) => ({ t: 'rect', x, y, width, height, rx });

const LINE = {
  home: [p('M3.5 10.2 12 3.5l8.5 6.7'), p('M5.5 9v10.5c0 .6.4 1 1 1H10v-6h4v6h3.5c.6 0 1-.4 1-1V9')],
  cal: [r(3.5, 4.5, 17, 16, 3), p('M3.5 9.5h17M8 2.8v3.4M16 2.8v3.4')],
  mic: [r(9, 2.8, 6, 11.2, 3), p('M5.5 11a6.5 6.5 0 0 0 13 0M12 17.5v3.7M8.5 21.2h7')],
  people: [c(9, 8, 3.5), p('M2.5 20.5a6.5 6.5 0 0 1 13 0'), p('M15.5 4.8a3.4 3.4 0 0 1 0 6.4M18 14.4a6.4 6.4 0 0 1 3.5 6.1')],
  globe: [c(12, 12, 9), p('M3 12h18M12 3c2.6 2.6 3.8 5.6 3.8 9s-1.2 6.4-3.8 9c-2.6-2.6-3.8-5.6-3.8-9S9.4 5.6 12 3z')],
  search: [c(10.8, 10.8, 6.8), p('m16 16 4.5 4.5')],
  locate: [c(12, 12, 7.5), c(12, 12, 2.5), p('M12 1.8v2.7M12 19.5v2.7M1.8 12h2.7M19.5 12h2.7')],
  sliders: [p('M4 6.5h9M17 6.5h3M4 12h3M11 12h9M4 17.5h11M19 17.5h1'), c(15, 6.5, 2), c(9, 12, 2), c(17, 17.5, 2)],
  'chev-r': [p('m9.5 6 6 6-6 6')],
  'chev-d': [p('m6 9.5 6 6 6-6')],
  'chev-l': [p('m14.5 6-6 6 6 6')],
  'chev-u': [p('m6 14.5 6-6 6 6')],
  x: [p('M6.5 6.5l11 11M17.5 6.5l-11 11')],
  check: [p('m5 12.5 4.5 4.5L19 7.5')],
  clock: [c(12, 12, 9), p('M12 7v5.2l3.3 2')],
  'cal-plus': [r(3.5, 4.5, 17, 16, 3), p('M3.5 9.5h17M8 2.8v3.4M16 2.8v3.4M12 12.5v5M9.5 15h5')],
  pin: [p('M12 21.2s-6.8-6-6.8-11.4a6.8 6.8 0 0 1 13.6 0c0 5.4-6.8 11.4-6.8 11.4z'), c(12, 9.8, 2.4)],
  nav: [p('M3.5 11 20.5 3.5 13 20.5l-1.8-7.7z')],
  ext: [p('M14 3.5h6.5V10M20.5 3.5l-9 9M18 14v4.5a2 2 0 0 1-2 2H5.5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2H10')],
  eye: [p('M2.2 12S5.8 5 12 5s9.8 7 9.8 7-3.6 7-9.8 7-9.8-7-9.8-7z'), c(12, 12, 3)],
  moon: [p('M20 14.6A8.2 8.2 0 1 1 9.4 4a6.6 6.6 0 0 0 10.6 10.6z')],
  sun: [c(12, 12, 4), p('M12 2.5v2M12 19.5v2M2.5 12h2M19.5 12h2M5.3 5.3l1.4 1.4M17.3 17.3l1.4 1.4M5.3 18.7l1.4-1.4M17.3 6.7l1.4-1.4')],
  video: [r(2.5, 6, 13, 12, 2.5), p('m15.5 10.2 6-3.4v10.4l-6-3.4')],
  xc: [c(12, 12, 9), p('m9 9 6 6M15 9l-6 6')],
  moved: [p('M4 12h15M14 7l5 5-5 5')],
  list: [p('M9 6h11.5M9 12h11.5M9 18h11.5'), c(4.5, 6, 0.6), c(4.5, 12, 0.6), c(4.5, 18, 0.6)],
  map: [p('M9 4 3.5 6v14L9 18l6 2 5.5-2V4L15 6z'), p('M9 4v14M15 6v14')],
  info: [c(12, 12, 9), p('M12 11v5.5M12 7.6v.2')],
  alert: [p('M10.3 3.9 2.4 17.6A2 2 0 0 0 4.1 20.6h15.8a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z'), p('M12 9.5v4.5M12 17.2v.2')],
  copy: [r(8.5, 8.5, 12, 12, 2.5), p('M15.5 8.5V6a2.5 2.5 0 0 0-2.5-2.5H6A2.5 2.5 0 0 0 3.5 6v7A2.5 2.5 0 0 0 6 15.5h2.5')],
  pen: [p('M4 20h4.2L19.3 8.9a2.1 2.1 0 0 0 0-3l-1.2-1.2a2.1 2.1 0 0 0-3 0L4 15.8z'), p('m13.5 6.5 4 4')],
  thumb: [p('M7 10.5v10H4.5a1 1 0 0 1-1-1v-8a1 1 0 0 1 1-1z'), p('M7 10.5 11 3a2.3 2.3 0 0 1 3.4 2.5l-.9 4.5h5.4a2 2 0 0 1 2 2.4l-1.3 6.3a2.2 2.2 0 0 1-2.1 1.8H7')],
  play: [p('M7 4.8v14.4a1 1 0 0 0 1.5.9l11.3-7.2a1 1 0 0 0 0-1.7L8.5 3.9A1 1 0 0 0 7 4.8z')],
  user: [c(12, 8, 4), p('M4 21a8 8 0 0 1 16 0')],
  plus: [p('M12 5v14M5 12h14')],
  minus: [p('M5 12h14')],
  swap: [p('M7 7.5h13M16.5 4l3.5 3.5-3.5 3.5M17 16.5H4M7.5 13 4 16.5 7.5 20')],
  download: [p('M12 3.5v11M7.5 10l4.5 4.5 4.5-4.5M4.5 15v3.5a2 2 0 0 0 2 2h11a2 2 0 0 0 2-2V15')],
  upload: [p('M12 14.5v-11M7.5 8 12 3.5 16.5 8M4.5 15v3.5a2 2 0 0 0 2 2h11a2 2 0 0 0 2-2V15')],
  tune: [p('M4 7h16M7 12h10M10 17h4')],
  bulb: [p('M9 18.5h6M10 21.5h4M12 2.5a6.5 6.5 0 0 0-3.8 11.8c.5.4.8 1 .8 1.6v.6h6v-.6c0-.6.3-1.2.8-1.6A6.5 6.5 0 0 0 12 2.5z')],
  book: [p('M4 5.5A2.5 2.5 0 0 1 6.5 3H20v15H6.5A2.5 2.5 0 0 0 4 20.5z'), p('M4 20.5A2.5 2.5 0 0 0 6.5 23H20v-5')],
  chat: [p('M20.5 12a8 8 0 0 1-11.9 7l-4.6 1.4 1.4-4.4A8 8 0 1 1 20.5 12z')],
  news: [r(3.5, 4, 17, 16, 2.5), p('M7.5 8.5h9M7.5 12h9M7.5 15.5h5')],
  offline: [p('M3 3l18 18M8.6 8.7A10 10 0 0 0 4.3 11M12 4.5a14.6 14.6 0 0 1 9.4 3.4M16.3 12.4a10 10 0 0 0-2.1-1.3M8.4 15.2a5.5 5.5 0 0 1 6.3-.5M12 19.2v.1')],
  flag: [p('M5 21V4M5 4.5h12l-2.5 4 2.5 4H5')],
  share: [p('M12 3.5v11.5M7.5 8 12 3.5 16.5 8M4.5 13v5.5a2 2 0 0 0 2 2h11a2 2 0 0 0 2-2V13')],
  shield: [p('M12 3 4.5 6v5.5c0 4.6 3.2 8.4 7.5 9.5 4.3-1.1 7.5-4.9 7.5-9.5V6z'), p('m8.8 12 2.3 2.3 4.2-4.3')],
  trash: [p('M4 6.5h16M9.5 6.5V4.5a1 1 0 0 1 1-1h3a1 1 0 0 1 1 1v2M6.5 6.5l.8 12.6a2 2 0 0 0 2 1.9h5.4a2 2 0 0 0 2-1.9l.8-12.6'), p('M10 10.5v6M14 10.5v6')],
  camera: [p('M4.5 7.5h3l1.6-2.5h5.8l1.6 2.5h3a1.5 1.5 0 0 1 1.5 1.5v9.5a1.5 1.5 0 0 1-1.5 1.5h-15A1.5 1.5 0 0 1 3 18.5V9a1.5 1.5 0 0 1 1.5-1.5z'), c(12, 13.5, 3.7)],
  dots: [c(5, 12, 1.2), c(12, 12, 1.2), c(19, 12, 1.2)],
  refresh: [p('M20 11.5A8 8 0 0 0 5.6 6.8L4 8.5M4 4v4.5h4.5'), p('M4 12.5a8 8 0 0 0 14.4 4.7L20 15.5M20 20v-4.5h-4.5')],
  chart: [p('M4 20.5h16'), p('M7 16.5v-5M12 16.5V6.5M17 16.5v-8')],
  school: [p('M2.5 9 12 4.5 21.5 9 12 13.5z'), p('M6.5 11v5c0 1.4 2.5 3 5.5 3s5.5-1.6 5.5-3v-5M21.5 9v5.5')],
  link: [p('M10 14a4.5 4.5 0 0 0 6.4 0l3-3a4.5 4.5 0 0 0-6.4-6.4l-1.2 1.2'), p('M14 10a4.5 4.5 0 0 0-6.4 0l-3 3a4.5 4.5 0 0 0 6.4 6.4l1.2-1.2')],
  star: [p('M12 3.5l2.6 5.3 5.9.9-4.3 4.1 1 5.8L12 16.9l-5.2 2.7 1-5.8-4.3-4.1 5.9-.9z')],
  stop: [r(5, 5, 14, 14, 3)],
  pause: [p('M9 5.5v13M15 5.5v13')],
};

// Filled icons. Inner strokes are drawn explicitly so the shape reads at 24px.
const STROKE = { fill: 'none', stroke: 'currentColor', strokeWidth: 2, strokeLinecap: 'round', strokeLinejoin: 'round' };
const FILL = {
  'home-f': [p('M11.4 2.7a1 1 0 0 1 1.2 0l8.5 6.7a1 1 0 0 1-1.2 1.6l-.4-.3v8.8a2 2 0 0 1-2 2H14.8v-6.2h-5.6v6.2H6.5a2 2 0 0 1-2-2v-8.8l-.4.3a1 1 0 1 1-1.2-1.6z')],
  'cal-f': [p('M8 2a1 1 0 0 1 1 1v.5h6V3a1 1 0 1 1 2 0v.5h.5a4 4 0 0 1 4 4V8.5h-19V7.5a4 4 0 0 1 4-4H7V3a1 1 0 0 1 1-1zM2.5 10.5h19v7a4 4 0 0 1-4 4h-11a4 4 0 0 1-4-4z')],
  'mic-f': [p('M12 1.8a4 4 0 0 1 4 4V11a4 4 0 0 1-8 0V5.8a4 4 0 0 1 4-4z'), { t: 'path', d: 'M5.5 11a6.5 6.5 0 0 0 13 0M12 17.5v3.7M8.5 21.2h7', ...STROKE }],
  'people-f': [c(9, 8, 4.5), p('M1.5 20.5a7.5 7.5 0 0 1 15 0 1 1 0 0 1-1 1h-13a1 1 0 0 1-1-1z'), { t: 'path', d: 'M15.5 4.8a3.4 3.4 0 0 1 0 6.4M18 14.4a6.4 6.4 0 0 1 3.5 6.1', ...STROKE }],
  'check-f': [c(12, 12, 10), { t: 'path', d: 'm7.5 12.3 3 3 6-6.3', ...STROKE, stroke: 'var(--card, #fff)', strokeWidth: 2.4 }],
};

export const ICON_NAMES = Object.freeze([...Object.keys(LINE), ...Object.keys(FILL)]);

function renderChild(node, i) {
  const { t: Tag, ...attrs } = node;
  return <Tag key={i} {...attrs} />;
}

export default function Icon({ name, size, label, className = '', ...rest }) {
  const filled = Object.prototype.hasOwnProperty.call(FILL, name);
  const children = filled ? FILL[name] : LINE[name];
  if (!children) {
    if (import.meta.env && import.meta.env.DEV) console.warn(`Icon: unknown name "${name}"`);
    return null;
  }
  const cls = ['icon', size && size !== 24 ? `icon--${size}` : '', filled ? 'icon--fill' : '', className].filter(Boolean).join(' ');
  return (
    <svg className={cls} viewBox="0 0 24 24" focusable="false" aria-hidden={label ? undefined : 'true'} role={label ? 'img' : undefined} aria-label={label} {...rest}>
      {children.map(renderChild)}
    </svg>
  );
}
