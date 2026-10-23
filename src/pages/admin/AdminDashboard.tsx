import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  Banknote, Bike, CheckCircle2, CircleDollarSign, Clock3, CookingPot,
  PackageCheck, ShoppingBag, Store, Truck, XCircle,
} from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/context/AuthContext';
import { useLanguage } from '@/context/LanguageContext';
import { useHotelSettings } from '@/hooks/useHotelSettings';
import { OrderStatusBadge, Spinner, StatusSwitch } from '@/components/ui';
import { isMissingRpcFunction, parseKvError } from '@/lib/errors';
import { formatRupee, rupeesToPaise } from '@/lib/money';
import type { Order, OrderStatus } from '@/types/db';
import { applyRealtime } from '@/hooks/useOrders';

const POLL_MS = 20000;
const REFRESH_STATUSES: OrderStatus[] = ['pending', 'confirmed', 'preparing', 'ready', 'out_for_delivery', 'delivered', 'rejected', 'cancelled'];

type MetricKey = 'pending' | 'confirmed' | 'preparing' | 'ready' | 'out_for_delivery' | 'delivered' | 'rejected' | 'cancelled' | 'orders_today' | 'order_value_today' | 'delivered_sales_today' | 'cod_pending' | 'cod_verified';
interface DailySummary { date: string; orders: number; order_value: number; }
type Summary = Record<MetricKey, number | string> & { last_7_days: DailySummary[] };
const zeroSummary: Summary = {
  pending: 0, confirmed: 0, preparing: 0, ready: 0, out_for_delivery: 0,
  delivered: 0, rejected: 0, cancelled: 0, orders_today: 0,
  order_value_today: 0, delivered_sales_today: 0, cod_pending: 0,  cod_verified: 0,
  last_7_days: [],
};


function metricValue(summary: Summary | null, key: MetricKey): number | null {
  if (!summary) return null;
  const value = Number(summary[key]);
  return Number.isFinite(value) ? value : null;
}

