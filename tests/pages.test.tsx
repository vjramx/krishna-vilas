import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { User } from 'firebase/auth';

// Mutable holder so each test can set the shared auth state the pages read.
const h = vi.hoisted(() => ({
  state: {
    session: null as User | null,
    userId: null as string | null,
    email: null as string | null,
    role: 'anon' as 'anon' | 'customer' | 'admin' | 'agent',
    roleError: null as string | null,
    refreshRole: vi.fn(async () => undefined),
    loading: true,
    redirectError: null as string | null,
    signOut: vi.fn(async () => undefined),
  },
}));

const fakeUser = {
  uid: 'u123456',
  email: 'tester@example.com',
  displayName: 'Tester',
  photoURL: 'https://example.com/a.png',
  getIdToken: async () => 'not-a-real-token',
} as unknown as User;

vi.mock('@/lib/firebase', () => ({
  firebaseAuth: { fake: true },
  googleProvider: {},
  startGoogleSignIn: vi.fn(),
  usesRedirectFlow: false,
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
import LoginPage from '@/pages/LoginPage';
import { startGoogleSignIn } from '@/lib/firebase';

function resetState(overrides: Partial<typeof h.state> = {}) {
  h.state = { ...h.state, session: null, userId: null, email: null, role: 'anon', roleError: null, refreshRole: vi.fn(async () => undefined), loading: true, redirectError: null, ...overrides };
}

function PageRoutes(entry = '/') {
  return (
    <MemoryRouter initialEntries={[entry]}>
      <Routes>
        <Route path="/" element={<AccountPage />} />
        <Route path="/login" element={<LoginPage />} />
        <Route path="/account" element={<p data-testid="at-account">authenticated-page</p>} />
        <Route path="/checkout" element={<p data-testid="at-checkout">checkout-page</p>} />
        <Route path="/admin" element={<p data-testid="at-admin">admin-page</p>} />
      </Routes>
    </MemoryRouter>
  );
}

beforeEach(() => {
  resetState();
});

describe('AccountPage gating', () => {
  it('shows the spinner while Firebase is resolving — never the signed-out UI prematurely', () => {
    render(PageRoutes());
    expect(screen.getByRole('status')).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'common.signIn' })).toBeNull();
  });

  it('signed-out user sees the sign-in option', async () => {
    resetState({ loading: false });
    render(PageRoutes());
    await screen.findByRole('link', { name: 'common.signIn' });
    expect(screen.getByText('account.guestTitle')).toBeInTheDocument();
  });

  it('authenticated user sees their profile, My Orders and Sign out', async () => {
    resetState({ loading: false, session: fakeUser, userId: 'u123456', email: 'tester@example.com', role: 'customer' });
    render(PageRoutes());
    await screen.findByText('tester@example.com');
    expect(screen.getByRole('link', { name: /nav\.orders/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'account.editProfile' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'common.signOut' })).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'common.signIn' })).toBeNull();
  });
});

