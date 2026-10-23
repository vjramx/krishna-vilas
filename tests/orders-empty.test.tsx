import { render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';

// Mutable supabase stub: the orders query resolves with whatever `data`/`error` hold.
const h = vi.hoisted(() => ({ data: [] as unknown[], error: null as { message: string } | null }));

/** Chainable Supabase postgrest-style builder resolving to { data: h.data, error: h.error }. */
function makeBuilder() {
  const b = {
    select: () => b,
    eq: () => b,
    order: () => b,
    range: () => b,
    then: (resolve: (v: { data: unknown[]; error: { message: string } | null }) => void) =>
      resolve({ data: h.data, error: h.error }),
  };
  return b;
}

vi.mock('@/lib/supabase', () => ({
  supabase: {
    from: vi.fn(() => makeBuilder()),
    channel: vi.fn(() => ({
      on: function () { return this; },
      subscribe: (cb: (s: string) => void) => { cb('SUBSCRIBED'); return {}; },
    })),
    removeChannel: vi.fn(async () => undefined),
  },
}));

vi.mock('@/context/AuthContext', () => ({
  useAuth: () => ({
    session: { user: {} },
    userId: 'u123456',
    loading: false,
  }),
}));

vi.mock('@/context/LanguageContext', () => ({
  useLanguage: () => ({
    t: (k: string) => k,
    lang: 'en',
    setLang: vi.fn(),
  }),
}));

vi.mock('@/components/nav', () => ({
  TopBackBar: () => <header>bar</header>,
  BottomNav: () => <nav>bottomnav</nav>,
}));

import OrdersPage from '@/pages/OrdersPage';

beforeEach(() => {
  h.data = [];
  h.error = null;
});

describe('OrdersPage with an empty order history', () => {
  it('shows the "no orders" empty state once the first fetch lands — never an endless spinner', async () => {
    render(
      <MemoryRouter>
        <OrdersPage />
      </MemoryRouter>,
    );

    await waitFor(() => expect(screen.getByText('orders.empty')).toBeInTheDocument());
    expect(screen.queryByRole('status')).toBeNull(); // spinner is gone
    expect(screen.getByRole('link', { name: 'nav.menu' })).toBeInTheDocument();
  });

  it('the error path also clears the spinner: a failed first fetch shows the retry state', async () => {
    h.error = { message: 'network gone' };
    render(
      <MemoryRouter>
        <OrdersPage />
      </MemoryRouter>,
    );

    const retry = await screen.findByRole('button', { name: 'common.retry' });
    expect(screen.queryByRole('status')).toBeNull(); // spinner is gone
    expect(retry).toBeInTheDocument();
  });
});
