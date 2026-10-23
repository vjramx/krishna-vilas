import { useEffect, useState } from 'react';
import { supabase } from '@/lib/supabase';
import { useLanguage } from '@/context/LanguageContext';
import { useHotelSettings } from '@/hooks/useHotelSettings';
import { Sheet, Spinner } from '@/components/ui';
import { parseKvError } from '@/lib/errors';
import type { AgentUser, Order } from '@/types/db';
import { Bike, Eye, Plus, Settings } from 'lucide-react';
import { Link } from 'react-router-dom';

export default function AdminAgents() {
  const { t } = useLanguage();
  const { data: settings, loading: settingsLoading } = useHotelSettings();
  const [agents, setAgents] = useState<AgentUser[]>([]);
  const [activeOrders, setActiveOrders] = useState<Order[]>([]);
  const [err, setErr] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [form, setForm] = useState({ name: '', email: '', phone: '' });

  useEffect(() => {
    void Promise.all([
      supabase.from('agent_users').select('*').order('name_en'),
      supabase.from('orders').select('*').in('status', ['out_for_delivery', 'confirmed', 'preparing', 'ready']),
    ]).then(([ag, od]) => {
      if (ag.error) setErr(ag.error.message);
      else setAgents((ag.data as AgentUser[]) ?? []);
      if (!od.error) setActiveOrders((od.data as Order[]) ?? []);
    });
  }, []);

  async function createAgent() {
    setBusy(true);
    setErr(null);
    try {
      if (!/\S+@\S+\.\S+/.test(form.email.trim()) || !form.name.trim()) {
        throw new Error('FIELD');
      }
      const { error } = await supabase.rpc('staff_grant_agent', {
        p_email: form.email.trim(),
        p_name: form.name.trim(),
        p_phone: form.phone.trim() || null,
      });
      if (error) throw error;
      setNotice(t('admin.agentCreated'));
      setOpen(false);
      setForm({ name: '', email: '', phone: '' });
      const refreshed = await supabase.from('agent_users').select('*').order('name_en');
      if (!refreshed.error) setAgents((refreshed.data as AgentUser[]) ?? []);
    } catch (e) {
      const kv = parseKvError(e);
      const msg =
        e instanceof Error && e.message === 'FIELD' ? `${t('admin.agentEmail')} + ${t('admin.agentName')}` : t(kv.key);
      setErr(msg);
    } finally {
      setBusy(false);
    }
  }

  async function toggleActive(agent: AgentUser) {
    const hasActive = activeOrders.some((o) => o.agent_id === agent.id && o.status !== 'delivered');
    if (agent.is_active && hasActive && !window.confirm(t('admin.activeDeliveries') + ' — ' + t('admin.deactivate') + '?')) return;
    setBusy(true);
    const { error } = await supabase.from('agent_users').update({ is_active: !agent.is_active }).eq('id', agent.id);
    if (error) setErr(t(parseKvError(error).key));
    else setAgents((prev) => prev.map((a) => (a.id === agent.id ? { ...a, is_active: !a.is_active } : a)));
    setBusy(false);
  }

  // Self delivery: the owner does the run themselves, so the agent
  // management surface (and its direct-URL access) becomes an explanation,
  // not a working screen.
  if (settings?.fulfillment_mode === 'self') {
    return (
      <section className="card grid gap-3 p-6 text-center" data-testid="agents-self-delivery">
        <span className="mx-auto grid h-14 w-14 place-items-center rounded-2xl bg-brand-secondary/15 text-brand-primaryDark" aria-hidden="true">
          <Bike size={26} />
        </span>
        <p className="text-sm font-extrabold text-brand-text">{t('admin.selfDelivery')}</p>
        <p className="mx-auto max-w-sm text-sm leading-snug text-brand-subtle">{t('admin.agentsSelfDeliveryCard')}</p>
        <Link to="/admin/settings" className="btn-secondary mx-auto w-fit text-sm">
          <Settings size={15} aria-hidden="true" /> {t('admin.settings')}
        </Link>
      </section>
    );
  }

  if (settingsLoading) return <Spinner label={t('common.loading')} />;

  return (
    <div className="grid gap-3">
      <div className="flex flex-wrap gap-2">
        <button type="button" className="btn-primary w-fit" onClick={() => setOpen(true)}><Plus size={16} aria-hidden="true" /> {t('admin.addAgent')}</button>
        <Link to="/agent/preview" className="btn-secondary w-fit text-sm">
          <Eye size={16} aria-hidden="true" /> {t('admin.previewAgent')}
        </Link>
      </div>
      {notice && <p className="text-xs text-brand-success" role="status">{notice}</p>}
      {err && <p className="text-sm text-brand-error" role="alert">{err}</p>}

      <ul className="grid gap-2">
        {agents.map((a) => {
          const load = activeOrders.filter((o) => o.agent_id === a.id && o.status !== 'delivered').length;
          return (
            <li key={a.id} className="card flex items-center gap-3 p-3 min-w-0">
              <div className="min-w-0 flex-1">
                <p className="truncate font-semibold">{a.name_en}</p>
                <p className="truncate text-xs text-brand-subtle">{a.email} · <span className="tabular-nums">{a.phone ?? '—'}</span></p>
                {load > 0 && <p className="text-xs text-brand-warn">🛵 {load} {t('admin.activeDeliveries')}</p>}
              </div>
              <span className={`badge ${a.is_active ? 'bg-brand-successBg text-brand-success' : 'bg-brand-errorBg text-brand-error'}`}>
                {a.is_active ? t('admin.agentActive') : t('admin.agentInactive')}
              </span>
              <button type="button" className="btn-secondary text-xs" disabled={busy} onClick={() => void toggleActive(a)}>
                {a.is_active ? t('admin.deactivate') : t('admin.activate')}
              </button>
            </li>
          );
        })}
        {agents.length === 0 && <li className="card p-4 text-sm text-brand-subtle">{t('agent.noAssignments')}</li>}
      </ul>

      <Sheet open={open} onClose={() => setOpen(false)} title={t('admin.addAgent')}>
        <form className="grid gap-3" onSubmit={(e) => { e.preventDefault(); void createAgent(); }} noValidate>
          <p className="text-xs text-brand-subtle">{t('admin.addAgentGoogleHint')}</p>
          <div>
            <label className="label" htmlFor="ag-name">{t('admin.agentName')}</label>
            <input id="ag-name" className="input" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
          </div>
          <div>
            <label className="label" htmlFor="ag-email">{t('admin.agentEmail')}</label>
            <input id="ag-email" type="email" autoComplete="off" className="input" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} />
          </div>
          <div>
            <label className="label" htmlFor="ag-phone">{t('admin.agentPhone')}</label>
            <input id="ag-phone" className="input tabular-nums" inputMode="tel" maxLength={15} value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} />
          </div>
          <button type="submit" className="btn-primary" disabled={busy}>{busy ? '…' : t('common.save')}</button>
        </form>
      </Sheet>
    </div>
  );
}
