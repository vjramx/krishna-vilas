import { useEffect, useRef, useState } from 'react';
import type { Order, OrderItemWithSnapshot } from '@/types/db';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/context/AuthContext';

const PAGE = 10;
const RECONNECT_MS = 5000;
const POLL_MS = 20000;
const MAX_PAGES = 50;

interface KvRealtimePayload {
  eventType: 'INSERT' | 'UPDATE' | 'DELETE';
  new: Order | null;
  old: { id: string } | null;
}

export function applyRealtime(prev: Order[], payload: KvRealtimePayload): Order[] {
  if (payload.eventType === 'DELETE' && payload.old?.id) {
    return prev.filter((o) => o.id !== payload.old!.id);
  }
  const next = payload.new;
  if (!next) return prev;
  const idx = prev.findIndex((o) => o.id === next.id);
  if (idx === -1) {
    return [next, ...prev].sort((a, b) => b.created_at.localeCompare(a.created_at));
  }
  const copy = [...prev];
  copy[idx] = next;
  return copy;
}

/** Last-known history survives refreshes and offline starts: hydrate the list
 * from localStorage before the network answers, then reconcile over it. */
function cacheKey(userId: string): string {
  return `kv.orders.${userId.slice(0, 8)}`;
}

export function readCache(userId: string): Order[] {
  try {
    const raw = localStorage.getItem(cacheKey(userId));
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((o): o is Order =>
      !!o && typeof o === 'object' && typeof (o as Order).id === 'string' && typeof (o as Order).status === 'string',
    );
  } catch {
    return [];
  }
}

function writeCache(userId: string, orders: Order[]): void {
  try {
    // History rows are small; cap the cache instead of storing all 50 pages.
    localStorage.setItem(cacheKey(userId), JSON.stringify(orders.slice(0, PAGE * 3)));
  } catch {
    /* storage full or unavailable — cache is best-effort only */
  }
}

async function fetchPage(offset: number): Promise<{ data: Order[]; error: string | null }> {
  const { data, error: err } = await supabase
    .from('orders')
    .select('*')
    .order('created_at', { ascending: false })
    .range(offset, offset + PAGE - 1);
  if (err) return { data: [], error: err.message };
  return { data: (data as Order[] | null) ?? [], error: null };
}

/** Merge fresh rows into an existing list (upsert + newest first) so a
 * reconciliation refetch never resurrects duplicates or lost pages. */
function upsertSorted(prev: Order[], fresh: Order[]): Order[] {
  return [...fresh, ...prev.filter((o) => !fresh.some((f) => f.id === o.id))].sort((a, b) =>
    b.created_at.localeCompare(a.created_at),
  );
}

export function useMyOrders(): {
  orders: Order[];
  loading: boolean;
  error: string | null;
  live: boolean;
  fromCache: boolean;
  hasMore: boolean;
  loadMore: () => void;
  retry: () => void;
} {
  const { userId } = useAuth();
  const [orders, setOrders] = useState<Order[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [live, setLive] = useState(true);
  const [fromCache, setFromCache] = useState(false);
  const [hasMore, setHasMore] = useState(false);
  const [attempt, setAttempt] = useState(0);

  const backoffRef = useRef(0);
  const reconnectTimer = useRef<number | null>(null);

  useEffect(() => {
    if (!userId) {
      setOrders([]);
      setLoading(false);
      setFromCache(false);
      return;
    }

    // Show the saved history instantly; the network output replaces it.
    const cached = readCache(userId);
    setOrders(cached);
    setFromCache(cached.length > 0);
    if (cached.length > 0) setLoading(false);

    let pollTimer: number | null = null;

    // Reconciliation refetch: replaces the visible list with the database's
    // newest rows, merged over what is already shown.
    const refresh = async (silent: boolean) => {
      if (!silent) {
        setLoading(true);
        setError(null);
      }
      const { data, error: err } = await fetchPage(0);
      if (err) {
        if (!silent) setError(err);
        return;
      }
      setError(null);
      setFromCache(false);
      // An empty reconciliation on a non-empty cache is kept as-is: it means
      // the fetch raced a fresh sign-in, not that history was truly wiped.
      setOrders((prev) => (data.length === 0 && cached.length > 0 ? prev : upsertSorted(prev, data)));
      if (data.length === 0) setHasMore((prev) => (silent ? prev : false));
      else setHasMore(data.length === PAGE);
      writeCache(userId, data);
    };

    const trigger = () => setAttempt((a) => a + 1);

    // Poll while realtime is down so status changes still arrive.
    const startPolling = () => {
      setLive(false);
      if (pollTimer === null) pollTimer = window.setInterval(() => void refresh(true), POLL_MS);
    };
    const stopPolling = () => {
      if (pollTimer !== null) {
        window.clearInterval(pollTimer);
        pollTimer = null;
      }
      setLive(true);
    };

    // Cached start is silent (no spinner over the hydrated list); empty start
    // shows the spinner until the first network page lands.
    void refresh(cached.length > 0);

    // Realtime: my orders only (RLS filters server-side too). A dropped
    // connection falls back to polling and re-subscribes with backoff —
    // missed updates are reconciled by every reconnecting refetch.
    const channel = supabase
      .channel(`orders-me-${userId.slice(0, 8)}`)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'orders' },
        (payload) => {
          setOrders((prev) => applyRealtime(prev, payload as unknown as KvRealtimePayload));
          setFromCache(false);
        },
      )
      .subscribe((status) => {
        if (status === 'SUBSCRIBED') {
          backoffRef.current = 0;
          stopPolling();
          return;
        }
        if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT' || status === 'CLOSED') {
          startPolling();
          if (reconnectTimer.current !== null) return;
          backoffRef.current = Math.min(backoffRef.current + RECONNECT_MS, RECONNECT_MS * 6);
          reconnectTimer.current = window.setTimeout(() => {
            reconnectTimer.current = null;
            void refresh(true);
            trigger();
          }, backoffRef.current);
        }
      });

    // Backgrounded tabs (and Android WebViews) can miss realtime events —
    // reconcile the moment the app comes back to the foreground.
    const onVisible = () => {
      if (document.visibilityState !== 'visible') return;
      void refresh(true);
    };
    document.addEventListener('visibilitychange', onVisible);

    return () => {
      document.removeEventListener('visibilitychange', onVisible);
      if (reconnectTimer.current !== null) {
        window.clearTimeout(reconnectTimer.current);
        reconnectTimer.current = null;
      }
      if (pollTimer !== null) window.clearInterval(pollTimer);
      void supabase.removeChannel(channel);
    };
  }, [userId, attempt]);

  const loadMore = async () => {
    if (loading || !hasMore || orders.length === 0 || orders.length >= MAX_PAGES || !userId) return;
    setLoading(true);
    const { data, error: err } = await fetchPage(orders.length);
    if (err) setError(err);
    else {
      const merged = upsertSorted(orders, data);
      setOrders(merged);
      setHasMore(data.length === PAGE);
      writeCache(userId, merged.slice(0, PAGE * 3));
    }
    setLoading(false);
  };

  return {
    orders,
    loading,
    error,
    live,
    fromCache,
    hasMore,
    loadMore,
    retry: () => setAttempt((a) => a + 1),
  };
}

