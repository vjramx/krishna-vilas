import { useCallback, useEffect, useId, useRef, useState, type ReactNode } from 'react';
import {
  AlertTriangle,
  Ban,
  CheckCircle2,
  Clock,
  Minus,
  PackageCheck,
  Plus,
  RefreshCw,
  Truck,
  X,
  XCircle,
} from 'lucide-react';
import type { OrderStatus } from '@/types/db';
import { useLanguage } from '@/context/LanguageContext';
import { haptic } from '@/lib/haptics';

export function Spinner({ label }: { label?: string }) {
  return (
    <div className="flex items-center justify-center gap-2 py-10 text-brand-subtle" role="status" aria-label={label ?? 'loading'}>
      <span className="h-7 w-7 animate-spin rounded-full border-[3px] border-brand-border border-t-brand-primary" aria-hidden="true" />
    </div>
  );
}

export function SkeletonItem() {
  return (
    <div className="card flex gap-3 p-3">
      <div className="min-w-0 flex-1 space-y-2 pt-1">
        <div className="skeleton h-4 w-3/4" />
        <div className="skeleton h-3 w-1/2" />
        <div className="skeleton h-4 w-20" />
      </div>
      <div className="skeleton h-[104px] w-[104px] shrink-0 rounded-2xl" />
    </div>
  );
}

const STATUS_STYLE: Record<OrderStatus, { bg: string; fg: string; icon: ReactNode }> = {
  pending: { bg: 'bg-brand-warnBg', fg: 'text-brand-warn', icon: <Clock size={14} aria-hidden="true" /> },
  confirmed: { bg: 'bg-brand-successBg', fg: 'text-brand-success', icon: <CheckCircle2 size={14} aria-hidden="true" /> },
  preparing: { bg: 'bg-brand-warnBg', fg: 'text-brand-warn', icon: <Clock size={14} aria-hidden="true" /> },
  ready: { bg: 'bg-brand-successBg', fg: 'text-brand-success', icon: <PackageCheck size={14} aria-hidden="true" /> },
  out_for_delivery: { bg: 'bg-brand-secondary/15', fg: 'text-brand-primaryDark', icon: <Truck size={14} aria-hidden="true" /> },
  delivered: { bg: 'bg-brand-successBg', fg: 'text-brand-success', icon: <CheckCircle2 size={14} aria-hidden="true" /> },
  rejected: { bg: 'bg-brand-errorBg', fg: 'text-brand-error', icon: <XCircle size={14} aria-hidden="true" /> },
  cancelled: { bg: 'bg-brand-bg', fg: 'text-brand-subtle', icon: <Ban size={14} aria-hidden="true" /> },
};

export function OrderStatusBadge({ status }: { status: OrderStatus }) {
  const { t } = useLanguage();
  const style = STATUS_STYLE[status];
  return (
    <span className={`badge ${style.bg} ${style.fg}`}>
      {style.icon}
      {t(`order.status.${status}`)}
    </span>
  );
}

export function EmptyState({ icon, title, hint, action }: { icon: ReactNode; title: string; hint?: string; action?: ReactNode }) {
  return (
    <div className="card flex flex-col items-center gap-2 px-5 py-10 text-center">
      <div className="grid h-14 w-14 place-items-center rounded-full bg-brand-bg text-brand-subtle" aria-hidden="true">
        {icon}
      </div>
      <p className="mt-1 text-base font-semibold text-brand-text">{title}</p>
      {hint && <p className="max-w-[34ch] text-sm text-brand-subtle">{hint}</p>}
      {action}
    </div>
  );
}

export function ErrorState({ message, onRetry }: { message: string; onRetry?: () => void }) {
  const { t } = useLanguage();
  return (
    <div className="card flex flex-col items-center gap-3 px-5 py-8 text-center">
      <AlertTriangle className="text-brand-primary" aria-hidden="true" size={30} />
      <p role="alert" className="text-sm text-brand-text">{message}</p>
      {onRetry && (
        <button type="button" className="btn-secondary" onClick={onRetry}>
          <RefreshCw size={16} aria-hidden="true" /> {t('common.retry')}
        </button>
      )}
    </div>
  );
}

