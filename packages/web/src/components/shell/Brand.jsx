import { Link } from 'react-router-dom';
import { BRAND, t } from '@agora/core';

/**
 * The mark: a stoa (architrave, two columns, a base) with a speaker at the podium between the
 * columns. The columns are Ink; the speaker's head is the Go light, because it is your turn.
 */
export function BrandMark({ className = 'brand__mark', title }) {
  return (
    <svg className={className} viewBox="0 0 28 28" aria-hidden={title ? undefined : 'true'} role={title ? 'img' : undefined} aria-label={title} focusable="false">
      <rect className="mark-body" x="2" y="2.5" width="24" height="4.5" rx="1.6" />
      <rect className="mark-body" x="3.5" y="9" width="4.2" height="15" rx="1.2" />
      <rect className="mark-body" x="20.3" y="9" width="4.2" height="15" rx="1.2" />
      <path className="mark-body" d="M9.6 16.2h8.8l-1.15 7.8h-6.5z" />
      <circle className="mark-head" cx="14" cy="11.6" r="3.1" />
      <rect className="mark-body" x="1.5" y="24.6" width="25" height="2" rx="1" />
    </svg>
  );
}

/** Mark + lowercase wordmark, linking home. */
export default function Brand({ className = '' }) {
  return (
    <Link className={`brand ${className}`.trim()} to="/" aria-label={t('shell.brandHome', { app: BRAND.name })}>
      <BrandMark />
      <span className="brand__word" aria-hidden="true">
        {BRAND.name.toLowerCase()}
      </span>
    </Link>
  );
}
