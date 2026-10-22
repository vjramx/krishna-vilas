import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { supabase } from '@/lib/supabase';
import { useLanguage } from '@/context/LanguageContext';
import { OrderStatusBadge, Sheet, Spinner } from '@/components/ui';
import { parseKvError } from '@/lib/errors';
import { applyRealtime } from '@/hooks/useOrders';
import { formatRupee, rupeesToPaise } from '@/lib/money';
import type { AgentUser, AssignmentStatus, Order, OrderStatus } from '@/types/db';
import { Clock, Phone, Trash2 } from 'lucide-react';
import { OrderDestination } from '@/components/OrderDestination';

const TABS: { key: string; statuses: OrderStatus[] }[] = [
  { key: 'all', statuses: [] },
  { key: 'pending', statuses: ['pending'] },
  { key: 'confirmed', statuses: ['confirmed'] },
  { key: 'preparing', statuses: ['preparing'] },
  { key: 'ready', statuses: ['ready'] },
  { key: 'out_for_delivery', statuses: ['out_for_delivery'] },
  { key: 'delivered', statuses: ['delivered'] },
  { key: 'rejected', statuses: ['rejected'] },
  { key: 'cancelled', statuses: ['cancelled'] },
];

/** When an order was placed: local-day aware periods and an everything view. */
const PERIODS: { key: string; i18nKey: string; startAt: () => string | null }[] = [
  { key: 'today', i18nKey: 'admin.filterToday', startAt: () => {
    const d = new Date(); d.setHours(0, 0, 0, 0); return d.toISOString();
  } },
  { key: '7d', i18nKey: 'admin.filterLast7', startAt: () => {
    const d = new Date(); d.setHours(0, 0, 0, 0); d.setDate(d.getDate() - 6); return d.toISOString();
  } },
  { key: '30d', i18nKey: 'admin.filterLast30', startAt: () => {
    const d = new Date(); d.setHours(0, 0, 0, 0); d.setDate(d.getDate() - 29); return d.toISOString();
  } },
  { key: 'all', i18nKey: 'admin.filterAllTime', startAt: () => null },
];

interface OrderWithItems extends Order {
  order_items: { id: string; name_en: string; quantity: number }[];
}