export function QtyStepper({
  value,
  onChange,
  min = 0,
  max = 50,
  size = 'md',
}: {
  value: number;
  onChange: (next: number) => void;
  min?: number;
  max?: number;
  size?: 'sm' | 'md';
}) {
  const { t } = useLanguage();
  const btn = size === 'sm' ? 'h-10 w-10' : 'h-12 w-12';
  const press = (next: number) => {
    haptic(5);
    onChange(next);
  };
  return (
    <div className="inline-flex shrink-0 items-center rounded-xl border border-brand-primary/25 bg-brand-primary/[0.06]">
      <button
        type="button"
        className={`${btn} tap inline-flex items-center justify-center rounded-l-xl text-brand-primary active:bg-brand-primary/10 disabled:opacity-30`}
        disabled={value <= min}
        aria-label={t('cart.qtyDecrease')}
        onClick={() => press(value - 1)}
      >
        <Minus size={17} aria-hidden="true" />
      </button>
      <span
        aria-live="polite"
        className={`min-w-[1.9rem] text-center font-bold tabular-nums text-brand-primary ${size === 'sm' ? 'text-[15px]' : 'text-base'}`}
      >
        {value}
      </span>
      <button
        type="button"
        className={`${btn} tap inline-flex items-center justify-center rounded-r-xl text-brand-primary active:bg-brand-primary/10 disabled:opacity-30`}
        disabled={value >= max}
        aria-label={t('cart.qtyIncrease')}
        onClick={() => press(value + 1)}
      >
        <Plus size={17} aria-hidden="true" />
      </button>
    </div>
  );
}

/**
 * Android bottom sheet: handle, scrollable body, safe-area footer, ESC and the
 * hardware back button both dismiss it (via a throwaway history entry).
 */
export function Sheet({
  open,
  onClose,
  title,
  children,
  desktopDialog = false,
  headerIcon,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  children: ReactNode;
  desktopDialog?: boolean;
  headerIcon?: ReactNode;
}) {
  const { t } = useLanguage();
  const ref = useRef<HTMLDivElement>(null);
  const titleId = useId();
  const pushedRef = useRef(false);

  const close = useCallback(() => {
    haptic(5);
    if (pushedRef.current) {
      pushedRef.current = false;
      window.history.back();
    }
    onClose();
  }, [onClose]);

  useEffect(() => {
    if (!open) return;
    const previous = document.activeElement as HTMLElement | null;
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    ref.current?.focus();

    // Hardware back should close the sheet, not leave the screen.
    try {
      window.history.pushState({ ...(window.history.state ?? {}), __kvSheet: true }, '');
      pushedRef.current = true;
    } catch {
      /* history unavailable (e.g. sandboxed iframe) */
    }
    const onPop = () => {
      pushedRef.current = false;
      onClose();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') close();
    };
    window.addEventListener('popstate', onPop);
    document.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('popstate', onPop);
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = prevOverflow;
      previous?.focus?.();
    };
  }, [open, onClose, close]);

  if (!open) return null;
  return (
    <div className={`fixed inset-0 z-50 flex flex-col justify-end ${desktopDialog ? 'lg:justify-center lg:px-6 lg:py-6' : ''}`}>
      <div className="absolute inset-0 bg-brand-scrim fade-in" onClick={close} aria-hidden="true" />
      <div
        ref={ref}
        tabIndex={-1}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        className={`sheet-up relative mx-auto flex max-h-[92dvh] w-full max-w-app flex-col rounded-t-3xl bg-white shadow-sheet outline-none ${desktopDialog ? 'lg:max-h-[calc(100dvh-3rem)] lg:max-w-5xl lg:rounded-3xl' : ''}`}
        style={{ paddingBottom: 'var(--safe-bottom)' }}
      >
        <div className="grid shrink-0 place-items-center pb-1 pt-2.5">
          <span className="h-1.5 w-10 rounded-full bg-brand-border" aria-hidden="true" />
        </div>
        <div className="flex shrink-0 items-center gap-2 px-4 pb-2">
          {headerIcon}
          <h2 id={titleId} className="min-w-0 flex-1 truncate text-lg font-bold">{title}</h2>
          <button
            type="button"
            className="tap grid h-10 w-10 place-items-center rounded-full text-brand-subtle active:bg-brand-bg"
            aria-label={t('common.close')}
            onClick={close}
          >
            <X size={21} aria-hidden="true" />
          </button>
        </div>
        <div className="app-scroll min-h-0 flex-1 px-4 pb-5">{children}</div>
      </div>
    </div>
  );
}

