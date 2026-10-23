import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup } from '@testing-library/react';
import { filterMenu } from '@/hooks/useMenu';
import type { MenuItem } from '@/types/db';

function makeItem(over: Partial<MenuItem> = {}): MenuItem {
  return {
    id: '',
    category_id: 'cat-1',
    name_en: '',
    name_kn: '',
    description_en: null,
    description_kn: null,
    price: 0,
    original_price: null,
    image_path: null,
    is_available: true,
    is_active: true,
    is_featured: false,
    is_vegetarian: false,
    ...over,
  };
}

describe('filterMenu (pure function)', () => {
  const items = [
    makeItem({ id: 'a', name_en: 'Ghee Dosa', price: 60, is_vegetarian: true, is_featured: true }),
    makeItem({ id: 'b', name_en: 'Chicken Biryani', price: 120, is_vegetarian: false }),
    makeItem({ id: 'c', name_en: 'Filter Coffee', price: 20, is_vegetarian: true, original_price: 30 }),
    makeItem({ id: 'd', name_en: 'Mutton Curry', price: 180, is_vegetarian: false, original_price: 250 }),
  ];

  it('keeps the kitchen order with featured dishes floated first by default', () => {
    expect(filterMenu(items, '', null, 'all').map((i) => i.id)).toEqual(['a', 'b', 'c', 'd']);
  });

  it('sorts by price low→high and high→low', () => {
    expect(filterMenu(items, '', null, 'all', { sort: 'price-asc' }).map((i) => i.id)).toEqual(['c', 'a', 'b', 'd']);
    expect(filterMenu(items, '', null, 'all', { sort: 'price-desc' }).map((i) => i.id)).toEqual(['d', 'b', 'a', 'c']);
  });

  it('filters by dietary type', () => {
    expect(filterMenu(items, '', null, 'veg').map((i) => i.id)).toEqual(['a', 'c']);
    expect(filterMenu(items, '', null, 'non-veg').map((i) => i.id)).toEqual(['b', 'd']);
  });

  it('filters offers-only to dishes with a real discount', () => {
    expect(filterMenu(items, '', null, 'all', { offersOnly: true }).map((i) => i.id)).toEqual(['c', 'd']);
  });

  it('combines search with the other filters', () => {
    expect(filterMenu(items, 'coffee', null, 'veg', { offersOnly: true }).map((i) => i.id)).toEqual(['c']);
  });
});

/* ---- Rendered home page ------------------------------------------------- */

const cart = {
  count: 0,
  lines: [],
  items: [],
  add: () => {},
  setQuantity: () => {},
  quantityOf: () => 0,
  syncPrices: () => {},
  markUnavailable: () => {},
  subtotal: 0,
  clear: () => {},
};

const h = {
  items: [] as MenuItem[],
  categories: [{ id: 'cat-1', slug: 'snacks', name_en: 'Snacks', name_kn: '', display_order: 0, is_active: true }],
};

async function renderMenu(loadedMarker = 'Filter Coffee') {
  const { default: MenuPage } = await import('@/pages/MenuPage');
  render(
    <MemoryRouter>
      <MenuPage />
    </MemoryRouter>,
  );
  await screen.findByText(loadedMarker);
}

vi.mock('@/lib/supabase', () => ({
  supabase: {
    from: (table: string) => ({
      select: () => ({
        eq: () => ({
          order: () =>
            Promise.resolve({
              data: table === 'menu_items' ? [...h.items] : [...h.categories],
              error: null,
            }),
        }),
      }),
    }),
  },
}));

vi.mock('@/hooks/useHotelSettings', () => ({
  useHotelSettings: () => ({
    data: { is_accepting_orders: true, name_en: 'Krishna Vilas', name_kn: '', opens_at: '09:00', closes_at: '22:00' },
    loading: false,
    error: null,
    retry: () => {},
  }),
}));

vi.mock('@/context/AuthContext', () => ({ useAuth: () => ({ role: 'anon' }) }));
vi.mock('@/context/CartContext', () => ({
  CartProvider: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  useCart: () => cart,
}));
vi.mock('@/context/LanguageContext', () => ({
  LanguageProvider: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  useLanguage: () => ({ lang: 'en', locale: 'en', t: (key: string) => key }),
}));
vi.mock('@/components/nav', () => ({
  CustomerHeader: () => <header />,
  BottomNav: () => <nav />,
}));
vi.mock('@/components/PullToRefresh', () => ({
  PullToRefresh: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

vi.mock('@/hooks/useMenu', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/hooks/useMenu')>();
  return {
    ...actual,
    useMenu: () => ({
      categories: h.categories,
      items: h.items,
      loading: false,
      error: null,
      retry: () => {},
      refresh: async () => {},
    }),
  };
});

describe('Home page filter bar', () => {
  it('keeps only the essentials — search, category rail and short dietary pills', async () => {
    h.items = [
      makeItem({ id: 'a', name_en: 'Ghee Dosa', price: 60, is_vegetarian: true, category_id: 'cat-1' }),
      makeItem({ id: 'c', name_en: 'Filter Coffee', price: 20, is_vegetarian: true, category_id: 'cat-1' }),
    ];
    await renderMenu();
    const pills = screen.getAllByRole('button', { name: 'menu.veg' });
    expect(pills.length).toBeGreaterThan(0);
    expect(screen.getByRole('button', { name: 'menu.nonVeg' })).toBeInTheDocument();
    // The sort/offer controls are gone by design.
    expect(screen.queryByRole('button', { name: /menu\.sort|menu\.offersOnly/ })).toBeNull();
    // Neutral view: nothing beyond "the menu", no clear button.
    expect(screen.queryByText('menu.clearAll')).toBeNull();
  });

  it('picking Veg shows only veg items, the count line, and Clear all restores the menu', async () => {
    h.items = [
      makeItem({ id: 'a', name_en: 'Ghee Dosa', price: 60, is_vegetarian: true, category_id: 'cat-1' }),
      makeItem({ id: 'b', name_en: 'Chicken Biryani', price: 120, is_vegetarian: false, category_id: 'cat-1' }),
    ];
    await renderMenu('Ghee Dosa');

    fireEvent.click(screen.getByRole('button', { name: 'menu.veg' }));
    expect(await screen.findByRole('status')).toHaveTextContent('menu.resultsCount');
    expect(screen.queryByText('Chicken Biryani')).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: 'menu.clearAll' }));
    await waitFor(() => expect(screen.getByText('Chicken Biryani')).toBeInTheDocument());
    expect(screen.queryByText('menu.clearAll')).toBeNull();
  });

  it('picking Non veg shows only non-veg items', async () => {
    h.items = [
      makeItem({ id: 'a', name_en: 'Ghee Dosa', price: 60, is_vegetarian: true, category_id: 'cat-1' }),
      makeItem({ id: 'b', name_en: 'Chicken Biryani', price: 120, is_vegetarian: false, category_id: 'cat-1' }),
    ];
    await renderMenu('Ghee Dosa');

    fireEvent.click(screen.getByRole('button', { name: 'menu.nonVeg' }));
    expect(await screen.findByRole('status')).toHaveTextContent('menu.resultsCount');
    expect(screen.getByText('Chicken Biryani')).toBeInTheDocument();
    expect(screen.queryByText('Ghee Dosa')).toBeNull();
  });
});

afterEach(() => {
  cleanup();
  h.items = [];
});

beforeEach(() => {
  h.items = [];
});
