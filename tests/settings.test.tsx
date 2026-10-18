import { act, renderHook, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

const h = vi.hoisted(() => ({ single: vi.fn() }));
vi.mock('@/lib/supabase', () => ({ supabase: {
  from: () => ({ select: () => ({ eq: () => ({ abortSignal: () => ({ single: h.single }) }) }) }),
} }));
import { useHotelSettings } from '@/hooks/useHotelSettings';

afterEach(() => vi.useRealTimers());
describe('Settings recovery', () => {
  it('stops loading after 12 seconds and can retry a stalled request', async () => {
    vi.useFakeTimers();
    h.single.mockImplementationOnce(() => new Promise(() => undefined));
    const { result } = renderHook(() => useHotelSettings());
    expect(result.current.loading).toBe(true);
    await act(async () => { vi.advanceTimersByTime(12000); });
    expect(result.current.loading).toBe(false);
    expect(result.current.error).toBe('SETTINGS_TIMEOUT');
    h.single.mockResolvedValueOnce({ data: { id: 1, is_accepting_orders: true }, error: null });
    await act(async () => { result.current.retry(); });
    expect(result.current.error).toBeNull();
    expect(result.current.data?.is_accepting_orders).toBe(true);
    expect(result.current.loading).toBe(false);
  });

  it('handles a rejected fetch and clears the loading state', async () => {
    h.single.mockRejectedValueOnce(new Error('Network disconnected'));
    const { result } = renderHook(() => useHotelSettings());
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.error).toBe('Network disconnected');
  });
});