/**
 * Fixed action bar pinned above the system gesture area (cart, checkout).
 * Set `aboveNav` when the screen also shows the bottom tab bar.
 */
export function BottomActionBar({ children, aboveNav = false }: { children: ReactNode; aboveNav?: boolean }) {
  return (
    <div
      data-sticky-bar
      className="fixed inset-x-0 z-30 border-t border-brand-border bg-white/95 px-3 pt-2.5 shadow-elev2 backdrop-blur"
      style={{
        bottom: aboveNav ? 'calc(var(--tabbar-h) + var(--safe-bottom))' : 0,
        paddingBottom: aboveNav ? '10px' : 'calc(var(--safe-bottom) + 10px)',
      }}
    >
      <div className="mx-auto flex w-full max-w-app items-center gap-3">{children}</div>
    </div>
  );
}

/* ------------------------------------------------------------------ snackbar */

type Snack = {
  id: number;
  message: string;
  actionLabel?: string;
  onAction?: () => void;
};

let snackListener: ((snack: Snack | null) => void) | null = null;

/** Show a Material-style snackbar from anywhere (no context plumbing needed). */
export function showSnackbar(
  message: string,
  action?: { label: string; onAction: () => void },
): void {
  snackListener?.({
    id: Date.now(),
    message,
    actionLabel: action?.label,
    onAction: action?.onAction,
  });
}

export function SnackbarHost() {
  const [snack, setSnack] = useState<Snack | null>(null);
  const [bottom, setBottom] = useState('calc(var(--safe-bottom) + 76px)');

  useEffect(() => {
    snackListener = setSnack;
    return () => {
      snackListener = null;
    };
  }, []);

  // Float above the tab bar, or above a sticky action bar when one is on screen.
  useEffect(() => {
    if (!snack) return;
    const bar = document.querySelector('[data-sticky-bar]');
    const lift = bar ? Math.round(bar.getBoundingClientRect().height) + 76 : 76;
    setBottom(`calc(var(--safe-bottom) + ${lift}px)`);
  }, [snack]);

  useEffect(() => {
    if (!snack) return;
    const timer = window.setTimeout(() => setSnack(null), 3600);
    return () => window.clearTimeout(timer);
  }, [snack]);

  if (!snack) return null;

  return (
    <div
      className="pointer-events-none fixed inset-x-0 z-[60] px-3"
      style={{ bottom }}
      role="status"
      aria-live="polite"
    >
      <div className="snackbar-in pointer-events-auto mx-auto flex w-full max-w-app items-center gap-3 rounded-xl bg-[#33211A] px-4 py-3 text-white shadow-sheet">
        <p className="min-w-0 flex-1 text-sm leading-snug">{snack.message}</p>
        {snack.actionLabel && (
          <button
            type="button"
            className="tap shrink-0 rounded-lg px-2 py-1 text-sm font-bold uppercase tracking-wide text-[#FFC49A]"
            onClick={() => {
              snack.onAction?.();
              setSnack(null);
            }}
          >
            {snack.actionLabel}
          </button>
        )}
      </div>
    </div>
  );
}
