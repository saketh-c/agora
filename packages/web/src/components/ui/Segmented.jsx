import { useRef } from 'react';
import Icon from './Icon.jsx';

/**
 * A segmented control (radio group): one of 2 to 4 options, such as List | Map.
 * Arrow keys move and select, like native radios; only the checked option is in the tab order.
 *
 *   <Segmented label="View" value={view} onChange={setView}
 *              options={[{ value: 'list', label: 'List', icon: 'list' }, { value: 'map', label: 'Map', icon: 'map' }]} />
 */
export default function Segmented({ label, options, value, onChange, block = false, className = '' }) {
  const refs = useRef([]);
  const index = Math.max(0, options.findIndex((o) => o.value === value));

  const onKeyDown = (e) => {
    const dir = { ArrowRight: 1, ArrowDown: 1, ArrowLeft: -1, ArrowUp: -1 }[e.key];
    let next = null;
    if (dir) next = (index + dir + options.length) % options.length;
    if (e.key === 'Home') next = 0;
    if (e.key === 'End') next = options.length - 1;
    if (next === null) return;
    e.preventDefault();
    onChange(options[next].value);
    refs.current[next] && refs.current[next].focus();
  };

  return (
    <div className={`seg${block ? ' seg--block' : ''} ${className}`.trim()} role="radiogroup" aria-label={label} onKeyDown={onKeyDown}>
      {options.map((o, i) => (
        <button
          key={o.value}
          ref={(el) => (refs.current[i] = el)}
          type="button"
          role="radio"
          aria-checked={o.value === value}
          tabIndex={i === index ? 0 : -1}
          onClick={() => onChange(o.value)}
        >
          {o.icon && <Icon name={o.icon} size={20} />}
          {o.label}
        </button>
      ))}
    </div>
  );
}
