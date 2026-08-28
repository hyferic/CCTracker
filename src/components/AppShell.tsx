import { useState } from 'react';
import { NavLink, Outlet, useLocation } from 'react-router-dom';
import { useAuth } from '../features/auth/AuthProvider';
import { Icon, type IconName } from './Icon';

const titles: Record<string, string> = {
  '/dashboard': 'Dashboard',
  '/benefits': 'Benefits',
  '/benefits/new': 'Add benefit',
  '/accounts': 'Cards & accounts',
  '/settings': 'Settings & data',
};

export function AppShell() {
  const auth = useAuth();
  const location = useLocation();
  const [menuOpen, setMenuOpen] = useState(false);
  const title =
    titles[location.pathname] ??
    (location.pathname.startsWith('/instances/')
      ? 'Benefit period'
      : location.pathname.includes('/edit')
        ? 'Edit benefit'
        : 'PerkLedger');
  const navItems = [
    { to: '/dashboard', label: 'Dashboard', icon: 'grid' },
    { to: '/benefits', label: 'Benefits', icon: 'archive' },
    { to: '/accounts', label: 'Cards & accounts', icon: 'wallet' },
    { to: '/settings', label: 'Settings & data', icon: 'settings' },
  ] satisfies Array<{ to: string; label: string; icon: IconName }>;

  return (
    <div className="app" data-testid="app-shell">
      <a className="skip-link" href="#main-content">
        Skip to main content
      </a>
      <aside
        className={`sidebar ${menuOpen ? 'sidebar--open' : ''}`}
        aria-label="Primary navigation"
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
            aria-label="Close menu"
          >
            <Icon name="close" />
          </button>
        </div>
        <nav>
          {navItems.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
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
            <strong>Owner</strong>
            <small title={auth.user?.email}>{auth.user?.email}</small>
          </span>
          <button
            className="icon-button"
            onClick={() => void auth.signOut()}
            aria-label="Sign out"
            title="Sign out"
          >
            <Icon name="logout" />
          </button>
        </div>
      </aside>
      {menuOpen && (
        <button
          className="scrim"
          onClick={() => setMenuOpen(false)}
          aria-label="Close navigation"
        />
      )}
      <div className="app-main">
        <header className="topbar">
          <button
            className="icon-button menu-button"
            onClick={() => setMenuOpen(true)}
            aria-label="Open menu"
          >
            <Icon name="menu" />
          </button>
          <div>
            <p className="topbar-kicker">Benefit tracker</p>
            <h1>{title}</h1>
          </div>
          <NavLink className="button button--primary topbar-action" to="/benefits/new">
            <Icon name="plus" />
            <span>Add benefit</span>
          </NavLink>
        </header>
        <main id="main-content" className="content" tabIndex={-1}>
          <Outlet />
        </main>
      </div>
    </div>
  );
}
