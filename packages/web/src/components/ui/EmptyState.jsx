import Icon from './Icon.jsx';

/**
 * What a screen shows when there is nothing to list, or something failed: an icon, a title
 * that says what happened, a sentence that says what to do next, and the action to do it.
 */
export default function EmptyState({ icon = 'info', title, children, actions, level = 3, className = '', role }) {
  const H = `h${level}`;
  return (
    <div className={`empty ${className}`.trim()} role={role}>
      <div className="empty__ic" aria-hidden="true">
        <Icon name={icon} />
      </div>
      <H>{title}</H>
      {children && (typeof children === 'string' ? <p>{children}</p> : children)}
      {actions && <div className="btn-row">{actions}</div>}
    </div>
  );
}
