import { render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const h = vi.hoisted(() => ({ summary: vi.fn(), orders: vi.fn() }));
vi.mock('@/lib/supabase', () => ({
  supabase: {
    rpc: h.summary,
    from: () => ({ select: () => ({ in: () => ({ order: () => ({ limit: h.orders }) }) }) }),
    channel: () => ({ on: () => ({ subscribe: () => ({}) }) }),
    removeChannel: vi.fn(async () => undefined),
  },
}));
vi.mock('@/context/AuthContext', () => ({ useAuth: () => ({ email: 'admin@example.com' }) }));
vi.mock('@/context/LanguageContext', () => ({
  useLanguage: () => ({ locale: 'en', t: (key: string, params?: { name?: string }) => {
    if (key === 'admin.greeting') return `Welcome ${params?.name}`;
    if (key === 'admin.analyticsMigrationRequired') return 'Supabase could not resolve the dashboard analytics RPC. Migration 0008 may be missing, or the API schema cache may be stale. Verify the database objects; if they exist, run NOTIFY pgrst, \'reload schema\' in the SQL Editor.';
    return key;
  } }),
}));
vi.mock('@/hooks/useHotelSettings', () => ({ useHotelSettings: () => ({ data: null, retry: vi.fn() }) }));
import AdminDashboard from '@/pages/admin/AdminDashboard';

beforeEach(() => {
  h.summary.mockReset().mockResolvedValue({
    data: null,
    error: { code: 'PGRST202', message: 'Could not find function', details: 'Searched for public.admin_dashboard_summary in schema cache' },
  });
  h.orders.mockReset().mockResolvedValue({ data: [], error: null });
});

describe('Admin dashboard analytics RPC', () => {
  it('explains that the analytics RPC is unresolved without hiding the orders dashboard', async () => {
    render(<MemoryRouter><AdminDashboard /></MemoryRouter>);
    expect(await screen.findByRole('alert')).toHaveTextContent(/Supabase could not resolve the dashboard analytics RPC/);
    expect(screen.getByRole('alert').textContent).toMatch(/schema cache/i);
    expect(screen.getByRole('alert').textContent).not.toMatch(/are not installed/i);
    expect(screen.getByRole('heading', { name: 'admin.orderOverview' })).toBeInTheDocument();
    await waitFor(() => expect(h.orders).toHaveBeenCalled());
  });
});
