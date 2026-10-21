import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { expect, it, vi, describe } from 'vitest';

const h = vi.hoisted(() => ({ from: vi.fn(), channel: vi.fn(), rpc: vi.fn(async () => ({ data: null, error: null })) }));
vi.mock('@/lib/supabase', () => ({
  supabase: {
    from: h.from,
    channel: h.channel,
    removeChannel: vi.fn(async () => undefined),
    rpc: h.rpc,
  },
}));
vi.mock('@/context/LanguageContext', () => ({
  useLanguage: () => ({ locale: 'en', lang: 'en', t: (key: string) => key }),
}));
import AdminOrders from '@/pages/admin/AdminOrders';

describe('AdminOrders tabs', () => {
  function query(data: unknown[] = []) {
    const self = {
      select: () => self,
      order: () => self,
      range: () => self,
      in: () => self,
      eq: () => self,
      // Point lookups (agent_id read-back after accept) have no seeded row.
      maybeSingle: () => Promise.resolve({ data: null, error: null }),
      then: (onFulfilled: (r: { data: unknown[]; error: null }) => void) =>
        Promise.resolve({ data, error: null }).then(onFulfilled),
    };
    return self;
  }

  it('offers a Cancelled tab matching the dashboard navigation target', async () => {
    h.from.mockReturnValue(query());
    h.channel.mockReturnValue({ on: () => ({ subscribe: () => ({}) }) });

    render(
      <MemoryRouter initialEntries={['/admin/orders?tab=cancelled']}>
        <AdminOrders />
      </MemoryRouter>,
    );
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });

    const cancelled = screen.getByRole('tab', { name: 'order.status.cancelled' });
    expect(cancelled).toHaveAttribute('aria-selected', 'true');
  });

  it('requires typing DELETE ALL ORDERS before invoking the admin bulk-delete RPC', async () => {
    h.from.mockReturnValue(query());
    h.channel.mockReturnValue({ on: () => ({ subscribe: () => ({}) }) });
    h.rpc.mockClear();

    render(<MemoryRouter><AdminOrders /></MemoryRouter>);
    fireEvent.click(await screen.findByRole('button', { name: 'admin.deleteOrders' }));
    const dialog = screen.getByRole('dialog', { name: 'admin.deleteOrdersTitle' });
    const input = screen.getByLabelText('admin.deleteOrdersType');
    const deleteButton = within(dialog).getByRole('button', { name: 'admin.deleteOrders' });
    expect(input).toHaveAttribute('type', 'text');
    expect(input).toHaveAttribute('placeholder', 'DELETE ALL ORDERS');
    await waitFor(() => expect(input).toHaveFocus());
    expect(deleteButton).toBeDisabled();
    fireEvent.change(input, { target: { value: 'DELETE' } });
    expect(input).toHaveValue('DELETE');
    expect(deleteButton).toBeDisabled();
    fireEvent.change(input, { target: { value: 'DELETE ALL ORDERS' } });
    expect(deleteButton).toBeEnabled();
    fireEvent.click(deleteButton);
    await waitFor(() => expect(h.rpc).toHaveBeenCalledWith('admin_delete_all_orders', { p_confirmation: 'DELETE ALL ORDERS' }));
    expect(await screen.findByRole('status')).toHaveTextContent('admin.deleteOrdersDone');
  });

  it('locks an order action while its RPC is in flight and handles a thrown request', async () => {
    let finishRpc!: (result: { data: null; error: null }) => void;
    h.rpc.mockClear();
    h.rpc.mockImplementationOnce(() => new Promise((resolve) => { finishRpc = resolve }));
    h.from.mockImplementation((table: string) => table === 'orders'
      ? query([{
          id: 'order-1', order_number: 'KV-1', status: 'pending', customer_name: 'Customer',
          phone: '9999999999', total: '100', created_at: '2025-01-01T00:00:00.000Z',
          assignment_status: 'none', agent_id: null, order_items: [],
        }])
      : query());
    h.channel.mockReturnValue({ on: () => ({ subscribe: () => ({}) }) });

    render(<MemoryRouter><AdminOrders /></MemoryRouter>);
    const confirm = await screen.findByRole('button', { name: 'admin.confirm' });
    fireEvent.click(confirm);
    expect(confirm).toBeDisabled();
    fireEvent.click(confirm);
    // The per-order in-flight guard must drop the second click silently.
    expect(h.rpc).toHaveBeenCalledTimes(1);
    expect(h.rpc).toHaveBeenNthCalledWith(1, 'set_order_status', { p_order_id: 'order-1', p_new_status: 'confirmed', p_note: null });

    await act(async () => finishRpc({ data: null, error: null }));
    await waitFor(() => expect(confirm).toBeEnabled());

    h.rpc.mockRejectedValueOnce(new Error('network failed'));
    fireEvent.click(confirm);
    expect(await screen.findByRole('alert')).toHaveTextContent('err.generic');
    await waitFor(() => expect(confirm).toBeEnabled());
    h.rpc.mockResolvedValue({ data: null, error: null });
  });

  it('completes a dispatched order from the detail sheet through the dedicated admin RPC', async () => {
    h.from.mockImplementation((table: string) => table === 'orders'
      ? query([{
          id: 'order-2', order_number: 'KV-2', status: 'out_for_delivery', customer_name: 'Ravi',
          phone: '8888888888', total: '120', created_at: '2025-01-02T00:00:00.000Z',
          assignment_status: 'picked_up', agent_id: 'agent-1', order_items: [],
        }])
      : query());
    h.channel.mockReturnValue({ on: () => ({ subscribe: () => ({}) }) });
    h.rpc.mockClear();

    render(<MemoryRouter><AdminOrders /></MemoryRouter>);
    // The dispatched card itself shows the agent handoff — no kitchen buttons.
    await screen.findByText(/admin\.agentHandles/);
    expect(screen.queryByRole('button', { name: 'admin.markDelivered' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'admin.markReady' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'admin.dispatch' })).not.toBeInTheDocument();

    // The delivery fallback lives in the operator's detail sheet.
    fireEvent.click(await screen.findByRole('button', { name: /KV-2/ }));
    const dialog = screen.getByRole('dialog', { name: 'KV-2' });
    fireEvent.click(within(dialog).getByRole('button', { name: 'admin.markDelivered' }));
    expect(h.rpc).toHaveBeenCalledTimes(1);
    expect(h.rpc).toHaveBeenCalledWith('admin_mark_delivered', { p_order_id: 'order-2' });
    expect(h.rpc).not.toHaveBeenCalledWith('set_order_status', expect.objectContaining({ p_new_status: 'delivered' }));
  });

  it('keeps the detail sheet open on the ETA step after accepting an order', async () => {
    h.from.mockImplementation((table: string) => table === 'orders'
      ? query([{
          id: 'order-1', order_number: 'KV-1', status: 'pending', customer_name: 'Customer',
          phone: '9999999999', total: '100', created_at: '2025-01-01T00:00:00.000Z',
          assignment_status: 'none', agent_id: null, eta_minutes: null, order_items: [],
        }])
      : query());
    h.channel.mockReturnValue({ on: () => ({ subscribe: () => ({}) }) });
    h.rpc.mockClear();

    render(<MemoryRouter><AdminOrders /></MemoryRouter>);
    fireEvent.click(await screen.findByRole('button', { name: 'admin.confirm' }));
    await waitFor(() => expect(h.rpc).toHaveBeenCalledWith('set_order_status', { p_order_id: 'order-1', p_new_status: 'confirmed', p_note: null }));
    // Accepting must land the operator straight on the ETA step — not on a
    // closed sheet they have to reopen.
    const dialog = await screen.findByRole('dialog', { name: 'KV-1' });
    expect(within(dialog).getByLabelText('admin.setEta')).toBeInTheDocument();
    expect(within(dialog).getByRole('button', { name: 'common.save' })).toBeInTheDocument();
    // The accept-path must state the auto-assignment outcome explicitly: with
    // no agent row available here, the manual-assign fallback notice shows.
    expect(await screen.findByText('admin.autoAssignNone')).toBeInTheDocument();
  });
});
