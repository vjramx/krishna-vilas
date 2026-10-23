import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const h = vi.hoisted(() => ({
  settings: { id: 1, is_accepting_orders: true, delivery_fee: 30, min_order_total: 0, opens_at: '09:00', closes_at: '22:00' } as Record<string, unknown>,
  update: vi.fn(),
  updateEq: vi.fn(),
  fromTable: vi.fn(),
  menuItems: [] as unknown[],
}));

vi.mock('@/lib/supabase', () => ({
  supabase: {
    from: h.fromTable.mockImplementation(() => ({
      update: h.update.mockImplementation(() => ({ eq: h.updateEq })),
      select: () => ({
        eq: () => ({ abortSignal: () => ({ single: () => Promise.resolve({ data: null, error: null }) }) }),
        order: () => Promise.resolve({ data: h.menuItems, error: null }),
        maybeSingle: () => Promise.resolve({ data: null }),
      }),
    })),
  },
  publicImageUrl: () => null,
}));

vi.mock('@/context/AuthContext', () => ({ useAuth: () => ({ role: 'anon' }) }));
vi.mock('@/context/CartContext', () => ({ useCart: () => ({ count: 0, items: [] }) }));
vi.mock('@/context/LanguageContext', () => ({
  useLanguage: () => ({ lang: 'en', locale: 'en', t: (key: string) => key }),
}));

vi.mock('@/hooks/useHotelSettings', () => ({
  useHotelSettings: () => ({ data: h.settings, loading: false, error: null, retry: vi.fn(async () => undefined) }),
}));

vi.mock('@/hooks/useMenu', () => ({
  useMenu: () => ({ items: h.menuItems, categories: [], loading: false, error: null, refresh: vi.fn(), retry: vi.fn() }),
  filterMenu: vi.fn(() => h.menuItems),
  groupByCategory: vi.fn(() => []),
}));

vi.mock('@/components/ItemCard', () => ({
  ItemCard: () => <div>item-card</div>,
  ItemSheet: () => null,
}));
vi.mock('@/components/PullToRefresh', () => ({
  PullToRefresh: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));
vi.mock('@/components/nav', () => ({
  CustomerHeader: () => <header>header</header>,
  BottomNav: () => <nav>bottomnav</nav>,
}));

import MenuPage from '@/pages/MenuPage';
import AdminSettings from '@/pages/admin/AdminSettings';

beforeEach(() => {
  h.settings = { id: 1, is_accepting_orders: true, delivery_fee: 30, min_order_total: 0, opens_at: '09:00', closes_at: '22:00' };
  h.menuItems = [];
  h.updateEq.mockReset().mockResolvedValue({ error: null });
  h.update.mockReset().mockImplementation(() => ({ eq: h.updateEq }));
});

describe('Customer home shows bold banner when orders are paused', () => {
  it('shows a bold "orders not accepting" banner when the restaurant is not accepting orders', () => {
    h.settings = { ...h.settings, is_accepting_orders: false };
    render(<MenuPage />);
    const banner = screen.getByRole('alert');
    expect(banner).toHaveTextContent('home.ordersPaused');
    expect(banner.querySelector('.font-extrabold')).not.toBeNull(); // bold headline
  });

  it('hides the banner entirely when the restaurant is accepting orders', () => {
    h.settings = { ...h.settings, is_accepting_orders: true };
    render(<MenuPage />);
    expect(screen.queryByText('home.ordersPaused')).toBeNull();
  });
});

describe('Admin settings restaurant-status toggle', () => {
  it('renders the switch with the current accepting state', () => {
    h.settings = { ...h.settings, is_accepting_orders: false };
    render(<AdminSettings />);
    const toggle = screen.getByRole('switch', { name: 'admin.acceptingOrders' });
    expect(toggle).toHaveAttribute('aria-checked', 'false');
  });

  it('turning the toggle on writes is_accepting_orders to the backend instantly', async () => {
    h.settings = { ...h.settings, is_accepting_orders: false };
    render(<AdminSettings />);
    fireEvent.click(screen.getByRole('switch', { name: 'admin.acceptingOrders' }));
    await waitFor(() =>
      expect(h.fromTable).toHaveBeenCalledWith('hotel_settings'),
    );
    await waitFor(() => expect(h.update).toHaveBeenCalledWith({ is_accepting_orders: true }));
    await waitFor(() => expect(h.updateEq).toHaveBeenCalledWith('id', 1));
    expect(await screen.findByText('admin.resumeOrders')).toBeInTheDocument();
  });

  it('turning the toggle off persists is_accepting_orders: false', async () => {
    h.settings = { ...h.settings, is_accepting_orders: true };
    render(<AdminSettings />);
    fireEvent.click(screen.getByRole('switch', { name: 'admin.acceptingOrders' }));
    await waitFor(() => expect(h.update).toHaveBeenCalled());
    expect(h.update).toHaveBeenCalledWith({ is_accepting_orders: false });
    expect(await screen.findByText('admin.pauseOrders')).toBeInTheDocument();
  });

  it('surfaces backend failures instead of pretending the toggle worked', async () => {
    h.settings = { ...h.settings, is_accepting_orders: true };
    h.updateEq.mockResolvedValue({ error: { message: 'permission denied', code: '42501' } });
    render(<AdminSettings />);
    fireEvent.click(screen.getByRole('switch', { name: 'admin.acceptingOrders' }));
    expect(await screen.findByRole('alert')).toBeInTheDocument();
  });
});
