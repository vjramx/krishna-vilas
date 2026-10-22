import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Proves the routing contract of startGoogleSignIn():
 *  - native bridge present → Credential Manager token → signInWithCredential,
 *    and popup/redirect are NEVER touched (Chrome never gets involved);
 *  - bridge outcomes map to the right error codes (cancelled stays silent in
 *    the UI, no-credentials gets its actionable message, others generic);
 *  - bridge absent → the previous popup/redirect behaviour, unchanged.
 */

const bridge = vi.hoisted(() => ({
  available: false,
  result: { status: 'failed' as string, token: undefined as string | undefined },
}));

const firebase = vi.hoisted(() => ({
  signInWithCredential: vi.fn(async () => undefined),
  signInWithPopup: vi.fn(async () => undefined),
  signInWithRedirect: vi.fn(async () => undefined),
  credential: vi.fn((token: string) => ({ token })),
}));

const flow = vi.hoisted(() => ({ calls: [] as boolean[] }));

vi.mock('firebase/auth', () => {
  class GoogleAuthProvider {
    static credential = firebase.credential;
  }
  return {
    initializeApp: vi.fn(() => ({ name: 'test' })),
    getAuth: vi.fn(() => ({ fake: true })),
    setPersistence: vi.fn(() => Promise.resolve()),
    browserLocalPersistence: 'local',
    GoogleAuthProvider,
    signInWithCredential: firebase.signInWithCredential,
    signInWithPopup: firebase.signInWithPopup,
    signInWithRedirect: firebase.signInWithRedirect,
  };
});

vi.mock('@/lib/googleSignInFlow', () => ({
  runGoogleSignInFlow: vi.fn(async ({ useRedirect }: { useRedirect: boolean }) => {
    flow.calls.push(useRedirect);
  }),
}));

vi.mock('@/lib/nativeAuthBridge', () => ({
  isNativeGoogleBridgeAvailable: () => bridge.available,
  requestNativeGoogleSignIn: vi.fn(async () => bridge.result),
}));

const { startGoogleSignIn } = await import('@/lib/firebase');

beforeEach(() => {
  bridge.available = false;
  bridge.result = { status: 'failed', token: undefined };
  flow.calls.length = 0;
  firebase.signInWithCredential.mockClear();
  firebase.signInWithPopup.mockClear();
  firebase.signInWithRedirect.mockClear();
  firebase.credential.mockClear();
});

describe('startGoogleSignIn routing', () => {
  it('uses the native bridge when available and never pops up or redirects', async () => {
    bridge.available = true;
    bridge.result = { status: 'ok', token: 'header.payload.sig' };
    await startGoogleSignIn();
    expect(firebase.signInWithCredential).toHaveBeenCalledTimes(1);
    expect(firebase.credential).toHaveBeenCalledWith('header.payload.sig');
    expect(firebase.signInWithPopup).not.toHaveBeenCalled();
    expect(firebase.signInWithRedirect).not.toHaveBeenCalled();
    expect(flow.calls).toEqual([]); // runGoogleSignInFlow untouched
  });

  it('maps native cancellation to a cancelled auth error (silent in UI)', async () => {
    bridge.available = true;
    bridge.result = { status: 'cancelled', token: undefined };
    await expect(startGoogleSignIn()).rejects.toMatchObject({ code: 'auth/user-cancelled' });
    expect(firebase.signInWithCredential).not.toHaveBeenCalled();
  });

  it('maps "no Google account on this device" to its own code', async () => {
    bridge.available = true;
    bridge.result = { status: 'no-credentials', token: undefined };
    await expect(startGoogleSignIn()).rejects.toMatchObject({ code: 'auth/no-google-account' });
  });

  it('maps native failures (failed/busy/timeout/invalid) to a generic code', async () => {
    bridge.available = true;
    for (const status of ['failed', 'busy', 'timeout', 'invalid-token']) {
      bridge.result = { status, token: undefined };
      await expect(startGoogleSignIn()).rejects.toMatchObject({ code: 'auth/native-bridge-failure' });
    }
    expect(firebase.signInWithCredential).not.toHaveBeenCalled();
  });

  it('falls back to the platform flow when no bridge is present', async () => {
    bridge.available = false;
    await startGoogleSignIn();
    expect(flow.calls).toEqual([false]); // desktop: popup
    expect(firebase.signInWithCredential).not.toHaveBeenCalled();
  });
});
