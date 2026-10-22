import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { supabase } from '@/lib/supabase';
import { useLanguage } from '@/context/LanguageContext';
import { useAuth } from '@/context/AuthContext';
import { applyRealtime } from '@/hooks/useOrders';
import { useAgentLocationShare } from '@/hooks/useAgentLocationShare';
import { EmptyState, Sheet, Spinner } from '@/components/ui';
import { parseKvError } from '@/lib/errors';
import { formatRupee, rupeesToPaise } from '@/lib/money';
import type { AssignmentStatus, Order } from '@/types/db';
import { OrderDestination } from '@/components/OrderDestination';
import { Phone, MapPin, Banknote } from 'lucide-react';

// Map navigation is removed everywhere: agent cards show the saved delivery
// address text instead (see AgentOrderCard) — no directions URLs, no map SDK.

const ASSIGNED_STATUSES: AssignmentStatus[] = ['assigned'];
const ACTIVE_STATUSES: AssignmentStatus[] = ['accepted', 'picked_up'];
const DELIVERED_STATUSES: AssignmentStatus[] = ['delivered'];

function useAgentOrders(closedAssignment: AssignmentStatus[]) {
  // The stable assignment key (agent_users.id) is what orders.agent_id
  // stores — NOT the Firebase uid. Matching by uid silently misses every
  // auto-assigned order, so wait for the resolved id before querying.
  const { agentId } = useAuth();
  const [orders, setOrders] = useState<Order[]>([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => {
    if (!agentId) return;
    void supabase
      .from('orders')
      .select('*')
      // Only this agent's orders: other agents' assignments must never appear,
      // even offline — beneath RLS this also keeps the fetch scoped server-side.
      .eq('agent_id', agentId)
      .order('created_at', { ascending: false })
      .then(({ data, error }) => {
        if (error) setErr(error.message);
        else setOrders(((data as Order[]) ?? []).filter((o) => o.agent_id === agentId && closedAssignment.includes(o.assignment_status)));
        setLoading(false);
      });
    const ch = supabase
      .channel('agent-orders')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'orders' }, (payload) => {
        const o = payload.new as Order | null;
        if (o === null) {
          const goneId = (payload.old as { id?: string } | null)?.id;
          setOrders((prev) => prev.filter((x) => x.id !== goneId));
          return;
        }
        // Stable-ID ownership guard mirroring the RLS policy (orders_agent_read):
        // an assignment to ANOTHER agent must never enter this agent's list,
        // even if the server-side event filter ever changes underneath.
        if (o.agent_id !== agentId) return;
        if (!closedAssignment.includes(o.assignment_status)) {
          // The row left this tab's slice (assigned → accepted, accepted →
          // delivered/failed): drop it instead of silently keeping a stale card
          // — this alone was why Accept "did nothing" until a manual refresh.
          setOrders((prev) => prev.filter((x) => x.id !== o.id));
          return;
        }
        setOrders((prev) => applyRealtime(prev, payload as unknown as { eventType: 'INSERT' | 'UPDATE' | 'DELETE'; new: Order | null; old: { id: string } | null }));
      })
      .subscribe();
    return () => {
      void supabase.removeChannel(ch);
    };
  }, [agentId, closedAssignment]);
  // Deterministic post-success removal: callers drop the card only after the
  // backend confirmed the write. Failure keeps the row — never optimistic.
  const removeOrder = useCallback((id: string) => setOrders((prev) => prev.filter((x) => x.id !== id)), []);
  return { orders, loading, err, setErr, removeOrder };
}

async function runAgent(fn: string, args: Record<string, unknown>, onErr: (msg: string) => void) {
  // A thrown request (network outage, cancelled promise) must surface as an
  // error too — never leave the action silently failing or falsely succeed.
  try {
    const { error } = await supabase.rpc(fn, args);
    if (error) {
      onErr(parseKvError(error).key);
      return false;
    }
    return true;
  } catch (e) {
    onErr(parseKvError(e).key);
    return false;
  }
}

/** Shared card shell so Assigned/Active cards stay structured identically:
 * header (number + step badge), customer block, COD strip, then actions. */
