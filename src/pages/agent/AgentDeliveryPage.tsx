import { useParams } from 'react-router-dom';
import { useOrder } from '@/hooks/useOrders';
import { useLanguage } from '@/context/LanguageContext';
import { useAuth } from '@/context/AuthContext';
import { TopBackBar } from '@/components/nav';
import { ErrorState, OrderStatusBadge, Spinner } from '@/components/ui';
import { formatRupee, rupeesToPaise } from '@/lib/money';
import { Phone, Clock } from 'lucide-react';
import { OrderDestination } from '@/components/OrderDestination';
import { customerVisibleOrderStatus, customerOrderStatusLabel } from '@/lib/orderPresentation';

export default function AgentDeliveryPage() {
  const { t, lang } = useLanguage();
  const { userId } = useAuth();
  const { id } = useParams<{ id: string }>();
  const { order, items, loading, error, retry } = useOrder(id);

  if (!userId || loading) return <div className="min-h-dvh bg-brand-bg"><TopBackBar title={t('agent.pickupInstr')} /><Spinner /></div>;
  if (error || !order) {
    return (
      <div className="min-h-dvh bg-brand-bg">
        <TopBackBar title={t('agent.title')} />
        <div className="app-col py-4"><ErrorState message={t('err.orderNotFound')} onRetry={retry} /></div>
      </div>
    );
  }

  // Map navigation removed — the destination card below carries the saved
  // address text (landmark, instructions) and the tap-to-call phone action.

  return (
    <div className="min-h-dvh bg-brand-bg">
      <TopBackBar title={order.order_number} />
      <main className="app-col grid gap-3 pb-10 pt-3">
        <section className="card animate-rise p-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <span className="font-bold tabular-nums">{order.order_number}</span>
            <OrderStatusBadge status={customerVisibleOrderStatus(order.status)} label={customerOrderStatusLabel(order.status, t)} />
          </div>
          <p className="mt-2 text-sm text-brand-subtle">{t('agent.pickupInstr')}</p>
          <p className="mt-1 font-semibold">{t('agent.codNote', { amount: formatRupee(rupeesToPaise(order.total)) })}</p>
          {order.eta_minutes != null && (
            <p className="mt-1 flex items-center gap-1.5 text-sm font-semibold text-brand-success"><Clock size={14} aria-hidden="true" /> {t('order.etaArrival', { minutes: String(order.eta_minutes) })}</p>
          )}
        </section>

        <section className="card p-4">
          <p className="font-bold">{t('agent.customer')}</p>
          <p>{order.customer_name} · <a className="underline tabular-nums" href={`tel:${order.phone}`}><b>{order.phone}</b></a></p>
          <OrderDestination order={order} audience="agent" />
          <a href={`tel:${order.phone}`} className="btn-secondary mt-2 w-full text-sm"><Phone size={14} aria-hidden="true" /> <span className="tabular-nums">{order.phone}</span></a>
        </section>

        <section className="card p-4">
          <p className="font-bold text-sm mb-1">{t('order.items')}</p>
          <ul className="grid gap-1 text-sm">
            {items.map((it) => (
              <li key={it.id} className="flex justify-between gap-2">
                <span className="min-w-0 truncate">{lang === 'kn' ? it.name_kn || it.name_en : it.name_en} × {it.quantity}</span>
                <span>{formatRupee(rupeesToPaise(it.item_total))}</span>
              </li>
            ))}
          </ul>
          <p className="mt-2 font-bold text-sm">{t('checkout.cod')}: {formatRupee(rupeesToPaise(order.total))}</p>
        </section>
      </main>
    </div>
  );
}
