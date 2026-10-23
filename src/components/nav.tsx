import { useEffect, useRef } from 'react';
import { NavLink, useNavigate } from 'react-router-dom';
import { Home, ShoppingBag, ClipboardList, User, ChevronLeft, Lock, PauseCircle } from 'lucide-react';
import { useLanguage } from '@/context/LanguageContext';
import { useCart } from '@/context/CartContext';
import { useAuth } from '@/context/AuthContext';
import { useHotelSettings } from '@/hooks/useHotelSettings';
import { haptic } from '@/lib/haptics';
import { BrandLogo } from '@/components/BrandLogo';

/**
 * Android app bar: 56dp tall, safe-area aware, solid brand fill with a thin
 * elevation. Never taller than one toolbar line so content stays above the fold.
 */
export function CustomerHeader({ title }: { title?: string }) {
  const { t, lang } = useLanguage();
  const { data: settings } = useHotelSettings();
  const { role } = useAuth();
  const navigate = useNavigate();
  const name = settings ? (lang === 'kn' ? settings.name_kn : settings.name_en) : t('app.name');
  const ref = useRef<HTMLElement>(null);

  // Publish the real header height so sticky content below it never overlaps
  // (the closed-kitchen notice changes the height at runtime).
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const publish = () =>
      document.documentElement.style.setProperty('--app-header', `${Math.round(el.getBoundingClientRect().height)}px`);
    publish();
    const ro = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(publish) : null;
    ro?.observe(el);
    return () => {
      ro?.disconnect();
      document.documentElement.style.removeProperty('--app-header');
    };
  }, [settings?.is_accepting_orders]);

  return (
    <header
      ref={ref}
      className="sticky top-0 z-30 bg-brand-primary text-white shadow-elev1"
      style={{ paddingTop: 'var(--safe-top)' }}
    >
      <div className="mx-auto flex h-[56px] w-full max-w-app items-center gap-2.5 px-3">
        <button
          type="button"
          onClick={() => navigate('/')}
          className="tap grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-white/15"
          aria-label={name}
        >
          <BrandLogo size={34} />
        </button>
        <div className="min-w-0 flex-1 leading-tight">
          <p className="truncate text-[17px] font-bold">{title ?? name}</p>
          <p className="truncate text-[11px] opacity-85">
            {title ? name : t('app.tagline')}
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-1">
          {role === 'admin' && (
            <button
              type="button"
              className="tap grid h-10 w-10 place-items-center rounded-xl bg-white/15"
              onClick={() => navigate('/admin')}
              aria-label={t('nav.admin')}
              title={t('nav.admin')}
            >
              <Lock size={18} aria-hidden="true" />
            </button>
          )}
          {role === 'agent' && (
            <button
              type="button"
              className="tap rounded-full bg-white/15 px-3 py-1.5 text-xs font-semibold"
              onClick={() => navigate('/agent')}
            >
              {t('nav.agent')}
            </button>
          )}
        </div>
      </div>
      {!settings?.is_accepting_orders && settings && (
        <p className="flex items-center justify-center gap-1.5 bg-brand-primaryDark px-3 py-1 text-center text-[12px] font-bold" role="status">
          <PauseCircle size={14} className="shrink-0" aria-hidden="true" />
          {t('checkout.notAccepting')}
        </p>
      )}
    </header>
  );
}

/**
 * Material 3 style bottom navigation: icon sits in a pill that fills when the
 * tab is active, labels stay at 11px, whole bar respects the gesture inset.
 */
export function BottomNav() {
  const { t } = useLanguage();
  const cart = useCart();
  const { role } = useAuth();

  const tabs = [
    { to: '/', label: t('nav.menu'), icon: Home },
    { to: '/cart', label: t('nav.cart'), icon: ShoppingBag },
    { to: '/orders', label: t('nav.orders'), icon: ClipboardList },
    { to: '/account', label: t('nav.account'), icon: User },
  ];

  return (
    <nav
      aria-label="Primary"
      className="fixed inset-x-0 bottom-0 z-40 border-t border-white/15 bg-brand-primary text-white shadow-elev2"
      style={{ paddingBottom: 'var(--safe-bottom)' }}
    >
      <ul className="mx-auto flex w-full max-w-app">
        {tabs.map((tab) => {
          const Icon = tab.icon;
          return (
            <li key={tab.to} className="min-w-0 flex-1">
              <NavLink
                to={tab.to}
                end={tab.to === '/'}
                onClick={() => haptic(6)}
                className={({ isActive }) =>
                  `tap flex h-[58px] flex-col items-center justify-center gap-0.5 text-[11px] font-semibold ${
                    isActive ? 'text-white' : 'text-white/70'
                  }`
                }
              >
                {({ isActive }) => (
                  <>
                    <span
                      className={`relative grid h-7 w-14 place-items-center rounded-full transition-colors ${
                        isActive ? 'bg-white/20' : ''
                      }`}
                    >
                      <Icon size={21} strokeWidth={isActive ? 2.4 : 1.9} aria-hidden="true" />
                      {tab.to === '/cart' && cart.count > 0 && (
                        <span className="absolute -top-1 right-1.5 min-w-[18px] rounded-full bg-white px-1 text-[10px] font-bold leading-[18px] text-brand-primary">
                          {cart.count > 99 ? '99+' : cart.count}
                        </span>
                      )}
                    </span>
                    <span className="max-w-full truncate px-0.5">{tab.label}</span>
                  </>
                )}
              </NavLink>
            </li>
          );
        })}
      </ul>
      {role !== 'customer' && role !== 'anon' && <p className="sr-only">Signed-in staff view</p>}
    </nav>
  );
}

/** Single-line back toolbar used by every secondary screen. */
export function TopBackBar({
  title,
  right,
  onBack,
}: {
  title: string;
  right?: React.ReactNode;
  onBack?: () => void;
}) {
  const { t } = useLanguage();
  const navigate = useNavigate();
  return (
    <header
      className="sticky top-0 z-30 bg-brand-primary text-white shadow-elev1"
      style={{ paddingTop: 'var(--safe-top)' }}
    >
      <div className="mx-auto flex h-[56px] w-full max-w-app items-center gap-1 px-1.5">
        <button
          type="button"
          onClick={() => {
            haptic(6);
            if (onBack) onBack();
            else navigate(-1);
          }}
          className="tap grid h-11 w-11 shrink-0 place-items-center rounded-full active:bg-white/15"
          aria-label={t('nav.back')}
        >
          <ChevronLeft size={26} aria-hidden="true" />
        </button>
        <h1 className="min-w-0 flex-1 truncate text-[17px] font-bold">{title}</h1>
        {right}
      </div>
    </header>
  );
}