function AgentOrderCard({ order, busy, headerBadge, actions }: {
  order: Order;
  busy?: boolean;
  headerBadge?: ReactNode;
  actions: ReactNode;
}) {
  const { t } = useLanguage();
  return (
    <li className={`card animate-rise grid gap-3 p-4 ${busy ? 'opacity-60' : ''}`}>
      <div className="flex items-start justify-between gap-2">
        <Link to={`/agent/delivery/${order.id}`} className="min-w-0 truncate font-bold tabular-nums underline-offset-2 hover:underline">{order.order_number}</Link>
        {headerBadge}
      </div>
      {/* Saved delivery address. Real data only — missing fields are marked,
          never invented; long addresses wrap (no truncation here, the order
          detail view carries the full text). */}
      <div className="min-w-0 grid gap-0.5">
        <p className="text-[11px] font-bold uppercase tracking-wide text-brand-subtle">{t('agent.deliveryAddress')}</p>
        <p className="break-words text-sm font-semibold">{order.customer_name}</p>
        <p className="break-words text-sm">{[order.address_line, order.area].filter(Boolean).join(', ')}</p>
        <p className="break-words text-xs text-brand-subtle"><b>{t('checkout.landmark')}:</b> <span>{order.landmark || t('agent.notProvided')}</span></p>
        <p className="break-words text-xs text-brand-subtle"><b>{t('checkout.instructions')}:</b> <span>{order.instructions || t('agent.notProvided')}</span></p>
      </div>
      <div className="flex items-center justify-between gap-2 rounded-xl bg-brand-bg px-3 py-2">
        <span className="flex items-center gap-1 text-sm font-bold tabular-nums"><Banknote size={15} aria-hidden="true" /> {formatRupee(rupeesToPaise(order.total))}</span>
        <a href={`tel:${order.phone}`} className="btn-secondary min-h-11 px-3 text-sm"><Phone size={15} aria-hidden="true" /> <span className="tabular-nums">{order.phone}</span></a>
      </div>
      {actions}
    </li>
  );
}

/* -------------------------------- Assigned tab -------------------------------- */
export function AgentAssigned() {
  const { loading } = useAuth();
  const { t } = useLanguage();
  const { orders, loading: l, err, setErr, removeOrder } = useAgentOrders(ASSIGNED_STATUSES);
  const [busy, setBusy] = useState<string | null>(null);
  const [openOrder, setOpenOrder] = useState<Order | null>(null);

  if (loading || l) return <Spinner />;

  return (
    <div className="grid gap-3">
      {err && <p className="text-sm text-brand-error" role="alert">{t(err)}</p>}
      {orders.length === 0 ? (
        <EmptyState icon={<MapPin size={30} />} title={t('agent.noAssignments')} hint={t('agent.allDone')} />
      ) : (
        <ul className="grid gap-3">
          {orders.map((o) => (
            <AgentOrderCard
              key={o.id}
              order={o}
              busy={busy === o.id}
              headerBadge={<span className="badge whitespace-nowrap bg-brand-secondary/15 text-brand-primaryDark">{t('agent.steps.assigned')}</span>}
              actions={
                <div className="grid grid-cols-2 gap-2">
                  <button type="button" className="btn-primary min-h-11 text-sm" disabled={busy === o.id} onClick={() => { setBusy(o.id); void runAgent('agent_accept', { p_order_id: o.id }, (k) => setErr(k)).then((ok) => { setBusy(null); if (ok) removeOrder(o.id); }); }}>
                    {t('agent.accept')}
                  </button>
                  <button type="button" className="btn-secondary min-h-11 text-sm" disabled={busy === o.id} onClick={() => { setBusy(o.id); void runAgent('agent_decline', { p_order_id: o.id }, (k) => setErr(k)).then((ok) => { setBusy(null); if (ok) removeOrder(o.id); }); }}>
                    {t('agent.decline')}
                  </button>
                </div>
              }
            />
          ))}
        </ul>
      )}

      <Sheet open={!!openOrder} onClose={() => setOpenOrder(null)} title={openOrder?.order_number ?? ''}>
        {openOrder && (
          <div className="grid gap-2 text-sm">
            <p><b>{t('agent.pickupInstr')}</b></p>
            <p>{t('agent.customer')}: {openOrder.customer_name} · <a className="underline tabular-nums" href={`tel:${openOrder.phone}`}><b>{openOrder.phone}</b></a></p>
            <OrderDestination order={openOrder} audience="agent" />
            <p className="font-semibold text-brand-primary">{t('agent.codNote', { amount: formatRupee(rupeesToPaise(openOrder.total)) })}</p>
          </div>
        )}
      </Sheet>
    </div>
  );
}

