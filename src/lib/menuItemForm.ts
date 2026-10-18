import { rupeesToPaise } from '@/lib/money';

export interface MenuPriceInput {
  name_en: string;
  category_id: string;
  price: string;
  original_price: string;
}

export type MenuPriceError = 'name' | 'category' | 'price' | 'original_price' | 'discount';

function parseRupees(value: number | string | null | undefined): number | null {
  // PostgREST serializes numeric columns as JSON numbers, so callers may
  // legitimately hand us a number from a freshly loaded row.
  if (value === null || value === undefined) return null;
  const normalized = (typeof value === 'number' ? (Number.isFinite(value) ? String(value) : '') : value).trim();
  if (!/^(?:\d+)(?:\.\d{1,2})?$/.test(normalized)) return null;
  const amount = Number(normalized);
  return Number.isFinite(amount) ? amount : null;
}

export function validateMenuPrice(input: MenuPriceInput): MenuPriceError | null {
  if (!input.name_en.trim()) return 'name';
  if (!input.category_id) return 'category';
  const price = parseRupees(input.price);
  if (price === null || price <= 0) return 'price';
  if (input.original_price.trim()) {
    const original = parseRupees(input.original_price);
    if (original === null || original <= 0) return 'original_price';
    if (rupeesToPaise(original) <= rupeesToPaise(price)) return 'discount';
  }
  return null;
}

export function menuDiscountPercent(price: number | string, originalPrice: number | string): number | null {
  const priceRupees = parseRupees(price);
  const originalRupees = parseRupees(originalPrice);
  if (priceRupees === null || originalRupees === null || priceRupees <= 0 || originalRupees <= priceRupees) return null;
  const originalPaise = rupeesToPaise(originalRupees);
  return Math.round(((originalPaise - rupeesToPaise(priceRupees)) / originalPaise) * 100);
}

export function menuPriceNumber(value: number | string): number {
  const parsed = parseRupees(value);
  if (parsed === null) throw new RangeError('Invalid rupee price');
  return parsed;
}