/** Single order (customer detail page) with realtime refresh and the same
 * disconnect fallbacks as the history list. */
export function useOrder(orderId: string | undefined): {
  order: Order | null;
  items: OrderItemWithSnapshot[];
  loading: boolean;
  error: string | null;
  live: boolean;
  retry: () => void;
} {
  const [order, setOrder] = useState<Order | null>(null);
  const [items, setItems] = useState<OrderItemWithSnapshot[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [live, setLive] = useState(true);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    if (!orderId) return;
    let active = true;
    setLoading(true);
    setError(null);
    void (async () => {
      const [{ data: o, error: oe }, { data: oi, error: ie }] = await Promise.all([
        supabase.from('orders').select('*').eq('id', orderId).maybeSingle(),
        supabase.from('order_items').select('*').eq('order_id', orderId),
      ]);
      if (!active) return;
      if (oe || ie || !o) {
        setError(oe?.message ?? ie?.message ?? 'not found');
      } else {
        setOrder(o as Order);
        const rows = ((oi ?? []) as OrderItemWithSnapshot[]);
        // Item images/descriptions live on menu_items (no FK embed is defined,
        // so hydrate by the stored menu_item_id; catalog reads are public).
        const menuIds = [...new Set(rows.map((r) => r.menu_item_id).filter((v): v is string => !!v))];
        if (menuIds.length === 0) {
          setItems(rows.map((r) => ({ ...r, menu_items: null })));
        } else {
          const { data: mi } = await supabase
            .from('menu_items')
            .select('id, image_path, description_en, description_kn, is_vegetarian')
            .in('id', menuIds);
          if (!active) return;
          const byId = new Map(((mi ?? []) as NonNullable<OrderItemWithSnapshot['menu_items']>[]).map((m) => [m.id, m]));
          setItems(rows.map((r) => ({ ...r, menu_items: (r.menu_item_id && byId.get(r.menu_item_id)) || null })));
        }
      }
      if (active) setLoading(false);
    })();

    const refetch = async () => {
      const { data: o, error: oe } = await supabase.from('orders').select('*').eq('id', orderId).maybeSingle();
      if (!active || oe || !o) return;
      setOrder(o as Order);
      setError(null);
    };

    let pollTimer: number | null = null;
    const startPolling = () => {
      setLive(false);
      if (pollTimer === null) pollTimer = window.setInterval(() => void refetch(), POLL_MS);
    };
    const stopPolling = () => {
      if (pollTimer !== null) {
        window.clearInterval(pollTimer);
        pollTimer = null;
      }
      setLive(true);
    };

    const channel = supabase
      .channel(`order-${orderId.slice(0, 8)}`)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'orders', filter: `id=eq.${orderId}` },
        (payload) => {
          if (payload.new) setOrder(payload.new as Order);
        },
      )
      .subscribe((status) => {
        if (status === 'SUBSCRIBED') stopPolling();
        else if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT' || status === 'CLOSED') startPolling();
      });

    const onVisible = () => {
      if (document.visibilityState !== 'visible') return;
      void refetch();
    };
    document.addEventListener('visibilitychange', onVisible);

    return () => {
      active = false;
      document.removeEventListener('visibilitychange', onVisible);
      if (pollTimer !== null) window.clearInterval(pollTimer);
      void supabase.removeChannel(channel);
    };
  }, [orderId, attempt]);

  return { order, items, loading, error, live, retry: () => setAttempt((a) => a + 1) };
}
