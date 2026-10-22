import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { User } from 'firebase/auth';

// Mutable holder so each test can set the shared auth state the page reads.
const h = vi.hoisted(() => ({
  state: {
    session: null as User | null,
    userId: null as string | null,
    email: 'cust@example.com' as string | null,
    role: 'customer' as 'anon' | 'customer' | 'admin' | 'agent',
    roleError: null as string | null,
    refreshRole: vi.fn(async () => undefined),
    loading: false,
    redirectError: null as string | null,
    signOut: vi.fn(async () => undefined),
  },
  requestAccountDeletion: vi.fn(),
}));

const fakeUser = {
  uid: 'u123456',
  email: 'cust@example.com',
  displayName: 'Cust',
  photoURL: null,
  getIdToken: async () => 'not-a-real-token',
} as unknown as User;

vi.mock('@/lib/firebase', () => ({
  firebaseAuth: { fake: true },
  googleProvider: {},
  startGoogleSignIn: vi.fn(),
  usesRedirectFlow: false,
  currentFirebaseUser: vi.fn(() => fakeUser),
}));

vi.mock('@/lib/googleReauth', () => ({
  reauthenticateWithGoogle: vi.fn(() => vi.fn(async () => undefined)),
}));

vi.mock('@/lib/accountDeletion', () => ({
  requestAccountDeletion: h.requestAccountDeletion,
  mapDeletionError: vi.fn(),
  clearLocalDataAfterDeletion: vi.fn(),
}));

vi.mock('@/lib/supabase', () => ({
  supabase: {
    from: vi.fn(() => ({
      select: () => ({
        eq: () => ({
          maybeSingle: () => Promise.resolve({ data: null }),
        }),
      }),
    })),
  },
  supabaseUrl: 'https://fake.supabase.co',
  supabaseAnonKey: 'anon',
  supabaseConfigured: true,
  publicImageUrl: vi.fn(() => null),
}));

vi.mock('@/context/AuthContext', () => ({
  useAuth: () => h.state,
}));

