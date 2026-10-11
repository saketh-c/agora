import { useId } from 'react';
import { Link } from 'react-router-dom';
import { t } from '@agora/core';

/**
 * A titled block of a page with an optional "See all" link:
 *   <Section title="Coming up for you" see={{ to: '/meetings' }}>...</Section>
 * `see.label` defaults to "See all"; the link is described by the heading for screen readers.
 */
export default function Section({ title, see, children, className = '', level = 2, id, headingClass = 't-heading', ...rest }) {
  const auto = useId();
  const hid = id || `sec-${auto.replace(/[^a-zA-Z0-9_-]/g, '')}`;
  const H = `h${level}`;
  return (
    <section className={className || undefined} aria-labelledby={hid} {...rest}>
      <div className="sec-head">
        <H className={headingClass} id={hid}>
          {title}
        </H>
        {see && (see.to ? (
          <Link className="see" to={see.to} aria-describedby={hid}>
            {see.label || t('ui.seeAll')}
          </Link>
        ) : (
          <button type="button" className="see" onClick={see.onClick} aria-describedby={hid}>
            {see.label || t('ui.seeAll')}
          </button>
        ))}
      </div>
      {children}
    </section>
  );
}
