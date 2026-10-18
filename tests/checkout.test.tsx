import { fireEvent, render, screen, cleanup } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const h = vi.hoisted(() => ({
  auth: { session: null as object | null, userId: null, loading: false },
  settings: { data: null as Record<string, unknown> | null, loading: false, retry: vi.fn() },
  rpc: vi.fn(),
}));
vi.mock('@/context/AuthContext', () => ({ useAuth: () => h.auth }));
vi.mock('@/hooks/useHotelSettings', () => ({ useHotelSettings: () => h.settings }));
vi.mock('@/context/LanguageContext', () => ({ useLanguage: () => ({ t: (key: string) => key, lang: 'en' }) }));
vi.mock('@/context/CartContext', () => ({ useCart: () => ({
  lines: [{ itemId: 'idli', nameEn: 'Idli', nameKn: '', unitPaise: 10000, quantity: 1 }],
  clear: vi.fn(),
}) }));
vi.mock('@/components/nav', () => ({ TopBackBar: () => <header /> }));
vi.mock('@/components/DeliveryMap', () => ({ DeliveryMap: () => <div data-testid="delivery-map" /> }));
vi.mock('@/lib/supabase', () => ({ supabase: { rpc: h.rpc } }));
import CheckoutPage from '@/pages/CheckoutPage';

