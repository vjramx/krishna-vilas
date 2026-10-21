import { NavLink, Navigate, Outlet, useNavigate } from 'react-router-dom';
import { useAuth } from '@/context/AuthContext';
import { useLanguage } from '@/context/LanguageContext';
import { Loader2, Bike, ClipboardCheck, HandCoins } from 'lucide-react';
import { Spinner } from '@/components/ui';
import { BrandLogo } from '@/components/BrandLogo';
import { supabase } from '@/lib/supabase';
import { haptic } from '@/lib/haptics';
import { applyAssignmentDelta } from '@/lib/agentAssignments';
import { showSnackbar } from '@/components/ui';
import { useEffect, useState } from 'react';
import type { Order } from '@/types/db';

/**
 * Rings when the backend auto-dispatches an order to this agent (admin accept
 * → least-loaded active agent). Mounted once for the logged-in agent so the
 * alert fires on ANY tab — the Assigned list only exists on its own route,
 * and an assignment landing while the agent is working the Active tab must
 * never be missed. Seeds known ids first so a fresh mount stays quiet about
 * assignments made before the app opened; every later realtime change goes
 * through the pure delta classifier, so accepting/declining/reassignment
 * keeps the alert state consistent even across reconnects.
 */
function AgentAssignmentNotifier() {
  const { userId } = useAuth();
  const { t } = useLanguage();
  const navigate = useNavigate();
  useEffect(() => {
    if (!userId) return;
    let seeded = false;
    const known = new Set<string>();
    let cancelled = false;
    void supabase
      .from('orders')
      .select('id, agent_id, assignment_status')
      .eq('agent_id', userId)
      .in('assignment_status', ['assigned'])
      .then(({ data }) => {
        if (cancelled) return;
        for (const row of (data as { id: string }[]) ?? []) known.add(row.id);
        seeded = true;
      });
    const channel = supabase
      .channel('agent-assign-notify')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'orders' }, (payload) => {
        const o = payload.new as Order | null;
        // DELETE carries only the old row: it cannot be a fresh assignment.
        if (!o || !o.id) return;
        const fired = applyAssignmentDelta(known, o, userId, { seeded });
        if (!fired) return;
        haptic(30);
        showSnackbar(`${o.order_number} · ${t('agent.newAssignment')}`, {
          label: t('agent.accept'),
          onAction: () => navigate('/agent'),
        });
      })
      .subscribe();
    return () => {
      cancelled = true;
      void supabase.removeChannel(channel);
    };
  }, [userId, t, navigate]);
  return null;
}

export function AgentLayout() {
  const { role, loading } = useAuth();
  const { t } = useLanguage();
  const [isActive, setIsActive] = useState<boolean | null>(null);

  useEffect(() => {
    if (role !== 'agent') return;
    void supabase.from('agent_users').select('is_active').maybeSingle().then(({ data }) => setIsActive(!!data?.is_active));
  }, [role]);

  if (loading) return <div className="grid min-h-dvh place-items-center"><Spinner /></div>;
  if (role !== 'agent') return <Navigate to="/agent/login" replace />;
  if (isActive === false) {
    return (
      <div className="grid min-h-dvh place-items-center bg-brand-bg px-4">
        <div className="card p-6 text-center">
          <Loader2 className="mx-auto text-brand-warn" aria-hidden="true" />
          <p className="mt-2 font-semibold">{t('agent.inactive')}</p>
        </div>
      </div>
    );
  }

  const tabs = [
    { to: '/agent', label: t('agent.assigned'), icon: Bike, end: true },
    { to: '/agent/active', label: t('agent.accepted'), icon: ClipboardCheck, end: false },
    { to: '/agent/cod', label: t('agent.codHandover'), icon: HandCoins, end: false },
  ];

  return (
    <div className="min-h-dvh bg-brand-bg">
      <AgentAssignmentNotifier />
      <header
        className="sticky top-0 z-30 bg-brand-secondary text-white shadow-elev1"
        style={{ paddingTop: 'var(--safe-top)' }}
      >
        <div className="mx-auto flex h-[56px] w-full max-w-app items-center gap-2.5 px-3">
          <BrandLogo size={40} className="rounded-xl border border-white/30" />
          <div className="min-w-0 flex-1 leading-tight">
            <p className="truncate text-[17px] font-bold">{t('agent.title')}</p>
            <p className="truncate text-[11px] opacity-85">{t('app.name')}</p>
          </div>
        </div>
      </header>

      <main className="app-col pb-nav pt-3">
        <Outlet />
      </main>

      <nav
        aria-label={t('agent.title')}
        className="fixed inset-x-0 bottom-0 z-40 border-t border-brand-border bg-white shadow-elev2"
        style={{ paddingBottom: 'var(--safe-bottom)' }}
      >
        <ul className="mx-auto flex w-full max-w-app">
          {tabs.map((tab) => {
            const Icon = tab.icon;
            return (
              <li key={tab.to} className="min-w-0 flex-1">
                <NavLink
                  to={tab.to}
                  end={tab.end}
                  onClick={() => haptic(6)}
                  className={({ isActive }) =>
                    `tap flex h-[58px] flex-col items-center justify-center gap-0.5 px-1 text-[11px] font-semibold ${
                      isActive ? 'text-brand-primary' : 'text-brand-subtle'
                    }`
                  }
                >
                  {({ isActive }) => (
                    <>
                      <span className={`grid h-7 w-14 place-items-center rounded-full ${isActive ? 'bg-brand-primary/12' : ''}`}>
                        <Icon size={21} strokeWidth={isActive ? 2.4 : 1.9} aria-hidden="true" />
                      </span>
                      <span className="max-w-full truncate">{tab.label}</span>
                    </>
                  )}
                </NavLink>
              </li>
            );
          })}
        </ul>
      </nav>
    </div>
  );
}
