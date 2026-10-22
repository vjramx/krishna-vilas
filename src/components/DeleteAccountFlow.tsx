import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ShieldAlert } from 'lucide-react';
import { Sheet, Spinner } from '@/components/ui';
import { useLanguage } from '@/context/LanguageContext';
import { useAuth } from '@/context/AuthContext';
import { currentFirebaseUser } from '@/lib/firebase';
import { haptic } from '@/lib/haptics';
import { reauthenticateWithPassword } from '@/lib/accountReauth';
import { clearLocalDataAfterDeletion, requestAccountDeletion } from '@/lib/accountDeletion';
import { supabaseUrl } from '@/lib/supabase';

type Stage = 'closed' | 'warning' | 'confirm' | 'loading' | 'error' | 'success';

/**
 * Danger-zone entry: the card on Account is only the entry — nothing is
 * deleted until the two-step confirmation (permanent-data sheet, then a typed
 * "DELETE") completes, and every step is cancellable with no side effects.
 */
export function DeleteAccountCard({ email }: { email: string | null }) {
  const { t } = useLanguage();
  const { signOut } = useAuth();
  const navigate = useNavigate();
  const [stage, setStage] = useState<Stage>('closed');
  const [confirmText, setConfirmText] = useState('');
  const [password, setPassword] = useState('');
  const [outcome, setOutcome] = useState<{ messageKey: string; detail?: string } | null>(null);
  const [understood, setUnderstood] = useState(false);

  const close = () => {
    setStage('closed');
    setConfirmText('');
    setPassword('');
    setOutcome(null);
    setUnderstood(false);
  };
  const openWarning = () => {
    haptic(8);
    setStage('warning');
  };

  async function execute() {
    setStage('loading');
    try {
      const result = await requestAccountDeletion({
        reauthenticate: reauthenticateWithPassword(email, password),
        currentUser: currentFirebaseUser,
        url: supabaseUrl,
      });
      if (result.ok) {
        setOutcome({ messageKey: result.messageKey });
        setStage('success');
        return;
      }
      setOutcome(result);
      setStage('error');
    } catch {
      // Reauthentication dismissed/failed — the user still owns their account.
      setOutcome({ messageKey: 'delete.reauthFailed' });
      setStage('error');
    }
  }

  async function finish() {
    clearLocalDataAfterDeletion();
    try {
      await signOut();
    } catch {
      /* session may already be gone (account deleted) */
    }
    navigate('/', { replace: true });
  }

  const canSubmit = understood && confirmText.trim() === 'DELETE' && password.length > 0;

  return (
    <>
      <button
        type="button"
        data-testid="delete-account-entry"
        className="tap flex w-full items-center gap-3 rounded-xl border border-brand-error/25 bg-white px-3 py-3 text-sm font-semibold text-brand-error active:bg-brand-errorBg"
        onClick={openWarning}
        aria-haspopup="dialog"
      >
        <span className="grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-brand-errorBg text-brand-error" aria-hidden="true">
          <ShieldAlert size={18} />
        </span>
        <span className="flex-1 text-left">{t('delete.action')}</span>
      </button>

      <Sheet
        open={stage !== 'closed'}
        onClose={stage === 'loading' ? () => undefined : close}
        title={t('delete.title')}
      >
        {(stage === 'warning' || stage === 'confirm') && (
          <div className="grid gap-3" data-testid="delete-confirm">
            <p className="text-sm text-brand-text" role="note">{t('delete.intro')}</p>
            <div className="rounded-xl border border-brand-border bg-brand-bg p-3">
              <p className="text-xs font-bold uppercase tracking-wide text-brand-warn">{t('delete.removesTitle')}</p>
              <ul className="mt-1 grid gap-1 text-sm text-brand-text" aria-label={t('delete.removesTitle')}>
                {t('delete.removes').split('\n').map((line, i) => (
                  <li key={i} className="flex gap-1.5">
                    <span aria-hidden="true" className="mt-2 h-1 w-1 shrink-0 rounded-full bg-brand-subtle" />
                    <span>{line}</span>
                  </li>
                ))}
              </ul>
            </div>
            <p className="text-xs leading-relaxed text-brand-subtle">{t('delete.retains')}</p>
            <p className="text-xs font-semibold text-brand-warn">{t('delete.permWarning')}</p>

            {stage === 'warning' ? (
              <div className="mt-1 grid grid-cols-2 gap-2">
                <button type="button" className="btn-ghost" onClick={close}>{t('common.cancel')}</button>
                <button
                  type="button"
                  className="btn border border-brand-error/40 bg-brand-error text-white"
                  onClick={() => { haptic(8); setStage('confirm'); }}
                >
                  {t('delete.continue')}
                </button>
              </div>
            ) : (
              <>
                <label className="mt-1 flex items-start gap-2 text-sm">
                  <input
                    type="checkbox"
                    data-testid="delete-understood"
                    checked={understood}
                    onChange={(e) => setUnderstood(e.target.checked)}
                    className="mt-0.5 h-5 w-5 shrink-0"
                  />
                  <span>{t('delete.understand')}</span>
                </label>
                <div>
                  <label className="label" htmlFor="del-confirm">{t('delete.typeDelete')}</label>
                  <input
                    id="del-confirm"
                    data-testid="delete-confirm-input"
                    className="input tabular-nums"
                    autoComplete="off"
                    spellCheck={false}
                    value={confirmText}
                    onChange={(e) => setConfirmText(e.target.value)}
                  />
                </div>
                <div>
                  <label className="label" htmlFor="del-password">{t('delete.passwordLabel')}</label>
                  <input
                    id="del-password"
                    data-testid="delete-password"
                    type="password"
                    className="input"
                    autoComplete="current-password"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                  />
                  <p className="mt-1 text-xs text-brand-subtle">{t('delete.passwordNote')}</p>
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <button type="button" className="btn-secondary" onClick={close}>{t('common.cancel')}</button>
                  <button
                    type="button"
                    className="btn bg-brand-error text-white"
                    data-testid="delete-final"
                    disabled={!canSubmit}
                    onClick={() => void execute()}
                  >
                    {t('delete.finalDelete')}
                  </button>
                </div>
              </>
            )}
          </div>
        )}

        {stage === 'loading' && (
          <div className="grid gap-2 py-6" data-testid="delete-loading">
            <Spinner label={t('delete.inProgress')} />
            <p className="text-center text-sm text-brand-subtle">{t('delete.inProgress')}</p>
          </div>
        )}

        {stage === 'error' && outcome && (
          <div className="grid gap-3" data-testid="delete-error" role="alert">
            <p className="text-sm text-brand-error">{t(outcome.messageKey, outcome.detail ? { count: outcome.detail } : undefined)}</p>
            <div className="grid grid-cols-2 gap-2">
              <button type="button" className="btn-ghost" onClick={close}>{t('common.cancel')}</button>
              <button type="button" className="btn-primary" onClick={() => setStage('confirm')}>{t('common.retry')}</button>
            </div>
          </div>
        )}

        {stage === 'success' && (
          <div className="grid gap-3 py-2 text-center" data-testid="delete-success">
            <p className="text-base font-bold text-brand-success" role="status">{t('delete.success')}</p>
            <p className="text-sm text-brand-subtle">{t('delete.successNote')}</p>
            <button
              type="button"
              className="btn-primary"
              data-testid="delete-done"
              onClick={() => void finish()}
            >
              {t('common.close')}
            </button>
          </div>
        )}
      </Sheet>
    </>
  );
}
