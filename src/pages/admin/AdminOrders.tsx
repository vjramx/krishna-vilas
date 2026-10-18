import { useEffect, useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { supabase } from '@/lib/supabase';
import { useLanguage } from '@/context/LanguageContext';
import { OrderStatusBadge, Sheet, Spinner } from '@/components/ui';
import { parseKvError } from '@/lib/errors';
import { applyRealtime } from '@/hooks/useOrders';
import { formatRupee, rupeesToPaise } from '@/lib/money';
import type { AgentUser, AssignmentStatus, Order, OrderStatus } from '@/types/db';
import { Phone } from 'lucide-react';
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
  const [detail, setDetail] = useState<OrderWithItems | null>(null);
  const [agents, setAgents] = useState<AgentUser[]>([]);
  const [rejectReason, setRejectReason] = useState('');
  const [etaValue, setEtaValue] = useState('15');

  const activeTab = useMemo(() => TABS.find((x) => x.key === tab) ?? TABS[0]!, [tab]);
  const statusFilter = useMemo(() => activeTab.statuses.join(','), [activeTab]);

  useEffect(() => {
    let active = true;
    setLoading(true);
    let q = supabase.from('orders').select('*, order_items(id, name_en, quantity)').order('created_at', { ascending: false }).range(0, 49);
    if (statusFilter) q = q.in('status', statusFilter.split(',') as OrderStatus[]);
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
            .filter((o) => activeTab.statuses.length === 0 || activeTab.statuses.includes(o.status)) as OrderWithItems[];
          return merged;
        });
      })
      .subscribe();

    return () => {
      active = false;
      void supabase.removeChannel(ch);
    };
  }, [activeTab, statusFilter]);

  useEffect(() => {
    supabase.from('agent_users').select('*').order('name_en').then(({ data }) => {
      setAgents(((data as AgentUser[]) ?? []).filter((a) => a.is_active));
    });
  }, [tab]);

  const activeAgents = useMemo(() => agents, [agents]);

  async function rpcCall(fn: 'set_order_status' | 'assign_order' | 'set_order_eta', args: Record<string, unknown>, _orderId: string) {
    setErr(null);
    const { error } = await supabase.rpc(fn, args);
    if (error) setErr(t(parseKvError(error).key));
    else setDetail(null);
  }

  function transition(order: OrderWithItems, next: OrderStatus) {
    void rpcCall('set_order_status', { p_order_id: order.id, p_new_status: next, p_note: next === 'rejected' ? rejectReason || null : null }, order.id);
  }

  const actionsFor = (o: OrderWithItems) => {
    switch (o.status) {
      case 'pending': return (
        <>
          <button className="btn-primary flex-1 text-sm" onClick={() => transition(o, 'confirmed')}>{t('admin.accept')}</button>
          <button className="btn-secondary text-sm text-brand-error" onClick={() => setDetail(o)}>{t('admin.reject')}</button>
        </>
      );
      case 'confirmed': return (
        <>
          <button className="btn-primary flex-1 text-sm" onClick={() => transition(o, 'preparing')}>{t('admin.startPreparing')}</button>
          <button className="btn-secondary text-sm" onClick={() => { setDetail(o); setEtaValue(String(o.eta_minutes ?? 15)); }}>{t('admin.setEta')}</button>
        </>
      );
      case 'preparing': return <button className="btn-primary flex-1 text-sm" onClick={() => transition(o, 'ready')}>{t('admin.markReady')}</button>;
      case 'ready': return <button className="btn-primary flex-1 text-sm" onClick={() => transition(o, 'out_for_delivery')}>{t('admin.dispatch')}</button>;
      case 'out_for_delivery': return <button className="btn-secondary flex-1 text-sm" onClick={() => transition(o, 'delivered')}>{t('admin.markDelivered')}</button>;
      default: return <span className="text-xs text-brand-subtle">{t('err.finalState')}</span>;
    }
  };

  const assignmentBadge = (o: OrderWithItems) => {
    const asg = o.assignment_status as AssignmentStatus;
    if (asg === 'none' && o.status !== 'pending' && o.status !== 'rejected') return <span className="badge bg-brand-warnBg text-brand-warn">{t('admin.assignAgent')}</span>;
    if (asg === 'delivered') return <span className="badge bg-brand-successBg text-brand-success">✓ {t('agent.steps.delivered')}</span>;
    if (asg === 'failed') return <span className="badge bg-brand-errorBg text-brand-error">{t('agent.steps.failed')}</span>;
    return null;
  };

  return (
    <div className="grid gap-3">
      <div className="no-scrollbar -mx-3 flex gap-1.5 overflow-x-auto px-3 py-0.5" role="tablist" aria-label={t('admin.filter')}>
        {TABS.map((x) => (
          <button
            key={x.key}
            role="tab"
            aria-selected={tab === x.key}
            className={`badge whitespace-nowrap px-3 ${tab === x.key ? 'bg-brand-text text-white' : 'bg-white border border-brand-border text-brand-text'}`}
            onClick={() => setParams(x.key === 'all' ? {} : { tab: x.key })}
          >
            {x.key === 'all' ? t('menu.all') : t(`order.status.${x.key as OrderStatus}`)}
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
            <li key={o.id} className="card p-3">
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
                  {o.agent_id ? (
                    <span className="badge bg-brand-secondary/15 text-brand-primaryDark">
                      🛵 {agents.find((a) => a.id === o.agent_id)?.name_en ?? t('order.agent')}
                    </span>
                  ) : null}
                  {assignmentBadge(o)}
                </div>
              </button>
              <div className="mt-2 flex flex-wrap gap-2">{actionsFor(o)}</div>
            </li>
          ))}
        </ul>
      )}

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
                <label className="label" htmlFor="rej-reason">{t('admin.rejectReasonPrompt')}</label>
                <input id="rej-reason" className="input" maxLength={120} value={rejectReason} onChange={(e) => setRejectReason(e.target.value)} />
                <button type="button" className="btn-primary bg-brand-error" onClick={() => transition(detail, 'rejected')}>{t('admin.reject')}</button>
              </>
            )}

            {detail.status === 'confirmed' && (
              <>
                <label className="label" htmlFor="eta-val">{t('admin.setEta')}</label>
                <input id="eta-val" className="input tabular-nums" type="number" min={1} max={600} value={etaValue}
                  onChange={(e) => setEtaValue(e.target.value)} />
                <button type="button" className="btn-secondary" onClick={() => void rpcCall('set_order_eta', { p_order_id: detail.id, p_eta_minutes: Number(etaValue) }, detail.id)}>
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

            <Link to={`/order/${detail.id}`} className="btn-ghost text-sm">{t('orders.viewDetails')}</Link>
          </div>
        )}
      </Sheet>
    </div>
  );
}
