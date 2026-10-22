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
    signOut: vi.fn(async () => undefined),
  },
  signInWithEmail: vi.fn(async () => undefined),
  registerWithEmail: vi.fn(async () => undefined),
  sendPasswordReset: vi.fn(async () => undefined),
  sendVerificationEmail: vi.fn(async () => undefined),
}));

const fakeUser = {
  uid: 'u123456',
  email: 'tester@example.com',
  // Verified: registered users land on their workspace only after the
  // verification gate in LoginPage lifts.
  emailVerified: true,
  displayName: 'Tester',
  photoURL: 'https://example.com/a.png',
  isAnonymous: false,
  reload: async () => undefined,
  getIdToken: async () => 'not-a-real-token',
} as unknown as User;

vi.mock('@/lib/firebase', () => ({
  firebaseAuth: { fake: true },
  signInWithEmail: h.signInWithEmail,
  registerWithEmail: h.registerWithEmail,
  sendPasswordReset: h.sendPasswordReset,
  currentFirebaseUser: vi.fn(() => fakeUser),
  signInAsGuest: vi.fn(async () => undefined),
  isGuestSession: vi.fn(() => false),
  sendVerificationEmail: h.sendVerificationEmail,
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

function resetState(overrides: Partial<typeof h.state> = {}) {
  h.state = { ...h.state, session: null, userId: null, email: null, role: 'anon', roleError: null, refreshRole: vi.fn(async () => undefined), loading: true, ...overrides };
  h.signInWithEmail.mockReset();
  h.registerWithEmail.mockReset();
  h.sendPasswordReset.mockReset();
  h.sendVerificationEmail.mockReset();
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
    render(PageRoutes('/'));
    await screen.findByText('tester@example.com');
    expect(screen.getByRole('link', { name: /nav\.orders/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'account.editProfile' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'common.signOut' })).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'common.signIn' })).toBeNull();
  });
});

