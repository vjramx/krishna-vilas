import { useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useOrder } from '@/hooks/useOrders';
import { useLanguage } from '@/context/LanguageContext';
import { TopBackBar } from '@/components/nav';
import { EmptyState, ErrorState, OrderStatusBadge, Sheet, showSnackbar, Spinner } from '@/components/ui';
import { formatRupee, rupeesToPaise } from '@/lib/money';
import { publicImageUrl, supabase } from '@/lib/supabase';
import { parseKvError } from '@/lib/errors';
import { CheckCircle2, Circle, Clock, Utensils, XCircle } from 'lucide-react';
import type { Order, OrderStatus } from '@/types/db';
import { OrderDestination } from '@/components/OrderDestination';
import { customerOrderStatusLabel, customerVisibleOrderStatus } from '@/lib/orderPresentation';
import { DeliveryRideAnimation } from '@/components/DeliveryRide';

const TIMELINE: { key: OrderStatus; labelKey: string; timestamp: keyof Pick<Order, 'created_at' | 'confirmed_at' | 'delivered_at'> }[] = [
  { key: 'pending', labelKey: 'order.status.pending', timestamp: 'created_at' },
  { key: 'confirmed', labelKey: 'order.status.confirmed', timestamp: 'confirmed_at' },
  { key: 'delivered', labelKey: 'order.status.delivered', timestamp: 'delivered_at' },
];

