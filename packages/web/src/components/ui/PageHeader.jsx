import { Fragment } from 'react';
import { Link } from 'react-router-dom';
import { t } from '@agora/core';
import Icon from './Icon.jsx';

/**
 * The top of a page: optional breadcrumb, the page's one h1 (display type), optional actions
 * on the same row, and a lead of two lines at most.
 *
 *   <PageHeader title="Meetings" crumbs={[{ to: '/meetings', label: 'Meetings' }, { label: 'Plano' }]}
 *               lead="One line." actions={<Badge tone="ink" icon="check">Your city</Badge>} />
 */
export default function PageHeader({ title, lead, crumbs, actions, children, className = '', titleId }) {
  return (
    <header className={`page-head ${className}`.trim()}>
      {crumbs && crumbs.length > 0 && (
        <nav className="crumbs" aria-label={t('ui.breadcrumb')}>
          {crumbs.map((c, i) => (
            <Fragment key={`${c.label}-${i}`}>
              {i > 0 && <Icon name="chev-r" />}
              {c.to && i < crumbs.length - 1 ? <Link to={c.to}>{c.label}</Link> : <span aria-current="page">{c.label}</span>}
            </Fragment>
          ))}
        </nav>
      )}
      <div className="page-head__row">
        <h1 className="t-title" id={titleId}>
          {title}
        </h1>
        {actions}
      </div>
      {lead && <p>{lead}</p>}
      {children && <div className="page-head__extra">{children}</div>}
    </header>
  );
}
