import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const h = vi.hoisted(() => ({
  rpc: vi.fn(),
  isSuper: true,
  admins: [] as unknown[],
  invitations: [] as unknown[],
  t: (key: string) => key,
  adminQueryError: null as { message: string } | null,
}));
vi.mock('@/lib/supabase', () => ({
  supabase: {
    rpc: h.rpc,
    from: (table: string) => ({
      select: () => ({
        order: () => Promise.resolve(table === 'admin_users' && h.adminQueryError
          ? { data: null, error: h.adminQueryError }
          : { data: table === 'admin_users' ? h.admins : h.invitations, error: null }),
      }),
    }),
  },
}));
vi.mock('@/context/LanguageContext', () => ({
  useLanguage: () => ({ lang: 'en', t: h.t }),
}));
import AdminAccess from '@/pages/admin/AdminAccess';

beforeEach(() => {
  h.isSuper = true;
  h.admins = [];
  h.invitations = [];
  h.adminQueryError = null;
  h.rpc.mockReset().mockImplementation((name: string, args?: { p_email?: string; p_role?: string }) => {
    if (name === 'staff_invite_admin' && args?.p_email && args.p_role) {
      h.invitations = [...h.invitations, {
        id: `invite-${h.invitations.length + 1}`,
        email: args.p_email,
        role: args.p_role,
        status: 'pending',
        invited_by: 'owner@example.com',
        created_at: '2026-10-01T00:00:00Z',
        expires_at: '2026-10-08T00:00:00Z',
        accepted_at: null,
      }];
    }
    return Promise.resolve({
      data: name === 'is_current_super_admin' ? h.isSuper : 'new-invitation-id',
      error: null,
    });
  });
});

describe('Admin access role lifecycle', () => {
  it('shows the Admin and Super Admin capability differences at the bottom of Access', async () => {
    render(<AdminAccess />);

    expect(await screen.findByRole('heading', { name: 'admin.access.roleDifferences' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'admin.access.roleAdmin' })).toBeInTheDocument();
    expect(screen.getByText('admin.access.roleAdminDetails')).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'admin.access.roleSuper' })).toBeInTheDocument();
    expect(screen.getByText('admin.access.roleSuperDetails')).toBeInTheDocument();
  });

  it('clearly explains that invitations are activated by Google sign-in with the matching email', async () => {
    render(<AdminAccess />);
    expect(await screen.findByRole('heading', { name: 'admin.access.inviteTitle' })).toBeInTheDocument();
    expect(screen.getAllByText('admin.access.inviteHint')).toHaveLength(2);
  });

  it('lets a Super Admin invite an ordinary Admin and sends the selected role to the backend', async () => {
    render(<AdminAccess />);
    await screen.findByRole('heading', { name: 'admin.access.inviteTitle' });

    fireEvent.change(screen.getByLabelText('admin.access.email'), { target: { value: '  new.admin@example.com  ' } });
    fireEvent.click(screen.getByRole('radio', { name: 'admin.access.roleAdmin' }));
    fireEvent.click(screen.getByRole('button', { name: 'admin.access.send' }));

    await waitFor(() => expect(h.rpc).toHaveBeenCalledWith('staff_invite_admin', {
      p_email: 'new.admin@example.com',
      p_role: 'admin',
    }));
    expect(await screen.findByRole('status')).toHaveTextContent('admin.access.invited');
    expect(await screen.findByText('new.admin@example.com')).toBeInTheDocument();
    expect(screen.getAllByText('admin.access.roleAdmin').length).toBeGreaterThan(0);
  });

  it('lets a Super Admin invite another Super Admin with the elevated role explicitly selected', async () => {
    render(<AdminAccess />);
    await screen.findByRole('heading', { name: 'admin.access.inviteTitle' });

    fireEvent.change(screen.getByLabelText('admin.access.email'), { target: { value: 'owner2@example.com' } });
    const superOption = screen.getByRole('radio', { name: 'admin.access.roleSuper' });
    fireEvent.click(superOption);
    expect(superOption).toHaveAttribute('aria-checked', 'true');
    fireEvent.click(screen.getByRole('button', { name: 'admin.access.send' }));

    await waitFor(() => expect(h.rpc).toHaveBeenCalledWith('staff_invite_admin', {
      p_email: 'owner2@example.com',
      p_role: 'super_admin',
    }));
    expect(await screen.findByRole('status')).toHaveTextContent('admin.access.invited');
    expect(await screen.findByText('owner2@example.com')).toBeInTheDocument();
    expect(screen.getAllByText('admin.access.roleSuper').length).toBeGreaterThan(0);
  });

  it('keeps an ordinary Admin read-only on Access and hides all management actions', async () => {
    h.isSuper = false;
    h.admins = [{ id: 'a1', email: 'admin@example.com', role: 'admin', created_at: '2026-10-01T00:00:00Z' }];
    h.invitations = [{ id: 'i1', email: 'next@example.com', role: 'admin', status: 'pending', invited_by: 'owner@example.com', created_at: '2026-10-01T00:00:00Z', expires_at: '2026-10-08T00:00:00Z', accepted_at: null }];
    render(<AdminAccess />);

    expect(await screen.findByRole('note')).toHaveTextContent('admin.access.viewOnly');
    expect(screen.queryByRole('heading', { name: 'admin.access.inviteTitle' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'admin.access.revoke' })).toBeNull();
    expect(screen.queryByRole('button', { name: /admin.access.remove/ })).toBeNull();
    expect(screen.getByRole('heading', { name: 'admin.access.roleAdmin' })).toBeInTheDocument();
  });

  it('allows ordinary admins to open Access in read-only mode when management queries are denied', async () => {
    h.isSuper = false;
    h.adminQueryError = { message: 'permission denied for table admin_users' };
    render(<AdminAccess />);

    expect(await screen.findByRole('note')).toHaveTextContent('admin.access.viewOnly');
    expect(screen.getByRole('heading', { name: 'admin.access.roleDifferences' })).toBeInTheDocument();
    expect(screen.getByRole('status')).toHaveTextContent('admin.access.noManagementAccess');
    expect(screen.queryByRole('heading', { name: 'admin.access.inviteTitle' })).toBeNull();
  });

  it('surfaces backend authorization errors and always releases the busy state', async () => {
    h.rpc.mockImplementation((name: string) => Promise.resolve(name === 'is_current_super_admin'
      ? { data: true, error: null }
      : { data: null, error: { message: 'NOT_SUPER_ADMIN' } }));
    render(<AdminAccess />);
    await screen.findByRole('heading', { name: 'admin.access.inviteTitle' });
    fireEvent.change(screen.getByLabelText('admin.access.email'), { target: { value: 'admin@example.com' } });
    fireEvent.click(screen.getByRole('button', { name: 'admin.access.send' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('admin.access.errNotSuper');
    await waitFor(() => expect(screen.getByRole('button', { name: 'admin.access.send' })).toBeEnabled());
  });
});
