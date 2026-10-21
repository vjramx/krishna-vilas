import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { ChevronRight, ClipboardList, HelpCircle, LogOut, Pencil, Phone, ShieldCheck } from 'lucide-react';
import { useAuth } from '@/context/AuthContext';
import { useLanguage } from '@/context/LanguageContext';
import { useHotelSettings } from '@/hooks/useHotelSettings';
import { supabase } from '@/lib/supabase';
import { BottomNav, TopBackBar } from '@/components/nav';
import { Spinner } from '@/components/ui';

/** "Priya S" -> "PS" — first letter of first and last word. */
function initialsOf(name: string, email: string | null): string {
  const fromName = name
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .map((w) => w[0])
    .slice(0, 2)
    .join('');
  if (fromName) return fromName.toUpperCase();
  return (email?.[0] ?? '?').toUpperCase();
}

function Avatar({ src, fallback }: { src: string | null; fallback: string }) {
  const [broken, setBroken] = useState(false);
  const showImg = src && !broken;
  return (
    <span className="relative grid h-16 w-16 shrink-0 place-items-center overflow-hidden rounded-full ring-2 ring-white/70 shadow-soft">
      <span className="absolute inset-0 bg-gradient-to-br from-brand-secondary to-brand-primary text-white" aria-hidden="true">
        <span className="grid h-full w-full place-items-center text-xl font-bold tracking-wide">{fallback}</span>
      </span>
      {showImg && (
        <img
          src={src}
          alt=""
          aria-hidden="true"
          className="absolute inset-0 h-full w-full object-cover"
          onError={() => setBroken(true)}
        />
      )}
    </span>
  );
}

