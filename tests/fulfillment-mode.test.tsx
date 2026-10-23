import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const h = vi.hoisted(() => ({
  settings: { fulfillment_mode: 'agent' } as Record<string, unknown> | null,
  update: vi.fn(),
  updateEq: vi.fn(),
  fromTable: vi.fn(),
  rpcCalls: [] as { fn: string; args: Record<string, unknown> }[],
  ordersRes: { data: [] as unknown[], error: null },
  agentRes: { data: [] as unknown[], error: null },
}));

function makeOrder(over: Record<string, unknown> = {}) {
  return {
    id: 'o1',
    order_number: 'KV-1',
    customer_name: 'Test Customer',
    phone: '9876543210',
    address_line: '12 Cross St',
    area: 'Karatagi',
    landmark: null,
    instructions: null,
    payment_method: 'cod',
    status: 'confirmed',
    subtotal: '100', discount_total: '0', delivery_fee: '30', total: '130',
    eta_minutes: 15, delay_note: null, reject_reason: null,
    confirmed_at: null, preparing_at: null, ready_at: null, out_for_delivery_at: null,
    delivered_at: null, rejected_at: null, cancelled_at: null, cancelled_by: null,
    delivery_latitude: null, delivery_longitude: null, location_accuracy_meters: null,
    location_source: null, location_confirmed_at: null,
    delivery_house: null, delivery_street: null, delivery_locality: null,
    delivery_city: null, delivery_pincode: null, delivery_floor: null,
    agent_latitude: null, agent_longitude: null, agent_location_accuracy_meters: null,
    agent_location_at: null, accepted_at: null, arrived_at: null, picked_up_at: null,
    customer_reached_at: null, created_at: new Date().toISOString(),
    agent_id: null, assignment_status: 'none', delivery_fail_reason: null,
    delivery_pin: null, cod_expected: null, cod_collected: null,
    cash_handed_at: null, cash_verified_at: null,
    order_items: [],
    ...over,
  };
}

vi.mock('@/lib/supabase', () => ({
  supabase: {
    from: h.fromTable.mockImplementation((table: string) => {
      if (table === 'orders') {
        return { select: () => ({
          in: () => Promise.resolve(h.ordersRes),
          order: () => ({ range: () => Promise.resolve(h.ordersRes) }),
        }) };
      }
      if (table === 'agent_users') {
        return { select: () => ({ order: () => Promise.resolve(h.agentRes) }) };
      }
      if (table === 'hotel_settings') {
        return {
          update: (vals: Record<string, unknown>) => { h.update(vals); return { eq: h.updateEq }; },
          select: () => ({ eq: () => ({ abortSignal: () => ({ single: () => Promise.resolve({ data: h.settings, error: null }) }) }) }),
        };
      }
      return { select: () => Promise.resolve({ data: [], error: null }), update: () => ({ eq: () => Promise.resolve({ data: null, error: null }) }) };
    }),
    rpc: (fn: string, args: Record<string, unknown>) => {
      h.rpcCalls.push({ fn, args });
      return Promise.resolve({ data: {}, error: null });
    },
    channel: () => ({ on: () => ({ subscribe: () => ({}) }) }),
    removeChannel: vi.fn(async () => undefined),
  },
}));

vi.mock('@/context/AuthContext', () => ({
  useAuth: () => ({ role: 'admin', roleError: null, refreshRole: vi.fn(), email: 'admin@example.com', loading: false, session: {}, signOut: vi.fn(async () => undefined) }),
}));
vi.mock('@/context/LanguageContext', () => ({
  useLanguage: () => ({ lang: 'en', locale: 'en', t: (key: string) => key }),
}));

vi.mock('@/hooks/useHotelSettings', () => ({
  useHotelSettings: () => ({ data: h.settings, loading: false, error: null, retry: vi.fn(async () => undefined) }),
}));

import { AdminLayout } from '@/pages/admin/AdminLayout';
import AdminSettings from '@/pages/admin/AdminSettings';
import AdminAgents from '@/pages/admin/AdminAgents';
import AdminOrders from '@/pages/admin/AdminOrders';

const routers = {
  admin: (
    <MemoryRouter initialEntries={['/admin']}>
      <Routes>
        <Route path="/admin" element={<AdminLayout />}>
          <Route index element={<div>dashboard</div>} />
          <Route path="orders" element={<AdminOrders />} />
          <Route path="agents" element={<AdminAgents />} />
        </Route>
      </Routes>
    </MemoryRouter>
  ),
};

beforeEach(() => {
  h.settings = { fulfillment_mode: 'agent', is_accepting_orders: true };
  h.rpcCalls = [];
  h.ordersRes = { data: [], error: null };
  h.agentRes = { data: [], error: null };
  h.updateEq.mockReset().mockResolvedValue({ error: null });
  h.update.mockReset();
});

