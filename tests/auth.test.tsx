import { act, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { User } from 'firebase/auth';

// AuthContext-driven lifecycle, made deterministic via mocks. Module-scope
// holders let tests emit Firebase auth events like the real SDK does.
type Listener = (u: User | null) => void;
let listeners: Listener[] = [];
let snapshot: User | null = null;

vi.mock('@/lib/firebase', () => ({
  firebaseAuth: { fake: true },
  signInWithEmail: vi.fn(),
  registerWithEmail: vi.fn(),
  sendPasswordReset: vi.fn(),
  currentFirebaseUser: vi.fn(() => null),
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
    signOut: vi.fn(async () => {
      snapshot = null;
    }),
    setPersistence: vi.fn(async () => undefined),
    browserLocalPersistence: 'local',
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
  const { session, userId, email, role, loading } = useAuth();
  return (
    <div
      data-testid="probe"
      data-loading={String(loading)}
      data-user={userId ?? ''}
      data-email={email ?? ''}
      data-role={role}
    >
      {session ? 'signed-in' : 'signed-out'}
    </div>
  );
}

beforeEach(() => {
  listeners = [];
  snapshot = null;
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

  it('restores the session after a page refresh (auth observer replays the stored user)', async () => {
    // Simulate a fresh page load where Firebase restores the persisted session.
    snapshot = fakeUser;
    render(
      <AuthProvider>
        <Probe />
      </AuthProvider>,
    );
    const probe = await waitFor(() => {
      const p = screen.getByTestId('probe');
      expect(p.textContent).toContain('signed-in');
      return p;
    });
    expect(probe.dataset.email).toBe('tester@example.com');
    expect(probe.dataset.role).toBe('customer');
  });
});
