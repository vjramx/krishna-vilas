import { useOrder } from '@/hooks/useOrders';
import { useLanguage } from '@/context/LanguageContext';
import { useAuth } from '@/context/AuthContext';
import { TopBackBar } from '@/components/nav';
import { ErrorState, Spinner } from '@/components/ui';
import { formatRupee, rupeesToPaise } from '@/lib/money';
import { Phone } from 'lucide-react';
import { OrderDestination } from '@/components/OrderDestination';

export default function AgentDeliveryPage() {
  const { t, lang } = useLanguage();
  const { userId } = useAuth();
  const id = window.location.pathname.split('/').pop();
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

  return (
    <div className="min-h-dvh bg-brand-bg">
      <TopBackBar title={order.order_number} />
      <main className="app-col grid gap-3 pb-10 pt-3">
        <section className="card p-4">
          <p className="text-sm font-bold">{t('agent.pickupInstr')}</p>
          <p className="text-sm text-brand-subtle">{t('checkout.area')}: {order.area}</p>
          <p className="mt-1 font-semibold">{t('agent.codNote', { amount: formatRupee(rupeesToPaise(order.total)) })}</p>
        </section>

        <section className="card p-4 text-sm">
          <p className="font-bold">{t('agent.customer')}</p>
          <p>{order.customer_name}</p>
          <OrderDestination order={order} audience="agent" />
          <a href={`tel:${order.phone}`} className="btn-secondary mt-2 w-fit text-sm"><Phone size={14} aria-hidden="true" /> <span className="tabular-nums">{order.phone}</span></a>

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
