import type { OrderStatus } from '@/types/db';

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