export default function OrderDetailPage() {
  const { id } = useParams<{ id: string }>();
  const { t, lang } = useLanguage();
  const { order, items, loading, error, retry } = useOrder(id);
  const [cancelOpen, setCancelOpen] = useState(false);
  const [cancelling, setCancelling] = useState(false);

  if (!id) {
    return (
      <div className="min-h-dvh bg-brand-bg">
        <TopBackBar title={t('order.items')} />
        <div className="app-col py-4"><ErrorState message={t('err.orderNotFound')} /></div>
      </div>
    );
  }

  return (
    <div className="min-h-dvh bg-brand-bg">
      <TopBackBar title={order?.order_number ?? t('order.items')} />
      <main className="app-col pb-10 pt-3">
        {loading ? <Spinner /> :
         error ? <ErrorState message={t('err.orderNotFound')} onRetry={retry} /> :
         !order ? (
          <EmptyState icon={<XCircle size={32} />} title={t('err.orderNotFound')} action={<Link to="/orders" className="btn-primary mt-2">{t('nav.orders')}</Link>} />
        ) : (
          <>
            {new URLSearchParams(window.location.search).get('confirmed') === '1' && order.status === 'pending' && (
              <section className="card my-2 border-l-4 border-l-brand-primary p-4" role="status">
                <h2 className="font-bold text-brand-text">{t('confirm.placedTitle')}</h2>
                <p className="mt-1 text-sm text-brand-text">{t('confirm.ref')}: <b className="tabular-nums">{order.order_number}</b></p>
                <p className="mt-1 text-sm text-brand-subtle">{t('confirm.nextPending')}</p>
                <p className="mt-1 text-sm">{t('order.cashDue', { amount: formatRupee(rupeesToPaise(order.total)) })}</p>
                {order.eta_minutes && <p className="mt-1 text-sm">{t('confirm.eta')}: ~{order.eta_minutes} {lang === 'kn' ? 'ನಿಮಿಷ' : 'min'}</p>}
              </section>
            )}
            {customerVisibleOrderStatus(order.status) === 'confirmed' && (
              <section className="my-2 rounded-2xl border border-brand-success/30 bg-brand-successBg p-4 sm:p-5" role="status">
                <h2 className="flex items-center gap-2 text-base font-bold text-brand-success sm:text-lg">
                  <CheckCircle2 size={22} className="shrink-0" aria-hidden="true" />
                  <span>{customerOrderStatusLabel(order.status, t)}</span>
                </h2>
                <p className="mt-1 break-words text-sm text-brand-text">{t('order.customerConfirmed')}</p>
                <DeliveryRideAnimation />
                {order.eta_minutes != null && (
                  <p className="animate-rise mt-2 flex items-center gap-1.5 text-sm font-semibold text-brand-success" aria-live="polite">
                    <Clock size={15} aria-hidden="true" />
                    {t('order.etaArrival', { minutes: String(order.eta_minutes) })}
                  </p>
                )}
                <p className="mt-1 text-sm text-brand-subtle">{t('confirm.ref')}: <b className="tabular-nums">{order.order_number}</b></p>
              </section>
            )}

            <section className="card p-4" aria-label={t('status.badge')}>
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="font-bold">{t('status.badge')}</span>
                <div className="ml-auto flex min-w-0 flex-wrap items-center justify-end gap-2">
                  <OrderStatusBadge status={customerVisibleOrderStatus(order.status)} label={customerOrderStatusLabel(order.status, t)} />
                </div>
              </div>
              {order.status === 'rejected' && (
                <p className="mt-2 text-sm text-brand-error" role="alert">
                  {t('order.rejectReason', { reason: order.reject_reason || '—' })}
                </p>
              )}
              {order.status === 'cancelled' && (
                <p className="mt-2 text-sm text-brand-subtle" role="alert">
                  {t('order.cancelledNote')}
                </p>
              )}
              {order.delay_note && order.status !== 'rejected' && (
                <p className="mt-2 text-sm text-brand-warn">{t('order.delayNote', { note: order.delay_note })}</p>
              )}

              <TimelineStatusBar status={customerVisibleOrderStatus(order.status)} />

              <ol className="mt-2 grid" aria-label="Progress">
                {TIMELINE.map((step, stepIdx) => {
                  const displayStatus = customerVisibleOrderStatus(order.status);
                  const currentIdx = TIMELINE.findIndex((s) => s.key === displayStatus);
                  const completedAt = order[step.timestamp];
                  const done = Boolean(completedAt);
                  const current = step.key === displayStatus;
                  const isLast = stepIdx === TIMELINE.length - 1;
                  return (
                    <li key={step.key} className="relative flex items-start gap-2.5 pb-3 last:pb-0">
                      <span className="relative z-10 grid h-6 w-6 shrink-0 place-items-center bg-white">
                        {done ? (
                          <CheckCircle2 size={18} aria-hidden="true" className="text-brand-success" />
                        ) : (
                          <Circle size={18} aria-hidden="true" className="text-brand-border" />
                        )}
                      </span>
                      {!isLast && (
                        <span
                          aria-hidden="true"
                          className={`absolute left-[11px] top-6 bottom-0 w-0.5 rounded-full ${done && stepIdx < currentIdx ? 'bg-brand-success' : 'bg-brand-border'}`}
                        />
                      )}
                      <span
                        className={`pt-0.5 text-sm ${current ? 'font-bold text-brand-text' : done ? 'text-brand-text' : 'text-brand-subtle'}`}
                        aria-current={current ? 'step' : undefined}
                      >
                        <span>{customerOrderStatusLabel(step.key, t)}</span>
                        {completedAt && (
                          <time className="ml-2 text-xs font-normal text-brand-subtle" dateTime={completedAt}>
                            {new Date(completedAt).toLocaleString(lang === 'kn' ? 'kn-IN' : 'en-IN', { dateStyle: 'medium', timeStyle: 'short' })}
                          </time>
                        )}
                      </span>
                    </li>
                  );
                })}
                {(order.status === 'rejected' || order.status === 'cancelled') && (
                  <li className="flex items-center gap-2 pt-2 text-sm text-brand-error">
                    <XCircle size={16} aria-hidden="true" />
                    <span>{t(`order.status.${order.status}`)}</span>
                    {order.status === 'rejected' && order.rejected_at && (
                      <time className="text-xs text-brand-subtle" dateTime={order.rejected_at}>
                        {new Date(order.rejected_at).toLocaleString(lang === 'kn' ? 'kn-IN' : 'en-IN', { dateStyle: 'medium', timeStyle: 'short' })}
                      </time>
                    )}
                    {order.status === 'cancelled' && order.cancelled_at && (
                      <time className="text-xs text-brand-subtle" dateTime={order.cancelled_at}>
                        {new Date(order.cancelled_at).toLocaleString(lang === 'kn' ? 'kn-IN' : 'en-IN', { dateStyle: 'medium', timeStyle: 'short' })}
                      </time>
                    )}
                  </li>
                )}
              </ol>
            </section>

            {(order.status === 'pending' || order.status === 'confirmed') && (
              <button type="button" className="btn-ghost mt-3 w-full" onClick={() => setCancelOpen(true)}>
                {t('order.cancelBtn')}
              </button>
            )}

            <section className="card mt-3 p-4">
              <h2 className="mb-2 font-bold">{t('order.items')}</h2>
              <ul className="grid gap-2" aria-label={t('order.items')}>
                {items.map((it) => {
                  const name = lang === 'kn' ? it.name_kn || it.name_en : it.name_en;
                  const description = lang === 'kn' ? it.menu_items?.description_kn ?? it.menu_items?.description_en : it.menu_items?.description_en;
                  const image = publicImageUrl(it.menu_items?.image_path ?? null);
                  return (
                    <li key={it.id} className="flex items-center gap-3 rounded-xl border border-brand-border bg-white p-2.5">
                      {image ? (
                        <img src={image} alt={name} loading="lazy" className="h-16 w-16 shrink-0 rounded-lg object-cover" />
                      ) : (
                        <span className="grid h-16 w-16 shrink-0 place-items-center rounded-lg bg-brand-bg text-brand-subtle"><Utensils size={20} aria-hidden="true" /></span>
                      )}
                      <div className="min-w-0 flex-1">
                        <p className="flex min-w-0 items-center gap-1.5 font-semibold">
                          {it.menu_items && <span className={`h-2 w-2 shrink-0 rounded-full border ${it.menu_items.is_vegetarian ? 'border-green-600 bg-green-500' : 'border-red-700 bg-red-600'}`} aria-label={t(it.menu_items.is_vegetarian ? 'menu.veg' : 'menu.nonVeg')} title={t(it.menu_items.is_vegetarian ? 'menu.veg' : 'menu.nonVeg')} />}
                          <span className="min-w-0 truncate">{name}</span>
                          <span className="ml-auto shrink-0 rounded-full bg-brand-bg px-2 py-0.5 text-xs font-bold tabular-nums">× {it.quantity}</span>
                        </p>
                        {description && <p className="mt-0.5 line-clamp-2 text-xs text-brand-subtle">{description}</p>}
                        <p className="mt-1 text-xs tabular-nums text-brand-subtle"><span>{t('order.eachLine', { price: formatRupee(rupeesToPaise(it.unit_price)) })}</span>{rupeesToPaise(it.discount_amount) > 0 && <span className="ml-1 text-brand-success">−{formatRupee(rupeesToPaise(it.discount_amount))}</span>}</p>
                      </div>
                      <span className="shrink-0 font-bold tabular-nums">{formatRupee(rupeesToPaise(it.item_total))}</span>
                    </li>
                  );
                })}
              </ul>
              <dl className="mt-2 grid gap-1 border-t border-brand-border pt-2 text-sm">
                <div className="flex justify-between"><dt>{t('cart.itemTotal')}</dt><dd>{formatRupee(rupeesToPaise(order.subtotal))}</dd></div>
                {rupeesToPaise(order.discount_total) > 0 && (
                  <div className="flex justify-between text-brand-success"><dt>{t('cart.discount')}</dt><dd>-{formatRupee(rupeesToPaise(order.discount_total))}</dd></div>
                )}
                <div className="flex justify-between"><dt>{t('cart.deliveryFee')}</dt><dd>{formatRupee(rupeesToPaise(order.delivery_fee))}</dd></div>
                <div className="flex justify-between font-bold"><dt>{t('common.total')}</dt><dd>{formatRupee(rupeesToPaise(order.total))}</dd></div>
              </dl>
              <p className="mt-1 text-xs text-brand-subtle">
                {new Date(order.created_at).toLocaleString(lang === 'kn' ? 'kn-IN' : 'en-IN', { dateStyle: 'full', timeStyle: 'short' })}
              </p>
            </section>

            <section className="card mt-3 p-4 text-sm">
              <h2 className="mb-1 font-bold">{t('checkout.address')}</h2>
              <p>{order.customer_name} · <span className="tabular-nums">{order.phone}</span></p>
              <OrderDestination order={order} audience="customer" />
              {order.instructions && <p className="mt-1 text-brand-subtle">“{order.instructions}”</p>}
              {rupeesToPaise(order.cod_collected ?? -1) >= 0 && (
                <p className="mt-2 text-brand-success">{t('order.cashCollected', { amount: formatRupee(rupeesToPaise(order.cod_collected!)) })}</p>
              )}
              {order.cash_handed_at && (
                <p className="mt-1">{order.cash_verified_at ? `✅ ${t('order.cashHanded')}` : `⏳ ${t('order.cashPendingVerification')}`}</p>
              )}
            </section>
          </>
        )}
      </main>

      {order && (order.status === 'pending' || order.status === 'confirmed') && (
        <Sheet open={cancelOpen} onClose={() => (cancelling ? undefined : setCancelOpen(false))} title={t('order.cancelTitle')}>
          <p className="text-sm text-brand-subtle">{t('order.cancelNote')}</p>
          <div className="mt-4 grid gap-2">
            <button type="button" className="btn-secondary" disabled={cancelling} onClick={() => setCancelOpen(false)}>
              {t('common.cancel')}
            </button>
            <button type="button" className="btn-primary" disabled={cancelling} onClick={() => void cancelOrder()}>
              {cancelling ? t('checkout.placing') : t('order.cancelBtn')}
            </button>
          </div>
        </Sheet>
      )}
    </div>
  );

  async function cancelOrder() {
    if (!id) return;
    setCancelling(true);
    try {
      const { error: ae } = await supabase.rpc('cancel_order', { p_order_id: id });
      if (ae) {
        showSnackbar(t(parseKvError(ae).key));
        return;
      }
      setCancelOpen(false);
      showSnackbar(t('order.cancelDone'));
      retry();
    } catch {
      showSnackbar(t('err.generic'));
    } finally {
      setCancelling(false);
    }
  }
}

/** Thin fill bar under the header: pending → confirmed → delivered. */
function TimelineStatusBar({ status }: { status: OrderStatus }) {
  const currentIdx = status === 'rejected' || status === 'cancelled' ? -1 : TIMELINE.findIndex((s) => s.key === status);
  if (currentIdx === -1) {
    return <div className="mt-3 h-1.5 w-full overflow-hidden rounded-full bg-brand-errorBg"><div className="h-full w-full bg-brand-error/70" /></div>;
  }
  const percent = Math.round(((currentIdx + 1) / TIMELINE.length) * 100);
  return (
    <div className="mt-3 flex items-center gap-2" aria-hidden="true">
      <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-brand-border/70">
        <div className="h-full rounded-full bg-brand-success transition-all duration-500" style={{ width: `${percent}%` }} />
      </div>
      <span className="text-[11px] font-semibold tabular-nums text-brand-subtle">{percent}%</span>
    </div>
  );
}
