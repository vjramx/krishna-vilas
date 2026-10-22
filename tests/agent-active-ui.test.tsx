import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it, vi, beforeEach } from 'vitest';

const h = vi.hoisted(() => ({
  rows: [] as unknown[],
  rpc: vi.fn(async () => ({ data: null, error: null })),
  /** Records the latest fetch's eq() columns/values — the regression probe for
   * the agent assignment identity. */
  eqCalls: [] as string[],
}));

vi.mock('@/lib/supabase', () => {
  const channel = { on() { return channel; }, subscribe() { return channel; } };
  return {
    supabase: {
      from: () => ({ select: () => ({ eq: (col: string, val: unknown) => { h.eqCalls.push(`${col}=${val}`); return { order: () => Promise.resolve({ data: h.rows, error: null }) }; } }) }),
      channel: () => channel,
      removeChannel: vi.fn(),
      rpc: h.rpc,
    },
  };
});
vi.mock('@/context/AuthContext', () => ({ useAuth: () => ({ userId: 'firebase-uid-1', agentId: 'agent-1', loading: false }) }));
vi.mock('@/context/LanguageContext', () => ({ useLanguage: () => ({ t: (key: string) => key, lang: 'en' }) }));
vi.mock('@/hooks/useAgentLocationShare', () => ({ useAgentLocationShare: () => ({ sharing: true, error: null }) }));

import { AgentActive, AgentAssigned } from '@/pages/agent/AgentHome';

