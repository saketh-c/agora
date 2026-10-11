import { Link, useLocation } from 'react-router-dom';
import { LOCALES, t } from '@agora/core';
import { useStore } from '../../lib/store.jsx';
import Icon from '../ui/Icon.jsx';
import Menu from '../ui/Menu.jsx';
import Avatar from '../ui/Avatar.jsx';
import Brand from './Brand.jsx';
import { SETUP_STATE, setupTo } from './SetupHost.jsx';
import { DESTINATIONS, activeDestination } from './nav.js';

/** Globe + current language; the menu lists each language in its own name. */
function LanguageMenu() {
  const { lang, setLang } = useStore();
  const current = LOCALES.find((l) => l.code === lang) || LOCALES[0];
  return (
    <Menu
      label={t('shell.languagesButton', { language: current.nativeName })}
      menuLabel={t('shell.languages')}
      button={
        <>
          <Icon name="globe" />
          <span className="tool__label" aria-hidden="true" lang={current.code}>
            {current.nativeName}
          </span>
          <Icon name="chev-d" size={16} className="tool__chev" />
        </>
      }
      items={LOCALES.map((l) => ({ type: 'radio', key: l.code, label: l.nativeName, lang: l.code, checked: l.code === lang, onSelect: () => setLang(l.code) }))}
    />
  );
}

/** Initial avatar; the menu switches profiles and links to setup, Profiles and backup, About. */
function ProfileMenu() {
  const { profile, profileName, profiles, switchProfile, setupComplete } = useStore();
  const location = useLocation();
  const others = profiles.filter((p) => p.id !== profile.id);
  const items = [
    ...(others.length ? [{ type: 'group', label: t('shell.profile.switchTo') }] : []),
    ...others.map((p) => ({ type: 'item', key: p.id, icon: 'swap', label: p.name || t('profile.defaultName'), onSelect: () => switchProfile(p.id) })),
    ...(others.length ? [{ type: 'separator' }] : []),
    // Opens over the current page, so closing it leaves you where you were.
    { type: 'link', key: 'setup', to: setupTo(location), state: SETUP_STATE, refocus: true, icon: 'sliders', label: t('shell.profile.setup') },
    { type: 'link', key: 'profiles', to: '/profile', icon: 'user', label: t('shell.profile.profiles') },
    { type: 'link', key: 'about', to: '/about', icon: 'info', label: t('nav.about') },
  ];
  return (
    <Menu
      label={t('shell.profileButton', { name: profileName })}
      menuLabel={t('shell.profile.menu')}
      buttonClassName="tool tool--avatar"
      button={<Avatar name={profile.name} />}
      header={
        <>
          <Avatar name={profile.name} size="lg" />
          <span>
            <span className="menu__name">{profileName}</span>
            <span className="menu__sub">{setupComplete ? t('shell.profile.onThisDevice') : t('shell.profile.notSetUp')}</span>
          </span>
        </>
      }
      items={items}
    />
  );
}

export default function AppHeader() {
  const { pathname } = useLocation();
  const active = activeDestination(pathname);
  return (
    <header className="topbar">
      <div className="wrap topbar__in">
        <Brand />
        <nav className="topnav" aria-label={t('nav.primary')}>
          {DESTINATIONS.map((d) => (
            <Link key={d.id} to={d.to} aria-current={active === d.id ? 'page' : undefined}>
              {t(d.labelKey)}
            </Link>
          ))}
        </nav>
        <div className="tools">
          <LanguageMenu />
          <ProfileMenu />
        </div>
      </div>
    </header>
  );
}
