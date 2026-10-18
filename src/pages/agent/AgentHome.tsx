import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { supabase } from '@/lib/supabase';
import { useLanguage } from '@/context/LanguageContext';
import { useAuth } from '@/context/AuthContext';
import { applyRealtime } from '@/hooks/useOrders';
import { EmptyState, Sheet, Spinner } from '@/components/ui';
import { parseKvError } from '@/lib/errors';
import { formatRupee, rupeesToPaise } from '@/lib/money';
import type { AssignmentStatus, Order } from '@/types/db';
import { OrderDestination } from '@/components/OrderDestination';
import { Phone, MapPin, Banknote } from 'lucide-react';

const ASSIGNED_STATUSES: AssignmentStatus[] = ['assigned'];
const ACTIVE_STATUSES: AssignmentStatus[] = ['accepted', 'picked_up'];
const DELIVERED_STATUSES: AssignmentStatus[] = ['delivered'];

function useAgentOrders(closedAssignment: AssignmentStatus[]) {
  const { userId } = useAuth();
  const [orders, setOrders] = useState<Order[]>([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => {
    if (!userId) return;
    void supabase
      .from('orders')
      .select('*')
      .order('created_at', { ascending: false })
      .then(({ data, error }) => {
        if (error) setErr(error.message);
        else setOrders(((data as Order[]) ?? []).filter((o) => o.agent_id !== null && closedAssignment.includes(o.assignment_status)));
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
        if (!closedAssignment.includes(o.assignment_status)) return;
        setOrders((prev) => applyRealtime(prev, payload as unknown as { eventType: 'INSERT' | 'UPDATE' | 'DELETE'; new: Order | null; old: { id: string } | null }));
      })
      .subscribe();
    return () => {
      void supabase.removeChannel(ch);
    };
  }, [userId, closedAssignment]);
  return { orders, loading, err, setErr };
}

async function runAgent(fn: string, args: Record<string, unknown>, onErr: (msg: string) => void) {
  const { error } = await supabase.rpc(fn, args);
  if (error) onErr(parseKvError(error).key);
  else return true;
  return false;
}

/* -------------------------------- Assigned tab -------------------------------- */
export function AgentAssigned() {
  const { loading } = useAuth();
  const { t } = useLanguage();  const { orders, loading: l, err, setErr } = useAgentOrders(ASSIGNED_STATUSES);
  const [busy, setBusy] = useState<string | null>(null);
  const [openOrder, setOpenOrder] = useState<Order | null>(null);

  if (loading || l) return <Spinner />;

  return (
    <div className="grid gap-3">
      {err && <p className="text-sm text-brand-error" role="alert">{t(err)}</p>}
      {orders.length === 0 ? (
        <EmptyState icon={<MapPin size={30} />} title={t('agent.noAssignments')} hint={t('agent.allDone')} />
      ) : (
        <ul className="grid gap-2">
          {orders.map((o) => (
            <li key={o.id} className="card p-3">
              <button type="button" className="w-full min-w-0 text-left" onClick={() => setOpenOrder(o)} aria-haspopup="dialog">
                <div className="flex justify-between gap-2"><span className="font-bold tabular-nums">{o.order_number}</span><span className="font-semibold">{formatRupee(rupeesToPaise(o.total))}</span></div>
                <p className="mt-0.5 truncate text-sm text-brand-subtle">{t('agent.address')}: {o.area} — {o.address_line}</p>
              </button>
              <div className="mt-2 flex flex-wrap gap-2">
                <button type="button" className="btn-primary flex-1 text-sm" disabled={busy === o.id} onClick={() => { setBusy(o.id); void runAgent('agent_accept', { p_order_id: o.id }, (k) => setErr(k)).then(() => setBusy(null)); }}>
                  {t('agent.accept')}
                </button>
                <button type="button" className="btn-secondary text-sm" disabled={busy === o.id} onClick={() => { setBusy(o.id); void runAgent('agent_decline', { p_order_id: o.id }, (k) => setErr(k)).then(() => setBusy(null)); }}>
                  {t('agent.decline')}
                </button>
              </div>
            </li>
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
  const { orders, loading: l, err, setErr } = useAgentOrders(ACTIVE_STATUSES);
  const [busy, setBusy] = useState<string | null>(null);
  const [deliverOrder, setDeliverOrder] = useState<Order | null>(null);
  const [pin, setPin] = useState('');
  const [collected, setCollected] = useState('');
  const [failOrder, setFailOrder] = useState<Order | null>(null);
  const [failReason, setFailReason] = useState('');

  if (l) return <Spinner />;

  const nextAction = (o: Order) => {
    if (o.assignment_status === 'accepted' && o.status === 'ready') {
      return { label: t('agent.pickedUp'), fn: 'agent_pickup' };
    }
    if (o.assignment_status === 'accepted' && (o.status === 'confirmed' || o.status === 'preparing')) {
      return { label: t('agent.arrived'), fn: 'agent_arrived' };
    }
    if (o.assignment_status === 'picked_up') {
      return { label: t('agent.deliveredBtn'), fn: 'agent_deliver' };
    }
    return null;
  };

  return (
    <div className="grid gap-3">
      {err && <p className="text-sm text-brand-error" role="alert">{t(err)}</p>}
      {orders.length === 0 ? (
        <EmptyState icon={<MapPin size={30} />} title={t('agent.noAssignments')} hint={t('agent.allDone')} />
      ) : (
        <ul className="grid gap-2">
          {orders.map((o) => {
            const action = nextAction(o);
            return (
              <li key={o.id} className="card p-3 grid gap-2">
                <div className="flex justify-between gap-2">
                  <Link to={`/agent/delivery/${o.id}`} className="font-bold tabular-nums underline-offset-2 hover:underline min-w-0 truncate">{o.order_number}</Link>
                  <span className="badge bg-brand-secondary/15 text-brand-primaryDark whitespace-nowrap">{t(`agent.steps.${o.assignment_status}`)}</span>
                </div>
                <p className="text-sm text-brand-subtle truncate">{o.area} — {o.address_line}</p>
                <div className="flex flex-wrap items-center gap-2">
                  <span className="badge bg-white border border-brand-border"><Banknote size={13} aria-hidden="true" /> {formatRupee(rupeesToPaise(o.total))}</span>
                  <a href={`tel:${o.phone}`} className="btn-secondary text-xs"><Phone size={13} aria-hidden="true" /> {o.phone}</a>
                  {action?.fn === 'agent_deliver' ? (
                    <button type="button" className="btn-primary text-sm" onClick={() => { setDeliverOrder(o); setPin(''); setCollected(o.total); }}>
                      {t('agent.deliveredBtn')}
                    </button>
                  ) : action ? (
                    <button type="button" className="btn-primary text-sm" disabled={busy === o.id}
                      onClick={() => { setBusy(o.id); void runAgent(action.fn, { p_order_id: o.id }, (k) => setErr(k)).then(() => setBusy(null)); }}>
                      {action.label}
                    </button>
                  ) : (
                    <span className="text-xs text-brand-subtle">
                      {t(`order.status.${o.status}`)} — {t('err.notDispatched')}
                    </span>
                  )}
                  <button type="button" className="btn-ghost text-xs text-brand-error" onClick={() => { setFailOrder(o); setFailReason(''); }}>
                    {t('agent.failedBtn')}
                  </button>
                </div>
                {o.status === 'out_for_delivery' && o.assignment_status === 'accepted' && (
                  <button type="button" className="btn-secondary text-sm" disabled={busy === o.id}
                    onClick={() => { setBusy(o.id); void runAgent('agent_pickup', { p_order_id: o.id }, (k) => setErr(k)).then(() => setBusy(null)); }}>
                    {t('agent.pickedUp')}
                  </button>
                )}
                {o.delay_note && <p className="text-xs text-brand-warn">{t('order.delayNote', { note: o.delay_note })}</p>}
              </li>
            );
          })}
        </ul>
      )}

      <Sheet open={!!deliverOrder} onClose={() => setDeliverOrder(null)} title={t('agent.confirmDelivery')}>
        {deliverOrder && (
          <form className="grid gap-3" onSubmit={(e) => {
            e.preventDefault();
            setBusy(deliverOrder.id);
            void runAgent('agent_deliver', { p_order_id: deliverOrder.id, p_pin: pin, p_collected: Number(collected) }, (k) => setErr(k))
              .then((ok) => { setBusy(null); if (ok) setDeliverOrder(null); });
          }}>
            <p className="text-sm">{t('agent.codNote', { amount: formatRupee(rupeesToPaise(deliverOrder.total)) })}</p>
            <label className="block">
              <span className="label">{t('agent.enterPin')}</span>
              <input className="input tabular-nums tracking-[0.4em]" inputMode="numeric" maxLength={6} value={pin} onChange={(e) => setPin(e.target.value.replace(/[^0-9]/g, ''))} />
            </label>
            <label className="block">
              <span className="label">{t('agent.collectedAmount')}</span>
              <input className="input tabular-nums" inputMode="decimal" value={collected} onChange={(e) => setCollected(e.target.value)} />
            </label>
            <button type="submit" className="btn-primary">{t('agent.confirmDelivery')}</button>
          </form>
        )}
      </Sheet>

      <Sheet open={!!failOrder} onClose={() => setFailOrder(null)} title={t('agent.failedBtn')}>
        {failOrder && (
          <form className="grid gap-3" onSubmit={(e) => {
            e.preventDefault();
            setBusy(failOrder.id);
            void runAgent('agent_fail', { p_order_id: failOrder.id, p_reason: failReason }, (k) => setErr(k))
              .then((ok) => { setBusy(null); if (ok) setFailOrder(null); });
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
