import Icon from './Icon.jsx';

/**
 * A filter or choice chip.
 * - Toggle: pass `pressed` (boolean) and onClick; renders aria-pressed and a check when on.
 * - Menu or dialog opener: pass `menu` (adds a chevron) or `count` (a small number badge).
 */
export default function Chip({ pressed, icon, count, menu = false, children, className = '', type = 'button', ...rest }) {
  const toggle = typeof pressed === 'boolean';
  const lead = icon || (toggle && pressed ? 'check' : null);
  return (
    <button type={type} className={`chip${menu ? ' chip--menu' : ''} ${className}`.trim()} aria-pressed={toggle ? pressed : undefined} {...rest}>
      {lead && <Icon name={lead} size={20} />}
      {children}
      {count ? <span className="count num">{count}</span> : null}
      {menu && <Icon name="chev-d" size={20} />}
    </button>
  );
}