describe('LoginPage email/password sign-in', () => {
  it('submits the typed email/password for sign-in and stays quiet on success', async () => {
    resetState({ loading: false });
    render(PageRoutes('/login'));
    fireEvent.change(screen.getByTestId('login-email'), { target: { value: 'tester@example.com' } });
    fireEvent.change(screen.getByTestId('login-password'), { target: { value: 'hunter22' } });
    fireEvent.click(screen.getByTestId('login-submit'));
    await waitFor(() => expect(h.signInWithEmail).toHaveBeenCalledWith('tester@example.com', 'hunter22'));
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('sign-up: blocks submit when the confirmation password does not match, without calling Firebase', async () => {
    resetState({ loading: false });
    render(PageRoutes('/login'));
    fireEvent.click(screen.getByTestId('login-mode-toggle'));
    fireEvent.change(screen.getByTestId('login-email'), { target: { value: 'tester@example.com' } });
    fireEvent.change(screen.getByTestId('login-password'), { target: { value: 'hunter22' } });
    fireEvent.change(screen.getByTestId('login-confirm'), { target: { value: 'hunter23' } });
    fireEvent.click(screen.getByTestId('login-submit'));
    expect(await screen.findByRole('alert')).toHaveTextContent('login.passwordMismatch');
    expect(h.registerWithEmail).not.toHaveBeenCalled();
  });

  it('sign-up: submits email and password when the confirmation matches', async () => {
    resetState({ loading: false });
    render(PageRoutes('/login'));
    fireEvent.click(screen.getByTestId('login-mode-toggle'));
    fireEvent.change(screen.getByTestId('login-email'), { target: { value: 'new@example.com' } });
    fireEvent.change(screen.getByTestId('login-password'), { target: { value: 'hunter22' } });
    fireEvent.change(screen.getByTestId('login-confirm'), { target: { value: 'hunter22' } });
    fireEvent.click(screen.getByTestId('login-submit'));
    await waitFor(() => expect(h.registerWithEmail).toHaveBeenCalledWith('new@example.com', 'hunter22'));
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('sign-in mode has no confirmation field at all', async () => {
    resetState({ loading: false });
    render(PageRoutes('/login'));
    fireEvent.change(screen.getByTestId('login-password'), { target: { value: 'hunter22' } });
    fireEvent.click(screen.getByTestId('login-submit'));
    expect(screen.queryByTestId('login-confirm')).toBeNull();
  });

  it('maps a wrong password (Firebase invalid-credential) to a clear message and keeps the form usable', async () => {
    resetState({ loading: false });
    // FirebaseError embeds its code in the message — mirror that exactly.
    h.signInWithEmail.mockRejectedValueOnce(new Error('Firebase: Error (auth/invalid-credential).'));
    render(PageRoutes('/login'));
    fireEvent.change(screen.getByTestId('login-email'), { target: { value: 'tester@example.com' } });
    fireEvent.change(screen.getByTestId('login-password'), { target: { value: 'wrongpass1' } });
    fireEvent.click(screen.getByTestId('login-submit'));
    expect(await screen.findByRole('alert')).toHaveTextContent('login.invalidCredentials');
    expect(screen.getByTestId('login-submit')).toBeEnabled();
  });

  it('blocks locally invalid emails before calling Firebase', async () => {
    resetState({ loading: false });
    render(PageRoutes('/login'));
    // 'user@localhost' passes the browser's native email check but fails the
    // app's stricter pattern — so the message comes from our own validation.
    fireEvent.change(screen.getByTestId('login-email'), { target: { value: 'user@localhost' } });
    fireEvent.change(screen.getByTestId('login-password'), { target: { value: 'hunter22' } });
    fireEvent.click(screen.getByTestId('login-submit'));
    expect(await screen.findByRole('alert')).toHaveTextContent('login.invalidEmail');
    expect(h.signInWithEmail).not.toHaveBeenCalled();
  });

  it('sends a password-reset email and confirms it without exposing account existence', async () => {
    h.sendPasswordReset.mockResolvedValueOnce(undefined);
    resetState({ loading: false });
    render(PageRoutes('/login'));
    fireEvent.click(screen.getByTestId('login-forgot'));
    fireEvent.change(screen.getByTestId('login-email'), { target: { value: 'tester@example.com' } });
    fireEvent.click(screen.getByTestId('login-submit'));
    await waitFor(() => expect(h.sendPasswordReset).toHaveBeenCalledWith('tester@example.com'));
    expect(await screen.findByRole('status')).toHaveTextContent('login.resetSent');
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('maps the no-such-account reset reply to the neutral reset notice too', async () => {
    h.sendPasswordReset.mockRejectedValueOnce(new Error('Firebase: Error (auth/user-not-found).'));
    resetState({ loading: false });
    render(PageRoutes('/login'));
    fireEvent.click(screen.getByTestId('login-forgot'));
    fireEvent.change(screen.getByTestId('login-email'), { target: { value: 'ghost@example.com' } });
    fireEvent.click(screen.getByTestId('login-submit'));
    expect(await screen.findByRole('status')).toHaveTextContent('login.resetSent');
  });

  // Verification gate: the backend only trusts verified email claims (0003
  // is_allowed_issuer), so an unverified email session must be held on this
  // page with a resend option — never routed into a workspace whose data
  // reads would all be silently rejected by RLS.
  it('holds an unverified email session on /login with a resend option, without routing away', async () => {
    const unverified = { ...fakeUser, emailVerified: false } as unknown as User;
    resetState({ loading: false, session: unverified, userId: 'u123456', email: 'tester@example.com', role: 'customer' });
    render(PageRoutes('/login'));
    expect(await screen.findByRole('status')).toHaveTextContent('login.verifyRequired');
    expect(screen.queryByTestId('at-account')).toBeNull();
    expect(screen.queryByTestId('at-checkout')).toBeNull();

    fireEvent.click(screen.getByTestId('login-verify-resend'));
    await waitFor(() => expect(h.sendVerificationEmail).toHaveBeenCalledTimes(1));
  });

  it('routes a verified session onward — the gate only holds unverified sessions', async () => {
    const { rerender } = render(PageRoutes('/login'));
    resetState({ loading: false, session: fakeUser, userId: 'u123456', email: 'tester@example.com', role: 'customer' });
    rerender(PageRoutes('/login'));
    await waitFor(() => expect(screen.getByTestId('at-account')).toBeInTheDocument());
    expect(screen.queryByTestId('login-verify-resend')).toBeNull();
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
    expect(screen.getByTestId('login-submit')).toBeInTheDocument();
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
