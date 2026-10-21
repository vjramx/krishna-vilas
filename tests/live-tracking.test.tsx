import { act, render, renderHook, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Order } from '@/types/db';

const h = vi.hoisted(() => ({
  rpc: vi.fn(async () => ({ data: null, error: null })),
  watchPosition: vi.fn(),
  clearWatch: vi.fn(),
  mapProps: [] as unknown[],
}));

vi.mock('@/lib/supabase', () => ({ supabase: { rpc: h.rpc } }));
vi.mock('@/context/LanguageContext', () => ({ useLanguage: () => ({ t: (key: string) => key, lang: 'en' }) }));
vi.mock('@/components/MapLibreTrackingMap', () => ({
  default: (props: unknown) => {
    h.mapProps.push(props);
    return <div data-testid="tracking-map" />;
  },
}));

import { LiveTracking } from '@/components/LiveTracking';
import { useAgentLocationShare } from '@/hooks/useAgentLocationShare';

const baseOrder = {
  id: 'order-1', order_number: 'KV-1', status: 'out_for_delivery', assignment_status: 'picked_up',
  delivery_latitude: '12.9600000', delivery_longitude: '77.6000000',
  agent_latitude: null, agent_longitude: null, agent_location_accuracy_meters: null, agent_location_at: null,
} as unknown as Order;

describe('customer live tracking card', () => {
  beforeEach(() => {
    h.mapProps.length = 0;
  });

  it('shows the rider and destination map once the rider has a position', async () => {
    render(<LiveTracking order={{ ...baseOrder, agent_latitude: '12.9700000', agent_longitude: '77.6100000', agent_location_at: '2026-10-19T10:00:00.000Z' } as Order} />);
    expect(screen.getByText('delivery.liveTitle')).toBeInTheDocument();
    // The map is lazy-loaded, so wait for it to mount before checking its props.
    await screen.findByTestId('tracking-map');
    expect(screen.getByRole('status')).toHaveTextContent('delivery.agentUpdatedAt');
    expect(h.mapProps[h.mapProps.length - 1]).toEqual({
      destination: { latitude: 12.96, longitude: 77.6 },
      agent: { latitude: 12.97, longitude: 77.61 },
      height: 240,
      label: 'delivery.agentLocation',
    });
  });

  it('waits for the rider when no position has been shared yet', () => {
    render(<LiveTracking order={baseOrder} />);
    expect(screen.getByRole('status')).toHaveTextContent('delivery.agentWaiting');
    expect(screen.queryByTestId('tracking-map')).not.toBeInTheDocument();
  });

  it('stays hidden outside the out-for-delivery stage', () => {
    const { container } = render(<LiveTracking order={{ ...baseOrder, status: 'preparing' } as Order} />);
    expect(container).toBeEmptyDOMElement();
  });

  it('ignores a rider position that is not a valid coordinate', () => {
    render(<LiveTracking order={{ ...baseOrder, agent_latitude: '95', agent_longitude: '77.6' } as Order} />);
    expect(screen.getByRole('status')).toHaveTextContent('delivery.agentWaiting');
  });
});

describe('agent location sharing hook', () => {
  let watchCallback: ((pos: GeolocationPosition) => void) | null = null;

  beforeEach(() => {
    vi.useFakeTimers();
    h.rpc.mockClear();
    h.watchPosition.mockReset();
    h.clearWatch.mockReset();
    watchCallback = null;
    h.watchPosition.mockImplementation((success: (pos: GeolocationPosition) => void) => {
      watchCallback = success;
      return 7;
    });
    Object.defineProperty(navigator, 'geolocation', {
      configurable: true,
      value: { watchPosition: h.watchPosition, clearWatch: h.clearWatch },
    });
  });

  it('uploads the latest fix on a 15-second throttle and stops when unmounted', () => {
    const { unmount } = renderHook(() => useAgentLocationShare(['order-1']));
    act(() => {
      watchCallback?.({ coords: { latitude: 12.97, longitude: 77.61, accuracy: 9 } } as GeolocationPosition);
    });

    // First tick (5s) sends immediately.
    act(() => { vi.advanceTimersByTime(5_000); });
    expect(h.rpc).toHaveBeenCalledTimes(1);
    expect(h.rpc).toHaveBeenCalledWith('agent_report_location', {
      p_order_id: 'order-1', p_latitude: 12.97, p_longitude: 77.61, p_accuracy_meters: 9,
    });

    // Within the 15s window: no extra upload.
    act(() => { vi.advanceTimersByTime(10_000); });
    expect(h.rpc).toHaveBeenCalledTimes(1);

    // After the window: the newest fix goes out again.
    act(() => {
      watchCallback?.({ coords: { latitude: 12.98, longitude: 77.62, accuracy: 5 } } as GeolocationPosition);
      vi.advanceTimersByTime(5_000);
    });
    expect(h.rpc).toHaveBeenCalledTimes(2);
    expect(h.rpc).toHaveBeenLastCalledWith('agent_report_location', {
      p_order_id: 'order-1', p_latitude: 12.98, p_longitude: 77.62, p_accuracy_meters: 5,
    });

    unmount();
    expect(h.clearWatch).toHaveBeenCalledWith(7);
  });

  it('sends nothing when there are no on-route orders', () => {
    renderHook(() => useAgentLocationShare([]));
    expect(h.watchPosition).not.toHaveBeenCalled();
  });
});