export default function AdminOrders() {
  const { t, lang } = useLanguage();
  const [params, setParams] = useSearchParams();
  const tab = params.get('tab') ?? 'all';
  const [orders, setOrders] = useState<OrderWithItems[]>([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [detail, setDetail] = useState<OrderWithItems | null>(null);
  const [agents, setAgents] = useState<AgentUser[]>([]);
  const [rejectReason, setRejectReason] = useState('');
  const [etaValue, setEtaValue] = useState('15');
  // Confirm flow (Step B): accepting first asks for an ETA, then the backend
  // RPC commits status + ETA + auto-assignment in ONE transaction (0022).
  const [confirmOrder, setConfirmOrder] = useState<OrderWithItems | null>(null);
  const [confirmEta, setConfirmEta] = useState('15');
  const confirmEtaNum = Number(confirmEta.trim());
  const confirmEtaInvalid = confirmEta.trim() === '' || !Number.isInteger(confirmEtaNum) || confirmEtaNum < 1 || confirmEtaNum > 600;
  const [pendingOrderIds, setPendingOrderIds] = useState<Set<string>>(() => new Set());
  const pendingOrderIdsRef = useRef(new Set<string>());
  const [deleteOrdersOpen, setDeleteOrdersOpen] = useState(false);
  const [deleteOrdersText, setDeleteOrdersText] = useState('');
  const [deletingOrders, setDeletingOrders] = useState(false);
  const deleteOrdersInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!deleteOrdersOpen) return;
    // Sheet focuses its dialog container; focus the confirmation input after
    // that so keyboard input goes straight into the visible field.
    const frame = window.requestAnimationFrame(() => deleteOrdersInputRef.current?.focus());
    return () => window.cancelAnimationFrame(frame);
  }, [deleteOrdersOpen]);

  const activeTab = useMemo(() => TABS.find((x) => x.key === tab) ?? TABS[0]!, [tab]);
  const statusFilter = useMemo(() => activeTab.statuses.join(','), [activeTab]);
  const period = params.get('period') ?? 'all';
  const activePeriod = useMemo(() => PERIODS.find((x) => x.key === period) ?? PERIODS[3]!, [period]);
  const periodStart = useMemo(() => activePeriod.startAt(), [activePeriod]);

  useEffect(() => {
    let active = true;
    setLoading(true);
    let q = supabase.from('orders').select('*, order_items(id, name_en, quantity)').order('created_at', { ascending: false }).range(0, 49);
    if (statusFilter) q = q.in('status', statusFilter.split(',') as OrderStatus[]);
    if (periodStart) q = q.gte('created_at', periodStart);
    void q.then(({ data, error }) => {
      if (!active) return;
      if (error) setErr(error.message);
      else setOrders((data as OrderWithItems[]) ?? []);
      setLoading(false);
    });

    const ch = supabase
      .channel('admin-orders')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'orders' }, (payload) => {
        setOrders((prev) => {
          const merged = applyRealtime(prev as Order[], payload as unknown as { eventType: 'INSERT' | 'UPDATE' | 'DELETE'; new: OrderWithItems | null; old: { id: string } | null })
            .map((o) => ({ ...o, order_items: (o as OrderWithItems).order_items ?? [] }))
            .filter((o) => activeTab.statuses.length === 0 || activeTab.statuses.includes(o.status))
            .filter((o) => !periodStart || new Date(o.created_at).getTime() >= new Date(periodStart).getTime()) as OrderWithItems[];
          return merged;
        });
      })
      .subscribe();

    return () => {
      active = false;
      void supabase.removeChannel(ch);
    };
  }, [activeTab, statusFilter, periodStart]);

  useEffect(() => {
    supabase.from('agent_users').select('*').order('name_en').then(({ data }) => {
      setAgents(((data as AgentUser[]) ?? []).filter((a) => a.is_active));
    });
  }, [tab]);

  const activeAgents = useMemo(() => agents, [agents]);

  /** RPC runner that reports success so multi-step transitions can bail early.
   * Returns the RPC's jsonb payload on success (null on failure) so callers can
   * act on authoritative, post-write server facts instead of local guesses. */
  async function rpcCall(fn: string, args: Record<string, unknown>, orderId: string, opts?: { keepDetailOpen?: boolean }): Promise<Record<string, unknown> | null> {
    if (pendingOrderIdsRef.current.has(orderId)) return null;
    pendingOrderIdsRef.current.add(orderId);
    setPendingOrderIds(new Set(pendingOrderIdsRef.current));
    setErr(null);
    try {
      const { data, error } = await supabase.rpc(fn, args);
      if (error) {
        setErr(t(parseKvError(error).key));
        return null;
      }
      if (!opts?.keepDetailOpen) setDetail(null);
      return (data as Record<string, unknown> | null) ?? {};
    } catch {
      setErr(t('err.generic'));
      return null;
    } finally {
      pendingOrderIdsRef.current.delete(orderId);
      setPendingOrderIds(new Set(pendingOrderIdsRef.current));
    }
  }

  /** Merge authoritative post-write fields into every live surface (card list
   * respects the active tab/period filters exactly like the realtime path) so
   * the operator sees the new state instantly, without a page refresh. */
  function mergeOrderUpdate(orderId: string, patch: Partial<Order>) {
    setOrders((prev) =>
      prev
        .map((o) => (o.id === orderId ? { ...o, ...patch } : o))
        .filter((o) => activeTab.statuses.length === 0 || activeTab.statuses.includes(o.status))
        .filter((o) => !periodStart || new Date(o.created_at).getTime() >= new Date(periodStart).getTime()),
    );
    setDetail((d) => (d && d.id === orderId ? { ...d, ...patch } : d));
  }

  function transition(order: OrderWithItems, next: OrderStatus) {
    if (next === 'delivered') {
      // Delivery completion is not a set_order_status transition anymore
      // (backend 0016+): it goes through the dedicated admin completion RPC.
      void rpcCall('admin_mark_delivered', { p_order_id: order.id }, order.id);
      return;
    }
    void rpcCall('set_order_status', { p_order_id: order.id, p_new_status: next, p_note: next === 'rejected' ? rejectReason || null : null }, order.id);
  }

  /** Step B: accepting opens the ETA dialog first — nothing changes on the
   * server until the operator submits a valid ETA there. Pre-fills the
   * persisted ETA so re-opening stays consistent. */
  function openConfirm(order: OrderWithItems) {
    setConfirmOrder(order);
    setConfirmEta(String(order.eta_minutes ?? 15));
  }

  /** Step C/D: submit the ETA → the backend commits confirmation + ETA +
   * auto-assignment atomically (migration 0022) and returns the post-write
   * row; the card, detail sheet and notice update from THAT data immediately. */
  async function submitConfirmEta() {
    const order = confirmOrder;
    if (!order) return;
    const eta = Number(confirmEta.trim());
    if (!Number.isInteger(eta) || eta < 1 || eta > 600) {
      setErr(t('err.etaInvalid'));
      return;
    }
    const result = await rpcCall('admin_confirm_order', { p_order_id: order.id, p_eta_minutes: eta }, order.id, { keepDetailOpen: true });
    if (result === null) return; // error already surfaced by rpcCall
    const freshAgentId = (result.agent_id as string | null | undefined) ?? order.agent_id;
    const freshAssignment = (result.assignment_status as AssignmentStatus | undefined) ?? order.assignment_status;
    setConfirmOrder(null);
    mergeOrderUpdate(order.id, {
      status: 'confirmed',
      eta_minutes: eta,
      agent_id: freshAgentId,
      assignment_status: freshAssignment,
      confirmed_at: new Date().toISOString(),
    });
    setEtaValue(String(eta));
    const agentName = freshAgentId ? agents.find((a) => a.id === freshAgentId)?.name_en ?? null : null;
    setNotice(agentName ? t('admin.autoAssigned', { agent: agentName }) : t('admin.autoAssignNone'));
  }

  /** Card actions mirror the operator's authority: accept or cancel a new
   * order. Everything after that is the delivery agent's job — the list shows
   * where the assignment stands instead of kitchen buttons. */
  const actionsFor = (o: OrderWithItems) => {
    const pending = pendingOrderIds.has(o.id);
    switch (o.status) {
      case 'pending': return (
        <>
          <button className="btn-primary text-base" aria-busy={pending} disabled={pending} onClick={() => openConfirm(o)}>{t('admin.confirm')}</button>
          <button className="btn-secondary text-base text-brand-error" disabled={pending} onClick={() => setDetail(o)}>{t('admin.reject')}</button>
        </>
      );
      case 'confirmed':
      case 'preparing':
      case 'ready':
      case 'out_for_delivery':
        return o.agent_id ? (
          <p className="col-span-2 rounded-xl bg-brand-bg px-3 py-2 text-xs font-semibold text-brand-primary" role="status">
            🛵 {t('admin.agentHandles', { agent: agents.find((a) => a.id === o.agent_id)?.name_en ?? t('order.agent') })}
          </p>
        ) : (
          <p className="col-span-2 rounded-xl bg-brand-warnBg px-3 py-2 text-xs font-semibold text-brand-warn" role="status">
            {t('admin.assignInDetails')}
          </p>
        );
      default: return <span className="col-span-2 text-xs text-brand-subtle">{t('err.finalState')}</span>;
    }


  };

  async function deleteAllOrders() {
    if (deleteOrdersText !== 'DELETE ALL ORDERS' || deletingOrders) return;
    setDeletingOrders(true);
    setErr(null);
    setNotice(null);
    try {
      const { data, error } = await supabase.rpc('admin_delete_all_orders', { p_confirmation: deleteOrdersText });
      if (error) {
        setErr(t(parseKvError(error).key));
        return;
      }
      setOrders([]);
      setDetail(null);
      setDeleteOrdersOpen(false);
      setDeleteOrdersText('');
      setErr(null);
      setNotice(t('admin.deleteOrdersDone', { count: String(data ?? 0) }));
    } catch {
      setErr(t('err.generic'));
    } finally {
      setDeletingOrders(false);
    }
  }

  const assignmentBadge = (o: OrderWithItems) => {
    const asg = o.assignment_status as AssignmentStatus;
    if (asg === 'none' && o.status !== 'pending' && o.status !== 'rejected') return <span className="badge bg-brand-warnBg text-brand-warn">{t('admin.assignAgent')}</span>;
    if (asg === 'delivered') return <span className="badge bg-brand-successBg text-brand-success">✓ {t('agent.steps.delivered')}</span>;
    if (asg === 'failed') return <span className="badge bg-brand-errorBg text-brand-error">{t('agent.steps.failed')}</span>;
    return null;
  };

  return (
    <div className="grid gap-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        {notice && <p className="text-sm text-brand-success" role="status">{notice}</p>}
        <button type="button" className="btn-secondary ml-auto min-h-11 text-sm text-brand-error" onClick={() => { setDeleteOrdersText(''); setDeleteOrdersOpen(true); }}>
          <Trash2 size={16} aria-hidden="true" /> {t('admin.deleteOrders')}
        </button>
      </div>
      <div className="no-scrollbar -mx-3 flex gap-1.5 overflow-x-auto px-3 py-0.5" role="tablist" aria-label={t('admin.filter')}>
        {TABS.map((x) => (
          <button
            key={x.key}
            role="tab"
            aria-selected={tab === x.key}
            className={`badge whitespace-nowrap px-3 ${tab === x.key ? 'bg-brand-text text-white' : 'bg-white border border-brand-border text-brand-text'}`}
            onClick={() => setParams({ ...(x.key === 'all' ? {} : { tab: x.key }), ...(activePeriod.key !== 'all' ? { period: activePeriod.key } : {}) })}
          >
            {x.key === 'all' ? t('menu.all') : t(`order.status.${x.key as OrderStatus}`)}
          </button>
        ))}
      </div>
      <div className="no-scrollbar -mx-3 flex gap-1.5 overflow-x-auto px-3 py-0.5" role="tablist" aria-label={t('order.placedAt')}>
        {PERIODS.map((p) => (
          <button
            key={p.key}
            role="tab"
            aria-selected={activePeriod.key === p.key}
            className={`badge whitespace-nowrap px-3 ${activePeriod.key === p.key ? 'bg-brand-primary text-white' : 'bg-white border border-brand-border text-brand-text'}`}
            onClick={() => setParams({ ...(tab !== 'all' ? { tab } : {}), ...(p.key === 'all' ? {} : { period: p.key }) })}
          >
            {t(p.i18nKey)}
          </button>
        ))}
      </div>

      {err && <p className="text-sm text-brand-error" role="alert">{err}</p>}
      {loading ? (
        <Spinner label={t('common.loading')} />
      ) : orders.length === 0 ? (
        <p className="card p-4 text-sm text-brand-subtle">{t('admin.noOrders')}</p>
      ) : (
        <ul className="grid gap-2">
          {orders.map((o) => (
            <li key={o.id} className="card animate-rise p-3">
              <button type="button" className="w-full text-left min-w-0" onClick={() => setDetail(o)} aria-haspopup="dialog">
                <div className="flex items-center justify-between gap-2">
                  <span className="font-bold tabular-nums">{o.order_number}</span>
                  <OrderStatusBadge status={o.status} />
                </div>
                <div className="mt-0.5 flex items-center justify-between gap-2 text-sm">
                  <span className="min-w-0 truncate text-brand-subtle">{o.customer_name} · <span className="tabular-nums">{o.phone}</span></span>
                  <span className="font-semibold whitespace-nowrap">{formatRupee(rupeesToPaise(o.total))}</span>
                </div>
                <div className="mt-1 flex flex-wrap items-center gap-1.5">
                  <span className="badge inline-flex items-center gap-1 bg-brand-bg text-brand-subtle">
                    <Clock size={11} aria-hidden="true" />
                    <span className="tabular-nums">{new Intl.DateTimeFormat(lang === 'kn' ? 'kn-IN' : 'en-IN', { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(o.created_at))}</span>
                  </span>
                  {o.eta_minutes != null && (
                    <span className="badge bg-brand-successBg text-brand-success">
                      <Clock size={11} aria-hidden="true" />
                      {t('admin.etaBadge', { minutes: String(o.eta_minutes) })}
                    </span>
                  )}
                  {o.agent_id ? (
                    <span className="badge bg-brand-secondary/15 text-brand-primaryDark">
                      🛵 {agents.find((a) => a.id === o.agent_id)?.name_en ?? t('order.agent')}
                    </span>
                  ) : null}
                  {assignmentBadge(o)}
                </div>
              </button>
              <div className="mt-2 grid grid-cols-2 gap-2">{actionsFor(o)}</div>
            </li>
          ))}
        </ul>
      )}

      <Sheet open={deleteOrdersOpen} onClose={() => { if (!deletingOrders) { setDeleteOrdersOpen(false); setDeleteOrdersText(''); } }} title={t('admin.deleteOrdersTitle')}>
        <div className="grid gap-3">
          <p id="delete-orders-warning" className="text-sm text-brand-error">{t('admin.deleteOrdersWarning')}</p>
          <label className="label" htmlFor="delete-orders-confirm">{t('admin.deleteOrdersType')}</label>
          <input
            ref={deleteOrdersInputRef}
            id="delete-orders-confirm"
            type="text"
            className="input font-mono text-brand-text caret-brand-primary placeholder:text-brand-subtle focus:border-brand-primary focus:ring-2 focus:ring-brand-primary/20"
            autoComplete="off"
            autoCapitalize="characters"
            autoCorrect="off"
            spellCheck={false}
            placeholder="DELETE ALL ORDERS"
            aria-describedby="delete-orders-warning"
            value={deleteOrdersText}
            disabled={deletingOrders}
            onChange={(event) => setDeleteOrdersText(event.target.value)}
          />
          <div className="grid grid-cols-2 gap-2">
            <button type="button" className="btn-secondary" disabled={deletingOrders} onClick={() => { setDeleteOrdersOpen(false); setDeleteOrdersText(''); }}>{t('common.cancel')}</button>
            <button type="button" className="btn-primary bg-brand-error" disabled={deleteOrdersText !== 'DELETE ALL ORDERS' || deletingOrders} onClick={() => void deleteAllOrders()}>
              {deletingOrders ? t('common.loading') : t('admin.deleteOrders')}
            </button>
          </div>
        </div>
      </Sheet>

      <Sheet open={!!detail} onClose={() => { setDetail(null); setRejectReason(''); setEtaValue('15'); }} title={detail?.order_number ?? ''}>
        {detail && (
          <div className="grid gap-3">
            <ul className="grid gap-1 text-sm">
              {detail.order_items.map((it) => (
                <li key={it.id} className="flex justify-between"><span>{it.name_en} × {it.quantity}</span></li>
              ))}
            </ul>
            <OrderDestination order={detail} audience="admin" />
            <a href={`tel:${detail.phone}`} className="btn-secondary text-sm"><Phone size={15} aria-hidden="true" /> {t('admin.callCustomer')} · <span className="tabular-nums">{detail.phone}</span></a>

            {detail.status === 'pending' && (
              <>
                <button type="button" className="btn-primary" disabled={pendingOrderIds.has(detail.id)} onClick={() => openConfirm(detail)}>{t('admin.confirm')}</button>
                <label className="label" htmlFor="rej-reason">{t('admin.rejectReasonPrompt')}</label>
                <input id="rej-reason" className="input" maxLength={120} value={rejectReason} disabled={pendingOrderIds.has(detail.id)} onChange={(e) => setRejectReason(e.target.value)} />
                <button type="button" className="btn-primary bg-brand-error" disabled={pendingOrderIds.has(detail.id)} onClick={() => transition(detail, 'rejected')}>{t('admin.reject')}</button>
              </>
            )}

            {/* ETA editing after acceptance: at accept the ETA is captured in
                the confirm dialog itself, so the field is for adjustments on
                already-confirmed/preparing orders only. */}
            {['confirmed', 'preparing'].includes(detail.status) && (
              <>
                <label className="label" htmlFor="eta-val">{t('admin.setEta')}</label>
                <input id="eta-val" className="input tabular-nums" type="number" min={1} max={600} value={etaValue} disabled={pendingOrderIds.has(detail.id)}
                  onChange={(e) => setEtaValue(e.target.value)} />
                <button type="button" className="btn-secondary" disabled={pendingOrderIds.has(detail.id)} onClick={() => void rpcCall('set_order_eta', { p_order_id: detail.id, p_eta_minutes: Number(etaValue) }, detail.id)}>
                  {t('common.save')}
                </button>
              </>
            )}

            {['confirmed', 'preparing', 'ready', 'out_for_delivery'].includes(detail.status) && (
              <div>
                <label className="label" htmlFor="asg-agent">{detail.agent_id ? t('admin.reassign') : t('admin.assignAgent')}</label>
                <select
                  id="asg-agent"
                  className="input"
                  value={detail.agent_id ?? ''}
                  disabled={pendingOrderIds.has(detail.id)}
                  onChange={(e) => {
                    const v = e.target.value || null;
                    const target = orders.find((o) => o.id === detail.id);
                    if (target) void rpcCall('assign_order', { p_order_id: detail.id, p_agent_id: v }, detail.id);
                  }}
                >
                  <option value="">{t('admin.unassign')}</option>
                  {activeAgents.map((a) => (
                    <option key={a.id} value={a.id}>{lang === 'kn' ? a.name_en : a.name_en} — {a.phone ?? a.email}</option>
                  ))}
                </select>
              </div>
            )}

            {/* Rescue completion: if the agent app could not attest delivery,
                the operator can close out a dispatched order from here. */}
            {detail.status === 'out_for_delivery' && (
              <button
                type="button"
                className="btn-secondary text-brand-error"
                disabled={pendingOrderIds.has(detail.id)}
                onClick={() => void rpcCall('admin_mark_delivered', { p_order_id: detail.id }, detail.id)}
              >
                {t('admin.markDelivered')}
              </button>
            )}

            <Link to={`/order/${detail.id}`} className="btn-ghost text-sm">{t('orders.viewDetails')}</Link>
          </div>
        )}
      </Sheet>

      {/* Step B dialog: the order is only confirmed once a valid ETA lands on
          the backend — Cancel leaves it untouched, and the per-order in-flight
          guard blocks double submissions while the RPC runs. */}
      <Sheet open={!!confirmOrder} onClose={() => { if (!pendingOrderIds.has(confirmOrder?.id ?? '')) { setConfirmOrder(null); setErr(null); } }} title={t('admin.confirmEtaTitle')}>
        {confirmOrder && (
          <form className="grid gap-3" onSubmit={(e) => { e.preventDefault(); if (confirmEtaInvalid || pendingOrderIds.has(confirmOrder.id)) return; void submitConfirmEta(); }}>
            <p className="text-sm text-brand-subtle">{confirmOrder.order_number} · {confirmOrder.customer_name}</p>
            <label className="label" htmlFor="confirm-eta">{t('admin.setEta')}</label>
            <input
              id="confirm-eta"
              className="input tabular-nums"
              type="number"
              inputMode="numeric"
              min={1}
              max={600}
              autoFocus
              aria-invalid={confirmEtaInvalid}
              disabled={pendingOrderIds.has(confirmOrder.id)}
              value={confirmEta}
              onChange={(e) => { setConfirmEta(e.target.value); setErr(null); }}
            />
            {confirmEtaInvalid && (
              <p className="text-sm text-brand-error" role="alert">{t('admin.etaInvalid')}</p>
            )}
            <div className="grid grid-cols-2 gap-2">
              <button type="button" className="btn-secondary" disabled={pendingOrderIds.has(confirmOrder.id)} onClick={() => { if (!pendingOrderIds.has(confirmOrder.id)) { setConfirmOrder(null); setErr(null); } }}>
                {t('common.cancel')}
              </button>
              <button type="submit" className="btn-primary" disabled={confirmEtaInvalid || pendingOrderIds.has(confirmOrder.id)} aria-busy={pendingOrderIds.has(confirmOrder.id)}>
                {t('common.confirm')}
              </button>
            </div>
          </form>
        )}
      </Sheet>
    </div>
  );
}