describe('LoginPage sign-in errors', () => {
  it('shows a useful error for popup-blocked rather than silently dismissing it', async () => {
    vi.mocked(startGoogleSignIn).mockRejectedValueOnce(Object.assign(new Error('Popup blocked'), { code: 'auth/popup-blocked' }));
    resetState({ loading: false });
    render(PageRoutes('/login'));
    fireEvent.click(screen.getByRole('button', { name: 'login.google' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('login.popupBlocked');
    expect(screen.getByRole('button', { name: 'login.google' })).toBeEnabled();
  });

  it('does not show an error when the user closes the Google chooser', async () => {
    vi.mocked(startGoogleSignIn).mockRejectedValueOnce(Object.assign(new Error('Popup closed'), { code: 'auth/popup-closed-by-user' }));
    resetState({ loading: false });
    render(PageRoutes('/login'));
    fireEvent.click(screen.getByRole('button', { name: 'login.google' }));
    await waitFor(() => expect(screen.getByRole('button', { name: 'login.google' })).toBeEnabled());
    expect(screen.queryByRole('alert')).toBeNull();
  });
});

describe('LoginPage transition', () => {
  it('returns to checkout after sign-in when requested', async () => {
    const { rerender } = render(PageRoutes('/login?next=%2Fcheckout'));
    expect(screen.queryByTestId('at-checkout')).toBeNull();
    resetState({ loading: false, session: fakeUser, role: 'customer' });
    rerender(PageRoutes('/login?next=%2Fcheckout'));
    await screen.findByTestId('at-checkout');
  });

  it('ignores external return URLs', async () => {
    resetState({ loading: false, session: fakeUser, role: 'customer' });
    render(PageRoutes('/login?next=https%3A%2F%2Fevil.example'));
    await screen.findByTestId('at-account');
  });
  it('navigates to /account only after a verified Firebase user exists', async () => {
    const { rerender } = render(PageRoutes('/login'));
    expect(screen.getByRole('button', { name: 'login.google' })).toBeInTheDocument();
    expect(screen.queryByTestId('at-account')).toBeNull();

    // Session confirmed by the auth observer — the page must move on to Account.
    resetState({ loading: false, session: fakeUser, userId: 'u123456', email: 'tester@example.com', role: 'customer' });
    rerender(PageRoutes('/login'));
    await waitFor(() => expect(screen.getByTestId('at-account')).toBeInTheDocument());
  });

  it('routes a signed-in admin to the admin dashboard, not Account', async () => {
    const { rerender } = render(PageRoutes('/login'));
    expect(screen.queryByTestId('at-admin')).toBeNull();

    resetState({ loading: false, session: fakeUser, userId: 'u123456', email: 'tester@example.com', role: 'admin' });
    rerender(PageRoutes('/login'));
    await waitFor(() => expect(screen.getByTestId('at-admin')).toBeInTheDocument());
  });});

describe('Role-resolution failure states (backend refused the session)', () => {
  it('AccountPage shows a friendly failure with a Retry instead of raw internals', () => {
    resetState({
      loading: false,
      session: fakeUser,
      userId: 'u123456',
      email: 'tester@example.com',
      role: 'customer',
      roleError: 'No suitable key or wrong key type',
    });
    render(PageRoutes('/'));
    expect(screen.getByTestId('account-role-failed')).toHaveTextContent('login.roleCheckFailed');
    // Raw internals never appear inside the friendly block.
    expect(
      within(screen.getByTestId('account-role-failed')).queryByText(/No suitable key/),
    ).toBeNull();
    // No [dbg] diagnostics leak in any build — internal codes stay internal.
    expect(document.body.textContent).not.toMatch(/\[dbg\]/);
  });

  it('LoginPage with a failed role check falls through to the Account route', async () => {
    resetState({
      loading: false,
      session: fakeUser,
      userId: 'u123456',
      email: 'tester@example.com',
      role: 'customer',
      roleError: 'No suitable key or wrong key type',
    });
    render(PageRoutes('/login'));

    // The unresolved session falls through to its customer default — the
    // durable failure state (friendly text + Retry) lives on the Account page.
    await waitFor(() => expect(screen.getByTestId('at-account')).toBeInTheDocument());
  });

  it('AccountPage offers a Retry that re-runs role resolution', () => {
    const refreshRole = vi.fn(async () => undefined);
    resetState({
      loading: false,
      session: fakeUser,
      userId: 'u123456',
      email: 'tester@example.com',
      role: 'customer',
      roleError: 'No suitable key or wrong key type',
      refreshRole,
    });
    render(PageRoutes('/'));
    expect(screen.getByTestId('account-role-failed')).toHaveTextContent('login.roleCheckFailed');

    fireEvent.click(screen.getByRole('button', { name: 'login.retryRoleCheck' }));
    expect(refreshRole).toHaveBeenCalledTimes(1);
  });

  it('a signed-in admin with a clean role check still routes to /admin (no false denials)', () => {
    resetState({ loading: false, session: fakeUser, userId: 'u123456', email: 'tester@example.com', role: 'admin', roleError: null });
    render(PageRoutes('/login'));
    expect(screen.queryByTestId('role-check-failed')).toBeNull();
  });
});
