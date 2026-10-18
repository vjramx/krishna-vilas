import { useEffect, useState } from 'react';
import { Link, Navigate } from 'react-router-dom';
import { ArrowLeft, Banknote, ClipboardCheck, HandCoins, Bike, MapPin } from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/context/AuthContext';
import { useLanguage } from '@/context/LanguageContext';
import { EmptyState, Spinner } from '@/components/ui';
import { formatRupee, rupeesToPaise } from '@/lib/money';
import type { Order } from '@/types/db';

const PREVIEW_STATUSES = ['assigned', 'accepted', 'picked_up'] as const;

/**
 * Read-only preview of the delivery-agent workspace for the admin.
 * Renders the same chrome/tabs an agent sees, with live order data, but every
 * action is disabled — mutations always require an actual agent identity.
 */
export default function AgentPreview() {
  const { t } = useLanguage();
  const { role, loading } = useAuth();
  const [orders, setOrders] = useState<Order[]>([]);
  const [busy, setBusy] = useState(true);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    if (loading || role !== 'admin') return;
    void supabase
      .from('orders')
      .select('*')
      .in('assignment_status', PREVIEW_STATUSES as unknown as string[])
      .order('created_at', { ascending: false })
      .then(({ data, error }) => {
        if (error) setErr(error.message);
        else setOrders((data as Order[]) ?? []);
        setBusy(false);
      });
  }, [loading, role]);

  if (loading) return <div className="grid min-h-dvh place-items-center"><Spinner /></div>;
  if (role !== 'admin') return <Navigate to="/agent/login" replace />;

  const tabs = [
    { label: t('agent.assigned'), icon: <Bike size={18} aria-hidden="true" /> },
    { label: t('agent.accepted'), icon: <ClipboardCheck size={18} aria-hidden="true" /> },
    { label: t('agent.codHandover'), icon: <HandCoins size={18} aria-hidden="true" /> },
  ];

  return (
    <div className="min-h-dvh bg-brand-bg">
      <header className="sticky top-0 z-30 bg-brand-secondary text-white shadow-elev1" style={{ paddingTop: 'var(--safe-top)' }}>
        <div className="mx-auto w-full max-w-app px-2">
          <div className="flex h-[56px] items-center gap-1">
            <Link to="/admin/agents" className="tap grid h-11 w-11 place-items-center rounded-full active:bg-white/15" aria-label={t('nav.back')}>
              <ArrowLeft size={20} aria-hidden="true" />
            </Link>
            <p className="min-w-0 flex-1 truncate text-[17px] font-bold">{t('agent.title')}</p>
            <span className="badge mr-1 bg-white/20 text-white">{t('admin.previewAgent')}</span>
          </div>
          <nav aria-label={t('agent.title')}>
            <ul className="flex gap-1 pb-1">
              {tabs.map((tab) => (
                <li key={tab.label} className="min-w-0 flex-1">
                  <span
                    aria-disabled="true"
                    className="flex min-h-[44px] items-center justify-center gap-1.5 rounded-lg px-2 text-sm font-medium text-white/70 min-w-0"
                  >
                    {tab.icon}
                    <span className="truncate">{tab.label}</span>
                  </span>
                </li>
              ))}
            </ul>
          </nav>
        </div>
      </header>

      <main className="app-col grid gap-3 pb-10 pt-3">
        <p className="rounded-xl border border-brand-border bg-white p-3 text-xs leading-relaxed text-brand-subtle shadow-soft" role="note">
          {t('admin.previewNote')}
        </p>

        {busy ? (
          <Spinner />
        ) : err ? (
          <p className="text-sm text-brand-error" role="alert">{err}</p>
        ) : orders.length === 0 ? (
          <EmptyState icon={<MapPin size={30} />} title={t('agent.noAssignments')} hint={t('agent.allDone')} />
        ) : (
          <ul className="grid gap-2">
            {orders.map((o) => (
              <li key={o.id} className="card grid gap-2 p-3">
                <div className="flex justify-between gap-2">
                  <span className="truncate font-bold tabular-nums">{o.order_number}</span>
                  <span className="badge whitespace-nowrap bg-brand-secondary/15 text-brand-primaryDark">
                    {t(`agent.steps.${o.assignment_status}`)}
                  </span>
                </div>
                <p className="truncate text-sm text-brand-subtle">{o.area} — {o.address_line}</p>
                <div className="flex flex-wrap items-center gap-2">
                  <span className="badge border border-brand-border bg-white">
                    <Banknote size={13} aria-hidden="true" /> {formatRupee(rupeesToPaise(o.total))}
                  </span>
                  <button type="button" className="btn-primary text-sm" disabled>
                    {t('agent.accept')}
                  </button>
                  <button type="button" className="btn-secondary text-sm" disabled>
                    {t('agent.decline')}
                  </button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </main>
    </div>
  );
}
