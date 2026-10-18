import { describe, expect, it, vi } from 'vitest';
import { runGoogleSignInFlow } from '@/lib/googleSignInFlow';

describe('Google sign-in flow', () => {
  it('uses redirect directly in an embedded environment', async () => {
    const popup = vi.fn();
    const redirect = vi.fn().mockResolvedValue(undefined);
    await runGoogleSignInFlow({ useRedirect: true, popup, redirect });
    expect(redirect).toHaveBeenCalledOnce();
    expect(popup).not.toHaveBeenCalled();
  });

  it('uses popup in a normal browser when available', async () => {
    const popup = vi.fn().mockResolvedValue(undefined);
    const redirect = vi.fn();
    await runGoogleSignInFlow({ useRedirect: false, popup, redirect });
    expect(popup).toHaveBeenCalledOnce();
    expect(redirect).not.toHaveBeenCalled();
  });

  it.each(['auth/popup-blocked', 'auth/operation-not-supported-in-this-environment'])(
    'falls back to redirect for %s', async (code) => {
      const popup = vi.fn().mockRejectedValue(Object.assign(new Error('popup unavailable'), { code }));
      const redirect = vi.fn().mockResolvedValue(undefined);
      await runGoogleSignInFlow({ useRedirect: false, popup, redirect });
      expect(popup).toHaveBeenCalledOnce();
      expect(redirect).toHaveBeenCalledOnce();
    },
  );

  it('does not redirect after a user cancellation or unrelated failure', async () => {
    for (const code of ['auth/popup-closed-by-user', 'auth/network-request-failed']) {
      const popup = vi.fn().mockRejectedValue(Object.assign(new Error('failed'), { code }));
      const redirect = vi.fn();
      await expect(runGoogleSignInFlow({ useRedirect: false, popup, redirect })).rejects.toHaveProperty('code', code);
      expect(redirect).not.toHaveBeenCalled();
    }
  });
});
