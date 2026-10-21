import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/context/AuthContext';
import { useLanguage } from '@/context/LanguageContext';
import { showSnackbar } from '@/components/ui';
import { haptic } from '@/lib/haptics';
import { readCache } from '@/hooks/useOrders';
import type { Order } from '@/types/db';
import { customerOrderStatusLabel, customerVisibleOrderStatus } from '@/lib/orderPresentation';

const OPT_OUT_KEY = 'kv-notify-orders';

export function notifyOrdersEnabled(): boolean {
  try {
    return localStorage.getItem(OPT_OUT_KEY) !== 'off';
  } catch {
    return true;
  }
}

export function setNotifyOrdersEnabled(on: boolean): void {
  try {
    localStorage.setItem(OPT_OUT_KEY, on ? 'on' : 'off');
  } catch {
    /* private mode */
  }
}

/**
 * Passive status notifications: a lightweight channel whose only job is a
 * snackbar + haptic when one of MY orders changes state (status/journey).
 * Never the source of truth — screens refetch/render from their own hooks;
 * this just says "your order moved" even while you are elsewhere in the app.
 */
export default function OrderNotifier() {
  const { session, role, userId } = useAuth();
  const { t } = useLanguage();
  const navigate = useNavigate();
  const [enabled, setEnabled] = useState(() => {
    try { return localStorage.getItem(OPT_OUT_KEY) !== 'off'; } catch { return true; }
  });
  const lastStatusRef = useRef<Map<string, string>>(new Map());

  useEffect(() => {
    const off = (() => { try { return localStorage.getItem(OPT_OUT_KEY) === 'off'; } catch { return false; } })();
    if (off !== !enabled) setEnabled(!off);
  }, [enabled]);

  useEffect(() => {
    if (!enabled) return;
    if (!session || role !== 'customer' || !userId) return;

    // Seed known statuses from the cached history so a fresh mount does not
    // announce orders that changed before the app opened.
    const map = lastStatusRef.current;
    map.clear();
    for (const o of readCache(userId)) map.set(o.id, customerVisibleOrderStatus(o.status));

    const channel = supabase
      .channel(`orders-notify-${userId.slice(0, 8)}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'orders' }, (payload) => {
        const next = payload.new as Order | null;
        if (!next || next.customer_id !== userId) return;
        const visibleStatus = customerVisibleOrderStatus(next.status);
        const prev = map.get(next.id);
        map.set(next.id, visibleStatus);
        if (prev === undefined || prev === visibleStatus) return;

        const title = `${next.order_number} · ${customerOrderStatusLabel(visibleStatus, t)}`;
        haptic(24);
        showSnackbar(title, {
          label: t('common.view'),
          onAction: () => navigate(`/order/${next.id}`),
        });
      })
      .subscribe();

    return () => {
      void supabase.removeChannel(channel);
      map.clear();
    };
  }, [enabled, session, role, userId, t, navigate]);

  return null;
}
