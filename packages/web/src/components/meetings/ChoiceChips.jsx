import Icon from '../ui/Icon.jsx';

/**
 * One choice out of a few, as native radio buttons drawn as chips (put it inside a fieldset
 * with a legend). Arrow keys move between them like any radio group.
 *
 *   <ChoiceChips name="when" value={f.when} onChange={...} options={[{ value: 'today', label: 'Today' }]} />
 */
export default function ChoiceChips({ name, value, options, onChange, className = '' }) {
  return (
    <div className={`chipwrap ${className}`.trim()}>
      {options.map((o) => {
        const on = o.value === value;
        return (
          <label key={String(o.value)} className={`chip choice${on ? ' is-on' : ''}`} title={o.title}>
            <input type="radio" className="vh" name={name} value={String(o.value)} checked={on} onChange={() => onChange(o.value)} />
            {on && <Icon name="check" size={20} />}
            {o.label}
          </label>
        );
      })}
    </div>
  );
}
