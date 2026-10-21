import type { ReactNode } from 'react';
import { render, screen, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Order } from '@/types/db';

const h = vi.hoisted(() => ({
  order: null as unknown,
  items: [] as unknown[],
  rpc: vi.fn(async () => ({ data: null, error: null })),
}));

vi.mock('@/hooks/useOrders', () => ({
  useOrder: () => ({ order: h.order, items: h.items, loading: false, error: null, live: true, retry: vi.fn() }),
}));
vi.mock('@/context/LanguageContext', () => ({
  useLanguage: () => ({
    t: (key: string, params?: Record<string, string>) => (key === 'order.eachLine' ? `${params?.price ?? ''} each` : key),
    lang: 'en',
  }),
}));
vi.mock('@/lib/supabase', () => ({
  supabase: { rpc: h.rpc },
  publicImageUrl: (p: string | null) => (p ? `https://img.example/${p}` : null),
}));
vi.mock('@/components/nav', () => ({ TopBackBar: ({ title }: { title: string }) => <header>{title}</header> }));
vi.mock('@/components/OrderDestination', () => ({ OrderDestination: () => null }));
vi.mock('@/components/ui', () => ({
  EmptyState: () => null,
  ErrorState: () => null,
  OrderStatusBadge: ({ status, label }: { status: string; label?: string }) => <span data-status={status}>{label ?? status}</span>,
  Sheet: ({ open, children }: { open: boolean; children: ReactNode }) => open ? <div role="dialog">{children}</div> : null,
  showSnackbar: vi.fn(),
  Spinner: () => null,
}));

import OrderDetailPage from '@/pages/OrderDetailPage';

const baseOrder = {
  id: 'order-1', order_number: 'KV-1', customer_id: 'customer-1', customer_name: 'Customer',
  phone: '9999999999', address_line: '1 Main Street', area: 'Central', landmark: null,
  instructions: null, payment_method: 'cod', status: 'confirmed', subtotal: '90',
  discount_total: '0', delivery_fee: '10', total: '100', eta_minutes: null, delay_note: null,
  reject_reason: null, confirmed_at: '2025-01-02T10:30:00.000Z', preparing_at: null,
  ready_at: null, out_for_delivery_at: null, delivered_at: null, rejected_at: null,
  cancelled_at: null, cancelled_by: null, delivery_latitude: null, delivery_longitude: null,
  location_accuracy_meters: null, location_source: null, location_confirmed_at: null,
  delivery_house: null, delivery_street: null, delivery_locality: null, delivery_city: null,
  delivery_pincode: null, delivery_floor: null, created_at: '2025-01-02T10:00:00.000Z',
  agent_id: null, assignment_status: 'none', delivery_fail_reason: null, delivery_pin: null,
  cod_expected: null, cod_collected: null, cash_handed_at: null, cash_verified_at: null,
  agent_latitude: null, agent_longitude: null, agent_location_accuracy_meters: null, agent_location_at: null,
  accepted_at: null, arrived_at: null, picked_up_at: null, customer_reached_at: null,
} satisfies Order;

function renderOrder() {
  return render(
    <MemoryRouter initialEntries={['/order/order-1']}>
      <Routes><Route path="/order/:id" element={<OrderDetailPage />} /></Routes>
    </MemoryRouter>,
  );
}

beforeEach(() => {
  h.order = { ...baseOrder };
});

