import { StrictMode } from 'react';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const h = vi.hoisted(() => ({ query: vi.fn(), update: vi.fn(), updateSelect: vi.fn(), insert: vi.fn() }));
vi.mock('@/lib/supabase', () => ({ publicImageUrl: () => null, supabase: {
  from: (table: string) => ({
    select: () => ({ order: () => ({
      abortSignal: () => h.query(table),
      then: (resolve: (value: unknown) => unknown) => h.query(table).then(resolve),
    }) }),
    // Availability toggles await `.update().eq()` directly, while saves call
    // `.select()` afterwards, so eq() must be resolvable AND chain to select().
    update: () => ({ eq: () => {
      const result = Promise.resolve(h.update()) as Promise<unknown> & { select: () => unknown };
      result.select = () => h.updateSelect();
      return result;
    } }),
    insert: () => ({ select: () => h.insert() }),
  }),
} }));
vi.mock('@/context/LanguageContext', () => ({ useLanguage: () => ({ t: (key: string) => key, lang: 'en' }) }));
import AdminMenu from '@/pages/admin/AdminMenu';

const item = { id: 'idli', category_id: 'breakfast', name_en: 'Idli', name_kn: '', price: '30', is_available: true, is_active: true };
function success(table: string) {
  return Promise.resolve({ data: table === 'menu_items' ? [item] : [{ id: 'breakfast', name_en: 'Breakfast' }], error: null });
}
beforeEach(() => {
  h.query.mockReset().mockImplementation(success);
  h.updateSelect.mockReset();
  h.insert.mockReset();
});
afterEach(() => vi.useRealTimers());
function mount() { return render(<StrictMode><AdminMenu /></StrictMode>); }

describe('Admin menu loading', () => {
  it('renders fetched items under Strict Mode instead of leaving a permanent spinner', async () => {
    mount();
    expect(await screen.findByText('Idli')).toBeInTheDocument();
    expect(screen.queryByRole('status')).toBeNull();
  });
  it('shows fetch errors before the empty-category fallback and retries successfully', async () => {
    h.query.mockResolvedValue({ data: null, error: { message: 'Failed to fetch' } });
    mount();
    expect(await screen.findByRole('alert')).toBeInTheDocument();
    expect(screen.queryByText('menu.emptyCategory')).toBeNull();
    h.query.mockImplementation(success);
    fireEvent.click(screen.getByRole('button', { name: /common.retry/ }));
    expect(await screen.findByText('Idli')).toBeInTheDocument();
  });
  it('catches rejected requests', async () => {
    h.query.mockRejectedValue(new Error('Network disconnected'));
    mount();
    expect(await screen.findByRole('alert')).toBeInTheDocument();
  });
  it('ends a stalled request after 12 seconds and offers Retry', async () => {
    vi.useFakeTimers();
    h.query.mockImplementation(() => new Promise(() => undefined));
    mount();
    await act(async () => { vi.advanceTimersByTime(12000); });
    expect(screen.getByRole('alert')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /common.retry/ })).toBeInTheDocument();
    expect(screen.queryByRole('status')).toBeNull();
  });
  it('opens the edit sheet pre-filled and PATCHes the edited item with the new price', async () => {
    h.updateSelect.mockResolvedValue({ data: [item], error: null });
    mount();
    await screen.findByText('Idli');
    fireEvent.click(screen.getByRole('button', { name: 'admin.editItem: Idli' }));
    const nameInput = await screen.findByLabelText(/admin.nameEn/);
    expect(nameInput).toHaveValue('Idli');
    const priceInput = screen.getByLabelText(/admin.price/);
    fireEvent.change(priceInput, { target: { value: '35' } });
    h.query.mockImplementation(success); // reload after save returns the item list
    h.updateSelect.mockReset().mockResolvedValue({ data: [item], error: null });
    fireEvent.click(screen.getByRole('button', { name: /admin.saveChanges/ }));
    await waitFor(() => expect(h.updateSelect).toHaveBeenCalled());
    expect(screen.getByRole('status')).toHaveTextContent('admin.itemSaved');
  });

  it('survives PostgREST numeric price columns and edits them like strings', async () => {
    h.updateSelect.mockResolvedValue({ data: [item], error: null });
    h.query.mockImplementation((table: string) => Promise.resolve({
      data: table === 'menu_items'
        ? [{ ...item, price: 30, original_price: 40 }]
        : [{ id: 'breakfast', name_en: 'Breakfast' }],
      error: null,
    }));
    mount();
    // The discount-preview useMemo must not crash on a numeric price.
    expect(await screen.findByText('Idli')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'admin.editItem: Idli' }));
    const priceInput = await screen.findByLabelText(/admin.price/);
    expect(priceInput).toHaveValue(30);
    const nameInput = screen.getByLabelText(/admin.nameEn/);
    expect(nameInput).toHaveValue('Idli');
    fireEvent.click(screen.getByRole('button', { name: /admin.saveChanges/ }));
    await waitFor(() => expect(h.updateSelect).toHaveBeenCalled());
    expect(screen.getByRole('status')).toHaveTextContent('admin.itemSaved');
  });

  it('eye button persists and announces customer visibility changes', async () => {
    h.updateSelect.mockImplementation(() => Promise.resolve({ data: [{ id: 'idli', is_active: h.updateSelect.mock.calls.length % 2 === 1 }], error: null }));
    mount();
    const eye = await screen.findByRole('switch', { name: 'Idli: admin.hideFromMenu' });
    expect(eye).toHaveAttribute('aria-checked', 'true');
    fireEvent.click(eye);
    await waitFor(() => expect(h.updateSelect).toHaveBeenCalled());
    expect(screen.getByRole('status')).toHaveTextContent('admin.itemHidden');
    const hiddenEye = screen.getByRole('switch', { name: 'Idli: admin.showInMenu' });
    expect(hiddenEye).toHaveAttribute('aria-checked', 'false');
    fireEvent.click(hiddenEye);
    await waitFor(() => expect(h.updateSelect).toHaveBeenCalledTimes(2));
    expect(screen.getByRole('status')).toHaveTextContent('admin.itemShown');    expect(screen.getByRole('switch', { name: 'Idli: admin.hideFromMenu' })).toHaveAttribute('aria-checked', 'true');
  });
});

