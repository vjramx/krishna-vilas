import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import type { MenuItem } from '@/types/db';
import { cartItemCount, cartSubtotalPaise, formatRupee, lineTotalPaise, rupeesToPaise } from '@/lib/money';

export interface CartLineState {
  itemId: string;
  nameEn: string;
  nameKn: string;
  unitPaise: number;
  quantity: number;
  imageUrl?: string | null;
}

interface CartValue {
  lines: CartLineState[];
  count: number;
  subtotalPaise: number;
  add: (item: MenuItem) => void;
  setQuantity: (itemId: string, qty: number) => void;
  remove: (itemId: string) => void;
  clear: () => void;
  quantityOf: (itemId: string) => number;
  syncPrices: (items: Pick<MenuItem, 'id' | 'price' | 'name_en' | 'name_kn'>[]) => void;
  unavailableIds: string[];
  markUnavailable: (ids: string[]) => void;
}

const CART_KEY = 'kv-cart-v1';
const MAX_QTY = 50;

const CartContext = createContext<CartValue | null>(null);

function load(): CartLineState[] {
  try {
    const raw = window.localStorage.getItem(CART_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter((l): l is CartLineState => !!l && typeof (l as CartLineState).itemId === 'string')
      .map((l) => ({ ...l, quantity: Math.max(1, Math.min(MAX_QTY, Math.round(l.quantity))) }))
      .slice(0, 50);
  } catch {
    return [];
  }
}

export function CartProvider({ children }: { children: ReactNode }) {
  const [lines, setLines] = useState<CartLineState[]>(() => load());
  const [unavailableIds, setUnavailableIds] = useState<string[]>([]);

  useEffect(() => {
    try {
      window.localStorage.setItem(CART_KEY, JSON.stringify(lines));
    } catch {
      /* storage full/private mode — cart stays in memory */
    }
  }, [lines]);

  const add = useCallback((item: MenuItem) => {
    setLines((prev) => {
      const existing = prev.find((l) => l.itemId === item.id);
      const unitPaise = rupeesToPaise(item.price);
      if (existing) {
        return prev.map((l) =>
          l.itemId === item.id
            ? { ...l, quantity: Math.min(MAX_QTY, l.quantity + 1), unitPaise, nameEn: item.name_en, nameKn: item.name_kn }
            : l,
        );
      }
      return [
        ...prev,
        {
          itemId: item.id,
          nameEn: item.name_en,
          nameKn: item.name_kn,
          unitPaise,
          quantity: 1,
          imageUrl: item.image_path,
        },
      ];
    });
  }, []);

  const setQuantity = useCallback((itemId: string, qty: number) => {
    setLines((prev) =>
      qty <= 0
        ? prev.filter((l) => l.itemId !== itemId)
        : prev.map((l) => (l.itemId === itemId ? { ...l, quantity: Math.min(MAX_QTY, qty) } : l)),
    );
  }, []);

  const remove = useCallback((itemId: string) => {
    setLines((prev) => prev.filter((l) => l.itemId !== itemId));
    setUnavailableIds((prev) => prev.filter((id) => id !== itemId));
  }, []);

  const clear = useCallback(() => {
    setLines([]);
    setUnavailableIds([]);
  }, []);

  const quantityOf = useCallback(
    (itemId: string) => lines.find((l) => l.itemId === itemId)?.quantity ?? 0,
    [lines],
  );

  /** Reconcile trusted backend prices/names into cart lines (no network per tap). */
  const syncPrices = useCallback((items: Pick<MenuItem, 'id' | 'price' | 'name_en' | 'name_kn'>[]) => {
    setLines((prev) =>
      prev.map((l) => {
        const m = items.find((i) => i.id === l.itemId);
        return m
          ? { ...l, unitPaise: rupeesToPaise(m.price), nameEn: m.name_en, nameKn: m.name_kn }
          : l;
      }),
    );
  }, []);

  const markUnavailable = useCallback((ids: string[]) => {
    setUnavailableIds((prev) => Array.from(new Set([...prev, ...ids])));
  }, []);

  const value = useMemo<CartValue>(
    () => ({
      lines,
      count: cartItemCount(lines),
      subtotalPaise: cartSubtotalPaise(lines),
      add,
      setQuantity,
      remove,
      clear,
      quantityOf,
      syncPrices,
      unavailableIds,
      markUnavailable,
    }),
    [lines, add, setQuantity, remove, clear, quantityOf, syncPrices, unavailableIds, markUnavailable],
  );

  return <CartContext.Provider value={value}>{children}</CartContext.Provider>;
}

export function useCart(): CartValue {
  const ctx = useContext(CartContext);
  if (!ctx) throw new Error('useCart must be used inside CartProvider');
  return ctx;
}

/** Utility for empty-cart buttons etc. */
export function describeCart(lines: CartLineState[]): string {
  const subtotal = cartSubtotalPaise(lines);
  return `${lines.reduce((n, l) => n + l.quantity, 0)} items · ${formatRupee(subtotal, { withSymbol: true })} · line=${lineTotalPaise(lines[0] ?? { itemId: '', nameEn: '', nameKn: '', unitPaise: 0, quantity: 0 })}`;
}
