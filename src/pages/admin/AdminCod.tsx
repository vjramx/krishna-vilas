import { useEffect, useState } from 'react';
import { supabase } from '@/lib/supabase';
import { useLanguage } from '@/context/LanguageContext';
import { parseKvError } from '@/lib/errors';
import { formatRupee, rupeesToPaise } from '@/lib/money';
import { Spinner } from '@/components/ui';
import type { Order } from '@/types/db';

export default function AdminCod() {
  const { t } = useLanguage();
  const [orders, setOrders] = useState<Order[]>([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    supabase
      .from('orders')
      .select('*')
      .in('status', ['out_for_delivery', 'delivered'])
      .order('created_at', { ascending: false })
      .range(0, 49)
      .then(({ data, error }) => {
        if (!active) return;
        if (error) setErr(error.message);
        else setOrders(((data as Order[]) ?? []).filter((o) => o.cash_verified_at === null && o.status === 'delivered'));
        setLoading(false);
      });

    const ch = supabase
      .channel('admin-cod')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'orders' }, (payload) => {
        const o = payload.new as Order | null;
        if (payload.eventType === 'INSERT' && o) setOrders((prev) => (o.status === 'delivered' && !o.cash_verified_at && !prev.some((p) => p.id === o.id) ? [o, ...prev] : prev));
        if (payload.eventType === 'UPDATE' && o) {
          setOrders((prev) => (o.status === 'delivered' && !o.cash_verified_at
            ? (prev.some((p) => p.id === o.id) ? prev.map((p) => (p.id === o.id ? o : p)) : [o, ...prev])
            : prev.filter((p) => p.id !== o.id)));
        }
      })
      .subscribe();

    return () => {
      active = false;
      void supabase.removeChannel(ch);
    };
  }, []);

  async function verify(order: Order) {
    const expected = rupeesToPaise(order.cod_expected ?? order.total);
    const collected = rupeesToPaise(order.cod_collected ?? '-1');
    if (collected < 0 || collected !== expected) {
      const note = `collected=\u20B9${(order.cod_collected ?? '0')} expected=\u20B9${order.total}`;
      setErr(`${t('admin.discrepancy', { amount: note })} — ${t('err.amountInvalid')}`);
      return;
    }
    setBusyId(order.id);
    const { error } = await supabase.rpc('verify_cash', { p_order_id: order.id });
    setBusyId(null);
    if (error) setErr(t(parseKvError(error).key));
    else setOrders((prev) => prev.filter((o) => o.id !== order.id));
  }

  if (loading) return <Spinner />;

  return (
    <div className="grid gap-3">
      {err && <p className="text-sm text-brand-error" role="alert">{err}</p>}
      {orders.length === 0 ? (
        <p className="card p-4 text-sm text-brand-subtle">{t('admin.nothingPending')}</p>
      ) : (
        <ul className="grid gap-2">
          {orders.map((o) => {
            const expected = rupeesToPaise(o.cod_expected ?? o.total);
            const collected = o.cod_collected === null ? null : rupeesToPaise(o.cod_collected);
            const handed = !!o.cash_handed_at;
            return (
              <li key={o.id} className="card p-3 grid gap-2">
                <div className="flex items-center justify-between gap-2">
                  <span className="font-bold tabular-nums">{o.order_number}</span>
                  <span className={`badge ${o.assignment_status === 'delivered' ? 'bg-brand-successBg text-brand-success' : 'bg-brand-secondary/15 text-brand-primaryDark'}`}>
                    {t(`order.status.${o.status}`)}
                  </span>
                </div>
                <dl className="grid gap-1 text-sm" aria-label={`COD ${o.order_number}`}>
                  <div className="flex justify-between"><dt>{t('admin.codExpected')}</dt><dd className="font-semibold">{formatRupee(expected)}</dd></div>
                  <div className="flex justify-between"><dt>{t('admin.codCollected')}</dt><dd>{collected === null ? '—' : formatRupee(collected)}</dd></div>                  <div className="flex justify-between">
                    <dt>{t('admin.codHanded')}</dt>
                    <dd>{handed ? `✓ ${new Date(o.cash_handed_at ?? 0).toLocaleTimeString()}` : '⏳'}</dd>
                  </div>
                </dl>
                <button type="button" className="btn-primary text-sm" disabled={!handed || collected !== expected || busyId === o.id} onClick={() => void verify(o)}>
                  {t('admin.verifyCash')}
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