describe('customer order progress timeline', () => {
  it.each(['confirmed', 'preparing', 'ready', 'out_for_delivery'] as const)(
    'shows staff delivery state %s as the same green Order Confirmed status',
    (status) => {
      h.order = { ...baseOrder, status };
      renderOrder();
      const confirmation = screen.getByRole('status');
      expect(confirmation).toHaveClass('bg-brand-successBg');
      expect(within(confirmation).getByText('order.customerStatus.confirmed')).toBeInTheDocument();
      expect(within(confirmation).getByText('order.customerConfirmed')).toBeInTheDocument();
      const statusRegion = screen.getByRole('region', { name: 'status.badge' });
      expect(statusRegion.querySelector('[data-status="confirmed"]')).toHaveTextContent('order.customerStatus.confirmed');
      const progress = screen.getByRole('list', { name: 'Progress' });
      expect(within(progress).getByText('order.customerStatus.confirmed')).toBeInTheDocument();
      expect(progress.querySelectorAll('li')).toHaveLength(3);
      expect(within(progress).queryByText('order.status.preparing')).not.toBeInTheDocument();
      expect(within(progress).queryByText('order.status.ready')).not.toBeInTheDocument();
      expect(within(progress).queryByText('order.status.out_for_delivery')).not.toBeInTheDocument();
      expect(screen.queryByText('order.pin')).not.toBeInTheDocument();
      // The riding scooter animation accompanies the confirmed banner.
      expect(screen.getByTestId('delivery-ride')).toBeInTheDocument();
      // Decorative: the caption is visually hidden, the graphic stays out of
      // the accessibility tree.
      expect(screen.getByTestId('delivery-ride').getAttribute('aria-hidden')).toBe('true');
    },
  );

  it('distinguishes a newly placed order from restaurant acceptance', () => {
    window.history.replaceState({}, '', '/order/order-1?confirmed=1');
    h.order = { ...baseOrder, status: 'pending', confirmed_at: null };
    renderOrder();
    expect(screen.getByText('confirm.placedTitle')).toBeInTheDocument();
    expect(screen.queryByText('order.customerConfirmed')).not.toBeInTheDocument();
    // No riding animation before the restaurant accepts the order.
    expect(screen.queryByTestId('delivery-ride')).not.toBeInTheDocument();
  });

  it('shows recorded timestamps for the placed and completed stages', () => {
    renderOrder();
    const progress = screen.getByRole('list', { name: 'Progress' });
    expect(within(progress).getByText('order.customerStatus.pending')).toBeInTheDocument();
    expect(within(progress).getByText('order.customerStatus.confirmed')).toBeInTheDocument();
    expect(progress.querySelector('time[datetime="2025-01-02T10:00:00.000Z"]')).toBeInTheDocument();
    expect(progress.querySelector('time[datetime="2025-01-02T10:30:00.000Z"]')).toBeInTheDocument();
    expect(progress.querySelectorAll('time')).toHaveLength(2);
  });

  it('shows cancellation as a terminal event with its recorded time', () => {
    h.order = { ...baseOrder, status: 'cancelled', cancelled_at: '2025-01-02T11:00:00.000Z', cancelled_by: 'customer' };
    renderOrder();
    expect(screen.getByText('order.cancelledNote')).toBeInTheDocument();
    // A cancelled order never rides.
    expect(screen.queryByTestId('delivery-ride')).not.toBeInTheDocument();
    expect(screen.getByText('order.status.cancelled', { selector: 'span[data-status="cancelled"]' })).toBeInTheDocument();
    expect(screen.getByRole('list', { name: 'Progress' }).querySelector('time[datetime="2025-01-02T11:00:00.000Z"]')).toBeInTheDocument();
  });

  it('renders each ordered item as a structured card with image, description and priding', () => {
    h.items = [
      {
        id: 'oi-1', order_id: 'order-1', menu_item_id: 'mi-1', name_en: 'Masala Dosa', name_kn: '',
        unit_price: '60', quantity: 2, discount_amount: '10', item_total: '110',
        menu_items: { image_path: 'menu/dosa.jpg', description_en: 'Crispy dosa with chutney', description_kn: null, is_vegetarian: true },
      },
      {
        id: 'oi-2', order_id: 'order-1', menu_item_id: null, name_en: 'Deleted Item', name_kn: '',
        unit_price: '40', quantity: 1, discount_amount: '0', item_total: '40',
        menu_items: null,
      },
    ];
    renderOrder();
    const items = screen.getByRole('list', { name: 'order.items' });
    const rows = within(items).getAllByRole('listitem');
    expect(rows).toHaveLength(2);
    // Image card with its item photo, qty badge and unit price.
    expect(within(rows[0]!).getByRole('img', { name: 'Masala Dosa' })).toHaveAttribute('src', 'https://img.example/menu/dosa.jpg');
    expect(within(rows[0]!).getByText('× 2')).toBeInTheDocument();
    expect(within(rows[0]!).getByText('Crispy dosa with chutney')).toBeInTheDocument();
    expect(within(rows[0]!).getByText('₹60 each')).toBeInTheDocument();
    expect(within(rows[0]!).getByText('−₹10')).toBeInTheDocument();
    expect(within(rows[0]!).getByText('₹110')).toBeInTheDocument();
    // Deleted menu item falls back to a placeholder without crashing.
    expect(within(rows[1]!).queryByRole('img')).not.toBeInTheDocument();
    expect(within(rows[1]!).getByText('Deleted Item')).toBeInTheDocument();
  });
});
