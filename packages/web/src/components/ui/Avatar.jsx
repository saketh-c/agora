import Icon from './Icon.jsx';

/** A round initial, or a person glyph for a profile with no name yet. */
export default function Avatar({ name, size, soft = false, className = '' }) {
  const initial = String(name || '').trim().charAt(0);
  const cls = ['avatar', size === 'lg' ? 'avatar--lg' : '', !initial ? 'avatar--guest' : soft ? 'avatar--soft' : '', className].filter(Boolean).join(' ');
  return (
    <span className={cls} aria-hidden="true">
      {initial ? initial.toLocaleUpperCase() : <Icon name="user" size={20} />}
    </span>
  );
}