describe('Delivery mode toggle (Admin → Settings)', () => {
  it('renders the two focused modes with the current one selected', () => {
    h.settings = { fulfillment_mode: 'agent' };
    render(<AdminSettings />);
    const group = screen.getByRole('radiogroup');
    expect(group).toHaveTextContent('admin.selfDelivery');
    expect(within(group).getByRole('radio', { name: 'admin.deliveryAgents' })).toHaveAttribute('aria-checked', 'true');
    expect(within(group).getByRole('radio', { name: 'admin.selfDelivery' })).toHaveAttribute('aria-checked', 'false');
  });

  it('switching to self writes fulfillment_mode: self to hotel_settings instantly', async () => {
    h.settings = { fulfillment_mode: 'agent' };
    render(<AdminSettings />);
    fireEvent.click(screen.getByRole('radio', { name: 'admin.selfDelivery' }));
    await waitFor(() => expect(h.update).toHaveBeenCalledWith({ fulfillment_mode: 'self' }));
    await waitFor(() => expect(h.updateEq).toHaveBeenCalledWith('id', 1));
    expect(await screen.findByText('admin.selfDeliverySaved')).toBeInTheDocument();
  });

  it('switching back to agents writes fulfillment_mode: agent and shows the notice', async () => {
    h.settings = { fulfillment_mode: 'self' };
    render(<AdminSettings />);
    fireEvent.click(screen.getByRole('radio', { name: 'admin.deliveryAgents' }));
    await waitFor(() => expect(h.update).toHaveBeenCalledWith({ fulfillment_mode: 'agent' }));
    expect(await screen.findByText('admin.agentModeSaved')).toBeInTheDocument();
  });

  it('surfaces backend failures instead of pretending the mode changed', async () => {
    h.settings = { fulfillment_mode: 'agent' };
    h.updateEq.mockResolvedValue({ error: { message: 'permission denied', code: '42501' } });
    render(<AdminSettings />);
    fireEvent.click(screen.getByRole('radio', { name: 'admin.selfDelivery' }));
    expect(await screen.findByRole('alert')).toBeInTheDocument();
  });
});

describe('Agents section visibility in self delivery mode', () => {
  it('hides the Agents tab from the admin nav in self mode', async () => {
    h.settings = { fulfillment_mode: 'self' };
    render(routers.admin);
    await waitFor(() => {
      expect(screen.queryByRole('link', { name: /admin\.agents/ })).toBeNull();
    });
    expect(screen.getAllByRole('link', { name: /admin\.orders/ }).length).toBeGreaterThan(0);
  });

  it('shows the Agents tab in agent mode', async () => {
    h.settings = { fulfillment_mode: 'agent' };
    render(routers.admin);
    expect(await screen.findByRole('link', { name: /admin\.agents/ })).toBeInTheDocument();
  });

  it('replaces agent management with an explanation in self mode', async () => {
    document.body.innerHTML = '';
    h.settings = { fulfillment_mode: 'self' };
    render(
      <MemoryRouter initialEntries={['/admin/agents']}>
        <Routes>
          <Route path="/admin/agents" element={<AdminAgents />} />
        </Routes>
      </MemoryRouter>,
    );
    expect(await screen.findByTestId('agents-self-delivery')).toBeInTheDocument();
    expect(screen.queryByText('admin.addAgent')).toBeNull();
  });
});

describe('Self-delivery order controls (Admin Orders)', () => {
  const confirmed = makeOrder({ id: 'o1', status: 'confirmed' });

  it('offers only kitchen/delivery steps — first step is "start preparing" — and no agent picker', async () => {
    document.body.innerHTML = '';
    h.settings = { fulfillment_mode: 'self' };
    h.ordersRes = { data: [confirmed], error: null };
    render(
      <MemoryRouter initialEntries={['/admin/orders']}>
        <Routes>
          <Route path="/admin/orders" element={<AdminOrders />} />
        </Routes>
      </MemoryRouter>,
    );
    const card = await screen.findByText('KV-1');
    expect(within(card.closest('li')!).getByRole('button', { name: 'order.status.preparing' })).toBeInTheDocument();

    // Self mode: opening the details must NOT offer agent assignment.
    fireEvent.click(card);
    await waitFor(() =>
      expect(screen.queryByRole('combobox', { name: /admin\.assignAgent|admin\.reassign/ })).toBeNull(),
    );
  });

  it('advances the order through set_order_status on tap', async () => {
    document.body.innerHTML = '';
    h.settings = { fulfillment_mode: 'self' };
    h.ordersRes = { data: [confirmed], error: null };
    render(
      <MemoryRouter initialEntries={['/admin/orders']}>
        <Routes>
          <Route path="/admin/orders" element={<AdminOrders />} />
        </Routes>
      </MemoryRouter>,
    );
    const card = await screen.findByText('KV-1');
    fireEvent.click(within(card.closest('li')!).getByRole('button', { name: 'order.status.preparing' }));
    await waitFor(() => {
      expect(h.rpcCalls).toContainEqual(expect.objectContaining({
        fn: 'set_order_status',
        args: expect.objectContaining({ p_order_id: 'o1', p_new_status: 'preparing' }),
      }));
    });
  });

  it('keeps the agent assignment picker in agent mode', async () => {
    document.body.innerHTML = '';
    h.settings = { fulfillment_mode: 'agent' };
    h.ordersRes = { data: [confirmed], error: null };
    render(
      <MemoryRouter initialEntries={['/admin/orders']}>
        <Routes>
          <Route path="/admin/orders" element={<AdminOrders />} />
        </Routes>
      </MemoryRouter>,
    );
    const card = await screen.findByText('KV-1');
    fireEvent.click(card);
    // detail.agent_id is null here (no active agents), so the picker shows
    // the "assign agent" label with the Unassign option.
    const picker = await screen.findByRole('combobox', { name: /admin\.assignAgent|admin\.reassign/ });
    expect(picker).toBeInTheDocument();
    expect(screen.getByRole('option', { name: 'admin.unassign' })).toBeInTheDocument();
  });
});
