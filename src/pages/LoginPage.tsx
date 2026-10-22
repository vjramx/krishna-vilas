import { useEffect, useRef, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { registerWithEmail, sendPasswordReset, sendVerificationEmail, signInAsGuest, signInWithEmail } from '@/lib/firebase';
import { firebaseAuth } from '@/lib/firebase';
import { authErrorKey } from '@/lib/authErrors';
import { publicImageUrl } from '@/lib/supabase';
import { useLanguage } from '@/context/LanguageContext';
import { useHotelSettings } from '@/hooks/useHotelSettings';
import { useAuth } from '@/context/AuthContext';
import { ChevronRight } from 'lucide-react';
import { TopBackBar } from '@/components/nav';
import { BrandLogo } from '@/components/BrandLogo';
import { FireflyFx } from '@/components/FireflyFx';
import type { FireflyRefs } from '@/components/FireflyFx';

type Mode = 'signin' | 'signup' | 'reset';

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export default function LoginPage() {
  const { t, lang } = useLanguage();
  const { data: settings } = useHotelSettings();
  const { session, loading, role, email, roleError, refreshRole } = useAuth();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  // Only support the known checkout return path; never accept arbitrary URLs.
  const returnToCheckout = searchParams.get('next') === '/checkout';

  const [mode, setMode] = useState<Mode>('signin');
  const [emailInput, setEmailInput] = useState('');
  const [passwordInput, setPasswordInput] = useState('');
  const [confirmInput, setConfirmInput] = useState('');
  const [busy, setBusy] = useState(false);
  const [errorKey, setErrorKey] = useState<string | null>(null);
  const [noticeKey, setNoticeKey] = useState<string | null>(null);
  // The eye: the real password input stays type="password"; the mirror beside
  // it draws either dots or the characters, exactly like the firefly demo.
  const [showPass, setShowPass] = useState(false);
  // True only for interactive email/password sign-in: holds the route for a
  // beat so the firefly can fill the button with light before the app moves.
  const [celebrate, setCelebrate] = useState(false);
  // Re-check trigger: Firebase mutates the live user object in place on
  // reload(), which React cannot observe — the poll bumps this tick so the
  // routing effect re-evaluates session.emailVerified and lifts the gate.
  const [verifyTick, setVerifyTick] = useState(0);

  // Firefly wiring: stable ref objects shared with the <FireflyFx /> overlay.
  const ffRefs: FireflyRefs = {
    form: useRef<HTMLFormElement>(null),
    email: useRef<HTMLInputElement>(null),
    pass: useRef<HTMLInputElement>(null),
    passField: useRef<HTMLDivElement>(null),
    dots: useRef<HTMLSpanElement>(null),
    text: useRef<HTMLSpanElement>(null),
    caret: useRef<HTMLElement>(null),
    eye: useRef<HTMLButtonElement>(null),
    send: useRef<HTMLButtonElement>(null),
  };

  const name = settings ? (lang === 'kn' ? settings.name_kn : settings.name_en) : t('app.name');
  const logo = publicImageUrl(settings?.logo_path ?? null);

  // Once a verified session exists, route staff to their workspace instead of
  // always dropping them on the customer Account page. A guest (anonymous)
  // session stays on this page — the email forms remain useful for upgrading —
  // but an explicit checkout return link is honored immediately.
  //
  // An email session that is NOT yet verified is held here with a verify-your-
  // inbox notice: the backend only trusts verified email claims (0003
  // is_allowed_issuer), so routing an unverified user into the app would leave
  // every listed/RLS read failing with no explanation. The session is reloaded
  // periodically so the gate lifts the moment Firebase sees the verification.
  useEffect(() => {
    if (loading || !session || role === 'anon') return; // wait: role still resolving
    if (session.isAnonymous) {
      if (returnToCheckout) navigate('/checkout', { replace: true });
      return;
    }
    if (!session.emailVerified) {
      setNoticeKey('login.verifyRequired');
      const poll = window.setInterval(() => {
        void firebaseAuth.currentUser
          ?.reload()
          .then(() => setVerifyTick((tick) => tick + 1))
          .catch(() => undefined);
      }, 5000);
      // Re-enable the form so the resend action works while we wait.
      setBusy(false);
      return () => window.clearInterval(poll);
    }
    const to = returnToCheckout ? '/checkout' : role === 'admin' ? '/admin' : role === 'agent' ? '/agent' : '/account';
    const go = () => navigate(to, { replace: true });
    if (import.meta.env.DEV)
      console.log(`[auth] signed in as role=${role} email=${email ?? '—'}; /login → ${to}`);
    // Celebrating sign-in: hold the route for a beat so the light fills the
    // button before leaving (short enough to stay invisible on slow tests).
    if (celebrate) {
      const hold = window.setTimeout(go, 420);
      return () => window.clearTimeout(hold);
    }
    go();
  }, [loading, session, role, email, navigate, returnToCheckout, verifyTick, celebrate]);

  async function resendVerification() {
    if (busy) return;
    setNoticeKey(null);
    try {
      await sendVerificationEmail();
      setNoticeKey('login.verifySent');
    } catch (e) {
      setErrorKey(authErrorKey(e instanceof Error ? e.message : String(e)));
    }
  }

  function clearFlows() {
    setErrorKey(null);
    setNoticeKey(null);
    setShowPass(false);
  }

  function forget() {
    clearFlows();
    setConfirmInput('');
    setMode('reset');
  }

  async function submit() {
    if (busy) return; // prevent duplicate submissions
    setErrorKey(null);
    setNoticeKey(null);

    const addr = emailInput.trim();
    if (!addr) {
      setErrorKey('login.enterEmail');
      ffRefs.email.current?.focus(); // the firefly flies to the missing field
      return;
    }
    if (!EMAIL_PATTERN.test(addr)) {
      setErrorKey('login.invalidEmail');
      ffRefs.email.current?.focus();
      return;
    }
    if (mode === 'reset') {
      setBusy(true);
      try {
        await sendPasswordReset(addr);
        setNoticeKey('login.resetSent');
      } catch (e) {
        const message = e instanceof Error ? e.message : String(e);
        // Never reveal whether an account exists — Firebase's "unknown user"
        // reply on a reset request is surfaced as the same neutral notice.
        if (message.includes('user-not-found') || message.includes('invalid-credential')) {
          setNoticeKey('login.resetSent');
          setBusy(false);
          return;
        }
        setErrorKey(authErrorKey(message));
      } finally {
        setBusy(false);
      }
      return;
    }
    if (!passwordInput) {
      setErrorKey(mode === 'signup' ? 'login.choosePassword' : 'login.enterPassword');
      ffRefs.pass.current?.focus();
      return;
    }
    // Sign-up only: the confirmation must match before we ever hit Firebase —
    // a typo on first creation is the one password mistake that locks the
    // user out of their own account.
    if (mode === 'signup' && passwordInput !== confirmInput) {
      setErrorKey('login.passwordMismatch');
      return;
    }
    setBusy(true);
    try {
      if (mode === 'signin') {
        // Request the victory moment now so it is already set when the auth
        // observer routes away — on failure it is retracted above.
        setCelebrate(true);
        await signInWithEmail(addr, passwordInput);
      } else {
        const wasGuest = session?.isAnonymous ?? false;
        await registerWithEmail(addr, passwordInput);
        if (wasGuest) {
          // Upgrading a guest mutates the same Firebase user in place, so no
          // auth-state event fires — route explicitly to the ordered account.
          navigate(returnToCheckout ? '/checkout' : '/account', { replace: true });
        } else {
          // Account created; a verification email is already on its way
          // (registerWithEmail sends it). The routing effect holds the user
          // here until the Firebase session reports a verified email, then
          // directs staff to their workspace or customers to Account.
          setNoticeKey('login.verifyRequired');
          setBusy(false);
        }
      }
    } catch (e) {
      setCelebrate(false);
      const message = e instanceof Error ? e.message : String(e);
      if (import.meta.env.DEV) console.error('[auth] email auth error', message);
      setErrorKey(authErrorKey(message));
      setBusy(false);
    }
    // Success leaves `busy` set: the auth observer routes away from /login.
  }

  const isSignup = mode === 'signup';
  const isReset = mode === 'reset';

  async function continueAsGuest() {
    if (busy) return;
    setErrorKey(null);
    setNoticeKey(null);
    setBusy(true);
    try {
      await signInAsGuest();
      // The guest's whole purpose here is ordering — go straight to checkout.
      navigate('/checkout', { replace: true });
    } catch (e) {
      setErrorKey(authErrorKey(e instanceof Error ? e.message : String(e)));
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

      {/* Night window: fireflies, wood and the glass sign-in sheet */}
      <main className="app-col -mt-3 pb-16">
        <div className="ff-stage">
          <FireflyFx refs={ffRefs} celebrate={celebrate} />

          <div className="ff-glass grid gap-4 rounded-[22px] p-5">
            <div className="text-center">
              <h2 className="text-lg font-bold">
                {isReset ? t('login.forgotTitle') : isSignup ? t('login.createTitle') : t('login.signinTitle')}
              </h2>
              <p className="mt-1 text-sm text-brand-subtle">
                {isReset ? t('login.forgotHint') : isSignup ? t('login.createHint') : t('login.signinHint')}
              </p>
            </div>

            <form
              className="grid gap-3"
              ref={ffRefs.form}
              onSubmit={(e) => {
                e.preventDefault();
                void submit();
              }}
            >
              <div>
                <label className="label" htmlFor="login-email">{t('login.emailLabel')}</label>
                <div className="ff-field ff-noeye">
                  <input
                    id="login-email"
                    data-testid="login-email"
                    ref={ffRefs.email}
                    type="email"
                    name="email"
                    className="ff-input"
                    placeholder={t('login.emailLabel')}
                    autoComplete="email"
                    inputMode="email"
                    value={emailInput}
                    onChange={(e) => setEmailInput(e.target.value)}
                    disabled={busy}
                  />
                </div>
              </div>

              {!isReset && (
                <div>
                  <label className="label" htmlFor="login-password">{t('login.passwordLabel')}</label>
                  <div
                    className={`ff-field ff-pass${showPass ? ' show' : ''}`}
                    ref={ffRefs.passField}
                  >
                    <input
                      id="login-password"
                      data-testid="login-password"
                      ref={ffRefs.pass}
                      type="password"
                      name="password"
                      className="ff-input"
                      placeholder={t('login.passwordLabel')}
                      autoComplete={isSignup ? 'new-password' : 'current-password'}
                      value={passwordInput}
                      onChange={(e) => setPasswordInput(e.target.value)}
                      disabled={busy}
                      minLength={6}
                      required
                    />
                    {/* What you see: the mirror draws dots or the characters of the
                        value; the real input's text stays transparent for the
                        browser and password managers. */}
                    <span className="ff-mirror" aria-hidden="true">
                      <span className="ff-dots" ref={ffRefs.dots} />
                      <span className="ff-text" ref={ffRefs.text} />
                      <i className="ff-caret" ref={ffRefs.caret} />
                    </span>
                    <button
                      type="button"
                      data-testid="login-eye"
                      ref={ffRefs.eye}
                      className="ff-eye"
                      aria-label={showPass ? t('login.hidePassword') : t('login.showPassword')}
                      aria-pressed={showPass}
                      onClick={() => setShowPass((v) => !v)}
                    >
                      <svg viewBox="0 0 24 24">
                        <path d="M1.5 12S5.5 4.5 12 4.5 22.5 12 22.5 12 18.5 19.5 12 19.5 1.5 12 1.5 12Z" />
                        <circle cx="12" cy="12" r="3.2" />
                        <path className="slash" d="M3.5 20.5 20.5 3.5" />
                      </svg>
                    </button>
                  </div>
                </div>
              )}

              {isSignup && (
                <div>
                  <label className="label" htmlFor="login-confirm">{t('login.confirmPasswordLabel')}</label>
                  <div className="ff-field ff-noeye">
                    <input
                      id="login-confirm"
                      data-testid="login-confirm"
                      type="password"
                      name="confirm-password"
                      className="ff-input"
                      autoComplete="new-password"
                      value={confirmInput}
                      onChange={(e) => setConfirmInput(e.target.value)}
                      disabled={busy}
                      minLength={6}
                      required
                    />
                  </div>
                </div>
              )}

              <button
                type="submit"
                data-testid="login-submit"
                ref={ffRefs.send}
                className="ff-send"
                disabled={busy}
              >
                <span className="ff-go">
                  {busy ? (
                    <>
                      <span
                        className="h-5 w-5 shrink-0 animate-spin rounded-full border-2 border-white/30 border-t-[#ffdf9e]"
                        aria-hidden="true"
                      />
                      {t('common.loading')}
                    </>
                  ) : isReset ? (
                    t('login.resetCta')
                  ) : isSignup ? (
                    t('login.createCta')
                  ) : (
                    t('login.signinCta')
                  )}
                </span>
                {/* Shown when the firefly fills the button with light on sign-in. */}
                <span className="ff-ok">
                  <svg viewBox="0 0 24 24" aria-hidden="true">
                    <path d="M5 12.5l4.5 4.5L19 7.5" />
                  </svg>
                  {t('login.fireflyDone')}
                </span>
              </button>
            </form>

            {!session && (
              <>
                <div className="flex items-center gap-2" aria-hidden="true">
                  <span className="h-px flex-1 bg-brand-border" />
                  <span className="text-[11px] font-semibold uppercase tracking-wide text-brand-subtle">{t('login.or')}</span>
                  <span className="h-px flex-1 bg-brand-border" />
                </div>
                <button
                  type="button"
                  data-testid="login-guest"
                  className="btn-secondary w-full rounded-xl text-base"
                  onClick={() => void continueAsGuest()}
                  disabled={busy}
                >
                  {t('login.guestCta')}
                </button>
                <p className="text-center text-[11px] leading-relaxed text-brand-subtle">{t('login.guestNote')}</p>
              </>
            )}

            {!isReset && (
              <button
                type="button"
                data-testid="login-mode-toggle"
                className="btn-ghost mx-auto w-fit text-sm font-semibold active:opacity-80"
                onClick={() => {
                  clearFlows();
                  setConfirmInput('');
                  setMode(isSignup ? 'signin' : 'signup');
                }}
              >
                {isSignup ? t('login.haveAccount') : t('login.needAccount')}
              </button>
            )}

            {!isSignup && (
              <button
                type="button"
                data-testid="login-forgot"
                className="btn-ghost mx-auto w-fit -mt-2 text-xs active:opacity-80"
                onClick={() => forget()}
              >
                {isReset ? t('login.backToSignin') : t('login.forgot')}
              </button>
            )}
            {isReset && (
              <button
                type="button"
                data-testid="login-back-signin"
                className="btn-ghost mx-auto w-fit text-sm font-semibold active:opacity-80"
                onClick={() => {
                  clearFlows();
                  setMode('signin');
                }}
              >
                {t('login.backToSignin')}
              </button>
            )}

            {noticeKey && (
              <div className="rounded-xl border border-brand-success/30 bg-brand-successBg p-3" role="status">
                <p className="text-sm text-brand-success">{t(noticeKey)}</p>
              </div>
            )}

            {/* Verify-your-email gate: shown while the email session is held unverified. */}
            {session && !session.isAnonymous && !session.emailVerified && (
              <button
                type="button"
                data-testid="login-verify-resend"
                className="btn-secondary mx-auto w-fit px-4 text-sm font-semibold active:opacity-80"
                disabled={busy}
                onClick={() => void resendVerification()}
              >
                {t('login.verifyResend')}
              </button>
            )}

            {errorKey && (
              <div className="rounded-xl border border-brand-error/25 bg-brand-errorBg p-3" role="alert">
                <p className="text-sm text-brand-error">{t(errorKey)}</p>
              </div>
            )}

            <p className="text-center text-[11px] leading-relaxed text-brand-subtle">{t('login.termsNote')}</p>

            <Link
              to="/privacy"
              className="mx-auto flex items-center gap-0.5 text-xs font-semibold active:opacity-80"
            >
              {t('privacy.linkTitle')}
              <ChevronRight size={13} aria-hidden="true" />
            </Link>

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
        </div>
      </main>
    </div>
  );
}
