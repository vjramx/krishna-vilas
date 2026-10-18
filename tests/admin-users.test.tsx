import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const h = vi.hoisted(() => ({
  rpc: vi.fn(),
  t: (key: string, params?: Record<string, string | number>) => {
    if (key === 'admin.users.migrationRequired') return 'Supabase could not resolve the customer analytics RPC. Migration 0008 may be missing, or the API schema cache may be stale. Verify the database objects; if they exist, run NOTIFY pgrst, \'reload schema\' in the SQL Editor.';
    return Object.entries(params ?? {}).reduce((text, [name, value]) => text.replace(`{${name}}`, String(value)), key);
  },
}));
vi.mock('@/lib/supabase', () => ({ supabase: { rpc: h.rpc } }));
vi.mock('@/context/LanguageContext', () => ({ useLanguage: () => ({ locale: 'en', t: h.t }) }));
import AdminUsers from '@/pages/admin/AdminUsers';

const user = {
  user_id: 'firebase-user-1',
  email: 'customer@example.com',
  display_name: 'Customer One',
  first_seen_at: '2026-10-17T10:00:00.000Z',
  last_seen_at: '2026-10-18T10:00:00.000Z',
  order_count: 2,
};
function directory(totalResults = 1) {
  return {
    total_users: 1,
    active_today: 1,
    active_7_days: 1,
    new_today: 0,
    total_results: totalResults,
    users: [user],
  };
}
beforeEach(() => {
  h.rpc.mockReset().mockResolvedValue({ data: directory(), error: null });
});

describe('Admin user directory', () => {
  it('renders customer analytics and requests a bounded first page', async () => {
    render(<AdminUsers />);
    expect(await screen.findByText('customer@example.com')).toBeInTheDocument();
    expect(screen.getByText('Customer One')).toBeInTheDocument();
    expect(screen.getByText('admin.users.orders', { exact: false })).toBeInTheDocument();
    expect(h.rpc).toHaveBeenCalledWith('admin_user_directory', {
      p_search: null,
      p_filter: 'all',
      p_limit: 25,
      p_offset: 0,
    });
  });

  it('explains that the customer analytics RPC could not be resolved', async () => {
    h.rpc.mockResolvedValue({
      data: null,
      error: { code: 'PGRST202', message: 'Could not find function', details: 'Searched for public.admin_user_directory in schema cache' },
    });
    render(<AdminUsers />);
    expect(await screen.findByRole('alert')).toHaveTextContent(/Supabase could not resolve the customer analytics RPC/);
    expect(screen.getByRole('alert').textContent).toMatch(/schema cache/i);
    expect(screen.getByRole('alert').textContent).not.toMatch(/are not installed/i);
  });

  it('sends the active filter and keeps pagination bounded', async () => {
    h.rpc.mockResolvedValue({ data: directory(26), error: null });
    render(<AdminUsers />);
    await screen.findByText('customer@example.com');
    fireEvent.click(screen.getByRole('tab', { name: 'admin.users.filterActive' }));
    await waitFor(() => expect(h.rpc).toHaveBeenLastCalledWith('admin_user_directory', {
      p_search: null,
      p_filter: 'active',
      p_limit: 25,
      p_offset: 0,
    }));
    await waitFor(() => expect(screen.getByRole('button', { name: 'admin.users.next' })).toBeEnabled());
    fireEvent.click(screen.getByRole('button', { name: 'admin.users.next' }));
    await waitFor(() => expect(h.rpc).toHaveBeenLastCalledWith('admin_user_directory', {
      p_search: null,
      p_filter: 'active',
      p_limit: 25,
      p_offset: 25,
    }));
  });
});
