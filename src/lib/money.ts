/**
 * Money is handled exclusively as integer paise in client-side state and
 * calculations so we never do floating-point currency math. Backend prices
 * are numeric rupees with at most 2 decimals; we convert on read/write.
 */

export function rupeesToPaise(rupees: number | string | null | undefined): number {
  if (rupees === null || rupees === undefined) return 0;
  const n = typeof rupees === 'string' ? Number.parseFloat(rupees) : rupees;
  if (!Number.isFinite(n) || n < 0) return 0;
  return Math.round(n * 100);
}

export function paiseToRupees(paise: number): number {
  return Math.round(paise) / 100;
}

export function formatRupee(paise: number, opts?: { withSymbol?: boolean }): string {
  const value = Math.round(paise) / 100;
  const formatted = new Intl.NumberFormat('en-IN', {
    minimumFractionDigits: paise % 100 === 0 ? 0 : 2,
    maximumFractionDigits: 2,
  }).format(value);
  return opts?.withSymbol === false ? formatted : `₹${formatted}`;
}

export interface CartLine {
  itemId: string;
  nameEn: string;
  nameKn: string;
  unitPaise: number;
  quantity: number;
}

export function lineTotalPaise(line: CartLine): number {
  return line.unitPaise * Math.max(0, Math.min(50, line.quantity));
}

export function cartSubtotalPaise(lines: CartLine[]): number {
  return lines.reduce((sum, l) => sum + lineTotalPaise(l), 0);
}

export function cartItemCount(lines: CartLine[]): number {
  return lines.reduce((sum, l) => sum + Math.max(0, l.quantity), 0);
}

export function cartTotalsPaise(
  lines: CartLine[],
  deliveryFeePaise: number,
  discountPerUnitPaise: Record<string, number> = {},
): { subtotal: number; discount: number; fee: number; total: number } {
  const subtotal = cartSubtotalPaise(lines);
  const discount = lines.reduce(
    (d, l) => d + (discountPerUnitPaise[l.itemId] ?? 0) * l.quantity,
    0,
  );
  const total = Math.max(0, subtotal - discount + Math.max(0, deliveryFeePaise));
  return { subtotal, discount, fee: Math.max(0, deliveryFeePaise), total };
}
