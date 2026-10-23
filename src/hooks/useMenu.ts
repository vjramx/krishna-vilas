import { useCallback, useEffect, useRef, useState } from 'react';
import type { Category, MenuItem } from '@/types/db';
import { supabase } from '@/lib/supabase';
import { useCart } from '@/context/CartContext';

interface MenuState {
  categories: Category[];
  items: MenuItem[];
  loading: boolean;
  error: string | null;
  retry: () => void;
  /** Same fetch, awaitable — used by pull-to-refresh to end its spinner. */
  refresh: () => Promise<void>;
}

/** Never leave the menu skeleton spinning forever on a stalled request. */
const MENU_TIMEOUT_MS = 12000;
function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('MENU_TIMEOUT')), ms);
    p.then(
      (v) => {
        clearTimeout(timer);
        resolve(v);
      },
      (e) => {
        clearTimeout(timer);
        reject(e);
      },
    );
  });
}

export function useMenu(): MenuState {
  const [categories, setCategories] = useState<Category[]>([]);
  const [items, setItems] = useState<MenuItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const requestId = useRef(0);
  const cart = useCart();
  const syncedRef = useRef(false);

  const load = useCallback(async () => {
    const id = ++requestId.current;
    setLoading(true);
    setError(null);
    try {
      const [catRes, itemRes] = await withTimeout(
        Promise.all([
          supabase.from('categories').select('*').eq('is_active', true).order('display_order'),
          supabase.from('menu_items').select('*').eq('is_active', true).order('created_at'),
        ]),
        MENU_TIMEOUT_MS,
      );
      if (id !== requestId.current) return;
      if (catRes.error || itemRes.error) {
        setError(catRes.error?.message ?? itemRes.error?.message ?? 'fetch failed');
      } else {
        setCategories(catRes.data as Category[]);
        setItems(itemRes.data as MenuItem[]);
      }
    } catch (e: unknown) {
      if (id === requestId.current) setError(e instanceof Error ? e.message : String(e));
    } finally {
      if (id === requestId.current) setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  // Self-heal a stale/empty menu: if this tab cached an empty result (e.g. the
  // menu was unavailable when it first loaded), refetch as soon as it regains
  // focus instead of forcing the user to reload the whole app.
  useEffect(() => {
    const onFocus = () => {
      if (document.visibilityState !== 'visible') return;
      if (items.length === 0) void load();
    };
    window.addEventListener('focus', onFocus);
    document.addEventListener('visibilitychange', onFocus);
    return () => {
      window.removeEventListener('focus', onFocus);
      document.removeEventListener('visibilitychange', onFocus);
    };
  }, [items.length, load]);

  // Reconcile trusted prices + availability into the cart once per menu load.
  useEffect(() => {
    if (loading || error || items.length === 0) return;
    if (syncedRef.current) return;
    syncedRef.current = true;
    cart.syncPrices(items);
    const inCartIds = cart.lines.map((l) => l.itemId);
    const gone = inCartIds.filter((id) => {
      const m = items.find((i) => i.id === id);
      return !!m && (!m.is_active || !m.is_available);
    });
    if (gone.length) cart.markUnavailable(gone);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loading, items, error]);

  return {
    categories,
    items,
    loading,
    error,
    retry: () => void load(),
    refresh: load,
  };
}

export function filterMenu(items: MenuItem[], query: string, categoryId: string | null, dietary: 'all' | 'veg' | 'non-veg' = 'all', opts?: Partial<{ sort: MenuSort; offersOnly: boolean }>): MenuItem[] {
  const q = query.trim().toLowerCase();
  const sort = opts?.sort ?? 'popular';
  const offersOnly = opts?.offersOnly ?? false;
  const priceOf = (item: MenuItem): number => Number(item.price) || 0;
  const filtered = items.filter((item) => {
    if (categoryId && item.category_id !== categoryId) return false;
    if (dietary === 'veg' && !item.is_vegetarian) return false;
    if (dietary === 'non-veg' && item.is_vegetarian) return false;
    if (offersOnly) {
      const orig = item.original_price ? Number(item.original_price) : 0;
      if (!(orig > priceOf(item))) return false;
    }
    if (!q) return true;
    return (
      item.name_en.toLowerCase().includes(q) ||
      item.name_kn.includes(query.trim()) ||
      (item.description_en ?? '').toLowerCase().includes(q) ||
      (item.description_kn ?? '').includes(query.trim())
    );
  });
  // Sort AFTER filtering, on a copy — the order the kitchen publishes never
  // changes at the source. Stable sorts keep the original fetch order as the
  // tiebreak. "Popular" simply floats the featured dishes to the top.
  if (sort === 'price-asc') return [...filtered].sort((a, b) => priceOf(a) - priceOf(b));
  if (sort === 'price-desc') return [...filtered].sort((a, b) => priceOf(b) - priceOf(a));
  return [...filtered].sort((a, b) => Number(!!b.is_featured) - Number(!!a.is_featured));
}

/** Home-page sort options; 'popular' is the neutral default. */
export type MenuSort = 'popular' | 'price-asc' | 'price-desc';

export function groupByCategory(items: MenuItem[], categories: Category[]): { cat: Category; items: MenuItem[] }[] {
  const map = new Map<string, MenuItem[]>();
  for (const item of items) {
    const arr = map.get(item.category_id) ?? [];
    arr.push(item);
    map.set(item.category_id, arr);
  }
  return categories
    .map((cat) => ({ cat, items: map.get(cat.id) ?? [] }))
    .filter((g) => g.items.length > 0);
}
