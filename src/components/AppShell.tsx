import { useState } from 'react';
import { NavLink, Outlet, useLocation } from 'react-router-dom';
import { useAuth } from '../features/auth/AuthProvider';
import { useI18n, type MessageKey } from '../features/i18n/I18nContext';
import { Icon, type IconName } from './Icon';

const titles: Record<string, MessageKey> = {
  '/dashboard': 'nav.dashboard',
  '/benefits': 'nav.benefits',
  '/benefits/new': 'common.addBenefit',
  '/accounts': 'nav.accounts',
  '/settings': 'nav.settings',
};

export function AppShell() {
  const auth = useAuth();
  const { t } = useI18n();
  const location = useLocation();
  const [menuOpen, setMenuOpen] = useState(false);
  const titleKey = titles[location.pathname];
  const title = titleKey
    ? t(titleKey)
    : location.pathname.startsWith('/instances/')
      ? t('common.benefitPeriod')
      : location.pathname.includes('/edit')
        ? t('common.editBenefit')
        : t('common.benefitTracker');
  const navItems = [
    { to: '/dashboard', label: t('nav.dashboard'), icon: 'grid' },
    { to: '/benefits', label: t('nav.benefits'), icon: 'archive' },
    { to: '/accounts', label: t('nav.accounts'), icon: 'wallet' },
    { to: '/settings', label: t('nav.settings'), icon: 'settings' },
  ] satisfies Array<{ to: string; label: string; icon: IconName }>;

  return (
    <div className="app" data-testid="app-shell">
      <a className="skip-link" href="#main-content">
        {t('common.skipToContent')}
      </a>
      <aside
        id="primary-navigation"
        className={`sidebar ${menuOpen ? 'sidebar--open' : ''}`}
        aria-label={t('common.primaryNavigation')}
      >
        <div className="sidebar-head">
          <NavLink
            className="brand brand--light"
            to="/dashboard"
            onClick={() => setMenuOpen(false)}
          >
            <span className="brand-mark" aria-hidden="true">
              P
            </span>
            <span>PerkLedger</span>
          </NavLink>
          <button
            className="icon-button sidebar-close"
            onClick={() => setMenuOpen(false)}
            aria-label={t('common.closeMenu')}
            type="button"
          >
            <Icon name="close" />
          </button>
        </div>
        <nav>
          {navItems.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              end={item.to === '/dashboard'}
              onClick={() => setMenuOpen(false)}
              className={({ isActive }) => `nav-link ${isActive ? 'nav-link--active' : ''}`}
            >
              <span className="nav-icon" aria-hidden="true">
                <Icon name={item.icon} />
              </span>
              {item.label}
            </NavLink>
          ))}
        </nav>
        <div className="sidebar-footer">
          <span className="avatar" aria-hidden="true">
            {auth.user?.email?.slice(0, 1).toUpperCase()}
          </span>
          <span className="sidebar-user">
            <strong>{t('common.owner')}</strong>
            <small title={auth.user?.email}>{auth.user?.email}</small>
          </span>
          <button
            className="icon-button"
            onClick={() => void auth.signOut()}
            aria-label={t('common.signOut')}
            title={t('common.signOut')}
            type="button"
          >
            <Icon name="logout" />
          </button>
        </div>
      </aside>
      {menuOpen && (
        <button
          className="scrim"
          onClick={() => setMenuOpen(false)}
          aria-label={t('common.closeMenu')}
          type="button"
        />
      )}
      <div className="app-main">
        <header className="topbar">
          <button
            className="icon-button menu-button"
            onClick={() => setMenuOpen(true)}
            aria-label={t('common.openMenu')}
            aria-controls="primary-navigation"
            aria-expanded={menuOpen}
            type="button"
          >
            <Icon name="menu" />
          </button>
          <div>
            <p className="topbar-kicker">{t('common.benefitTracker')}</p>
            <h1>{title}</h1>
          </div>
          <NavLink className="button button--primary topbar-action" to="/benefits/new">
            <Icon name="plus" />
            <span>{t('common.addBenefit')}</span>
          </NavLink>
        </header>
        <main id="main-content" className="content" tabIndex={-1}>
          <Outlet />
        </main>
      </div>
    </div>
  );
}