export default function AccountPage() {
  const { t } = useLanguage();
  const { lang, setLang } = useLanguage();
  const { session, userId, email, role, roleError, refreshRole, loading, signOut } = useAuth();
  const photoURL = session?.photoURL ?? null;
  const navigate = useNavigate();
  const { data: settings } = useHotelSettings();

  const [name, setName] = useState('');
  const [profilePhone, setProfilePhone] = useState('');
  const [saving, setSaving] = useState(false);
  const [savedAt, setSavedAt] = useState<number | null>(null);
  const [editing, setEditing] = useState(false);

  // Profile fields arrive from the Supabase `profiles` row (self-owned via RLS).
  useEffect(() => {
    if (!userId) return;
    setName('');
    setProfilePhone('');
    void supabase
      .from('profiles')
      .select('display_name, phone')
      .eq('id', userId)
      .maybeSingle()
      .then(({ data }) => {
        if (data) {
          setName(data.display_name ?? '');
          setProfilePhone(data.phone ?? '');
        }
      });
  }, [userId]);

  const heroName = useMemo(() => {
    if (session) return name || session.displayName || email?.split('@')[0] || t('account.title');
    return t('account.guestTitle');
  }, [session, name, email, t]);
  const phone = profilePhone;
  const languageSettings = (
    <section className="card p-4">
      <h2 className="text-sm font-bold text-brand-subtle uppercase tracking-wide" id="acc-lang">
        {t('account.language')}
      </h2>
      <div className="mt-2 flex gap-2" role="group" aria-labelledby="acc-lang">
        {(['en', 'kn'] as const).map((l) => (
          <button
            key={l}
            type="button"
            aria-pressed={lang === l}
            onClick={() => setLang(l)}
            className={`flex-1 rounded-xl border p-2.5 text-center min-h-[44px] text-sm font-semibold transition-colors ${
              lang === l
                ? 'border-brand-primary bg-brand-primary text-white shadow-soft'
                : 'border-brand-border bg-white text-brand-text active:bg-brand-bg'
            }`}
          >
            {l === 'en' ? 'English' : 'ಕನ್ನಡ'}
          </button>
        ))}
      </div>
    </section>
  );

  if (loading) {
    return (
      <div className="min-h-dvh bg-brand-bg">
        <TopBackBar title={t('account.title')} />
        <Spinner />
      </div>
    );
  }

  // ---------------------------------------------------------------- signed out
  if (!session) {
    return (
      <div className="min-h-dvh bg-brand-bg">
        <TopBackBar title={t('account.title')} />
        <main className="app-col grid gap-3 pb-nav pt-4">
          <section className="card flex flex-col items-center gap-4 p-8 text-center shadow-soft">
            <span className="grid h-20 w-20 place-items-center rounded-full bg-gradient-to-br from-brand-secondary/20 to-brand-primary/20 text-brand-primary">
              <svg width="36" height="36" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true">
                <circle cx="12" cy="8" r="4" />
                <path d="M4 20c0-3.3 3.6-5 8-5s8 1.7 8 5" strokeLinecap="round" />
              </svg>
            </span>
            <div>
              <h2 className="text-xl font-bold">{t('account.guestTitle')}</h2>
              <p className="mt-1 text-sm text-brand-subtle">{t('account.guestHint')}</p>
            </div>
            <Link to="/login" className="btn-primary w-full text-base">
              {t('common.signIn')}
            </Link>
            <p className="text-xs text-brand-subtle">{t('account.guestOrdersHint')}</p>
          </section>
            {languageSettings}
            <Link
              to="/privacy"
              className="card flex items-center gap-2 p-4 shadow-soft active:bg-brand-bg"
            >
              <ShieldCheck size={18} className="shrink-0 text-brand-primary" aria-hidden="true" />
              <span className="flex-1 text-left text-sm font-bold">{t('privacy.linkTitle')}</span>
              <ChevronRight size={18} className="text-brand-subtle" aria-hidden="true" />
            </Link>
          </main>
        <BottomNav />
      </div>
    );
  }

  // ----------------------------------------------------------------- signed in
  const staffLink = role === 'admin' ? '/admin' : role === 'agent' ? '/agent' : null;

  async function saveProfile() {
    if (!userId) return;
    setSaving(true);
    try {
      await supabase
        .from('profiles')
        .upsert({ id: userId, display_name: name.trim() || null, phone: profilePhone.trim() || null });
      setSavedAt(Date.now());
      setEditing(false);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="min-h-dvh bg-brand-bg">
      <TopBackBar title={t('account.title')} />
      <main className="app-col grid content-start gap-3 pb-nav pt-4">
        {/* ---------- Profile hero ---------- */}
        <section className="card overflow-hidden">
          <div className="bg-gradient-to-br from-brand-primary to-brand-secondary px-5 pb-5 pt-4 text-white">
            <div className="flex items-center gap-4">
              <Avatar src={photoURL} fallback={initialsOf(heroName, email)} />
              <div className="min-w-0 flex-1">
                <h2 className="truncate text-lg font-bold leading-snug">{heroName}</h2>
                <p className="truncate text-sm opacity-90">{email}</p>
                {phone && (
                  <p className="mt-0.5 truncate text-xs tabular-nums opacity-80">
                    <Phone size={12} className="mr-1 inline align-[-1px]" aria-hidden="true" />
                    {phone}
                  </p>
                )}
              </div>
            </div>
            {staffLink && (
              <p className="mt-3 flex items-center gap-2 text-xs font-semibold opacity-90">
                <ShieldCheck size={14} aria-hidden="true" />
                {t('account.role')}: {t(role === 'admin' ? 'nav.admin' : 'nav.agent')}
              </p>
            )}
            {/* Friendly access state when the backend refused/failed to verify
                the session — visible to everyone; internals are never shown. */}            {roleError && (
              <div
                className="mt-3 rounded-xl border border-brand-error/25 bg-brand-errorBg p-3"
                role="alert"
                data-testid="account-role-failed"
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
          </div>
          <div className="grid divide-y divide-brand-border px-3 py-1">
            {staffLink && (
              <Link
                to={staffLink}
                className="flex items-center gap-3 rounded-xl px-2 py-3 text-sm font-semibold active:bg-brand-bg"
              >
                <span className="grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-brand-secondary/15 text-brand-primary" aria-hidden="true">
                  <ShieldCheck size={18} />
                </span>
                <span className="flex-1">{t('account.staffPortal')}</span>
                <ChevronRight size={18} className="text-brand-subtle" aria-hidden="true" />
              </Link>
            )}
            <Link
              to="/orders"
              className="flex items-center gap-3 rounded-xl px-2 py-3 text-sm font-semibold active:bg-brand-bg"
            >
              <span className="grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-brand-secondary/15 text-brand-primary" aria-hidden="true">
                <ClipboardList size={18} />
              </span>
              <span className="flex-1">{t('nav.orders')}</span>
              <span className="text-xs font-normal text-brand-subtle">{t('account.ordersHint')}</span>
              <ChevronRight size={18} className="text-brand-subtle" aria-hidden="true" />
            </Link>
            <button
              type="button"
              className="flex items-center gap-3 rounded-xl px-2 py-3 text-sm font-semibold active:bg-brand-bg"
              onClick={() => setEditing((v) => !v)}
              aria-expanded={editing}
            >
              <span className="grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-brand-secondary/15 text-brand-primary" aria-hidden="true">
                <Pencil size={18} />
              </span>
              <span className="flex-1 text-left">{t('account.editProfile')}</span>
              <ChevronRight size={18} className={`text-brand-subtle transition-transform ${editing ? 'rotate-90' : ''}`} aria-hidden="true" />
            </button>
          </div>
        </section>

        {/* ---------- Edit profile ---------- */}
        {editing && (
          <section className="card grid gap-3 p-4" aria-labelledby="acc-profile">
            <h2 id="acc-profile" className="text-sm font-bold text-brand-subtle uppercase tracking-wide">
              {t('account.profile')}
            </h2>
            <div>
              <label className="label" htmlFor="ac-name">{t('account.displayName')}</label>
              <input id="ac-name" className="input" value={name} maxLength={80} onChange={(e) => setName(e.target.value)} />
            </div>
            <div>
              <label className="label" htmlFor="ac-phone">{t('account.phone')}</label>
              <input id="ac-phone" className="input tabular-nums" inputMode="tel" maxLength={10} value={profilePhone}
                onChange={(e) => setProfilePhone(e.target.value.replace(/[^0-9]/g, ''))} />
            </div>
            <div className="flex items-center gap-3">
              <button type="button" className="btn-primary min-w-32 px-6" onClick={() => void saveProfile()} disabled={saving}>
                {t('common.save')}
              </button>
              <button type="button" className="btn-ghost" onClick={() => setEditing(false)}>
                {t('common.close')}
              </button>
            </div>
            <p aria-live="polite" className="h-4 text-xs text-brand-success">{savedAt ? t('account.saved') : ''}</p>
          </section>
        )}

        {/* ---------- Language ---------- */}
        {languageSettings}

        {/* ---------- Help & Contact ---------- */}
        <section className="card p-4">
          <div className="flex items-center gap-2">
            <HelpCircle size={16} className="text-brand-primary" aria-hidden="true" />
            <h2 className="font-bold">{t('account.help')}</h2>
          </div>
          <p className="mt-1 text-sm text-brand-subtle">{t('account.helpNote')}</p>
          {settings?.phone && (
            <a
              href={`tel:${settings.phone}`}
              className="btn-secondary mt-3 w-full text-sm font-semibold"
            >
              <Phone size={16} aria-hidden="true" />
              <span className="tabular-nums">{settings.phone}</span>
            </a>
          )}
        </section>

        {/* ---------- Privacy ---------- */}
        <Link
          to="/privacy"
          className="card block p-4 active:bg-brand-bg"
          aria-label={t('privacy.linkTitle')}
        >
          <div className="flex items-center gap-2">
            <ShieldCheck size={16} className="text-brand-primary" aria-hidden="true" />
            <h2 className="font-bold">{t('account.privacy')}</h2>
          </div>
          <p className="mt-1 text-sm text-brand-subtle">{t('account.privacyNote')}</p>
          <p className="mt-2 flex items-center gap-0.5 text-xs font-semibold text-brand-primary">
            {t('privacy.linkTitle')}
            <ChevronRight size={14} aria-hidden="true" />
          </p>
        </Link>

        {/* ---------- Sign out ---------- */}
        <button
          type="button"
          className="btn-secondary mt-1 justify-center border-transparent bg-white text-brand-error active:bg-brand-errorBg"
          onClick={() => void signOut().then(() => navigate('/', { replace: true }))}
        >
          <LogOut size={16} aria-hidden="true" />
          {t('common.signOut')}
        </button>
      </main>
      <BottomNav />
    </div>
  );
}
