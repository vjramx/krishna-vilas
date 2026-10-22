import { useEffect, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { startGoogleSignIn } from '@/lib/firebase';
import { isCancelledAuthError, mapLoginErrorMessage } from '@/lib/authErrors';
import { publicImageUrl } from '@/lib/supabase';
import { useLanguage } from '@/context/LanguageContext';
import { useHotelSettings } from '@/hooks/useHotelSettings';
import { useAuth } from '@/context/AuthContext';
import { ChevronRight } from 'lucide-react';
import { TopBackBar } from '@/components/nav';
import { BrandLogo } from '@/components/BrandLogo';

/** Map a FirebaseError code from the redirect to a user-actionable message key. */
function mapRedirectError(code: string): string {
  if (code.includes('unauthorized-domain')) return 'login.unauthorizedDomain';
  if (code.includes('no-google-account')) return 'login.noGoogleAccount';
  if (
    code.includes('operation-not-allowed') ||
    code.includes('configuration-not-found') ||
    code.includes('admin-restricted-operation')
  ) {
    return 'login.providerDisabled';
  }
  return 'login.googleUnavailable';
}

export default function LoginPage() {
  const { t, lang } = useLanguage();
  const { data: settings } = useHotelSettings();
  const { session, loading, redirectError, role, email, roleError, refreshRole } = useAuth();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  // Only support the known checkout return path; never accept arbitrary URLs.
  const returnToCheckout = searchParams.get('next') === '/checkout';
  const [busy, setBusy] = useState(false);
  const [errorKey, setErrorKey] = useState<string | null>(null);
  const name = settings ? (lang === 'kn' ? settings.name_kn : settings.name_en) : t('app.name');
  const logo = publicImageUrl(settings?.logo_path ?? null);

  // Once a verified session exists, route staff to their workspace instead of
  // always dropping them on the customer Account page.
  useEffect(() => {
    if (loading || !session || role === 'anon') return; // wait: role still resolving
    const to = returnToCheckout ? '/checkout' : role === 'admin' ? '/admin' : role === 'agent' ? '/agent' : '/account';
    if (import.meta.env.DEV)
      console.log(`[auth] signed in as role=${role} email=${email ?? '—'}; /login → ${to}`);
    navigate(to, { replace: true });
  }, [loading, session, role, email, navigate, returnToCheckout]);

  async function google() {
    if (busy) return; // prevent duplicate sign-in requests
    setErrorKey(null);
    setBusy(true);
    try {
      await startGoogleSignIn();
      // Popup flow: Firebase has a verified session now — go straight to Account.
      // (Redirect flow inside WebViews leaves the page; the return trip is
      // processed via getRedirectResult in AuthContext and lands here signed in.)
    } catch (e) {
      if (isCancelledAuthError(e)) {
        setBusy(false); // user closed the chooser — not an error
        return;
      }
      const errorCode = e && typeof e === 'object' && 'code' in e ? String((e as { code: unknown }).code) : '';
      const message = e instanceof Error ? e.message : String(e);
      const msg = `${errorCode} ${message}`.trim();
      if (import.meta.env.DEV) console.error('[auth] sign-in error', msg);
      const key = mapLoginErrorMessage(msg);
      if (key) setErrorKey(key);
      setBusy(false);
    }
  }

  return (
    <div className="min-h-dvh bg-brand-bg">
      <TopBackBar title={t('login.title')} />

      {/* Brand hero */}
      <div className="bg-gradient-to-br from-brand-primary to-brand-secondary px-4 pb-4 pt-5 text-white">
        <div className="mx-auto flex w-full max-w-app flex-col items-center gap-3 px-4 text-center">
          {logo ? (
            <img src={logo} alt="" aria-hidden="true" className="h-16 w-16 rounded-2xl object-contain bg-white/90 p-1.5 shadow-soft" />
          ) : (
            <BrandLogo size={64} className="rounded-2xl bg-white/90 p-1.5 shadow-soft" />
          )}
          <div>
            <p className="text-xl font-bold leading-tight">{name}</p>
            <p className="mt-1 text-sm opacity-90">{t('login.tagline')}</p>
          </div>
        </div>
      </div>

      {/* Raised sign-in sheet */}
      <main className="app-col -mt-3 pb-16">
        <div className="card grid gap-4 rounded-2xl p-5 shadow-soft">
          <div className="text-center">
            <h2 className="text-lg font-bold">{t('login.title')}</h2>
          </div>

          <button
            type="button"
            className="btn w-full gap-3 rounded-xl border border-brand-border bg-white text-brand-text shadow-soft active:bg-brand-bg text-base font-semibold"
            onClick={() => void google()}
            disabled={busy}
          >
            {busy ? (
              <span
                className="h-5 w-5 shrink-0 animate-spin rounded-full border-2 border-brand-border border-t-brand-primary"
                aria-hidden="true"
              />
            ) : (
              <svg width="18" height="18" viewBox="0 0 48 48" aria-hidden="true" className="shrink-0">
                <path fill="#EA4335" d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z" />
                <path fill="#4285F4" d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z" />
                <path fill="#FBBC05" d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z" />
                <path fill="#34A853" d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z" />
              </svg>
            )}
            {busy ? t('common.loading') : t('login.google')}
          </button>

          <p className="text-center text-[11px] leading-relaxed text-brand-subtle">{t('login.termsNote')}</p>

          <Link
            to="/privacy"
            className="mx-auto flex items-center gap-0.5 text-xs font-semibold text-brand-primary active:opacity-80"
          >
            {t('privacy.linkTitle')}
            <ChevronRight size={13} aria-hidden="true" />
          </Link>

          {(errorKey || redirectError) && (
            <div className="rounded-xl border border-brand-error/25 bg-brand-errorBg p-3" role="alert">
              <p className="text-sm text-brand-error">{t(errorKey ?? mapRedirectError(redirectError as string))}</p>
            </div>
          )}

          {/* Signed in, but the backend refused / failed to verify the session:
              show a friendly, actionable state instead of silently dropping to
              the customer experience. Raw detail stays in dev diagnostics. */}
          {session && roleError && (
            <div
              className="rounded-xl border border-brand-error/25 bg-brand-errorBg p-3"
              role="alert"
              data-testid="role-check-failed"
            >
              <p className="text-sm text-brand-error">{t('login.roleCheckFailed')}</p>
              <button
                type="button"
                className="btn btn-ghost mx-auto mt-2 w-fit rounded-lg px-4 py-2 text-sm font-semibold"
                onClick={() => void refreshRole()}
              >
                {t('login.retryRoleCheck')}
              </button>
            </div>
          )}

          <Link to="/" className="btn-ghost mx-auto w-fit text-sm">
            {t('nav.backHome')}
          </Link>

        </div>
      </main>
    </div>
  );
}