/* -------------------------------- Active tab --------------------------------- */
export function AgentActive() {
  const { t } = useLanguage();
  const { orders, loading: l, err, setErr, removeOrder } = useAgentOrders(ACTIVE_STATUSES);
  const [busy, setBusy] = useState<string | null>(null);
  const [handoverOrder, setHandoverOrder] = useState<Order | null>(null);
  const [foodConfirm, setFoodConfirm] = useState(false);
  const [cashConfirm, setCashConfirm] = useState(false);
  const [failOrder, setFailOrder] = useState<Order | null>(null);
  const [failReason, setFailReason] = useState('');
  // Live tracking: share GPS only for orders on the road (out for delivery and in the agent's hands).
  const onRouteIds = orders
    .filter((o) => o.status === 'out_for_delivery' && (o.assignment_status === 'accepted' || o.assignment_status === 'picked_up'))
    .map((o) => o.id);
  const location = useAgentLocationShare(onRouteIds);

  if (l) return <Spinner />;

  return (
    <div className="grid gap-3">
      {err && <p className="text-sm text-brand-error" role="alert">{t(err)}</p>}
      {onRouteIds.length > 0 && (
        <div className="flex items-center gap-2 self-start rounded-full bg-white px-3 py-1.5 text-xs font-semibold shadow-soft" role="status">
          <span className={`h-2 w-2 rounded-full ${location.error ? 'bg-brand-warn' : location.sharing ? 'animate-pulse bg-brand-success' : 'bg-brand-subtle'}`} aria-hidden="true" />
          <span className={location.error ? 'text-brand-warn' : 'text-brand-text'}>{location.error ? t(location.error) : location.sharing ? t('agent.sharing') : t('delivery.agentWaiting')}</span>
        </div>
      )}
      {orders.length === 0 ? (
        <EmptyState icon={<MapPin size={30} />} title={t('agent.noAssignments')} hint={t('agent.allDone')} />
      ) : (
        <ul className="grid gap-3">
          {orders.map((o) => {
            const delivered = o.assignment_status === 'delivered';
            return (
              <AgentOrderCard
                key={o.id}
                order={o}
                busy={busy === o.id}
                headerBadge={<span className={`badge whitespace-nowrap ${delivered ? 'bg-brand-successBg text-brand-success' : 'bg-brand-secondary/15 text-brand-primaryDark'}`}>{t(`agent.steps.${o.assignment_status}`)}</span>}
                actions={
                  <div className="grid gap-3">
                    {delivered ? (
                      <p className="rounded-xl bg-brand-successBg px-3 py-2 text-center text-sm font-semibold text-brand-success" role="status">✓ {t('agent.steps.delivered')}</p>
                    ) : (
                      <button type="button" className="btn-primary min-h-11 w-full text-sm" disabled={busy === o.id}
                        onClick={() => { setHandoverOrder(o); setFoodConfirm(false); setCashConfirm(false); }}>
                        {t('agent.deliveredBtn')}
                      </button>
                    )}
                    <div className="flex items-center justify-between gap-2">
                      <button type="button" className="btn-ghost text-xs text-brand-error" onClick={() => { setFailOrder(o); setFailReason(''); }}>
                        {t('agent.failedBtn')}
                      </button>
                    </div>
                    {o.delay_note && <p className="text-xs text-brand-warn">{t('order.delayNote', { note: o.delay_note })}</p>}
                  </div>
                }
              />
            );
          })}
        </ul>
      )}

      <Sheet open={!!handoverOrder} onClose={() => { if (busy === null) setHandoverOrder(null); setFoodConfirm(false); setCashConfirm(false); }} title={t('agent.confirmDelivery')}>
        {handoverOrder && (
          <form className="grid gap-3" onSubmit={(e) => {
            e.preventDefault();
            if (!foodConfirm || !cashConfirm || busy === handoverOrder.id) return;
            setBusy(handoverOrder.id);
            void runAgent('agent_deliver', { p_order_id: handoverOrder.id }, (k) => setErr(k))
              .then((ok) => {
                setBusy(null);
                if (ok) { removeOrder(handoverOrder.id); setHandoverOrder(null); setFoodConfirm(false); setCashConfirm(false); }
              });
          }}>
            <p className="rounded-xl bg-brand-bg px-3 py-2 text-sm">
              <span className="block font-bold tabular-nums">{handoverOrder.order_number}</span>
              <span className="block">{t('agent.customer')}: {handoverOrder.customer_name}</span>
              <span className="block text-brand-subtle">{handoverOrder.area} — {handoverOrder.address_line}</span>
            </p>
            <p className="rounded-xl bg-brand-bg px-3 py-2 text-sm font-semibold">{t('agent.codNote', { amount: formatRupee(rupeesToPaise(handoverOrder.total)) })}</p>
            <label className="flex min-h-[48px] items-start gap-3 rounded-xl border border-brand-border bg-white px-3 py-3">
              <input type="checkbox" role="switch" aria-label={t('agent.confirmFood')} checked={foodConfirm} disabled={busy === handoverOrder.id} onChange={(e) => setFoodConfirm(e.target.checked)} className="mt-0.5 h-5 w-5 accent-[#C83E24]" />
              <span className="text-sm font-medium">{t('agent.confirmFood')}</span>
            </label>
            <label className="flex min-h-[48px] items-start gap-3 rounded-xl border border-brand-border bg-white px-3 py-3">
              <input type="checkbox" role="switch" aria-label={t('agent.confirmCash')} checked={cashConfirm} disabled={busy === handoverOrder.id} onChange={(e) => setCashConfirm(e.target.checked)} className="mt-0.5 h-5 w-5 accent-[#C83E24]" />
              <span className="text-sm font-medium">{t('agent.confirmCash')}</span>
            </label>
            <button type="submit" className="btn-primary min-h-11" disabled={!foodConfirm || !cashConfirm || busy === handoverOrder.id}>{t('agent.confirmDelivery')}</button>
          </form>
        )}
      </Sheet>

      <Sheet open={!!failOrder} onClose={() => setFailOrder(null)} title={t('agent.failedBtn')}>
        {failOrder && (
          <form className="grid gap-3" onSubmit={(e) => {
            e.preventDefault();
            setBusy(failOrder.id);
            void runAgent('agent_fail', { p_order_id: failOrder.id, p_reason: failReason }, (k) => setErr(k))
              .then((ok) => { setBusy(null); if (ok) { removeOrder(failOrder.id); setFailOrder(null); } });
          }}>
            <label className="block">
              <span className="label">{t('agent.failReason')}</span>
              <textarea className="input min-h-16" maxLength={200} value={failReason} onChange={(e) => setFailReason(e.target.value)} />
            </label>
            <button type="submit" className="btn-primary bg-brand-error">{t('common.confirm')}</button>
          </form>
        )}
      </Sheet>
    </div>
  );
}

