import { describe, expect, it } from 'vitest';
import { applyAssignmentDelta, classifyAssignment, isAssignedToMe } from '@/lib/agentAssignments';

const o = (over: Partial<{ id: string; agent_id: string | null; assignment_status: 'none' | 'assigned' | 'accepted' | 'picked_up' | 'delivered' | 'failed' }> = {}) => ({
  id: 'order-1',
  agent_id: 'agent-1',
  assignment_status: 'assigned' as const,
  ...over,
});

const ME = 'agent-1';

describe('isAssignedToMe', () => {
  it('is true only for orders actively assigned to this agent', () => {
    expect(isAssignedToMe(o(), ME)).toBe(true);
    expect(isAssignedToMe(o({ assignment_status: 'accepted' }), ME)).toBe(false);
    expect(isAssignedToMe(o({ agent_id: null, assignment_status: 'none' }), ME)).toBe(false);
  });

  it('never matches another agent\u2019s assignment', () => {
    expect(isAssignedToMe(o({ agent_id: 'agent-2' }), ME)).toBe(false);
  });
});

describe('classifyAssignment', () => {
  it('flags an order freshly assigned to this agent', () => {
    expect(classifyAssignment(new Set(), o(), ME)).toBe('new');
  });

  it('does not re-flag an assignment it already knows', () => {
    expect(classifyAssignment(new Set(['order-1']), o(), ME)).toBe('same');
  });

  it('frees the id when the agent accepts, so a re-assignment can alert again', () => {
    const known = new Set(['order-1']);
    expect(classifyAssignment(known, o({ assignment_status: 'accepted' }), ME)).toBe('gone');
  });

  it('frees the id when the order is reassigned away from this agent', () => {
    const known = new Set(['order-1']);
    expect(classifyAssignment(known, o({ agent_id: 'agent-2' }), ME)).toBe('gone');
  });

  it('ignores unknown orders that were never assigned here', () => {
    expect(classifyAssignment(new Set(), o({ agent_id: null, assignment_status: 'none' }), ME)).toBe('same');
  });
});

describe('applyAssignmentDelta', () => {
  it('returns true once for a new assignment and records it', () => {
    const known = new Set<string>();
    expect(applyAssignmentDelta(known, o(), ME)).toBe(true);
    expect(known.has('order-1')).toBe(true);
    expect(applyAssignmentDelta(known, o(), ME)).toBe(false);
  });

  it('suppresses alerts until seeding finished', () => {
    const known = new Set<string>();
    expect(applyAssignmentDelta(known, o(), ME, { seeded: false })).toBe(false);
    expect(known.has('order-1')).toBe(true);
    expect(applyAssignmentDelta(known, o(), ME, { seeded: true })).toBe(false);
  });

  it('removes the id when the assignment leaves the queue', () => {
    const known = new Set(['order-1']);
    expect(applyAssignmentDelta(known, o({ assignment_status: 'delivered' }), ME)).toBe(false);
    expect(known.has('order-1')).toBe(false);
    expect(applyAssignmentDelta(known, o({ agent_id: null, assignment_status: 'none' }), ME)).toBe(false);
    expect(applyAssignmentDelta(known, o(), ME)).toBe(true);
  });
});
