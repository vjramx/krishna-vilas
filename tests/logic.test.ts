import { describe, expect, it } from 'vitest';
import { applyRealtime } from '@/hooks/useOrders';
import { canTransition } from '@/lib/transitions';
import type { Order } from '@/types/db';

const order = (id: string, status: Order['status']): Order =>
  ({
    id,
    status,
    order_number: `KV-${id}`,
    customer_name: 'C',
    total: '100',
    subtotal: '90',
    discount_total: '0',
    delivery_fee: '10',
    created_at: new Date().toISOString(),
    assignment_status: 'none',
    payment_method: 'cod',
    fulfillment: 'delivery',
    phone: '9999999999',
    address_line: 'X',
    area: 'Y',
    agent_id: null,
  }) as unknown as Order;

describe('realtime order merge', () => {
  it('inserts new orders at the head', () => {
    const a = order('a', 'pending');
    const b = order('b', 'confirmed');
    const merged = applyRealtime([a], { eventType: 'INSERT' as const, new: b, old: null });
    expect(merged.map((o) => o.id)).toEqual(['b', 'a']);
  });

  it('updates an existing order in place', () => {
    const a = order('a', 'pending');
    const updated = order('a', 'confirmed');
    const merged = applyRealtime([a], { eventType: 'UPDATE' as const, new: updated, old: null });
    expect(merged).toHaveLength(1);
    expect(merged[0].status).toBe('confirmed');
  });

  it('removes quests on delete', () => {
    const a = order('a', 'pending');
    const merged = applyRealtime([a], { eventType: 'DELETE' as const, new: null, old: { id: 'a' } });
    expect(merged).toHaveLength(0);
  });
});

describe('order transitions allowed by set_order_status backend', () => {
  it('only allows the documented chain', () => {
    expect(canTransition('pending', 'confirmed')).toBe(true);
    expect(canTransition('confirmed', 'rejected')).toBe(true);
    expect(canTransition('ready', 'out_for_delivery')).toBe(true);
    expect(canTransition('out_for_delivery', 'delivered')).toBe(true);
    expect(canTransition('pending', 'delivered')).toBe(false);
    expect(canTransition('delivered', 'preparing')).toBe(false);
  });
});
