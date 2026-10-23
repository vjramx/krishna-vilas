import { useState } from 'react';
import { Store, UserRound, Bike, Check } from 'lucide-react';
import { useHotelSettings } from '@/hooks/useHotelSettings';
import { supabase } from '@/lib/supabase';
import { useLanguage } from '@/context/LanguageContext';
import { Spinner, StatusSwitch } from '@/components/ui';
import { parseKvError } from '@/lib/errors';

export default function AdminSettings() {
  const { t } = useLanguage();
  const { data: settings, loading, retry } = useHotelSettings();
  const [edit, setEdit] = useState<Record<string, string>>({});
  const [err, setErr] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // Restaurant status toggle state (independent of the price/hours form).
  const [statusBusy, setStatusBusy] = useState(false);
  const [statusErr, setStatusErr] = useState<string | null>(null);
  const [statusNotice, setStatusNotice] = useState<string | null>(null);

  // Delivery mode (self ↔ agents): same instant-write pattern as the status
  // toggle, so flipping it hides / restores the Agents section immediately.
  const [modeBusy, setModeBusy] = useState<'agent' | 'self' | null>(null);
  const [modeErr, setModeErr] = useState<string | null>(null);
  const [modeNotice, setModeNotice] = useState<string | null>(null);

  if (loading || !settings) return <Spinner />;

  const val = (key: string, fallback: string) => edit[key] ?? fallback;

  async function setFulfillmentMode(mode: 'agent' | 'self') {
    if (!settings || modeBusy || settings.fulfillment_mode === mode) return;
    setModeBusy(mode);
    setModeErr(null);
    setModeNotice(null);
    try {
      const { error } = await supabase
        .from('hotel_settings')
        .update({ fulfillment_mode: mode })
        .eq('id', 1);
      if (error) throw error;
      setModeNotice(mode === 'self' ? t('admin.selfDeliverySaved') : t('admin.agentModeSaved'));
      retry(); // refetch so the displayed mode always mirrors the backend
    } catch (e) {
      setModeErr(t(parseKvError(e).key));
      retry();
    } finally {
      setModeBusy(null);
    }
  }

  async function toggleAccepting() {
    if (!settings || statusBusy) return;
    setStatusBusy(true);
    setStatusErr(null);
    setStatusNotice(null);
    try {
      const { error } = await supabase
        .from('hotel_settings')
        .update({ is_accepting_orders: !settings.is_accepting_orders })
        .eq('id', 1);
      if (error) throw error;
      if (settings.is_accepting_orders) setStatusNotice(t('admin.pauseOrders'));
      else setStatusNotice(t('admin.resumeOrders'));
      retry(); // refetch so the displayed state always mirrors the backend
    } catch (e) {
      setStatusErr(t(parseKvError(e).key));
      retry();
    } finally {
      setStatusBusy(false);
    }
  }

  async function save() {
    setBusy(true);
    setErr(null);
    try {
      const price = Number(val('delivery_fee', String(settings!.delivery_fee)));
      const min = Number(val('min_order_total', String(settings!.min_order_total)));
      if (Number.isNaN(price) || price < 0 || Number.isNaN(min) || min < 0) throw new Error('FIELD');
      const { error } = await supabase
        .from('hotel_settings')
        .update({
          delivery_fee: price,
          min_order_total: min,
          opens_at: `${val('opens_at', settings!.opens_at).slice(0, 8)}:00`,
          closes_at: `${val('closes_at', settings!.closes_at).slice(0, 8)}:00`,
          default_prep_minutes: Math.max(0, Number(val('prep', String(settings!.default_prep_minutes)))),
          default_delivery_minutes: Math.max(0, Number(val('deliver', String(settings!.default_delivery_minutes)))),
        })
        .eq('id', 1);
      if (error) throw error;
      setNotice(t('account.saved'));
      setEdit({});
    } catch (e) {
      setErr(e instanceof Error && e.message === 'FIELD' ? t('err.etaInvalid') : t(parseKvError(e).key));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="grid gap-3 content-start">
      {/* Delivery mode: self (owner delivers) ↔ delivery agents. While self is
          on the Agents section disappears everywhere in admin and no order is
          dispatched — the owner does the run from the orders dashboard. */}
      <section className="card grid gap-3 p-4" aria-labelledby="fulfillment-mode" aria-busy={modeBusy !== null}>
        <div className="flex items-center gap-3">
          <span
            className={`grid h-10 w-10 shrink-0 place-items-center rounded-xl ${
              settings.fulfillment_mode === 'self' ? 'bg-brand-secondary/15 text-brand-primaryDark' : 'bg-brand-primary/10 text-brand-primary'
            }`}
            aria-hidden="true"
          >
            {settings.fulfillment_mode === 'self' ? <UserRound size={19} /> : <Bike size={19} />}
          </span>
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-extrabold">{t('admin.deliveryMode')}</p>
            <p
              className={`text-xs font-bold ${settings.fulfillment_mode === 'self' ? 'text-brand-primaryDark' : 'text-brand-primary'}`}
              role="status"
            >
              {settings.fulfillment_mode === 'self' ? t('admin.selfDeliveryTagline') : t('admin.agentModeTagline')}
            </p>
          </div>
        </div>
        <div className="grid grid-cols-2 gap-2" role="radiogroup" aria-label={t('admin.deliveryMode')}>
          {([
            { mode: 'self', label: t('admin.selfDelivery'), Icon: UserRound },
            { mode: 'agent', label: t('admin.deliveryAgents'), Icon: Bike },
          ] as const).map(({ mode, label, Icon }) => {
            const active = settings.fulfillment_mode === mode;
            return (
              <button
                key={mode}
                type="button"
                role="radio"
                aria-checked={active}
                disabled={modeBusy !== null}
                className={`relative flex min-h-[48px] flex-col items-center justify-center gap-0.5 rounded-xl px-2 py-2 text-xs font-bold transition-colors ${
                  active
                    ? 'bg-brand-primary text-white shadow-soft'
                    : 'bg-brand-bg text-brand-text active:bg-brand-bg/70'
                }`}
                onClick={() => void setFulfillmentMode(mode)}
              >
                <Icon size={17} aria-hidden="true" />
                <span className="truncate">{label}</span>
                {active && <Check size={12} aria-hidden="true" className="absolute right-1.5 top-1.5" />}
              </button>
            );
          })}
        </div>
        <p className="text-xs leading-snug text-brand-subtle">
          {settings.fulfillment_mode === 'self' ? t('admin.selfDeliveryHint') : t('admin.agentModeHint')}
        </p>
        {modeErr && <p className="text-sm text-brand-error" role="alert">{modeErr}</p>}
        {modeNotice && <p className="text-xs text-brand-success" role="status">{modeNotice}</p>}
      </section>

      {/* Restaurant status: every change lands instantly on the customers' home
          screen — the bold banner swaps in the moment this is switched off. */}
      <section className="card grid gap-3 p-4" aria-labelledby="acc-status" aria-busy={statusBusy}>
        <h2 id="acc-status" className="sr-only">{t('admin.restaurantStatus')}</h2>
        <div className="flex items-center gap-3">
          <span
            className={`grid h-10 w-10 shrink-0 place-items-center rounded-xl ${
              settings.is_accepting_orders ? 'bg-brand-successBg text-brand-success' : 'bg-brand-errorBg text-brand-error'
            }`}
            aria-hidden="true"
          >
            <Store size={19} />
          </span>
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-extrabold">{t('admin.restaurantStatus')}</p>
            <p
              className={`text-xs font-bold ${settings.is_accepting_orders ? 'text-brand-success' : 'text-brand-error'}`}
              role="status"
            >
              {settings.is_accepting_orders ? t('admin.openNow') : t('admin.pauseOrders')}
            </p>
          </div>
          <StatusSwitch
            checked={settings.is_accepting_orders}
            busy={statusBusy}
            label={t('admin.acceptingOrders')}
            onChange={() => void toggleAccepting()}
          />
        </div>
        <p className="text-xs leading-snug text-brand-subtle">{t('admin.acceptingOrdersHint')}</p>
        {statusErr && <p className="text-sm text-brand-error" role="alert">{statusErr}</p>}
        {statusNotice && <p className="text-xs text-brand-success" role="status">{statusNotice}</p>}
      </section>

      <div className="card grid gap-3 p-4" aria-busy={busy}>
        <p className="text-xs text-brand-subtle">{t('admin.settingsHint')}</p>
        <label className="grid gap-1">
          <span className="label mb-0">{t('admin.deliveryFee')}</span>
          <input className="input tabular-nums" inputMode="decimal" value={val('delivery_fee', String(settings.delivery_fee))} onChange={(e) => setEdit({ ...edit, delivery_fee: e.target.value })} />
        </label>
        <label className="grid gap-1">
          <span className="label mb-0">{t('admin.minOrder')}</span>
          <input className="input tabular-nums" inputMode="decimal" value={val('min_order_total', String(settings.min_order_total))} onChange={(e) => setEdit({ ...edit, min_order_total: e.target.value })} />
        </label>
        <div className="grid grid-cols-2 gap-3">
          <label className="grid gap-1">
            <span className="label mb-0">{t('admin.opensAt')}</span>
            <input type="time" className="input" value={val('opens_at', settings.opens_at)} onChange={(e) => setEdit({ ...edit, opens_at: e.target.value })} />
          </label>
          <label className="grid gap-1">
            <span className="label mb-0">{t('admin.closesAt')}</span>
            <input type="time" className="input" value={val('closes_at', settings.closes_at)} onChange={(e) => setEdit({ ...edit, closes_at: e.target.value })} />
          </label>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <label className="grid gap-1">
            <span className="label mb-0">{t('admin.prepTime')}</span>
            <input type="number" min={0} max={600} className="input tabular-nums" value={val('prep', String(settings.default_prep_minutes))} onChange={(e) => setEdit({ ...edit, prep: e.target.value })} />
          </label>
          <label className="grid gap-1">
            <span className="label mb-0">{t('admin.deliveryTime')}</span>
            <input type="number" min={0} max={600} className="input tabular-nums" value={val('deliver', String(settings.default_delivery_minutes))} onChange={(e) => setEdit({ ...edit, deliver: e.target.value })} />
          </label>
        </div>
        {err && <p className="text-sm text-brand-error" role="alert">{err}</p>}
        {notice && <p className="text-xs text-brand-success" role="status">{notice}</p>}
        <button type="button" className="btn-primary" onClick={() => void save()} disabled={busy}>{busy ? '…' : t('common.save')}</button>
      </div>
    </div>
  );
}
