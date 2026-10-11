import { Link, useLocation } from 'react-router-dom';
import { t } from '@agora/core';
import Icon from '../ui/Icon.jsx';
import { DESTINATIONS, activeDestination } from './nav.js';

/** The phone and tablet tab bar: four destinations, icon + label, active pill (below 1024px). */
export default function TabBar() {
  const { pathname } = useLocation();
  const active = activeDestination(pathname);
  return (
    <nav className="tabbar" aria-label={t('nav.primary')}>
      {DESTINATIONS.map((d) => (
        <Link key={d.id} className="tab" to={d.to} aria-current={active === d.id ? 'page' : undefined}>
          <span className="tab__ind">
            <Icon name={d.icon} className="icon--line" />
            <Icon name={`${d.icon}-f`} />
          </span>
          <span className="tab__label">{t(d.labelKey)}</span>
        </Link>
      ))}
    </nav>
  );
}