/* ------------------------------ COD tab -------------------------------------- */
export function AgentCod() {
  const { t } = useLanguage();
  const { orders, loading: l, err, setErr } = useAgentOrders(DELIVERED_STATUSES);
  const [busy, setBusy] = useState<string | null>(null);

  if (l) return <Spinner />;

  const pending = orders.filter((o) => o.cash_handed_at === null);

  return (
    <div className="grid gap-3">
      {err && <p className="text-sm text-brand-error" role="alert">{t(err)}</p>}
      {pending.length === 0 ? (
        <EmptyState icon={<Banknote size={30} />} title={t('agent.allDone')} />
      ) : (
        <ul className="grid gap-2">
          {pending.map((o) => (
            <li key={o.id} className="card p-3">
              <div className="flex justify-between gap-2">
                <span className="font-bold tabular-nums">{o.order_number}</span>
                <span className="font-bold">{formatRupee(rupeesToPaise(o.cod_collected ?? o.total))}</span>
              </div>
              {rupeesToPaise(o.cod_collected ?? '0') !== rupeesToPaise(o.total ?? '0') && (
                <p className="mt-1 text-xs text-brand-warn">{t('admin.discrepancy', { amount: formatRupee(rupeesToPaise(o.cod_collected ?? '0') - rupeesToPaise(o.total)) })}</p>
              )}
              <button
                type="button"
                className="btn-primary mt-2 w-full text-sm"
                disabled={busy === o.id}
                onClick={() => { setBusy(o.id); void runAgent('agent_hand_cash', { p_order_id: o.id }, (k) => setErr(k)).then(() => setBusy(null)); }}
              >
                {t('agent.handCash')}
              </button>
            </li>
          ))}
        </ul>
      )}
      {orders.length > 0 && pending.length < orders.length && (
        <p className="text-xs text-brand-success" role="status">✓ {t('agent.handed')} ({orders.length - pending.length}/{orders.length})</p>
      )}
    </div>
  );
}