describe('agent Active tab order card', () => {
  beforeEach(() => {
    h.rows = [];
    h.rpc.mockReset();
    h.rpc.mockResolvedValue({ data: null, error: null });
  });

  it('shows the saved delivery address — never a navigate button', async () => {
    h.rows = [{
      id: 'order-1', order_number: 'KV-260101-0001', customer_name: 'Asha Rao', phone: '9876543210',
      area: 'Central', address_line: '12 Main Road', total: '250', agent_id: 'agent-1',
      status: 'confirmed', assignment_status: 'accepted', delay_note: null,
      landmark: null, instructions: null,
      arrived_at: null, picked_up_at: null, customer_reached_at: null,
    }];
    render(<MemoryRouter><AgentActive /></MemoryRouter>);

    expect(await screen.findByText('Asha Rao')).toBeInTheDocument();
    // Address section: label, address+area as one wrapping line, and explicit
    // (not invented) markers for information the customer never provided.
    expect(screen.getByText('agent.deliveryAddress')).toBeInTheDocument();
    expect(screen.getByText('12 Main Road, Central')).toBeInTheDocument();
    expect(screen.getByText('checkout.landmark:')).toBeInTheDocument();
    expect(screen.getAllByText('agent.notProvided')).toHaveLength(2);
    expect(screen.getByText('checkout.instructions:')).toBeInTheDocument();
    // Map navigation removed everywhere — no directions link may appear.
    expect(screen.queryByText('delivery.navigate')).not.toBeInTheDocument();
    expect(screen.queryByRole('link', { name: /delivery\.navigate/i })).not.toBeInTheDocument();
    expect(screen.getByRole('link', { name: /9876543210/ })).toHaveAttribute('href', 'tel:9876543210');
    expect(screen.getByRole('button', { name: 'agent.deliveredBtn' })).toBeInTheDocument();
    expect(screen.queryByText('agent.arrived')).not.toBeInTheDocument();
    expect(screen.queryByText('agent.step.restaurant')).not.toBeInTheDocument();
    expect(screen.queryByText('agent.step.onTheWay')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'agent.failedBtn' })).toBeInTheDocument();
  });

  it('requires both handover attestations before confirming delivery', async () => {
    h.rows = [{
      id: 'order-2', order_number: 'KV-260101-0002', customer_name: 'Ravi Kumar', phone: '9123456789',
      area: 'East', address_line: '3 Lake View', total: '180', agent_id: 'agent-1',
      status: 'confirmed', assignment_status: 'picked_up', delay_note: null,
      arrived_at: null, picked_up_at: null, customer_reached_at: null,
    }];
    render(<MemoryRouter><AgentActive /></MemoryRouter>);

    fireEvent.click(await screen.findByRole('button', { name: 'agent.deliveredBtn' }));
    const dialog = screen.getByRole('dialog', { name: 'agent.confirmDelivery' });
    expect(within(dialog).getByText('KV-260101-0002')).toBeInTheDocument();
    expect(within(dialog).getByText(/Ravi Kumar/)).toBeInTheDocument();

    const confirm = within(dialog).getByRole('button', { name: 'agent.confirmDelivery' });
    expect(confirm).toBeDisabled();

    const food = screen.getByRole('switch', { name: 'agent.confirmFood' });
    const cash = screen.getByRole('switch', { name: 'agent.confirmCash' });
    fireEvent.click(food);
    expect(confirm).toBeDisabled();
    fireEvent.click(cash);
    expect(confirm).toBeEnabled();
    fireEvent.click(confirm);

    await waitFor(() => expect(h.rpc).toHaveBeenCalledWith('agent_deliver', { p_order_id: 'order-2' }));
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'agent.confirmDelivery' })).not.toBeInTheDocument());
  });

  it('never fakes success when the delivery RPC fails and keeps the order available for retry', async () => {
    const base = {
      id: 'order-3', order_number: 'KV-260101-0003', customer_name: 'Sandhya', phone: '9000000000',
      area: 'West', address_line: '7 Tank Bund', total: '300', agent_id: 'agent-1',
      status: 'confirmed', assignment_status: 'accepted', delay_note: null,
      arrived_at: null, picked_up_at: null, customer_reached_at: null,
    };
    h.rows = [base];
    h.rpc.mockRejectedValueOnce(new Error('FINAL_STATE'));
    render(<MemoryRouter><AgentActive /></MemoryRouter>);

    fireEvent.click(await screen.findByRole('button', { name: 'agent.deliveredBtn' }));
    fireEvent.click(screen.getByRole('switch', { name: 'agent.confirmFood' }));
    fireEvent.click(screen.getByRole('switch', { name: 'agent.confirmCash' }));
    fireEvent.click(screen.getByRole('button', { name: 'agent.confirmDelivery' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('err.finalState');
    expect(screen.getByRole('dialog', { name: 'agent.confirmDelivery' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'agent.deliveredBtn' })).toBeInTheDocument();
  });

  it('moves an accepted order out of Assigned only after the backend confirms', async () => {
    h.rows = [{
      id: 'order-20', order_number: 'KV-260101-0020', customer_name: 'Vijay Ram', phone: '9449000000',
      area: 'Karatagi', address_line: 'near Panapur Cross', total: '210', landmark: 'Panapur Cross',
      instructions: 'Ring the bell twice', agent_id: 'agent-1', status: 'confirmed',
      assignment_status: 'assigned', delay_note: null,
      arrived_at: null, picked_up_at: null, customer_reached_at: null,
    }];
    h.eqCalls.length = 0;
    render(<MemoryRouter><AgentAssigned /></MemoryRouter>);

    expect(await screen.findByText('near Panapur Cross, Karatagi')).toBeInTheDocument();
    expect(screen.getByText('Panapur Cross')).toBeInTheDocument();
    expect(screen.getByText('Ring the bell twice')).toBeInTheDocument();
    expect(screen.queryByText('agent.notProvided')).not.toBeInTheDocument();
    expect(h.eqCalls).toContain('agent_id=agent-1');

    // Duplicate taps while the RPC is in flight are impossible: the button is
    // disabled immediately.
    fireEvent.click(screen.getByRole('button', { name: 'agent.accept' }));
    expect(screen.getByRole('button', { name: 'agent.accept' })).toBeDisabled();
    await waitFor(() => expect(h.rpc).toHaveBeenCalledWith('agent_accept', { p_order_id: 'order-20' }));
    // Backend confirmed (mockResolvedValue) → the card leaves Assigned
    // immediately; it appears in Accepted by me on the next tab fetch.
    await waitFor(() => expect(screen.queryByText('Vijay Ram')).not.toBeInTheDocument());
  });

  it('keeps the order in Assigned and shows an error when acceptance fails', async () => {
    h.rows = [{
      id: 'order-21', order_number: 'KV-260101-0021', customer_name: 'Ravi', phone: '9000000002',
      area: 'East', address_line: '4 Market Road', total: '150', agent_id: 'agent-1',
      status: 'confirmed', assignment_status: 'assigned', delay_note: null,
      arrived_at: null, picked_up_at: null, customer_reached_at: null,
    }];
    h.rpc.mockRejectedValueOnce(new Error('NOT_THE_ASSIGNED_AGENT'));
    render(<MemoryRouter><AgentAssigned /></MemoryRouter>);

    fireEvent.click(await screen.findByRole('button', { name: 'agent.accept' }));
    // No false success: the card stays and a real error is surfaced.
    expect(await screen.findByRole('alert')).toBeInTheDocument();
    expect(screen.getByText('Ravi')).toBeInTheDocument();
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('queries assignments by the resolved agent_users.id — never the Firebase uid', async () => {
    // 0022/agent auto-assignment stores agent_users.id (a uuid) in
    // orders.agent_id; the AuthContext resolves exactly that key (`agentId`).
    // Any fetch filtering by the raw Firebase uid would be the root cause of
    // "confirmed orders never appear in the agent dashboard".
    h.rows = [{
      id: 'order-4', order_number: 'KV-260101-0004', customer_name: 'Viju', phone: '9000000001',
      area: 'South', address_line: '9 Market St', total: '100', agent_id: 'agent-1',
      status: 'confirmed', assignment_status: 'accepted', delay_note: null,
      arrived_at: null, picked_up_at: null, customer_reached_at: null,
    }];
    h.eqCalls.length = 0;
    render(<MemoryRouter><AgentActive /></MemoryRouter>);

    await screen.findByText('Viju');
    expect(h.eqCalls).toContain('agent_id=agent-1');
    expect(h.eqCalls).not.toContain('agent_id=firebase-uid-1');
  });
});

