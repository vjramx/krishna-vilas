import type { OrderStatus } from '@/types/db';

/** Mirrors public.set_order_status validation — backend remains authoritative.
 * 'cancelled' is staff-proof through set_order_status on purpose: only the
 * customer-facing cancel_order RPC may create it (pending/confirmed only). */
export const TRANSITIONS: Record<OrderStatus, OrderStatus[]> = {
  pending: ['confirmed', 'rejected'],
  confirmed: ['preparing', 'rejected'],
  preparing: ['ready'],
  ready: ['out_for_delivery'],
  out_for_delivery: ['delivered'],
  delivered: [],
  rejected: [],
  cancelled: [],
};

export function canTransition(from: OrderStatus, to: OrderStatus): boolean {
  return TRANSITIONS[from]?.includes(to) ?? false;
}

/** Agent assignmentflow mirrors the agent_* RPCs. */
export const AGENT_STEPS = ['assigned', 'accepted', 'arrived', 'picked_up', 'delivered'] as const;
