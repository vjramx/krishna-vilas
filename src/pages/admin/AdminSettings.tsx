import { useState } from 'react';
import { useHotelSettings } from '@/hooks/useHotelSettings';
import { supabase } from '@/lib/supabase';
import { useLanguage } from '@/context/LanguageContext';
import { Spinner } from '@/components/ui';
import { parseKvError } from '@/lib/errors';

export default function AdminSettings() {
  const { t } = useLanguage();
  const { data: settings, loading } = useHotelSettings();
  const [edit, setEdit] = useState<Record<string, string>>({});
  const [err, setErr] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  if (loading || !settings) return <Spinner />;

  const val = (key: string, fallback: string) => edit[key] ?? fallback;

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
      <label className="flex items-center gap-2 text-sm">
        <input type="checkbox" checked={settings.is_accepting_orders} className="h-5 w-5 accent-[#C83E24]" readOnly />
        {t('admin.acceptingOrders')} ({t('admin.filter')}: {t('admin.dashboard')} → {t('admin.openNow')})
      </label>
      {err && <p className="text-sm text-brand-error" role="alert">{err}</p>}
      {notice && <p className="text-xs text-brand-success" role="status">{notice}</p>}
      <button type="button" className="btn-primary" onClick={() => void save()} disabled={busy}>{busy ? '…' : t('common.save')}</button>
    </div>
  );
}
