import { describe, expect, it } from 'vitest';
import { customerOrderStatusLabel, customerVisibleOrderStatus } from '@/lib/orderPresentation';

describe('customerVisibleOrderStatus', () => {
  it.each(['preparing', 'ready', 'out_for_delivery'] as const)(
    'maps internal %s to confirmed',
    (status) => {
      expect(customerVisibleOrderStatus(status)).toBe('confirmed');
    },
  );

  it('uses customer-facing placement and acceptance labels in notifications', () => {
    const translate = (key: string) => key;
    expect(customerOrderStatusLabel('pending', translate)).toBe('order.customerStatus.pending');
    expect(customerOrderStatusLabel('confirmed', translate)).toBe('order.customerStatus.confirmed');
    expect(customerOrderStatusLabel('preparing', translate)).toBe('order.customerStatus.confirmed');
  });

  it.each(['pending', 'confirmed', 'delivered', 'rejected', 'cancelled'] as const)(
    'preserves customer outcome %s',
    (status) => {
      expect(customerVisibleOrderStatus(status)).toBe(status);
    },
  );
});
