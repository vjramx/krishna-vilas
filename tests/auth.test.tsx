import { act, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { User } from 'firebase/auth';

// AuthContext-driven lifecycle, made deterministic via mocks. Module-scope
// holders let tests emit Firebase auth events like the real SDK does.
type Listener = (u: User | null) => void;
let listeners: Listener[] = [];
let snapshot: User | null = null;
let redirectError: unknown = null;

vi.mock('@/lib/firebase', () => ({
  firebaseAuth: { fake: true },
  startGoogleSignIn: vi.fn(),
  isCancelledAuth: vi.fn(),
  usesRedirectFlow: false,
}));

vi.mock('@/lib/supabase', () => ({
  supabase: {
    rpc: vi.fn(async () => ({ data: false })),
  },
}));

vi.mock('firebase/auth', async (importOriginal) => {
  void importOriginal;
  return {
    onAuthStateChanged: (_auth: unknown, cb: Listener) => {
      listeners.push(cb);
      // The SDK notifies asynchronously with the restored user.
      Promise.resolve().then(() => cb(snapshot));
      return () => {
        listeners = listeners.filter((l) => l !== cb);
      };
    },
    getRedirectResult: vi.fn(() =>
      redirectError !== null ? Promise.reject(redirectError) : Promise.resolve({ user: null }),
    ),
    signOut: vi.fn(async () => {
      snapshot = null;
    }),
    setPersistence: vi.fn(async () => undefined),
  };
});

import { AuthProvider, useAuth } from '@/context/AuthContext';

const fakeUser = {
  uid: 'u123456',
  email: 'tester@example.com',
  displayName: 'Tester',
  photoURL: null,
  getIdToken: async () => 'not-a-real-token',
} as unknown as User;

function emit(next: User | null) {
  for (const l of [...listeners]) l(next);
}

function Probe() {
  const { session, userId, email, role, loading, redirectError: rerr } = useAuth();
  return (
    <div
      data-testid="probe"
      data-loading={String(loading)}
      data-user={userId ?? ''}
      data-email={email ?? ''}
      data-role={role}
      data-redirect={rerr ?? ''}
    >
      {session ? 'signed-in' : 'signed-out'}
    </div>
  );
}

beforeEach(() => {
  listeners = [];
  snapshot = null;
  redirectError = null;
});

describe('AuthContext lifecycle', () => {
  it('keeps loading=true until Firebase reports the initial state, then unauthenticated', async () => {
    render(
      <AuthProvider>
        <Probe />
      </AuthProvider>,
    );
    const probe = screen.getByTestId('probe');
    expect(probe.dataset.loading).toBe('true');
    expect(probe.textContent).toContain('signed-out');
    await waitFor(() => expect(probe.dataset.loading).toBe('false'));
    expect(probe.dataset.user).toBe('');
    expect(probe.dataset.role).toBe('anon');
  });

  it('adopts a signed-in Firebase user and resolves role from the backend', async () => {
    snapshot = fakeUser;
    render(
      <AuthProvider>
        <Probe />
      </AuthProvider>,
    );
    const probe = await waitFor(() => {
      const p = screen.getByTestId('probe');
      expect(p.dataset.loading).toBe('false');
      return p;
    });
    expect(probe.textContent).toContain('signed-in');
    expect(probe.dataset.user).toBe('u123456');
    expect(probe.dataset.email).toBe('tester@example.com');
    expect(probe.dataset.role).toBe('customer');
  });

  it('signs out: user and role reset, observer stays connected', async () => {
    snapshot = fakeUser;
    const { unmount } = render(
      <AuthProvider>
        <Probe />
      </AuthProvider>,
    );
    const probe = await waitFor(() => {
      const p = screen.getByTestId('probe');
      expect(p.textContent).toContain('signed-in');
      return p;
    });

    await act(async () => {
      snapshot = null;
      emit(null);
    });
    expect(probe.textContent).toContain('signed-out');
    expect(probe.dataset.user).toBe('');
    expect(probe.dataset.role).toBe('anon');
    expect(listeners).toHaveLength(1);
    unmount();
  });

  it('surfaces a failed redirect as redirectError with the Firebase code', async () => {
    redirectError = Object.assign(new Error('Unauthorized domain'), { code: 'auth/unauthorized-domain' });
    render(
      <AuthProvider>
        <Probe />
      </AuthProvider>,
    );
    const probe = screen.getByTestId('probe');
    await waitFor(() => expect(probe.dataset.redirect).toBe('auth/unauthorized-domain'));
    expect(probe.dataset.loading).toBe('false');
    expect(probe.textContent).toContain('signed-out');
  });
});
