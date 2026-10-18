import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { expect, it, vi, describe } from 'vitest';

const h = vi.hoisted(() => ({ from: vi.fn(), channel: vi.fn() }));
vi.mock('@/lib/supabase', () => ({
  supabase: {
    from: h.from,
    channel: h.channel,
    removeChannel: vi.fn(async () => undefined),
    rpc: vi.fn(async () => ({ data: null, error: null })),
  },
}));
vi.mock('@/context/LanguageContext', () => ({
  useLanguage: () => ({ locale: 'en', lang: 'en', t: (key: string) => key }),
}));
import AdminOrders from '@/pages/admin/AdminOrders';

describe('AdminOrders tabs', () => {
  it('offers a Cancelled tab matching the dashboard navigation target', async () => {
    function query() {
      const self = {
        select: () => self,
        order: () => self,
        range: () => self,
        in: () => self,
        then: (onFulfilled: (r: { data: unknown[]; error: null }) => void) =>
          Promise.resolve({ data: [], error: null }).then(onFulfilled),
      };
      return self;
    }
    h.from.mockReturnValue(query());
    h.channel.mockReturnValue({ on: () => ({ subscribe: () => ({}) }) });

    render(
      <MemoryRouter initialEntries={['/admin/orders?tab=cancelled']}>
        <AdminOrders />
      </MemoryRouter>,
    );

    const cancelled = screen.getByRole('tab', { name: 'order.status.cancelled' });
    expect(cancelled).toHaveAttribute('aria-selected', 'true');
  });
});