function mount() {
  return render(<MemoryRouter><CheckoutPage /></MemoryRouter>);
}
beforeEach(() => {
  localStorage.clear();
  sessionStorage.clear();
  h.auth = { session: null, userId: null, loading: false };
  h.rpc.mockReset();
  h.settings = { data: { is_accepting_orders: true, delivery_fee: 10, min_order_total: 50, opens_at: '08:00', closes_at: '22:00' }, loading: false, retry: vi.fn() };
});
describe('Checkout recovery', () => {
  it('offers sign-in with a checkout return instead of a place-order button to guests', () => {
    mount();
    expect(screen.queryByRole('button', { name: 'checkout.placeOrder' })).toBeNull();
    for (const link of screen.getAllByRole('link', { name: 'common.signIn' })) {
      expect(link).toHaveAttribute('href', '/login?next=%2Fcheckout');
    }
  });
  it('keeps the form and save preference across unmount/reload without permanent storage', () => {
    mount();
    fireEvent.change(screen.getByLabelText('checkout.name'), { target: { value: 'Priya' } });
    fireEvent.click(screen.getByRole('checkbox'));
    cleanup();
    mount();
    expect(screen.getByLabelText('checkout.name')).toHaveValue('Priya');
    expect(screen.getByRole('checkbox')).not.toBeChecked();
    expect(localStorage.getItem('kv-delivery-details')).toBeNull();
  });
  it('disables submission while settings are loading, without claiming the kitchen is closed', () => {
    h.auth.session = {};
    h.settings.data = null;
    h.settings.loading = true;
    mount();
    expect(screen.getByRole('button', { name: 'checkout.placeOrder' })).toBeDisabled();
    expect(screen.queryByText('checkout.notAccepting')).toBeNull();
  });
  it('renders one compact optional location picker after the manual address fields', () => {
    mount();
    const picker = document.querySelector('[data-location-picker]');
    expect(picker).toBeInTheDocument();
    expect(picker?.querySelectorAll('button')).toHaveLength(2);
    expect(picker?.textContent).toContain('checkout.locationPrivacy');
    expect(document.querySelectorAll('#ck-address')).toHaveLength(1);
    const formItems = [...document.querySelectorAll('#checkout-form [data-location-picker], #checkout-form #ck-instr')];
    expect(formItems.map((element) => element.id || 'location')).toEqual(['location', 'ck-instr']);
  });
  it('requests current location only after the customer taps the location action', async () => {
    h.auth.session = {};
    const denied = { code: 1, message: 'denied', PERMISSION_DENIED: 1, POSITION_UNAVAILABLE: 2, TIMEOUT: 3 } as GeolocationPositionError;
    const getCurrentPosition = vi.fn((...args: Parameters<Geolocation['getCurrentPosition']>) => args[1]?.(denied));
    Object.defineProperty(navigator, 'geolocation', { configurable: true, value: { getCurrentPosition } });
    Object.defineProperty(window, 'isSecureContext', { configurable: true, value: true });
    mount();
    expect(getCurrentPosition).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'checkout.useCurrentLocation' }));
    await screen.findByText('checkout.locationDenied');
    expect(getCurrentPosition).toHaveBeenCalledOnce();
    expect(getCurrentPosition.mock.calls[0]?.[2]).toEqual({ enableHighAccuracy: true, timeout: 15000, maximumAge: 0 });
  });
  it('opens the map with a draft and leaves selection unchanged when cancelled', async () => {
    h.auth.session = {};
    sessionStorage.setItem('kv-checkout-location', JSON.stringify({
      location: { latitude: 12.9, longitude: 77.5, accuracyMeters: null, source: 'map_pin', confirmedAt: '2025-01-01T00:00:00.000Z' },
      confirmed: true,
    }));
    mount();
    fireEvent.click(screen.getByRole('button', { name: 'checkout.chooseMap' }));
    expect(await screen.findByRole('button', { name: 'checkout.confirmPin' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'common.close' }));
    expect(screen.getByText('checkout.locationSelected')).toBeInTheDocument();
    expect(sessionStorage.getItem('kv-checkout-location')).toContain('12.9');
  });
  it('confirms GPS pin before submitting and persists exact coordinates with the order', async () => {
    h.auth.session = {};
    h.rpc.mockResolvedValue({ data: { order_id: 'saved-order' }, error: null });
    Object.defineProperty(window, 'isSecureContext', { configurable: true, value: true });
    const position = { coords: { latitude: 12.9716, longitude: 77.5946, accuracy: 15 } } as GeolocationPosition;
    const getCurrentPosition = vi.fn((...args: Parameters<Geolocation['getCurrentPosition']>) => args[0](position));
    Object.defineProperty(navigator, 'geolocation', { configurable: true, value: { getCurrentPosition } });
    mount();
    fireEvent.change(screen.getByLabelText('checkout.name'), { target: { value: 'Priya' } });
    fireEvent.change(screen.getByLabelText('checkout.phone'), { target: { value: '9876543210' } });
    fireEvent.change(screen.getByLabelText('checkout.address'), { target: { value: '12 Main Street' } });
    fireEvent.change(screen.getByLabelText('checkout.area'), { target: { value: 'Mysuru' } });
    fireEvent.click(screen.getByRole('button', { name: 'checkout.useCurrentLocation' }));
    await screen.findByRole('button', { name: 'checkout.confirmPin' });
    fireEvent.click(screen.getByRole('button', { name: 'checkout.confirmPin' }));
    expect(await screen.findByText('checkout.locationSelected')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('checkbox'));
    fireEvent.click(screen.getByRole('button', { name: 'checkout.placeOrder' }));
    await vi.waitFor(() => expect(h.rpc).toHaveBeenCalledOnce());
    const payload = h.rpc.mock.calls[0]?.[1];
    expect(h.rpc.mock.calls[0]?.[0]).toBe('place_order_with_location');
    expect(payload).toMatchObject({
      p_delivery_latitude: 12.9716,
      p_delivery_longitude: 77.5946,
      p_address_line: '12 Main Street',
      p_location_accuracy_meters: 15,
      p_location_source: 'browser_geolocation',
      p_delivery_details: {},
    });
    expect(payload.p_location_confirmed_at).toEqual(expect.any(String));
  });
  it('offers Retry for missing settings and keeps order submission disabled', () => {
    h.auth.session = {};
    h.settings.data = null;
    mount();
    fireEvent.click(screen.getByRole('button', { name: 'common.retry' }));
    expect(h.settings.retry).toHaveBeenCalledOnce();
    expect(screen.getByRole('button', { name: 'checkout.placeOrder' })).toBeDisabled();
  });
});
