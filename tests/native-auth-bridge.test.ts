import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  checkGoogleIdToken,
  isNativeGoogleBridgeAvailable,
  KV_BRIDGE_NAME,
  requestNativeGoogleSignIn,
  WEB_CLIENT_AUDIENCE,
} from '@/lib/nativeAuthBridge';

/** Unpadded base64url encode (browser-safe: builds off btoa/UTF-8). */
function b64url(input: string): string {
  const bytes = new TextEncoder().encode(input);
  let binary = '';
  bytes.forEach((b) => {
    binary += String.fromCharCode(b);
  });
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

interface FakeBridgeEventTarget {
  postMessage: ReturnType<typeof vi.fn>;
  addEventListener: ReturnType<typeof vi.fn>;
  removeEventListener: ReturnType<typeof vi.fn>;
  emit: (data: unknown) => void;
}

let captured: FakeBridgeEventTarget | null = null;

function installBridge(): FakeBridgeEventTarget {
  const listeners = new Set<(event: { data: unknown }) => void>();
  let listener: ((event: { data: unknown }) => void) | null = null;
  const addEventListener = vi.fn((_: 'message', fn: (event: { data: unknown }) => void) => {
    listener = fn;
    listeners.add(fn);
  });
  const removeEventListener = vi.fn((_: 'message', fn: (event: { data: unknown }) => void) => {
    listeners.delete(fn);
  });
  const bridge = {
    postMessage: vi.fn(),
    addEventListener,
    removeEventListener,
    emit: (data: unknown) => {
      for (const fn of [...listeners]) fn({ data });
    },
  };
  (window as unknown as Record<string, unknown>)[KV_BRIDGE_NAME] = bridge;
  captured = bridge as FakeBridgeEventTarget;
  captured.emit = bridge.emit;
  void listener;
  return captured;
}

const RESULT = 'kv-google-signin-result';
const REQUEST = 'kv-google-signin';

function makeToken(payload: Record<string, unknown>): string {
  return `${b64url('{"alg":"RS256","typ":"JWT"}')}.${b64url(JSON.stringify(payload))}.${b64url('sig')}`;
}

const VALID_PAYLOAD: Record<string, unknown> = {
  iss: 'https://accounts.google.com',
  aud: WEB_CLIENT_AUDIENCE,
  email: 'tester@example.com',
  email_verified: true,
  iat: 1893456000,
  exp: 1893542400, // 2030-01-02 — fixtures must stay valid for years
};

describe('native google bridge availability', () => {
  afterEach(() => {
    delete (window as unknown as Record<string, unknown>)[KV_BRIDGE_NAME];
    captured = null;
  });

  it('is unavailable without the injected object', () => {
    expect(isNativeGoogleBridgeAvailable()).toBe(false);
  });

  it('rejects objects with the wrong shape (never a plain @JavascriptInterface)', () => {
    (window as unknown as Record<string, unknown>)[KV_BRIDGE_NAME] = { foo: 'bar' };
    expect(isNativeGoogleBridgeAvailable()).toBe(false);
    (window as unknown as Record<string, unknown>)[KV_BRIDGE_NAME] = 'not-an-object';
    expect(isNativeGoogleBridgeAvailable()).toBe(false);
  });
});

describe('requestNativeGoogleSignIn ↔ app handshake', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    installBridge();
  });
  afterEach(() => {
    vi.useRealTimers();
    delete (window as unknown as Record<string, unknown>)[KV_BRIDGE_NAME];
    captured = null;
  });

  it('sends the protocol request and resolves ok with a claim-checked token', async () => {
    const pending = requestNativeGoogleSignIn();
    expect(captured?.postMessage).toHaveBeenCalledTimes(1);
    expect(JSON.parse(captured?.postMessage.mock.calls[0]?.[0] as string)).toEqual({
      type: REQUEST,
      v: 1,
    });
    captured?.emit(JSON.stringify({ type: RESULT, v: 1, status: 'ok', token: makeToken(VALID_PAYLOAD) }));
    await expect(pending).resolves.toEqual({ status: 'ok', token: makeToken(VALID_PAYLOAD) });
  });

  it('ignores unrelated channel traffic before the result', async () => {
    const pending = requestNativeGoogleSignIn();
    captured?.emit(JSON.stringify({ type: 'unrelated', status: 'ok' }));
    captured?.emit(JSON.stringify({ type: RESULT, v: 1, status: 'ok', token: makeToken(VALID_PAYLOAD) }));
    await expect(pending).resolves.toMatchObject({ status: 'ok' });
  });

  it.each([
    ['cancelled', 'cancelled'],
    ['no-credentials', 'no-credentials'],
    ['failed', 'failed'],
    ['busy', 'busy'],
    ['timeout', 'timeout'],
  ] as const)('passes app status "%s" through unchanged', async (appStatus, expected) => {
    const pending = requestNativeGoogleSignIn();
    captured?.emit(JSON.stringify({ type: RESULT, v: 1, status: appStatus }));
    const resolved = await pending;
    expect(resolved.status).toBe(expected);
    if (appStatus === 'cancelled') expect(resolved.token).toBeUndefined();
  });

  it('degrades unknown statuses to failed instead of hanging', async () => {
    const pending = requestNativeGoogleSignIn();
    captured?.emit(JSON.stringify({ type: RESULT, v: 1, status: 'some-future-status' }));
    await expect(pending).resolves.toMatchObject({ status: 'failed' });
  });

  it('rejects a token with a foreign audience (invalid-token)', async () => {
    const pending = requestNativeGoogleSignIn();
    captured?.emit(JSON.stringify({
      type: RESULT,
      v: 1,
      status: 'ok',
      token: makeToken({ ...VALID_PAYLOAD, aud: 'other-client.apps.googleusercontent.com' }),
    }));
    await expect(pending).resolves.toMatchObject({ status: 'invalid-token' });
  });

  it('rejects an ok reply with no usable token', async () => {
    const pending = requestNativeGoogleSignIn();
    captured?.emit(JSON.stringify({ type: RESULT, v: 1, status: 'ok' }));
    await expect(pending).resolves.toMatchObject({ status: 'invalid-token' });
  });

  it('times out when the app never replies', async () => {
    const pending = requestNativeGoogleSignIn();
    const assertion = expect(pending).resolves.toMatchObject({ status: 'timeout' });
    await vi.advanceTimersByTimeAsync(121_000);
    await assertion;
  });

  it('stops listening after the first result (no double delivery)', async () => {
    const pending = requestNativeGoogleSignIn();
    captured?.emit(JSON.stringify({ type: RESULT, v: 1, status: 'cancelled' }));
    await pending;
    expect(captured?.removeEventListener).toHaveBeenCalled();
    captured?.emit(JSON.stringify({ type: RESULT, v: 1, status: 'ok', token: makeToken(VALID_PAYLOAD) }));
    // No unhandled rejection problem and the first (cancelled) result stands.
  });
});

