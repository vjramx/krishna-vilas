import { describe, expect, it } from 'vitest';
import {
  rupeesToPaise,
  paiseToRupees,
  formatRupee,
  cartSubtotalPaise,
  cartTotalsPaise,
  cartItemCount,
  lineTotalPaise,
  type CartLine,
} from '@/lib/money';

const line = (unitPaise: number, quantity: number): CartLine => ({
  itemId: `id-${unitPaise}-${quantity}`,
  nameEn: 'x',
  nameKn: 'x',
  unitPaise,
  quantity,
});

describe('money conversions', () => {
  it('converts rupees (number) to paise without float drift', () => {
    expect(rupeesToPaise(0.1 + 0.2)).toBe(30); // 0.30000000000000004 → 30
    expect(rupeesToPaise(30)).toBe(3000);
    expect(rupeesToPaise('30.00')).toBe(3000);
    expect(rupeesToPaise(null)).toBe(0);
    expect(rupeesToPaise(-5)).toBe(0);
  });

  it('round-trips paise ↔ rupees', () => {
    expect(paiseToRupees(rupeesToPaise('149.99'))).toBeCloseTo(149.99, 8);
  });
});

describe('formatRupee', () => {
  it('formats Indian grouping (99,999 → 99,999)', () => {
    expect(formatRupee(99900)).toBe('₹999');
    expect(formatRupee(9999000)).toBe('₹99,990');
    expect(formatRupee(123450)).toBe('₹1,234.50');
  });
});

describe('cart calculations', () => {
  it('adds line totals', () => {
    expect(lineTotalPaise({ ...line(2500, 2) })).toBe(5000);
  });

  it('sums the subtotal in paise exactly', () => {
    const lines = [line(1599, 3), line(450, 2), line(10, 49)];
    expect(cartSubtotalPaise(lines)).toBe(1599 * 3 + 450 * 2 + 10 * 49);
    expect(cartItemCount(lines)).toBe(54);
  });

  it('includes fee and discounts without float errors', () => {
    const totals = cartTotalsPaise([line(1999, 2)], 1000);
    expect(totals.subtotal).toBe(3998);
    expect(totals.fee).toBe(1000);
    expect(totals.total).toBe(4998);
  });

  it('never goes below zero with discounts', () => {
    const totals = cartTotalsPaise([line(100, 1)], 0, { 'id-100-1': 999 });
    expect(totals.total).toBe(0);
  });
});
