import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useMyOrders } from '@/hooks/useOrders';
import { useLanguage } from '@/context/LanguageContext';
import { useAuth } from '@/context/AuthContext';
import { BottomNav, TopBackBar } from '@/components/nav';
import { EmptyState, ErrorState, OrderStatusBadge, Spinner } from '@/components/ui';
import { formatRupee, rupeesToPaise } from '@/lib/money';
import { ChevronRight, ClipboardList, MapPin } from 'lucide-react';
import type { OrderStatus } from '@/types/db';
import { customerOrderStatusLabel, customerVisibleOrderStatus } from '@/lib/orderPresentation';

const ACTIVE_STATUSES: OrderStatus[] = ['pending', 'confirmed', 'preparing', 'ready', 'out_for_delivery'];
type Filter = 'active' | 'completed' | 'all';

export default function OrdersPage() {
  const { t, lang } = useLanguage();
  const { session, loading: authLoading } = useAuth();
  const orders = useMyOrders();
  const [filter, setFilter] = useState<Filter>('all');

  if (authLoading) {
    return (
      <div className="min-h-dvh bg-brand-bg">
        <TopBackBar title={t('orders.title')} />
        <Spinner label={t('common.loading')} />
      </div>
    );
  }

  if (!session) {
    return (
      <div className="min-h-dvh bg-brand-bg">
        <TopBackBar title={t('orders.title')} />
        <div className="app-col py-6">
          <EmptyState
            icon={<ClipboardList size={32} />}
            title={t('order.signedInRequired')}
            action={<Link to="/login" className="btn-primary mt-2">{t('common.signIn')}</Link>}
          />
        </div>
      </div>
    );
  }

  const visible = orders.orders.filter((o) =>
    filter === 'all' ? true : filter === 'active' ? ACTIVE_STATUSES.includes(o.status) : !ACTIVE_STATUSES.includes(o.status),
  );

  return (
    <div className="min-h-dvh bg-brand-bg">
      <TopBackBar title={t('orders.title')} />
      <main className="app-col pb-nav pt-3">
        {orders.orders.length > 0 && (
          <div className="mb-2 flex items-center gap-2" role="tablist" aria-label={t('admin.filter')}>
            <Chip selected={filter === 'active'} onClick={() => setFilter('active')} label={t('orders.filterActive')} count={orders.orders.filter((o) => ACTIVE_STATUSES.includes(o.status)).length} />
            <Chip selected={filter === 'completed'} onClick={() => setFilter('completed')} label={t('orders.filterCompleted')} count={orders.orders.filter((o) => !ACTIVE_STATUSES.includes(o.status)).length} />
            <Chip selected={filter === 'all'} onClick={() => setFilter('all')} label={t('orders.filterAll')} />
            {orders.live && (
              <span className="ml-auto flex items-center gap-1.5 text-[11px] font-medium text-brand-subtle" aria-live="polite">
                <span aria-hidden="true" className="h-2 w-2 rounded-full bg-brand-success" />
                {t('orders.live')}
              </span>
            )}
          </div>
        )}
        {orders.fromCache && <p className="mb-2 text-center text-xs text-brand-subtle">{t('common.offline')}</p>}
        {orders.loading && orders.orders.length === 0 ? <Spinner /> :
         orders.error && orders.orders.length === 0 ? <ErrorState message={t('common.network')} onRetry={orders.retry} /> :
         visible.length === 0 ? (
          filter === 'all' ? (
            <EmptyState
              icon={<ClipboardList size={32} />}
              title={t('orders.empty')}
              hint={t('orders.emptyHint')}
              action={<Link to="/" className="btn-primary mt-2">{t('nav.menu')}</Link>}
            />
          ) : (
            <EmptyState icon={<ClipboardList size={28} />} title={filter === 'active' ? t('orders.filterActive') : t('orders.filterCompleted')} hint={t('orders.emptyHint')} />
          )
        ) : (
          <ul className="grid gap-2">
            {visible.map((o) => (
              <li key={o.id}>
                <Link to={`/order/${o.id}`} className="card tap flex min-w-0 items-center gap-2 p-3.5 active:bg-brand-bg/60">
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-[15px] font-bold tabular-nums">{o.order_number}</span>
                      <OrderStatusBadge status={customerVisibleOrderStatus(o.status)} label={customerOrderStatusLabel(o.status, t)} />
                    </div>
                    <div className="mt-1 flex items-center justify-between gap-2 text-[13px] text-brand-subtle">
                      <span className="min-w-0 truncate">{t('orders.payment')} · {formatRupee(rupeesToPaise(o.total))}</span>
                      <span className="whitespace-nowrap">{new Date(o.created_at).toLocaleString(lang === 'kn' ? 'kn-IN' : 'en-IN', { dateStyle: 'medium', timeStyle: 'short' })}</span>
                    </div>
                    <p className="mt-1 flex min-w-0 items-center gap-1 text-xs text-brand-subtle">
                      <MapPin size={13} className="shrink-0" aria-hidden="true" />
                      <span className="truncate">{o.address_line}, {o.area}</span>
                      <span className="shrink-0">· {o.delivery_latitude !== null && o.delivery_longitude !== null ? t('delivery.pinSaved') : t('checkout.noCoordinatesSelected')}</span>
                    </p>
                  </div>
                  <ChevronRight size={18} className="shrink-0 text-brand-subtle" aria-hidden="true" />
                </Link>
              </li>
            ))}
          </ul>
        )}
        {orders.hasMore && orders.orders.length > 0 && filter === 'all' && !orders.loading && (
          <button type="button" className="btn-secondary mx-auto mt-3 w-full" onClick={() => void orders.loadMore()}>
            {t('orders.loadMore')}
          </button>
        )}
      </main>
      <BottomNav />
    </div>
  );
}

function Chip({ selected, onClick, label, count }: { selected: boolean; onClick: () => void; label: string; count?: number }) {
  return (
    <button
      type="button"
      role="tab"
      aria-selected={selected}
      className={`rounded-full border px-3 py-1.5 text-[13px] font-semibold transition-colors ${
        selected ? 'border-brand-primary bg-brand-primary text-white' : 'border-brand-border bg-white text-brand-subtle'
      }`}
      onClick={onClick}
    >
      {label}
      {count !== undefined && <span className="ml-1 tabular-nums opacity-70">{count}</span>}
    </button>
  );
}
