import { Link, useLocation } from 'react-router-dom';
import { t } from '@agora/core';
import { SCHEDULES_VERIFIED_ON } from '../../lib/data.js';
import { monthDay } from '../ui/meetingInfo.js';

/**
 * The footer on every page: secondary destinations and the three standing lines.
 * `inline` is for a footer inside a page column (Meetings list): no wrap of its own.
 */
const LINKS = [
  { to: '/news', key: 'nav.news' },
  { to: '/insights', key: 'nav.data' },
  { to: '/about', key: 'nav.about' },
  { to: '/profile', key: 'nav.profiles' },
];

export default function AppFooter({ inline = false }) {
  const { pathname } = useLocation();
  // Routes ignore case and a trailing slash ("/News/" is the News page).
  const here = pathname.toLowerCase().replace(/\/+$/, '') || '/';
  const verified = SCHEDULES_VERIFIED_ON ? monthDay(SCHEDULES_VERIFIED_ON, { withYear: true }) : '';
  const inner = (
    <>
      {/* These pages have no tab, so the footer is the nav that says where you are. */}
      <nav className="footer__links" aria-label={t('shell.footer.label')}>
        {LINKS.map((l) => (
          <Link key={l.to} to={l.to} aria-current={here === l.to ? 'page' : undefined}>
            {t(l.key)}
          </Link>
        ))}
      </nav>
      <p>{t('shell.footer.nonpartisan')}</p>
      {verified && <p>{t('shell.footer.verified', { date: verified })}</p>}
      <p>{t('shell.footer.builtBy')}</p>
    </>
  );
  return (
    <footer className={`footer${inline ? ' footer--inline' : ''}`}>
      {inline ? <div className="footer__in">{inner}</div> : <div className="wrap footer__in">{inner}</div>}
    </footer>
  );
}
