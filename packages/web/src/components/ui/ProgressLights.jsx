import Icon from './Icon.jsx';

/**
 * Prep progress as four lights (Sign up, Write, Practice, On the day).
 *   <ProgressLights label="Progress" steps={[{ id: 'signup', label: 'Sign up', done: false }, ...]} />
 * Done steps are Ink; the rest stay quiet, as in the podium mocks (the "Continue" button and the
 * step cards already say what comes next).
 * `onLight` uses the style for light surfaces (Prepare page); the default sits on the Go card.
 */
export default function ProgressLights({ steps, label, onLight = false, className = '' }) {
  return (
    <ol className={`prog${onLight ? ' prog--onlight' : ''} ${className}`.trim()} aria-label={label}>
      {steps.map((s) => (
        <li key={s.id} className={`prog__step${s.done ? ' is-done' : ''}`}>
          <span className="prog__bar" aria-hidden="true" />
          <span className="prog__lbl">
            {s.done && <Icon name="check" />}
            {s.label}
            {s.stateLabel && <span className="vh">{`, ${s.stateLabel}`}</span>}
          </span>
        </li>
      ))}
    </ol>
  );
}
