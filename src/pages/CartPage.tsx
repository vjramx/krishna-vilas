import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useCart } from '@/context/CartContext';
import { useHotelSettings } from '@/hooks/useHotelSettings';
import { useLanguage } from '@/context/LanguageContext';
import { BottomNav, TopBackBar } from '@/components/nav';
import { QtyStepper, EmptyState, Sheet, BottomActionBar } from '@/components/ui';
import { cartTotalsPaise, formatRupee, rupeesToPaise } from '@/lib/money';
import { ShoppingBag, Trash2, Trash, Wallet } from 'lucide-react';
import { haptic } from '@/lib/haptics';

export default function CartPage() {
  const { t, lang } = useLanguage();
  const cart = useCart();
  const { data: settings } = useHotelSettings();
  const [confirmClear, setConfirmClear] = useState(false);

  const feePaise = settings ? rupeesToPaise(settings.delivery_fee) : 0;
  const totals = useMemo(() => cartTotalsPaise(cart.lines, feePaise), [cart.lines, feePaise]);
  const hasUnavailable = cart.unavailableIds.length > 0;

  if (cart.lines.length === 0) {
    return (
      <div className="min-h-dvh bg-brand-bg">
        <TopBackBar title={t('cart.title')} />
        <main className="app-col pb-nav pt-4">
          <EmptyState
            icon={<ShoppingBag size={26} />}
            title={t('cart.empty')}
            hint={t('cart.emptyHint')}
            action={<Link to="/" className="btn-primary mt-2">{t('cart.browseMenu')}</Link>}
          />
        </main>
        <BottomNav />
      </div>
    );
  }

  return (
    <div className="min-h-dvh bg-brand-bg">
      <TopBackBar title={`${t('cart.title')} · ${cart.count}`} />

      <main className="app-col pb-cta pt-3">
        <section className="card overflow-hidden" aria-label={t('cart.title')}>
          <ul className="divide-y divide-brand-divider">
            {cart.lines.map((line) => (
              <li key={line.itemId} className="flex min-w-0 items-center gap-2 px-3 py-3">
                <div className="min-w-0 flex-1">
                  <p className="wrap-break-word text-[15px] font-semibold leading-snug">
                    {lang === 'kn' ? line.nameKn || line.nameEn : line.nameEn}
                  </p>
                  <p className="mt-0.5 text-[13px] text-brand-subtle">
                    {formatRupee(line.unitPaise)} × {line.quantity} ={' '}
                    <span className="font-bold text-brand-text">{formatRupee(line.unitPaise * line.quantity)}</span>
                  </p>
                </div>
                <QtyStepper value={line.quantity} min={0} onChange={(n) => cart.setQuantity(line.itemId, n)} size="sm" />
                <button
                  type="button"
                  className="tap grid h-10 w-10 shrink-0 place-items-center rounded-full text-brand-subtle active:bg-brand-errorBg active:text-brand-error"
                  aria-label={`${t('cart.delete')}: ${lang === 'kn' ? line.nameKn : line.nameEn}`}
                  onClick={() => {
                    haptic(6);
                    cart.remove(line.itemId);
                  }}
                >
                  <Trash2 size={18} aria-hidden="true" />
                </button>
              </li>
            ))}
          </ul>
        </section>

        {hasUnavailable && (
          <div className="card mt-2 border-brand-error/30 bg-brand-errorBg/50 p-3" role="alert">
            <p className="text-sm text-brand-error">{t('cart.unavailableInCart')}</p>
            <button
              type="button"
              className="btn-secondary mt-2 min-h-[44px] text-sm"
              onClick={() => cart.unavailableIds.forEach((id) => cart.remove(id))}
            >
              {t('cart.removeUnavailable')}
            </button>
          </div>
        )}

        <section className="card mt-3 p-4">
          <dl className="grid gap-2 text-sm">
            <div className="flex justify-between">
              <dt className="text-brand-subtle">{t('cart.itemTotal')}</dt>
              <dd className="font-medium">{formatRupee(totals.subtotal)}</dd>
            </div>
            <div className="flex justify-between">
              <dt className="text-brand-subtle">{t('cart.deliveryFee')}</dt>
              <dd className="font-medium">{formatRupee(totals.fee)}</dd>
            </div>
          </dl>
          <div className="mt-3 flex items-center gap-1.5 rounded-lg bg-brand-successBg px-2.5 py-2 text-[12px] font-semibold text-brand-success">
            <Wallet size={15} aria-hidden="true" />
            {t('checkout.codOnly')}
          </div>
        </section>

        <button
          type="button"
          className="btn-ghost mt-2 min-h-[44px] text-sm text-brand-error"
          onClick={() => setConfirmClear(true)}
        >
          <Trash size={16} aria-hidden="true" /> {t('common.clear')}
        </button>
      </main>

      <BottomActionBar aboveNav>
        <div className="min-w-0 flex-1">
          <p className="text-[11px] font-medium text-brand-subtle">{t('cart.checkoutBar')}</p>
          <p className="truncate text-lg font-extrabold leading-tight">{formatRupee(totals.total)}</p>
        </div>
        <Link to="/checkout" className="btn-primary min-w-0 flex-1 text-[15px]">
          {t('cart.checkout')}
        </Link>
      </BottomActionBar>

      <BottomNav />

      <Sheet open={confirmClear} onClose={() => setConfirmClear(false)} title={t('cart.clearConfirm')}>
        <div className="flex gap-2">
          <button type="button" className="btn-secondary flex-1" onClick={() => setConfirmClear(false)}>
            {t('common.cancel')}
          </button>
          <button
            type="button"
            className="btn-primary flex-1 bg-brand-error"
            onClick={() => {
              cart.clear();
              setConfirmClear(false);
            }}
          >
            {t('common.confirm')}
          </button>
        </div>
      </Sheet>
    </div>
  );
}