vi.mock('@/context/LanguageContext', () => ({
  useLanguage: () => ({
    t: (k: string) => k, // keys as text keeps assertions unambiguous
    lang: 'en',
    setLang: vi.fn(),
  }),
  LanguageProvider: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

vi.mock('@/hooks/useHotelSettings', () => ({
  useHotelSettings: () => ({ data: null }),
}));

vi.mock('@/components/nav', () => ({
  TopBackBar: () => <header>bar</header>,
  BottomNav: () => <nav>bottomnav</nav>,
}));

import AccountPage from '@/pages/AccountPage';
import { clearLocalDataAfterDeletion } from '@/lib/accountDeletion';

function resetState(overrides: Partial<typeof h.state> = {}) {
  h.state = { ...h.state, session: null, userId: null, email: null, role: 'anon', roleError: null, refreshRole: vi.fn(async () => undefined), loading: false, redirectError: null, ...overrides };
  h.requestAccountDeletion.mockReset();
  h.state.signOut.mockClear();
  (clearLocalDataAfterDeletion as ReturnType<typeof vi.fn>).mockClear();
}

function renderAccount() {
  return render(
    <MemoryRouter initialEntries={['/account']}>
      <AccountPage />
    </MemoryRouter>,
  );
}

beforeEach(() => {
  resetState({
    session: fakeUser,
    userId: 'u123456',
    email: 'cust@example.com',
    role: 'customer',
  });
});

describe('account deletion flow', () => {
  it('signs-in-step only: nothing happens until the entry option is tapped explicitly', async () => {
    renderAccount();
    expect(h.requestAccountDeletion).not.toHaveBeenCalled();
  });

  it('opening the entry only shows the confirmation; cancel changes nothing', async () => {
    renderAccount();
    fireEvent.click(screen.getByTestId('delete-account-entry'));
    expect(await screen.findByTestId('delete-confirm')).toBeInTheDocument();
    // cancel on the warning sheet
    fireEvent.click(screen.getByText('common.cancel'));
    await waitFor(() => expect(screen.queryByTestId('delete-confirm')).not.toBeInTheDocument());
    expect(h.requestAccountDeletion).not.toHaveBeenCalled();
  });

  it('typing anything other than DELETE does not enable the final button', async () => {
    renderAccount();
    fireEvent.click(screen.getByTestId('delete-account-entry'));
    await screen.findByTestId('delete-confirm');
    fireEvent.click(screen.getByText('delete.continue'));
    fireEvent.click(screen.getByTestId('delete-understood'));
    fireEvent.change(screen.getByTestId('delete-confirm-input'), { target: { value: 'delete' } });
    expect(screen.getByTestId('delete-final')).toBeDisabled();
    expect(h.requestAccountDeletion).not.toHaveBeenCalled();
  });

  it('checkbox + DELETE + confirm runs deletion, then clears local data and signs out on Done', async () => {
    h.requestAccountDeletion.mockResolvedValue({ ok: true, messageKey: 'delete.success' });
    renderAccount();
    fireEvent.click(screen.getByTestId('delete-account-entry'));
    await screen.findByTestId('delete-confirm');
    fireEvent.click(screen.getByText('delete.continue'));
    fireEvent.click(screen.getByTestId('delete-understood'));
    fireEvent.change(screen.getByTestId('delete-confirm-input'), { target: { value: 'DELETE' } });
    expect(screen.getByTestId('delete-final')).toBeEnabled();
    fireEvent.click(screen.getByTestId('delete-final'));

    await screen.findByTestId('delete-success');
    expect(h.requestAccountDeletion).toHaveBeenCalledTimes(1);
    expect(clearLocalDataAfterDeletion).not.toHaveBeenCalled(); // only on Done

    // abandon instead of confirming Done — no data cleared yet (u-turn safe)
    fireEvent.click(screen.getByTestId('delete-done'));
    await waitFor(() => expect(clearLocalDataAfterDeletion).toHaveBeenCalled());
    await waitFor(() => expect(h.state.signOut).toHaveBeenCalled());
  });

  it('pending-orders server reply surfaces the friendly error and the account is untouched', async () => {
    h.requestAccountDeletion.mockResolvedValue({ ok: false, messageKey: 'delete.pendingOrders', detail: '1' });
    renderAccount();
    fireEvent.click(screen.getByTestId('delete-account-entry'));
    await screen.findByTestId('delete-confirm');
    fireEvent.click(screen.getByText('delete.continue'));
    fireEvent.click(screen.getByTestId('delete-understood'));
    fireEvent.change(screen.getByTestId('delete-confirm-input'), { target: { value: 'DELETE' } });
    fireEvent.click(screen.getByTestId('delete-final'));

    const alertBox = await screen.findByTestId('delete-error');
    expect(alertBox).toHaveTextContent('delete.pendingOrders');
    expect(h.state.signOut).not.toHaveBeenCalled();
    expect(clearLocalDataAfterDeletion).not.toHaveBeenCalled();
  });

  it('reauthentication failure (rejected promise) shows the retry state, no deletion', async () => {
    h.requestAccountDeletion.mockRejectedValue(new Error('reauth dismissed'));
    renderAccount();
    fireEvent.click(screen.getByTestId('delete-account-entry'));
    await screen.findByTestId('delete-confirm');
    fireEvent.click(screen.getByText('delete.continue'));
    fireEvent.click(screen.getByTestId('delete-understood'));
    fireEvent.change(screen.getByTestId('delete-confirm-input'), { target: { value: 'DELETE' } });
    fireEvent.click(screen.getByTestId('delete-final'));

    const alertBox = await screen.findByTestId('delete-error');
    expect(alertBox).toHaveTextContent('delete.reauthFailed');
    expect(h.state.signOut).not.toHaveBeenCalled();
  });

  it('is hidden for staff roles — admin keeps the active session untouched', () => {
    resetState({
      session: fakeUser,
      userId: 'u123456',
      email: 'admin@example.com',
      role: 'admin',
    });
    renderAccount();
    expect(screen.queryByTestId('delete-account-entry')).not.toBeInTheDocument();
  });
});
