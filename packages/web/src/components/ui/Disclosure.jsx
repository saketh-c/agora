import Icon from './Icon.jsx';

/**
 * Show-more content on a native <details>, so it works without JavaScript and with every
 * screen reader. `variant="plain"` is the quiet text version ("How this works") for one-line
 * explanations; the default is a card row with a title and an optional one-line summary.
 */
export default function Disclosure({ title, summary, children, defaultOpen = false, open, onToggle, variant = 'card', className = '', id }) {
  const controlled = typeof open === 'boolean';
  return (
    <details
      id={id}
      className={`disc${variant === 'plain' ? ' disc--plain' : ''} ${className}`.trim()}
      {...(controlled ? { open } : defaultOpen ? { open: true } : {})}
      onToggle={onToggle ? (e) => onToggle(e.currentTarget.open) : undefined}
    >
      <summary>
        <span>
          <span className="disc__t">{title}</span>
          {summary && variant !== 'plain' ? <span className="disc__s">{summary}</span> : null}
        </span>
        <Icon name="chev-d" />
      </summary>
      <div className="disc__body">{children}</div>
    </details>
  );
}
