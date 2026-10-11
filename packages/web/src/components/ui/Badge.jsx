import Icon from './Icon.jsx';

const TONES = { go: 'badge--go', amber: 'badge--amber', 'amber-soft': 'badge--amber-soft', stop: 'badge--stop', neutral: 'badge--watch', watch: 'badge--watch', ink: 'badge--ink', plain: 'badge--plain' };

/**
 * A status pill. tone: go (you can speak), amber (deadline), amber-soft, stop (cancelled),
 * neutral (facts such as "After school"), ink (emphasis such as "Your city"), plain (no fill).
 */
export default function Badge({ tone = 'neutral', icon, children, className = '', ...rest }) {
  return (
    <span className={`badge ${TONES[tone] || TONES.neutral} ${className}`.trim()} {...rest}>
      {icon ? <Icon name={icon} /> : null}
      <span>{children}</span>
    </span>
  );
}
