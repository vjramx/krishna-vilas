import type { Order } from '@/types/db';

/** Outcome of classifying one realtime order snapshot against the set of
 * assignments the agent already knew about. 'new' = this agent just received
 * an assignment (must alert), 'gone' = the assignment left their queue (accept,
 * decline, hand-back or reassignment) and should be forgotten, 'same' = no
 * change worth reacting to. */
export type AssignmentDelta = 'new' | 'gone' | 'same';

/** Order fields the classifier needs — lets callers fetch narrow rows. */
export type AssignmentSnapshot = Pick<Order, 'id' | 'agent_id' | 'assignment_status'>;

export function isAssignedToMe(order: AssignmentSnapshot, me: string): boolean {
  return me !== '' && order.agent_id === me && order.assignment_status === 'assigned';
}

/** Pure diff so an incoming snapshot maps to exactly one user-visible outcome:
 * a fresh assignment to this agent is 'new' even if a previous version of the
 * order was known under a different assignment, and any order that is no
 * longer actively assigned to this agent frees its id for re-alerting. */
export function classifyAssignment(known: Set<string>, order: AssignmentSnapshot, me: string): AssignmentDelta {
  const mine = isAssignedToMe(order, me);
  const wasKnown = known.has(order.id);
  if (mine && !wasKnown) return 'new';
  if (!mine && wasKnown) return 'gone';
  return 'same';
}

/** Apply the delta to the known-set and return whether an alert should fire.
 * Alerts are suppressed until seeding completed, so a fresh mount never fires
 * for assignments that predate the app opening. */
export function applyAssignmentDelta(
  known: Set<string>,
  order: AssignmentSnapshot,
  me: string,
  opts: { alertIfNew?: boolean; seeded?: boolean } = {},
): boolean {
  const delta = classifyAssignment(known, order, me);
  if (delta === 'new') known.add(order.id);
  if (delta === 'gone') known.delete(order.id);
  return delta === 'new' && (opts.seeded ?? true) && (opts.alertIfNew ?? true);
}
