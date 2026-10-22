import { fireEvent, render, screen, cleanup, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';

const h = vi.hoisted(() => ({
  auth: { session: null as object | null, userId: null as string | null, loading: false },
  settings: { data: null as Record<string, unknown> | null, loading: false, retry: vi.fn() },
  cart: {
    lines: [] as { itemId: string; nameEn: string; nameKn: string; unitPaise: number; quantity: number }[],
    unavailableIds: [] as string[],
    clear: vi.fn(),
    remove: vi.fn(),
    syncPrices: vi.fn(),
    markUnavailable: vi.fn(),
  },
  catalogRows: [] as { id: string; category_id: string; price: number; name_en: string; name_kn: string; is_active: boolean; is_available: boolean }[],
  offers: [] as { discount_type: 'percent' | 'flat'; discount_value: number; scope: 'item' | 'category' | 'all'; target_id: string | null }[],
  rpc: vi.fn(),
  signInAsGuest: vi.fn(async () => undefined),
  currentFirebaseUser: vi.fn(() => ({ isAnonymous: true, uid: 'guest-uid' })),
  isGuestSession: vi.fn(() => true),
}));
vi.mock('@/context/AuthContext', () => ({ useAuth: () => h.auth }));
vi.mock('@/hooks/useHotelSettings', () => ({ useHotelSettings: () => h.settings }));
vi.mock('@/context/LanguageContext', () => ({ useLanguage: () => ({ t: (key: string, values?: Record<string, string>) => values ? `${key} ${JSON.stringify(values)}` : key, lang: 'en' }) }));
vi.mock('@/context/CartContext', () => ({ useCart: () => h.cart }));
vi.mock('@/components/nav', () => ({ TopBackBar: () => <header /> }));
vi.mock('@/lib/firebase', () => ({
  signInAsGuest: h.signInAsGuest,
  currentFirebaseUser: h.currentFirebaseUser,
  isGuestSession: h.isGuestSession,
  signInWithEmail: vi.fn(),
  registerWithEmail: vi.fn(),
  sendPasswordReset: vi.fn(),
  firebaseAuth: { fake: true },
}));
vi.mock('@/lib/supabase', () => ({    supabase: {
      rpc: h.rpc,
      from: vi.fn((table: string) => {

      const query = {
        select: () => query,
        in: () => query,
        eq: () => query,
        lte: () => query,
        gte: () => query,
        abortSignal: () => query,
        then: (resolve: (result: { data: unknown[]; error: null }) => unknown) =>
          Promise.resolve({ data: table === 'special_offers' ? h.offers : h.catalogRows, error: null }).then(resolve),
      };
      return query;
    }),
  },
}));
import CheckoutPage from '@/pages/CheckoutPage';

function mount() {
  return render(<MemoryRouter><CheckoutPage /></MemoryRouter>);
}
beforeEach(() => {
  localStorage.clear();
  sessionStorage.clear();
  h.auth = { session: null, userId: null, loading: false };
  h.rpc.mockReset();
  h.cart = {
    lines: [{ itemId: 'idli', nameEn: 'Idli', nameKn: '', unitPaise: 10000, quantity: 1 }],
    unavailableIds: [], clear: vi.fn(), remove: vi.fn(), syncPrices: vi.fn(), markUnavailable: vi.fn(),
  };
  h.catalogRows = [{ id: 'idli', category_id: 'breakfast', price: 100, name_en: 'Idli', name_kn: '', is_active: true, is_available: true }];
  h.offers = [];
  h.settings = { data: { is_accepting_orders: true, delivery_fee: 10, min_order_total: 50, opens_at: '08:00', closes_at: '22:00' }, loading: false, retry: vi.fn() };
});
afterEach(() => {
  cleanup();
});
describe('Checkout recovery', () => {
  it('compares minimum food subtotal, not the delivery-inclusive total, with the server rule', async () => {
    h.auth.session = {};
    h.cart.lines = [{ itemId: 'upma', nameEn: 'Upma', nameKn: '', unitPaise: 4000, quantity: 1 }];
    h.catalogRows = [{ id: 'upma', category_id: 'breakfast', price: 40, name_en: 'Upma', name_kn: '', is_active: true, is_available: true }];
    mount();
    expect(screen.getAllByText('common.total')[0]?.parentElement).toHaveTextContent('₹50');
    expect(screen.getAllByText(/checkout\.minFoodSubtotal/)[0]).toHaveTextContent('"more":"10"');
    expect(screen.getByRole('button', { name: 'checkout.placeOrder' })).toBeDisabled();

    h.cart.lines = [{ itemId: 'upma', nameEn: 'Upma', nameKn: '', unitPaise: 5000, quantity: 1 }];
    h.catalogRows = [{ id: 'upma', category_id: 'breakfast', price: 50, name_en: 'Upma', name_kn: '', is_active: true, is_available: true }];
    cleanup();
    mount();
    await waitFor(() => expect(screen.getByRole('button', { name: 'checkout.placeOrder' })).toBeEnabled());
    expect(screen.getAllByText('common.total')[0]?.parentElement).toHaveTextContent('₹60');
    expect(screen.queryByText(/checkout\.minFoodSubtotal/)).toBeNull();
  });

  it('refreshes a saved cart price from the live catalog before enabling checkout', async () => {
    h.auth.session = {};
    h.cart.lines = [{ itemId: 'upma', nameEn: 'Upma', nameKn: '', unitPaise: 4000, quantity: 1 }];
    h.catalogRows = [{ id: 'upma', category_id: 'breakfast', price: 40, name_en: 'Upma', name_kn: '', is_active: true, is_available: true }];
    h.cart.syncPrices.mockImplementation((items: typeof h.catalogRows) => {
      h.cart.lines = h.cart.lines.map((line) => {
        const fresh = items.find((item) => item.id === line.itemId);
        return fresh ? { ...line, unitPaise: Math.round(fresh.price * 100), nameEn: fresh.name_en, nameKn: fresh.name_kn } : line;
      });
    });
    mount();
    await vi.waitFor(() => expect(h.cart.syncPrices).toHaveBeenCalledOnce());
    expect(screen.getByRole('button', { name: 'checkout.placeOrder' })).toBeDisabled();
    expect(screen.getAllByText('common.total')[0]?.parentElement).toHaveTextContent('₹50');
  });

  it('enables checkout above the configured food subtotal minimum', async () => {
    h.auth.session = {};
    h.cart.lines = [{ itemId: 'upma', nameEn: 'Upma', nameKn: '', unitPaise: 5100, quantity: 1 }];
    h.catalogRows = [{ id: 'upma', category_id: 'breakfast', price: 51, name_en: 'Upma', name_kn: '', is_active: true, is_available: true }];
    mount();
    await waitFor(() => expect(screen.getByRole('button', { name: 'checkout.placeOrder' })).toBeEnabled());
  });

  it('guests can order without an account: the place-order button stays, sign-in is a secondary link', async () => {
    mount();
    // Cart has one default line and valid settings — the guest can submit.
    await waitFor(() => expect(screen.getByRole('button', { name: 'checkout.placeOrder' })).toBeEnabled());
    for (const link of screen.getAllByRole('link', { name: 'common.signIn' })) {
      expect(link).toHaveAttribute('href', '/login?next=%2Fcheckout');
    }
    expect(screen.getByText('checkout.guestOk')).toBeInTheDocument();
  });

  it('signs the guest in anonymously on submit, then places the order with that identity', async () => {
    mount();
    // The address block must be valid first — guest auth only kicks in after
    // client-side validation passes, exactly like a signed-in submission.
    fireEvent.change(screen.getByLabelText('checkout.name'), { target: { value: 'Priya' } });
    fireEvent.change(screen.getByLabelText('checkout.phone'), { target: { value: '9876543210' } });
    fireEvent.change(screen.getByLabelText('checkout.address'), { target: { value: '12 Main Street' } });
    fireEvent.change(screen.getByLabelText('checkout.area'), { target: { value: 'Karatagi' } });
    const submit = screen.getByRole('button', { name: 'checkout.placeOrder' });
    await waitFor(() => expect(submit).toBeEnabled());
    fireEvent.click(submit);
    await waitFor(() => expect(h.signInAsGuest).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(h.rpc).toHaveBeenCalledTimes(1));
    expect(h.rpc.mock.calls[0][0]).toBe('place_order_with_location');
  });

  it('shows the blocking reason instead of a dead button when the guest has nothing to order', () => {
    h.cart.lines = [];
    mount();
    expect(screen.getByRole('button', { name: 'checkout.placeOrder' })).toBeDisabled();
    expect(screen.getAllByText('err.itemsRequired').length).toBeGreaterThan(0);
  });
  it('keeps the form and explicit save preference across reload without opting in by default', () => {
    mount();
    fireEvent.change(screen.getByLabelText('checkout.name'), { target: { value: 'Priya' } });
    expect(screen.getByRole('checkbox')).not.toBeChecked();
    fireEvent.click(screen.getByRole('checkbox'));
    cleanup();
    mount();
    expect(screen.getByLabelText('checkout.name')).toHaveValue('Priya');
    expect(screen.getByRole('checkbox')).toBeChecked();
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
  it('serves a plain address checkout — no location picker, no device geolocation, no map pin', () => {
    h.auth.session = {};
    const getCurrentPosition = vi.fn(() => { throw new Error('geolocation must never be used'); });
    Object.defineProperty(navigator, 'geolocation', { configurable: true, value: { getCurrentPosition } });
    mount();
    expect(document.querySelector('[data-location-picker]')).toBeNull();
    expect(screen.queryByRole('button', { name: 'checkout.chooseMap' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'checkout.useCurrentLocation' })).toBeNull();
    expect(document.querySelector('[role="dialog"]')).toBeNull();
    expect(getCurrentPosition).not.toHaveBeenCalled();
  });

  it('places a COD order with the typed address and null coordinates, then clears the cart', async () => {
    h.auth.session = {};
    h.auth.userId = 'customer-1';
    h.rpc.mockResolvedValue({ data: { order_id: 'saved-order' }, error: null });
    mount();
    fireEvent.change(screen.getByLabelText('checkout.name'), { target: { value: 'Priya' } });
    fireEvent.change(screen.getByLabelText('checkout.phone'), { target: { value: '9876543210' } });
    fireEvent.change(screen.getByLabelText('checkout.address'), { target: { value: '12 Main Street' } });
    fireEvent.change(screen.getByLabelText('checkout.area'), { target: { value: 'Karatagi' } });
    const submit = screen.getByRole('button', { name: 'checkout.placeOrder' });
    await waitFor(() => expect(submit).toBeEnabled());
    fireEvent.click(submit);
    await vi.waitFor(() => expect(h.rpc).toHaveBeenCalledOnce());
    expect(h.rpc.mock.calls[0]?.[0]).toBe('place_order_with_location');
    expect(h.rpc.mock.calls[0]?.[1]).toMatchObject({
      p_customer_name: 'Priya',
      p_phone: '9876543210',
      p_address_line: '12 Main Street',
      p_area: 'Karatagi',
      // Address-only checkout: the backend receives no pin at all.
      p_delivery_latitude: null,
      p_delivery_longitude: null,
      p_location_accuracy_meters: null,
      p_location_source: 'manual_address',
      p_location_confirmed_at: null,
      p_delivery_details: {},
    });
    await vi.waitFor(() => expect(h.cart.clear).toHaveBeenCalledOnce());
  });

  it('allows placing an order as soon as the address block is valid without any pin', async () => {
    h.auth.session = {};
    mount();
    fireEvent.change(screen.getByLabelText('checkout.name'), { target: { value: 'Priya' } });
    fireEvent.change(screen.getByLabelText('checkout.phone'), { target: { value: '9876543210' } });
    fireEvent.change(screen.getByLabelText('checkout.address'), { target: { value: '12 Main Street' } });
    fireEvent.change(screen.getByLabelText('checkout.area'), { target: { value: 'Karatagi' } });
    const submit = screen.getByRole('button', { name: 'checkout.placeOrder' });
    await waitFor(() => expect(submit).toBeEnabled());
    expect(screen.queryByText('checkout.pinRequired')).toBeNull();
  });

  it('recovers from a thrown order RPC, preserves the cart and prevents duplicate taps', async () => {
    h.auth.session = {};
    h.rpc.mockImplementationOnce(() => new Promise((_resolve, reject) => setTimeout(() => reject(new TypeError('Failed to fetch')), 20)));
    mount();
    fireEvent.change(screen.getByLabelText('checkout.name'), { target: { value: 'Priya' } });
    fireEvent.change(screen.getByLabelText('checkout.phone'), { target: { value: '9876543210' } });
    fireEvent.change(screen.getByLabelText('checkout.address'), { target: { value: '12 Main Street' } });
    fireEvent.change(screen.getByLabelText('checkout.area'), { target: { value: 'Mysuru' } });
    const button = screen.getByRole('button', { name: 'checkout.placeOrder' });
    await waitFor(() => expect(button).toBeEnabled());
    fireEvent.click(button);
    fireEvent.submit(document.getElementById('checkout-form')!);
    expect(h.rpc).toHaveBeenCalledOnce();
    expect(button).toBeDisabled();
    expect(await screen.findByRole('alert')).toHaveTextContent('err.network');
    expect(button).toBeEnabled();
    expect(h.cart.clear).not.toHaveBeenCalled();
    expect(sessionStorage.getItem('kv-order-pending')).toMatch(/^[\da-f-]{36}$/i);
  });

  it('does not clear the cart or navigate when the backend response has no order id', async () => {
    h.auth.session = {};
    h.rpc.mockResolvedValue({ data: null, error: null });
    mount();
    fireEvent.change(screen.getByLabelText('checkout.name'), { target: { value: 'Priya' } });
    fireEvent.change(screen.getByLabelText('checkout.phone'), { target: { value: '9876543210' } });
    fireEvent.change(screen.getByLabelText('checkout.address'), { target: { value: '12 Main Street' } });
    fireEvent.change(screen.getByLabelText('checkout.area'), { target: { value: 'Mysuru' } });
    const button = screen.getByRole('button', { name: 'checkout.placeOrder' });
    await waitFor(() => expect(button).toBeEnabled());
    fireEvent.click(button);
    expect(await screen.findByRole('alert')).toHaveTextContent('err.generic');
    expect(h.cart.clear).not.toHaveBeenCalled();
    expect(sessionStorage.getItem('kv-order-pending')).toBeTruthy();
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
