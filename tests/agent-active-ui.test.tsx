import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it, vi, beforeEach } from 'vitest';

const h = vi.hoisted(() => ({
  rows: [] as unknown[],
  rpc: vi.fn(async () => ({ data: null, error: null })),
}));

vi.mock('@/lib/supabase', () => {
  const channel = { on() { return channel; }, subscribe() { return channel; } };
  return {
    supabase: {
      from: () => ({ select: () => ({ eq: () => ({ order: () => Promise.resolve({ data: h.rows, error: null }) }) }) }),
      channel: () => channel,
      removeChannel: vi.fn(),
      rpc: h.rpc,
    },
  };
});
vi.mock('@/context/AuthContext', () => ({ useAuth: () => ({ userId: 'agent-1', loading: false }) }));
vi.mock('@/context/LanguageContext', () => ({ useLanguage: () => ({ t: (key: string) => key, lang: 'en' }) }));
vi.mock('@/hooks/useAgentLocationShare', () => ({ useAgentLocationShare: () => ({ sharing: true, error: null }) }));

import { AgentActive } from '@/pages/agent/AgentHome';

describe('agent Active tab order card', () => {
  beforeEach(() => {
    h.rows = [];
    h.rpc.mockReset();
    h.rpc.mockResolvedValue({ data: null, error: null });
  });

  it('shows the customer, tap-to-call link and a single Mark delivered action — no Reached-restaurant step', async () => {
    h.rows = [{
      id: 'order-1', order_number: 'KV-260101-0001', customer_name: 'Asha Rao', phone: '9876543210',
      area: 'Central', address_line: '12 Main Road', total: '250', agent_id: 'agent-1',
      status: 'confirmed', assignment_status: 'accepted', delay_note: null,
      arrived_at: null, picked_up_at: null, customer_reached_at: null,
    }];
    render(<MemoryRouter><AgentActive /></MemoryRouter>);

    expect(await screen.findByText('Asha Rao')).toBeInTheDocument();
    expect(screen.getByText('Central — 12 Main Road')).toBeInTheDocument();
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
});

