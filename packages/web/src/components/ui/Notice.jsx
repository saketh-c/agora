import Icon from './Icon.jsx';

const DEFAULT_ICON = { neutral: 'info', amber: 'clock', go: 'check', stop: 'alert', card: 'info' };

/**
 * A one-line (or short) message inside a page: tone neutral | amber | go | stop | card.
 * Put the next step in `action` (a link or a small button). Use role="status" or "alert"
 * when the notice appears in response to something the person did.
 */
export default function Notice({ tone = 'neutral', icon, title, children, action, className = '', role }) {
  return (
    <div className={`notice${tone !== 'neutral' ? ` notice--${tone}` : ''} ${className}`.trim()} role={role}>
      <Icon name={icon || DEFAULT_ICON[tone] || 'info'} />
      <div>
        {title && <strong>{title} </strong>}
        {children}
      </div>
      {action && <div className="act">{action}</div>}
    </div>
  );
}
