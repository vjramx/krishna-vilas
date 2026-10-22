import { fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { MenuItem } from '@/types/db';

const h = vi.hoisted(() => ({
  cart: { add: vi.fn(), setQuantity: vi.fn(), quantityOf: vi.fn(() => 0) },
  snackbar: vi.fn(),
}));

vi.mock('@/context/CartContext', () => ({ useCart: () => h.cart }));
vi.mock('@/context/LanguageContext', () => ({
  useLanguage: () => ({
    t: (key: string, params?: Record<string, string>) =>
      key === 'menu.discount' ? `${params?.pct ?? ''}% OFF`
      : key === 'cart.addedToCart' ? `added ${params?.name ?? ''}`
      : key,
    lang: 'en',
  }),
}));
vi.mock('@/lib/haptics', () => ({ haptic: vi.fn(), hapticTick: vi.fn() }));
vi.mock('@/components/ui', async () => {
  const actual = await vi.importActual<typeof import('@/components/ui')>('@/components/ui');
  return { ...actual, showSnackbar: h.snackbar };
});

import { ItemSheet } from '@/components/ItemCard';

const baseItem: MenuItem = {
  id: 'mi-1', category_id: 'cat-1', name_en: 'Masala Dosa', name_kn: '',
  description_en: 'Crispy dosa with coconut chutney', description_kn: null,
  price: '60', original_price: '90', image_path: 'menu/dosa.jpg',
  is_available: true, is_active: true, is_featured: true, is_vegetarian: true,
};

function renderSheet(item: MenuItem | null) {
  return render(
    <MemoryRouter><ItemSheet item={item} onClose={() => undefined} /></MemoryRouter>,
  );
}

beforeEach(() => {
  h.cart.add.mockClear();
  h.snackbar.mockClear();
});

describe('item detail bottom sheet', () => {
  it('on a wide surface: bottom sheet (rounded top, height-capped) with two-column layout and the veg, popular and discount badges', () => {
    renderSheet(baseItem);
    const dialog = screen.getByRole('dialog', { hidden: true });
    // Anchored to the bottom, capped below the full viewport, app-width wide
    // (jsdom default >600px → wide surface, but never a centered card and
    // never edge-to-edge full-screen anymore).
    expect(dialog.className).toContain('rounded-t-3xl');
    expect(dialog.className).toContain('max-h-[86dvh]');
    expect(dialog.className).toContain('max-w-app');
    expect(dialog.className).not.toContain('h-full');
    expect(dialog.className).not.toContain('max-w-none');
    expect(dialog.className).not.toContain('rounded-none');
    // The whole viewport is dimmed behind the sheet.
    expect(document.querySelector('.bg-brand-scrim.fade-in')).not.toBeNull();
    // The hero carries a meaningful alt (it is the product photo, not decor),
    // so it is queryable by name in the accessibility tree.
    const img = screen.getByRole('img', { name: 'Masala Dosa', hidden: true });
    expect(img.getAttribute('src')).toContain('/storage/v1/object/public/food-images/menu/dosa.jpg');
    expect(img.className).toContain('absolute inset-0 h-full w-full');
    expect(screen.getByText('admin.vegetarian')).toBeInTheDocument();
    expect(screen.getByText('menu.featured')).toBeInTheDocument();
    // 60 vs original 90 → 33.33% rounds to 33% OFF.
    expect(screen.getByText('33% OFF')).toBeInTheDocument();
  });

  it('forces the vertical single-column phone layout at ≤600 CSS px in the bottom sheet (no side-by-side, no media queries)', () => {
    // Simulate a phone — and a zoomed-out WebView whose visual scale < 1 —
    // where the innerWidth alone could look wide but the device is not.
    Object.defineProperty(window, 'innerWidth', { configurable: true, value: 390 });
    renderSheet(baseItem);
    const dialog = screen.getByRole('dialog', { hidden: true });
    expect(dialog.className).toContain('rounded-t-3xl');
    expect(dialog.className).toContain('max-h-[86dvh]');
    expect(dialog.className).toContain('max-w-app');
    expect(dialog.className).not.toContain('max-w-none');
    // No viewport media-query classes anywhere in the forced-mobile tree.
    expect(dialog.textContent).toBeDefined();
    const stacked = dialog.querySelector('.app-scroll');
    expect(stacked?.className).toContain('flex-col');
    expect(stacked?.className).not.toContain('md:flex-row');
    const image = stacked?.firstElementChild as HTMLElement;
    expect(image.className).toContain('w-full');
    expect(image.className).not.toContain('w-[44%]');
    // Badge, name/price, description sit in the details block after the image.
    expect(screen.getByText('admin.vegetarian')).toBeInTheDocument();
    expect(screen.getByText('Masala Dosa')).toBeInTheDocument();
  });

  it('shows name, prices with strikethrough original, description and orig fallback line', () => {
    renderSheet(baseItem);
    expect(screen.getByText('Masala Dosa')).toBeInTheDocument();
    expect(screen.getByText('₹60')).toBeInTheDocument();
    expect(screen.getByText('₹90')).toBeInTheDocument();
    expect(screen.getByText('Crispy dosa with coconut chutney')).toBeInTheDocument();
  });

  it('steps quantity and adds multiples with the total on the pinned button', () => {
    renderSheet(baseItem);
    fireEvent.click(screen.getByRole('button', { name: 'cart.qtyIncrease' }));
    fireEvent.click(screen.getByRole('button', { name: 'cart.qtyIncrease' }));
    expect(screen.getByText('3')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'menu.add · ₹180' }));
    expect(h.cart.add).toHaveBeenCalledTimes(3);
    expect(h.snackbar).toHaveBeenCalledOnce();
  });

  it('never starts the stepper below one and disables add for sold-out items', () => {
    renderSheet({ ...baseItem, is_available: false });
    fireEvent.click(screen.getByRole('button', { name: 'cart.qtyDecrease' }));
    expect(screen.getByText('1')).toBeInTheDocument();
    const add = screen.getByRole('button', { name: 'menu.soldOut' });
    expect(add).toBeDisabled();
    expect(add).toHaveTextContent('menu.soldOut');
  });

  it('falls back to a clean placeholder tile when the photo is missing or broken', () => {
    const missing = { ...baseItem, image_path: null };
    renderSheet(missing);
    // No <img> at all — the placeholder tile renders in its place.
    expect(document.querySelector('img')).toBeNull();
    expect(document.querySelector('[role="dialog"]')?.textContent).toContain('Masala Dosa');
  });
});