export default function AdminDashboard() {
  const { t, locale } = useLanguage();
  const { email } = useAuth();
  const { data: settings, retry: refreshSettings } = useHotelSettings();
  const [orders, setOrders] = useState<Order[]>([]);
  const [summary, setSummary] = useState<Summary | null>(null);
  const [loading, setLoading] = useState(true);
  const [settingsBusy, setSettingsBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [summaryError, setSummaryError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    const [summaryResult, ordersResult] = await Promise.all([
      supabase.rpc('admin_dashboard_summary'),
      supabase.from('orders').select('*').in('status', REFRESH_STATUSES).order('created_at', { ascending: false }).limit(8),
    ]);
    if (summaryResult.error) {
      const missingSummaryRpc = isMissingRpcFunction(summaryResult.error, 'admin_dashboard_summary');
      if (import.meta.env.DEV) console.error('[admin dashboard] summary RPC failed', summaryResult.error);
      setSummaryError(t(missingSummaryRpc ? 'admin.analyticsMigrationRequired' : parseKvError(summaryResult.error).key));
      setSummary(null);
    } else {
      setSummaryError(null);
      setSummary({ ...zeroSummary, ...(summaryResult.data as Partial<Summary>) });
    }
    if (ordersResult.error) setError(t(parseKvError(ordersResult.error).key));
    else {
      setError(null);
      setOrders((ordersResult.data as Order[]) ?? []);
    }
    setLoading(false);
  }, [t]);

  useEffect(() => {
    let active = true;
    let pollTimer: number | null = null;
    const load = async () => { if (active) await refresh(); };
    void load();
    const startPolling = () => {
      if (pollTimer !== null) return;
      pollTimer = window.setInterval(() => void load(), POLL_MS);
    };
    const stopPolling = () => {
      if (pollTimer !== null) window.clearInterval(pollTimer);
      pollTimer = null;
    };
    const channel = supabase.channel('admin-dashboard-live')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'orders' }, (payload) => {
        setOrders((previous) => applyRealtime(previous, payload as unknown as { eventType: 'INSERT' | 'UPDATE' | 'DELETE'; new: Order | null; old: { id: string } | null })
          .filter((order) => REFRESH_STATUSES.includes(order.status)).slice(0, 8));
        void refresh();
      })
      .subscribe((status) => {
        if (status === 'SUBSCRIBED') stopPolling();
        if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT' || status === 'CLOSED') startPolling();
      });
    const onVisible = () => { if (document.visibilityState === 'visible') void load(); };
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      active = false;
      stopPolling();
      document.removeEventListener('visibilitychange', onVisible);
      void supabase.removeChannel(channel);
    };
  }, [refresh]);

  async function toggleAccepting() {
    if (!settings || settingsBusy) return;
    setSettingsBusy(true);
    setError(null);
    try {
      const { error: updateError } = await supabase.from('hotel_settings')
        .update({ is_accepting_orders: !settings.is_accepting_orders }).eq('id', 1);
      if (updateError) throw updateError;
      await refreshSettings();
    } catch (requestError) {
      setError(t(parseKvError(requestError).key));
    } finally {
      setSettingsBusy(false);
    }
  }

  const dateLabel = useMemo(() => new Intl.DateTimeFormat(locale, { dateStyle: 'full' }).format(new Date()), [locale]);
  const greetingName = email?.split('@')[0]?.replace(/[._-]+/g, ' ').replace(/\b\w/g, (letter) => letter.toUpperCase()) || t('admin.admin');
  const orderTiles = [
    { key: 'pending' as const, label: t('admin.newOrders'), to: '/admin/orders?tab=pending', Icon: ShoppingBag, color: 'text-brand-primary' },
    { key: 'confirmed' as const, label: t('admin.accepted'), to: '/admin/orders?tab=confirmed', Icon: CheckCircle2, color: 'text-brand-success' },
    { key: 'preparing' as const, label: t('admin.preparing'), to: '/admin/orders?tab=preparing', Icon: CookingPot, color: 'text-brand-secondary' },
    { key: 'ready' as const, label: t('admin.ready'), to: '/admin/orders?tab=ready', Icon: PackageCheck, color: 'text-brand-primary' },
    { key: 'out_for_delivery' as const, label: t('admin.outForDelivery'), to: '/admin/orders?tab=out_for_delivery', Icon: Truck, color: 'text-brand-secondary' },
    { key: 'delivered' as const, label: t('admin.deliveredToday'), to: '/admin/orders?tab=delivered', Icon: Bike, color: 'text-brand-success' },
    { key: 'rejected' as const, label: t('admin.rejected'), to: '/admin/orders?tab=rejected', Icon: XCircle, color: 'text-brand-error' },
    { key: 'cancelled' as const, label: t('admin.cancelled'), to: '/admin/orders?tab=cancelled', Icon: XCircle, color: 'text-brand-subtle' },
  ];
  const businessTiles = [
    { key: 'orders_today' as const, label: t('admin.ordersToday'), Icon: ShoppingBag, money: false },
    { key: 'order_value_today' as const, label: t('admin.orderValueToday'), Icon: CircleDollarSign, money: true },
    { key: 'delivered_sales_today' as const, label: t('admin.deliveredSalesToday'), Icon: Store, money: true },
    { key: 'cod_pending' as const, label: t('admin.codPending'), Icon: Clock3, money: true },
    { key: 'cod_verified' as const, label: t('admin.codVerifiedTotal'), Icon: Banknote, money: true },
  ];

  if (loading) return <Spinner label={t('common.loading')} />;

  return (
    <div className="grid gap-5">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="text-xs font-semibold uppercase tracking-wider text-brand-primary">{t('admin.dashboard')}</p>
          <h1 className="mt-1 text-2xl font-extrabold tracking-tight">{t('admin.greeting', { name: greetingName })}</h1>
          <p className="mt-1 text-sm text-brand-subtle">{dateLabel}</p>
        </div>
        <Link to="/admin/menu" className="btn-secondary text-sm"><UtensilsCrossedIcon /> {t('admin.manageMenu')}</Link>
      </header>

      {summaryError && <p className="rounded-xl border border-brand-error/25 bg-brand-errorBg px-3 py-2 text-sm text-brand-error" role="alert">{summaryError}</p>}
      {error && <p className="rounded-xl border border-brand-error/25 bg-brand-errorBg px-3 py-2 text-sm text-brand-error" role="alert">{error}</p>}

      {settings && <section className="card flex flex-wrap items-center justify-between gap-3 p-4" aria-label={t('admin.restaurantStatus')}>
        <div className="flex min-w-0 items-center gap-3"><span className={`grid h-10 w-10 shrink-0 place-items-center rounded-xl ${settings.is_accepting_orders ? 'bg-brand-successBg text-brand-success' : 'bg-brand-errorBg text-brand-error'}`}><Store size={19} aria-hidden="true" /></span><div className="min-w-0"><h2 className="text-sm font-bold">{t('admin.restaurantStatus')}</h2><p className="text-sm text-brand-subtle">{settings.is_accepting_orders ? t('admin.openNow') : t('admin.pauseOrders')} · {settings.opens_at.slice(0, 5)}–{settings.closes_at.slice(0, 5)}</p></div></div>
        <StatusSwitch checked={settings.is_accepting_orders} busy={settingsBusy} label={t('admin.acceptingOrders')} onChange={() => void toggleAccepting()} />
      </section>}

      <section className="grid gap-2" aria-labelledby="overview-orders-heading">
        <h2 id="overview-orders-heading" className="text-sm font-bold">{t('admin.orderOverview')}</h2>
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 xl:grid-cols-4">
          {orderTiles.map(({ key, label, to, Icon, color }) => <Link key={key} to={to} className="card flex min-h-[92px] items-center gap-3 p-3 transition-shadow hover:shadow-elev1"><span className={`grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-brand-bg ${color}`}><Icon size={18} aria-hidden="true" /></span><span className="min-w-0"><span className="block text-xl font-extrabold tabular-nums">{metricValue(summary, key) ?? '—'}</span><span className="block text-xs text-brand-subtle">{label}</span></span></Link>)}
        </div>
      </section>

      <section className="grid gap-2" aria-labelledby="overview-business-heading">
        <h2 id="overview-business-heading" className="text-sm font-bold">{t('admin.todayAndCash')}</h2>
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 xl:grid-cols-5">
          {businessTiles.map(({ key, label, Icon, money }) => <article key={key} className="card grid gap-2 p-3"><span className="grid h-9 w-9 place-items-center rounded-xl bg-brand-primary/10 text-brand-primary"><Icon size={18} aria-hidden="true" /></span><p className="text-xs text-brand-subtle">{label}</p><p className="text-lg font-extrabold tabular-nums">{metricValue(summary, key) === null ? '—' : money ? formatRupee(rupeesToPaise(metricValue(summary, key)!)) : metricValue(summary, key)}</p></article>)}
        </div>
        <p className="text-[11px] text-brand-subtle">{t('admin.salesMetricDefinition')}</p>
      </section>

      <section className="card grid gap-3 p-4" aria-labelledby="weekly-summary-heading">
        <div className="flex flex-wrap items-center justify-between gap-2"><h2 id="weekly-summary-heading" className="font-bold">{t('admin.lastSevenDays')}</h2><span className="text-xs text-brand-subtle">{t('admin.orderValueToday')}</span></div>
        <div className="grid grid-cols-7 items-end gap-2" role="img" aria-label={t('admin.lastSevenDays')}>
          {(summary?.last_7_days ?? []).map((day) => {
            const maximum = Math.max(1, ...(summary?.last_7_days ?? []).map((entry) => Number(entry.order_value) || 0));
            const amount = Number(day.order_value) || 0;
            const height = amount ? Math.max(8, (amount / maximum) * 100) : 3;
            return <div key={day.date} className="grid min-w-0 justify-items-center gap-1" title={`${day.date}: ${formatRupee(rupeesToPaise(amount))}, ${day.orders} ${t('admin.orders').toLowerCase()}`}><span className="text-[10px] tabular-nums text-brand-subtle">{day.orders}</span><span className="w-full rounded-t-md bg-brand-primary" style={{ height: `${height}px` }} /><span className="text-[10px] text-brand-subtle">{new Intl.DateTimeFormat(locale, { weekday: 'short' }).format(new Date(`${day.date}T12:00:00`))}</span></div>;
          })}
        </div>
      </section>

      <section className="card grid gap-3 p-4" aria-labelledby="recent-orders-heading">
        <div className="flex items-center justify-between gap-2"><h2 id="recent-orders-heading" className="font-bold">{t('admin.recentOrders')}</h2><Link to="/admin/orders" className="btn-ghost min-h-[40px] text-sm">{t('common.view')}</Link></div>
        {orders.length === 0 ? <p className="text-sm text-brand-subtle">{t('admin.noOrders')}</p> : <ul className="grid gap-2">{orders.map((order) => <li key={order.id} className="flex min-w-0 flex-wrap items-center gap-2 border-t border-brand-border pt-2 first:border-0 first:pt-0"><span className="min-w-[75px] font-bold tabular-nums">{order.order_number}</span><span className="min-w-0 flex-1 truncate text-sm">{order.customer_name}</span><span className="whitespace-nowrap text-sm font-semibold">{formatRupee(rupeesToPaise(order.total))}</span><OrderStatusBadge status={order.status} /><span className="badge bg-brand-bg text-brand-subtle">COD {order.cash_verified_at ? t('admin.codVerified') : order.cod_collected ? t('admin.codCollected') : t('admin.codPending')}</span><span className="text-[11px] text-brand-subtle">{new Intl.DateTimeFormat(locale, { timeStyle: 'short' }).format(new Date(order.created_at))}</span></li>)}</ul>}
      </section>
    </div>
  );
}

function UtensilsCrossedIcon() {
  return <ShoppingBag size={16} aria-hidden="true" />;
}
