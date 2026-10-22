import type { OrderStatus } from '@/types/db';

/**
 * The one authoritative order workflow (issue 7):
 *   placed → confirmed → being prepared → ready for pickup →
 *   out for delivery → delivered
 * plus rejected / cancelled end states (the app's persisted status strings are
 * `pending/confirmed/preparing/ready/out_for_delivery/delivered/rejected/
 * cancelled`; customers can cancel their own pending order via cancel_order —
 * migration 0006 — and rejected/cancelled are terminal).
 *
 * THE BACKEND IS THE ENFORCER: `set_order_status` (migrations 0016/0018) and
 * `admin_confirm_order` (0022) validate every transition server-side and raise
 * an INVALID_TRANSITION / FINAL_STATE exception for anything else, so invalid
 * transitions can never silently succeed from any client. This map mirrors
 * that contract for the UI (which button is ever offered) and for tests, and
 * records who may perform each transition.
 */
export const ORDER_TRANSITIONS: Readonly<Record<OrderStatus, NextTransition[]>> = Object.freeze({
  pending: [
    { to: 'confirmed', by: 'admin', via: 'admin_confirm_order — ETA required (issue 2)' },
    { to: 'rejected', by: 'admin', via: 'set_order_status — reason recorded' },
    { to: 'cancelled', by: 'customer', via: 'cancel_order (own pending order, 0006)' },
  ],
  confirmed: [
    { to: 'preparing', by: 'admin', via: 'set_order_status' },
    { to: 'rejected', by: 'admin', via: 'set_order_status — reason recorded' },
  ],
  preparing: [{ to: 'ready', by: 'admin', via: 'set_order_status' }],
  ready: [{ to: 'out_for_delivery', by: 'agent', via: 'agent flow (or admin via set_order_status)' }],
  out_for_delivery: [{ to: 'delivered', by: 'agent', via: 'agent_deliver — admin fallback: admin_mark_delivered' }],
  delivered: [],
  rejected: [],
  cancelled: [],
});

/** DELIVERY LIFECYCLE (parallel track — issue 3, documented): acceptance is a
 * SEPARATE tracked field (`orders.assignment_status`), not a global status
 * string. Life of an assignment:
 *   assigned → accepted → picked_up → delivered | failed
 * Enforced server-side by the 0021 agent RPCs (agent_accept / agent_decline /
 * agent_deliver / agent_fail all verify that `kv_agent_id()` matches the
 * stored `orders.agent_id` and that the assignment is in a valid state for a
 * further transition). The agent tabs read exactly these values:
 *   Assigned to me      → assignment_status = 'assigned'
 *   Accepted by me      → assignment_status = 'accepted' | 'picked_up'
 *   Delivered/History   → assignment_status = 'delivered'
 * COD handover (`cash_handed_at`) is deliberately separate (never set by the
 * delivery confirmation itself), so a completed FOOD delivery never implies a
 * completed CASH handover. `delivered_at` timestamps delivery; `assigned_at`,
 * `accepted_at`, `picked_up_at` timestamp the assignment steps. */
export type NextTransition = { to: OrderStatus; by: 'admin' | 'agent' | 'customer'; via: string };

export function canTransition(from: OrderStatus, to: OrderStatus): boolean {
  return ORDER_TRANSITIONS[from].some((x) => x.to === to);
}

/** Collapse staff-only preparation and courier states into one customer status. */
export function customerVisibleOrderStatus(status: OrderStatus): OrderStatus {
  if (status === 'preparing' || status === 'ready' || status === 'out_for_delivery') return 'confirmed';
  return status;
}

export function customerOrderStatusLabel(
  status: OrderStatus,
  t: (key: string) => string,
): string {
  const visibleStatus = customerVisibleOrderStatus(status);
  if (visibleStatus === 'pending' || visibleStatus === 'confirmed') {
    return t(`order.customerStatus.${visibleStatus}`);
  }
  return t(`order.status.${visibleStatus}`);
}
