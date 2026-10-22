import { Link } from 'react-router-dom';
import { Mail, ShieldCheck, Smartphone } from 'lucide-react';
import { useLanguage } from '@/context/LanguageContext';

/**
 * Google-Play-required public page: how to delete a Krishna Vilas Food
 * Delivery account without signing in. No personal data is read or written
 * here, and no misleading removal deadlines are promised.
 */
export default function PublicDeleteAccountPage() {
  const { t } = useLanguage();

  return (
    <div className="min-h-dvh bg-brand-bg">
      <header
        className="flex items-center gap-3 border-b border-brand-border px-4 py-4"
        style={{ paddingTop: 'var(--safe-top)' }}
      >
        <span className="text-lg font-extrabold text-brand-primary">Krishna Vilas</span>
        <span className="text-xs font-semibold text-brand-subtle">Food Delivery</span>
      </header>

      <main className="mx-auto grid w-full max-w-app gap-4 px-4 pb-16 pt-5">
        <h1 className="text-xl font-bold">{t('publicDelete.title')}</h1>
        <p className="text-sm leading-relaxed text-brand-subtle">{t('publicDelete.intro')}</p>

        <section className="card p-4">
          <h2 className="flex items-center gap-2 font-bold">
            <Smartphone size={16} className="text-brand-primary" aria-hidden="true" />
            {t('publicDelete.inApp.heading')}
          </h2>
          <ol className="mt-2 grid gap-1 pl-4 text-sm text-brand-text" style={{ listStyle: 'decimal' }}>
            {t('publicDelete.inApp.steps').split('\n').map((step, i) => (
              <li key={i}>{step}</li>
            ))}
          </ol>
          <Link to="/" className="btn-secondary mt-3 w-full justify-center text-sm font-semibold">
            {t('publicDelete.openApp')}
          </Link>
        </section>

        <section className="card p-4">
          <h2 className="flex items-center gap-2 font-bold">
            <Mail size={16} className="text-brand-primary" aria-hidden="true" />
            {t('publicDelete.email.heading')}
          </h2>
          <p className="mt-2 text-sm leading-relaxed text-brand-text">{t('publicDelete.email.body')}</p>
          <a
            href="mailto:vjramx@gmail.com?subject=Krishna%20Vilas%20Food%20Delivery%20-%20account%20or%20data%20deletion%20request"
            className="btn-secondary mt-2 w-full justify-center text-sm font-semibold"
          >
            vjramx@gmail.com
          </a>
        </section>

        <section className="card p-4">
          <h2 className="font-bold">{t('publicDelete.deleted.heading')}</h2>
          <ul className="mt-2 grid gap-1 text-sm text-brand-text" aria-label={t('publicDelete.deleted.heading')}>
            {t('publicDelete.deleted.items').split('\n').map((item, i) => (
              <li key={i} className="flex gap-1.5">
                <span aria-hidden="true" className="mt-2 h-1 w-1 shrink-0 rounded-full bg-brand-subtle" />
                <span>{item}</span>
              </li>
            ))}
          </ul>
        </section>

        <section className="card p-4">
          <h2 className="font-bold">{t('publicDelete.retained.heading')}</h2>
          <p className="mt-2 text-sm leading-relaxed text-brand-text">{t('publicDelete.retained.body')}</p>
        </section>

        <section className="card p-4">
          <h2 className="font-bold">{t('publicDelete.verify.heading')}</h2>
          <p className="mt-2 text-sm leading-relaxed text-brand-text">{t('publicDelete.verify.body')}</p>
        </section>

        <p className="flex items-start gap-2 text-xs text-brand-subtle">
          <ShieldCheck size={14} className="mt-0.5 shrink-0" aria-hidden="true" />
          {t('publicDelete.privacyLink')}
        </p>
        <p className="pb-2 text-center text-[11px] text-brand-subtle">{t('publicDelete.businessNote')}</p>
      </main>
    </div>
  );
}