describe('checkGoogleIdToken claim checks', () => {
  const NOW = 1767225600;

  it('accepts a well-formed Google ID token', () => {
    expect(checkGoogleIdToken(makeToken(VALID_PAYLOAD), NOW)).toEqual({ email: 'tester@example.com' });
  });

  it('rejects wrong issuer, audience, expiry and unverified email', () => {
    const aud = { ...VALID_PAYLOAD, aud: 'other.apps.googleusercontent.com' };
    expect(checkGoogleIdToken(makeToken(aud), NOW)).toBeNull();
    const iss = { ...VALID_PAYLOAD, iss: 'https://evil.example' };
    expect(checkGoogleIdToken(makeToken(iss), NOW)).toBeNull();
    const expired = { ...VALID_PAYLOAD, exp: NOW - 1 };
    expect(checkGoogleIdToken(makeToken(expired), NOW)).toBeNull();
    const unverified = { ...VALID_PAYLOAD, email_verified: false };
    expect(checkGoogleIdToken(makeToken(unverified), NOW)).toBeNull();
  });

  it('rejects malformed tokens', () => {
    expect(checkGoogleIdToken('nope')).toBeNull();
    expect(checkGoogleIdToken('a.b')).toBeNull();
    expect(checkGoogleIdToken('!!!.%%%.$$$', NOW)).toBeNull();
  });
});
