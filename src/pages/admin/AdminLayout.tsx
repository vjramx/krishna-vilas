import { useState } from 'react';
import { NavLink, Outlet, Navigate, useLocation, useNavigate } from 'react-router-dom';
import {
  LayoutDashboard,
  ClipboardList,
  UtensilsCrossed,
  Bike,
  Banknote,
  Settings,
  ShieldCheck,
  Users,
  Menu,
  LogOut,
  MoreHorizontal,
} from 'lucide-react';
import { useAuth } from '@/context/AuthContext';
import { useLanguage } from '@/context/LanguageContext';
import { BrandLogo } from '@/components/BrandLogo';
import { Sheet, Spinner } from '@/components/ui';

export function AdminLayout() {
  const { role, roleError, refreshRole, email, loading, session, signOut } = useAuth();
  const { t, lang } = useLanguage();
  const location = useLocation();
  const navigate = useNavigate();
  const [drawerOpen, setDrawerOpen] = useState(false);

  if (loading) return <div className="min-h-dvh place-items-center grid"><Spinner /></div>;

  // Authorization could not be verified (token rejected / RPC failure): show a
  // useful denied state with a retry, not a silent bounce to the sign-in page.
  if (role !== 'admin') {
    if (session && roleError) {
      return (
        <main className="min-h-dvh grid place-items-center px-4 bg-brand-bg">
          <div className="card max-w-sm p-6 text-center" role="alert" data-testid="admin-access-denied">
            <p className="text-sm text-brand-error">{t('login.roleCheckFailed')}</p>
            <button
              type="button"
              className="btn btn-ghost mx-auto mt-3 w-fit rounded-lg px-4 py-2 text-sm font-semibold"
              onClick={() => void refreshRole()}
            >
              {t('login.retryRoleCheck')}
            </button>
          </div>
        </main>
      );
    }
    return <Navigate to="/admin/login" state={{ from: location }} replace />;
  }

  const tabs = [
    { to: '/admin', label: t('admin.dashboard'), icon: <LayoutDashboard size={18} aria-hidden="true" />, end: true },
    { to: '/admin/orders', label: t('admin.orders'), icon: <ClipboardList size={18} aria-hidden="true" />, end: false },
    { to: '/admin/menu', label: t('admin.menu'), icon: <UtensilsCrossed size={18} aria-hidden="true" />, end: false },
    { to: '/admin/agents', label: t('admin.agents'), icon: <Bike size={18} aria-hidden="true" />, end: false },
    { to: '/admin/cod', label: t('admin.cod'), icon: <Banknote size={18} aria-hidden="true" />, end: false },
    { to: '/admin/settings', label: t('admin.settings'), icon: <Settings size={18} aria-hidden="true" />, end: false },
    { to: '/admin/access', label: t('admin.access'), icon: <ShieldCheck size={18} aria-hidden="true" />, end: false },
    { to: '/admin/users', label: t('admin.usersNav'), icon: <Users size={18} aria-hidden="true" />, end: false },
  ];

  const signOutNow = () => void signOut().then(() => navigate('/', { replace: true }));

  const linkCls = ({ isActive }: { isActive: boolean }) =>
    `flex items-center gap-3 rounded-xl px-3.5 py-2.5 text-sm font-semibold min-h-[44px] ${
      isActive
        ? 'bg-white text-brand-text shadow-soft'
        : 'text-white/75 active:bg-white/10'
    }`;

  return (
    <div className="min-h-dvh bg-brand-bg">
      {/* Top bar */}
      <header
        className="sticky top-0 z-40 bg-gradient-to-r from-brand-primary to-brand-secondary text-white"
        style={{ paddingTop: 'var(--safe-top)' }}
      >
        <div className="flex items-center gap-2 px-3 py-2.5">
          {/* Mobile hamburger */}
          <button
            type="button"
            className="grid h-11 w-11 place-items-center rounded-lg active:bg-white/15 lg:hidden"
            aria-label={t('admin.menu')}
            aria-expanded={drawerOpen}
            onClick={() => setDrawerOpen(true)}
          >
            <Menu size={22} aria-hidden="true" />
          </button>
          <BrandLogo size={36} />
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-bold leading-tight">{t('admin.title')} · {lang === 'kn' ? 'ಕೃಷ್ಣ ವಿಲಾಸ್' : 'Krishna Vilas'}</p>
            <p className="truncate text-[11px] opacity-75">{t('admin.ordersLive')}</p>
          </div>
          <button
            type="button"
            onClick={signOutNow}
            className="grid h-11 w-11 place-items-center rounded-lg active:bg-white/15"
            aria-label={t('common.signOut')}
          >
            <LogOut size={20} aria-hidden="true" />
          </button>
        </div>
      </header>

      <div className="mx-auto flex w-full max-w-6xl">
        {/* Desktop sidebar */}
        <aside
          className="sticky hidden h-[calc(100dvh-3.5rem)] w-60 shrink-0 flex-col gap-1 overflow-y-auto bg-brand-text px-3 py-4 lg:flex"
          style={{ top: 'calc(3.5rem + var(--safe-top))' }}
          aria-label={t('admin.title')}
        >
          {tabs.map((tab) => (
            <NavLink key={tab.to} to={tab.to} end={tab.end} className={linkCls}>
              {tab.icon}
              {tab.label}
            </NavLink>
          ))}
          <div className="mt-auto grid gap-1 border-t border-white/10 pt-3 px-2">
            <p className="truncate text-xs text-white/60">{email}</p>
            <button type="button" onClick={signOutNow} className={linkCls({ isActive: false })}>
              <LogOut size={18} aria-hidden="true" />
              {t('common.signOut')}
            </button>
          </div>
        </aside>

        {/* Content */}
        <main className="min-w-0 flex-1 px-3 pb-28 pt-4 sm:px-5 lg:pb-6">
          <Outlet />
        </main>
      </div>

      {/* Mobile bottom navigation — the parts of admin used every day, plus More. */}
      <nav
        aria-label={t('admin.title')}
        className="fixed inset-x-0 bottom-0 z-40 border-t border-brand-border bg-white shadow-elev2 lg:hidden"
        style={{ paddingBottom: 'var(--safe-bottom)' }}
      >
        <ul className="mx-auto flex w-full max-w-app">
          {tabs.slice(0, 3).map((tab) => (
            <li key={tab.to} className="min-w-0 flex-1">
              <NavLink
                to={tab.to}
                end={tab.end}
                className={({ isActive }) =>
                  `tap flex h-[58px] flex-col items-center justify-center gap-0.5 px-1 text-[11px] font-semibold ${
                    isActive ? 'text-brand-primary' : 'text-brand-subtle'
                  }`
                }
              >
                {({ isActive }) => (
                  <>
                    <span className={`grid h-7 w-14 place-items-center rounded-full ${isActive ? 'bg-brand-primary/10' : ''}`}>
                      {tab.icon}
                    </span>
                    <span className="max-w-full truncate">{tab.label}</span>
                  </>
                )}
              </NavLink>
            </li>
          ))}
          <li className="min-w-0 flex-1">
            <button
              type="button"
              onClick={() => setDrawerOpen(true)}
              aria-expanded={drawerOpen}
              className={`tap flex h-[58px] w-full flex-col items-center justify-center gap-0.5 px-1 text-[11px] font-semibold ${
                tabs.slice(3).some((tab) => location.pathname.startsWith(tab.to))
                  ? 'text-brand-primary'
                  : 'text-brand-subtle'
              }`}
            >
              <span className="grid h-7 w-14 place-items-center rounded-full">
                <MoreHorizontal size={21} aria-hidden="true" />
              </span>
              <span className="max-w-full truncate">{t('common.more')}</span>
            </button>
          </li>
        </ul>
      </nav>

      {/* Mobile drawer */}
      <Sheet open={drawerOpen} onClose={() => setDrawerOpen(false)} title={t('admin.title')}>
        <nav className="grid gap-1" aria-label={t('admin.title')}>
          {tabs.map((tab) => (
            <NavLink
              key={tab.to}
              to={tab.to}
              end={tab.end}
              className={({ isActive }) =>
                `flex items-center gap-3 rounded-xl px-3 py-3 text-sm font-semibold min-h-[48px] ${
                  isActive ? 'bg-brand-primary/10 text-brand-primary' : 'text-brand-text active:bg-brand-bg'
                }`
              }
              onClick={() => setDrawerOpen(false)}
            >
              {tab.icon}
              {tab.label}
            </NavLink>
          ))}
          <button
            type="button"
            onClick={() => void signOut().then(() => navigate('/', { replace: true }))}
            className="btn-secondary mt-2 text-brand-error"
          >
            <LogOut size={18} aria-hidden="true" />
            {t('common.signOut')}
          </button>
        </nav>
      </Sheet>
    </div>
  );
}
