import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { z } from 'zod';
import { useCart } from '@/context/CartContext';
import type { MenuItem } from '@/types/db';
import { useHotelSettings } from '@/hooks/useHotelSettings';
import { useLanguage } from '@/context/LanguageContext';
import { useAuth } from '@/context/AuthContext';
import { TopBackBar } from '@/components/nav';
import { Sheet, BottomActionBar } from '@/components/ui';
import { cartTotalsPaise, formatRupee, rupeesToPaise } from '@/lib/money';
import { parseKvError } from '@/lib/errors';
import { supabase } from '@/lib/supabase';
import { currentFirebaseUser, isGuestSession, signInAsGuest } from '@/lib/firebase';
import { BadgeCheck, LogIn, Wallet } from 'lucide-react';

const checkoutSchema = z.object({
  name: z.string().trim().min(2).max(80),
  phone: z.string().trim().regex(/^[6-9][0-9]{9}$/),
  address: z.string().trim().min(5).max(250),
  area: z.string().trim().min(2).max(80),
  landmark: z.string().trim().max(80).optional(),
  instructions: z.string().trim().max(250).optional(),
});

const DETAILS_KEY = 'kv-delivery-details';
const DRAFT_KEY = 'kv-checkout-draft';

type FormState = { name: string; phone: string; address: string; area: string; landmark: string; instructions: string; save: boolean };

/** Idempotency key survives reloads until order creation is confirmed. */
function readPendingKey(): string | null {
  try {
    return window.sessionStorage.getItem('kv-order-pending');
  } catch {
    return null;
  }
}
function clearPendingKey(): void {
  try {
    window.sessionStorage.removeItem('kv-order-pending');
  } catch {
    /* ignore */
  }
}

function createIdempotencyKey(): string {
  if (typeof crypto.randomUUID === 'function') return crypto.randomUUID();
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  bytes[6] = (bytes[6]! & 0x0f) | 0x40;
  bytes[8] = (bytes[8]! & 0x3f) | 0x80;
  const hex = Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

function scrollIntoViewIfAvailable(element: Element | null, options: ScrollIntoViewOptions): void {
  if (element && typeof element.scrollIntoView === 'function') element.scrollIntoView(options);
}

interface CheckoutOffer {
  discount_type: 'percent' | 'flat';
  discount_value: number | string;
  scope: 'item' | 'category' | 'all';
  target_id: string | null;
}

function checkoutDiscounts(
  lines: { itemId: string; unitPaise: number; quantity: number }[],
  items: Pick<MenuItem, 'id' | 'category_id'>[],
  offers: CheckoutOffer[],
): Record<string, number> {
  return Object.fromEntries(lines.map((line) => {
    const item = items.find((candidate) => candidate.id === line.itemId);
    const discount = offers.reduce((best, offer) => {
      const applies = offer.scope === 'all'
        || (offer.scope === 'item' && offer.target_id === line.itemId)
        || (offer.scope === 'category' && offer.target_id === item?.category_id);
      if (!applies) return best;
      const value = Number(offer.discount_value);
      if (!Number.isFinite(value) || value <= 0) return best;
      const amount = offer.discount_type === 'percent'
        ? Math.round(line.unitPaise * value / 100)
        : rupeesToPaise(value);
      return Math.max(best, Math.min(line.unitPaise, amount));
    }, 0);
    return [line.itemId, discount];
  }));
}

export default function CheckoutPage() {
  const cart = useCart();
  const { t, lang } = useLanguage();
  const { session, userId, loading: authLoading } = useAuth();
  const { data: settings, loading: settingsLoading, retry: retrySettings } = useHotelSettings();
  const navigate = useNavigate();

  const [form, setForm] = useState<FormState>(() => {
    let saved: Partial<FormState> = {};
    try {
      saved = JSON.parse(window.localStorage.getItem(DETAILS_KEY) ?? '{}') as Partial<FormState>;
    } catch {
      /* ignore */
    }
    // Session-only draft survives the Google redirect without opting into
    // permanent storage when “Save my details” is unchecked.
    try {
      const draft: unknown = JSON.parse(window.sessionStorage.getItem(DRAFT_KEY) ?? 'null');
      if (draft && typeof draft === 'object') saved = draft as Partial<FormState>;
    } catch {
      // Corrupt or unavailable storage must not prevent checkout.
    }
    const text = (value: unknown) => typeof value === 'string' ? value : '';
    return {
      name: text(saved.name),
      phone: text(saved.phone),
      address: text(saved.address),
      area: text(saved.area),
      landmark: text(saved.landmark),
      instructions: text(saved.instructions),
      save: saved.save === true,
    };
  });
  useEffect(() => {
    try {
      window.sessionStorage.setItem(DRAFT_KEY, JSON.stringify(form));
    } catch {
      // Checkout remains usable when storage is unavailable.
    }
  }, [form]);
  const [errors, setErrors] = useState<Partial<Record<keyof FormState, string>>>({});
  const [catalogLoading, setCatalogLoading] = useState(cart.lines.length > 0);
  const [catalogError, setCatalogError] = useState<string | null>(null);
  const [catalogAttempt, setCatalogAttempt] = useState(0);
  const [activeOffers, setActiveOffers] = useState<CheckoutOffer[]>([]);
  const [catalogItems, setCatalogItems] = useState<Pick<MenuItem, 'id' | 'category_id'>[]>([]);
  const catalogItemIds = cart.lines.map((line) => line.itemId).join('|');
  const syncCartPrices = cart.syncPrices;
  const markCartUnavailable = cart.markUnavailable;
  const [submitting, setSubmitting] = useState(false);
  const submitLockRef = useRef(false);
  const pendingIdempotencyKeyRef = useRef<string | null>(null);
  const [serverError, setServerError] = useState<string | null>(null);
  const [closedInfo, setClosedInfo] = useState<{ message: string } | null>(null);

  const feePaise = settings ? rupeesToPaise(settings.delivery_fee) : 0;
  const minTotal = settings ? rupeesToPaise(settings.min_order_total) : 0;
  const discountPerUnitPaise = useMemo(
    () => checkoutDiscounts(cart.lines, catalogItems, activeOffers),
    [cart.lines, catalogItems, activeOffers],
  );
  const totals = useMemo(() => cartTotalsPaise(cart.lines, feePaise, discountPerUnitPaise), [cart.lines, feePaise, discountPerUnitPaise]);

  useEffect(() => {
    if (!catalogItemIds) {
      setCatalogLoading(false);
      setCatalogError(null);
      return;
    }
    let active = true;
    const controller = new AbortController();
    const timeout = window.setTimeout(() => controller.abort(), 12000);
    setCatalogLoading(true);
    setCatalogError(null);
    void (async () => {
      try {
        const now = new Date().toISOString();
        const [catalogResult, offersResult] = await Promise.all([
          supabase.from('menu_items')
            .select('id, category_id, price, name_en, name_kn, is_active, is_available')
            .in('id', catalogItemIds.split('|'))
            .abortSignal(controller.signal),
          supabase.from('special_offers')
            .select('discount_type, discount_value, scope, target_id')
            .eq('is_active', true)
            .lte('starts_at', now)
            .gte('ends_at', now)
            .abortSignal(controller.signal),
        ]);
        if (!active) return;
        if (catalogResult.error || offersResult.error) {
          setCatalogError(catalogResult.error?.message ?? offersResult.error?.message ?? 'catalog fetch failed');
          return;
        }
        const items = (catalogResult.data ?? []) as Pick<MenuItem, 'id' | 'category_id' | 'price' | 'name_en' | 'name_kn' | 'is_active' | 'is_available'>[];
        setCatalogItems(items.map(({ id, category_id }) => ({ id, category_id })));
        setActiveOffers((offersResult.data ?? []) as CheckoutOffer[]);
        syncCartPrices(items);
        const foundIds = new Set(items.map((item) => item.id));
        const unavailableIds = catalogItemIds.split('|').filter((itemId) => {
          const item = items.find((candidate) => candidate.id === itemId);
          return !foundIds.has(itemId) || !item?.is_active || !item.is_available;
        });
        markCartUnavailable(unavailableIds);
      } catch (error: unknown) {
        if (active) setCatalogError(error instanceof Error ? error.message : String(error));
      } finally {
        window.clearTimeout(timeout);
        if (active) setCatalogLoading(false);
      }
    })();
    return () => {
      active = false;
      window.clearTimeout(timeout);
      controller.abort();
    };
  }, [catalogAttempt, catalogItemIds, markCartUnavailable, syncCartPrices]);
  const belowMin = minTotal > 0 && totals.subtotal < minTotal;
  const remainingToMin = Math.max(0, minTotal - totals.subtotal);

  // Zomato/Swiggy-style: the confirmed pin is the delivery point; the address
  // text (street + house details) describes it. Editing the text therefore must
  // NOT discard the pin — the customer can re-target with Change location.
  const save = (patch: Partial<FormState>) => setForm((f) => ({ ...f, ...patch }));
  async function placeOrder() {
    if (submitting || submitLockRef.current || catalogLoading || catalogError || cart.unavailableIds.length > 0) return;
    const parsed = checkoutSchema.safeParse(form);
    const nextErrors: Partial<Record<keyof FormState, string>> = {};
    if (!parsed.success) {
      for (const issue of parsed.error.issues) {
        const field = issue.path[0] as keyof FormState | undefined;
        if (field && !nextErrors[field]) {
          nextErrors[field] =
            field === 'name' ? t('checkout.nameRequired')
            : field === 'phone' ? t('checkout.phoneRequired')
            : field === 'address' ? t('checkout.addressRequired')
            : field === 'area' ? t('checkout.areaRequired')
            : t('common.somethingWrong');
        }
      }
      setErrors(nextErrors);
      requestAnimationFrame(() => {
        const first = document.querySelector<HTMLElement>('[data-invalid="true"]');
        first?.focus();
        scrollIntoViewIfAvailable(first, { behavior: 'smooth', block: 'center' });
      });
      return;
    }
    setErrors({});
    if (!session) {
      // Guest checkout: order without an account. A Firebase anonymous session
      // (created here or already on the device) becomes the order's owner —
      // the backend sees the same JWT subject shape, so no schema/RLS change.
      setSubmitting(true);
      setServerError(null);
      try {
        await signInAsGuest();
      } catch {
        setServerError(t('err.authRequired'));
        setSubmitting(false);
        return;
      }
      if (!currentFirebaseUser()) {
        setServerError(t('err.authRequired'));
        setSubmitting(false);
        return;
      }
    }

    // Idempotency: reuse the generated key if a previous attempt never got a response.
    let idem = pendingIdempotencyKeyRef.current ?? readPendingKey();
    if (!idem) idem = createIdempotencyKey();
    pendingIdempotencyKeyRef.current = idem;
    try {
      window.sessionStorage.setItem('kv-order-pending', idem);
    } catch {
      // Keep the key in memory for safe retries in WebViews with blocked storage.
    }

    submitLockRef.current = true;
    setSubmitting(true);
    setServerError(null);
    const payload = {
      p_items: cart.lines.map((l) => ({ item_id: l.itemId, quantity: l.quantity })),
      p_customer_name: form.name.trim(),
      p_phone: form.phone.trim(),
      p_address_line: form.address.trim(),
      p_area: form.area.trim(),
      p_landmark: form.landmark?.trim() || null,
      p_instructions: form.instructions?.trim() || null,
      p_idempotency_key: idem,
      // Address-only checkout: no pin is captured in the browser, so the exact
      // coordinates are saved by the backend as null and the source stays
      // 'manual_address' (accepted by place_order_with_location).
      p_delivery_latitude: null,
      p_delivery_longitude: null,
      p_location_accuracy_meters: null,
      p_location_source: 'manual_address',
      p_location_confirmed_at: null,
      p_delivery_details: {},
    };
    try {
      const { data, error } = await supabase.rpc('place_order_with_location', payload);
      if (error) {
        const kv = parseKvError(error);
        // A network failure is ambiguous: the server may have committed but the
        // response was lost. Keep the idempotency key so retry cannot duplicate.
        if (kv.key !== 'err.network') {
          clearPendingKey();
          pendingIdempotencyKeyRef.current = null;
        }
        if (kv.key === 'err.hotelClosed' || kv.key === 'err.notAccepting') {
          setClosedInfo({ message: t(kv.key) });
          return;
        }
        const message = kv.key === 'err.minOrder' && kv.detail
          ? t('checkout.minFoodSubtotal', {
              amount: formatRupee(rupeesToPaise(kv.detail), { withSymbol: false }),
              more: formatRupee(Math.max(0, rupeesToPaise(kv.detail) - totals.subtotal), { withSymbol: false }),
            })
          : kv.detail ? `${t(kv.key)} (${kv.detail})` : t(kv.key);
        setServerError(message);
        requestAnimationFrame(() =>
          scrollIntoViewIfAvailable(document.querySelector('[data-checkout-error]'), { behavior: 'smooth', block: 'center' }),
        );
        return;
      }
      const orderId = data && typeof data === 'object' && 'order_id' in data && typeof data.order_id === 'string'
        ? data.order_id
        : null;
      if (!orderId) {
        // A malformed/empty response is ambiguous. Keep the cart and key so a
        // retry safely resolves through the database idempotency constraint.
        setServerError(t('err.generic'));
        return;
      }
      // Backend confirmed — now (and only now) clear the cart.
      clearPendingKey();
      pendingIdempotencyKeyRef.current = null;
      try {
        window.sessionStorage.removeItem(DRAFT_KEY);
      } catch {
        // Storage may be unavailable.
      }
      cart.clear();
      if (form.save) {
        try {
          const { save: _s, ...details } = form;
          window.localStorage.setItem(DETAILS_KEY, JSON.stringify(details));
          void _s;
          // Guests get no profile row: their details live only in the order.
          if (userId && !isGuestSession()) {
            await supabase.from('profiles').upsert({ id: userId, display_name: form.name.trim(), phone: form.phone.trim() });
          }
        } catch {
          /* non-critical */
        }
      }
      navigate(`/order/${orderId}?confirmed=1`, { replace: true });
    } catch (error) {
      const kv = parseKvError(error);
      // Any thrown request is ambiguous: retain the idempotency key for a safe retry.
      setServerError(t(kv.key));
      requestAnimationFrame(() =>
        scrollIntoViewIfAvailable(document.querySelector('[data-checkout-error]'), { behavior: 'smooth', block: 'center' }),
      );
    } finally {
      submitLockRef.current = false;
      setSubmitting(false);
    }
  }

  const closedWindow =
    settings && settings.is_accepting_orders
      ? `${settings.opens_at.slice(0, 5)}–${settings.closes_at.slice(0, 5)}`
      : null;

  // A signed-out customer must get a sign-in step, never a red error after
  // filling the whole form. Same for a settings fetch that came back empty.
  const signedOut = !authLoading && !session;
  const settingsUnavailable = !settingsLoading && !settings;
  const closed = !!settings && !settings.is_accepting_orders;
  const minOrderNotice = belowMin
    ? t('checkout.minFoodSubtotal', {
        amount: formatRupee(minTotal, { withSymbol: false }),
        more: formatRupee(remainingToMin, { withSymbol: false }),
      })
    : null;
  const blockedReason = authLoading || (settingsLoading && !settings) || catalogLoading
    ? t('common.loading')
    : catalogError
      ? t('err.network')
      : cart.unavailableIds.length > 0
        ? t('cart.unavailableInCart')
        : settingsUnavailable
          ? t('err.network')
          : closed
            ? t('checkout.notAccepting')
            : cart.lines.length === 0
              ? t('err.itemsRequired')
              : belowMin
                ? t('checkout.minFoodSubtotalShort', { more: formatRupee(remainingToMin, { withSymbol: false }) })
                : null;
  const canSubmit =
    !submitting && !authLoading && !!settings && !settingsLoading && !settingsUnavailable && !catalogLoading && !catalogError && cart.unavailableIds.length === 0 && !closed && !belowMin && cart.lines.length > 0;

  return (      <div className="min-h-dvh bg-brand-bg">
      <TopBackBar title={t('checkout.title')} />
      <main className="app-col pb-40 pt-3">
        {settingsUnavailable && (
          <div role="alert" className="card mb-3 p-3 text-sm">
            <p className="text-brand-error">{t('err.network')}</p>
            <button type="button" className="btn-secondary mt-2 min-h-[44px] text-sm" onClick={retrySettings}>
              {t('common.retry')}
            </button>
          </div>
        )}
        {closed && (
          <div role="alert" className="card mb-3 p-3 text-sm text-brand-error">{t('checkout.notAccepting')}</div>
        )}
        {cart.unavailableIds.length > 0 && (
          <div className="card mb-3 border-brand-error/30 bg-brand-errorBg/50 p-3 text-sm" role="alert">
            <p className="text-brand-error">{t('cart.unavailableInCart')}</p>
            <button type="button" className="btn-secondary mt-2 min-h-[44px] text-sm" onClick={() => cart.unavailableIds.forEach((itemId) => cart.remove(itemId))}>
              {t('cart.removeUnavailable')}
            </button>
          </div>
        )}
        {catalogError && (
          <div className="card mb-3 p-3 text-sm" role="alert">
            <p className="text-brand-error">{t('err.network')}</p>
            <button type="button" className="btn-secondary mt-2 min-h-[44px] text-sm" onClick={() => setCatalogAttempt((attempt) => attempt + 1)}>
              {t('common.retry')}
            </button>
          </div>
        )}

        <section className="card p-4" aria-labelledby="ck-items">
          <h2 id="ck-items" className="mb-2 font-bold">{t('checkout.summary')}</h2>
          <ul className="grid gap-1 text-sm">
            {cart.lines.map((l) => (
              <li key={l.itemId} className="flex justify-between gap-2">
                <span className="min-w-0 truncate">{lang === 'kn' ? l.nameKn || l.nameEn : l.nameEn} × {l.quantity}</span>
                <span className="whitespace-nowrap">{formatRupee(l.unitPaise * l.quantity)}</span>
              </li>
            ))}
          </ul>
          <dl className="mt-2 grid gap-1 border-t border-brand-border pt-2 text-sm">
            <div className="flex justify-between"><dt>{t('cart.itemTotal')}</dt><dd>{formatRupee(totals.subtotal)}</dd></div>
            {totals.discount > 0 && <div className="flex justify-between text-brand-success"><dt>{t('cart.discount')}</dt><dd>-{formatRupee(totals.discount)}</dd></div>}
            <div className="flex justify-between"><dt>{t('cart.deliveryFee')}</dt><dd>{formatRupee(totals.fee)}</dd></div>
            <div className="flex justify-between font-bold"><dt>{t('common.total')}</dt><dd>{formatRupee(totals.total)}</dd></div>
          </dl>
          {belowMin && (
            <p className="mt-2 text-xs text-brand-warn">
              {minOrderNotice}
            </p>
          )}
        </section>

        {signedOut && (
          <section
            className="card mt-3 flex items-center gap-3 border-brand-primary/25 bg-brand-primary/[0.04] p-3.5"
            aria-label={t('checkout.guestOk')}
          >
            <span className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-brand-primary/10 text-brand-primary" aria-hidden="true">
              <LogIn size={20} />
            </span>
            <div className="min-w-0 flex-1">
              <p className="text-sm font-semibold leading-snug">{t('checkout.guestOk')}</p>
              <p className="text-[12px] leading-snug text-brand-subtle">{t('checkout.guestHint')}</p>
            </div>
            <Link to="/login?next=%2Fcheckout" className="btn-secondary shrink-0 px-3 text-sm">
              {t('common.signIn')}
            </Link>
          </section>
        )}

        <form id="checkout-form" className="mt-3 grid gap-3" onSubmit={(e) => { e.preventDefault(); void placeOrder(); }} noValidate>
          <div>
            <label className="label" htmlFor="ck-name">{t('checkout.name')}</label>
            <input id="ck-name" className="input" data-invalid={!!errors.name} autoComplete="name" value={form.name}
              onChange={(e) => save({ name: e.target.value })} aria-invalid={!!errors.name} />
            {errors.name && <p className="mt-1 text-xs text-brand-error" role="alert">{errors.name}</p>}
          </div>
          <div>
            <label className="label" htmlFor="ck-phone">{t('checkout.phone')}</label>
            <div className="flex items-stretch" data-phone-group>
              <span
                aria-hidden="true"
                className="grid shrink-0 place-items-center rounded-l-xl border border-r-0 border-brand-border bg-brand-bg px-3 text-sm font-semibold text-brand-subtle"
              >
                +91
              </span>
              <input id="ck-phone" className="input rounded-l-none tabular-nums" data-invalid={!!errors.phone} inputMode="tel" autoComplete="tel national"
                placeholder="9876543210" maxLength={10} value={form.phone} onChange={(e) => save({ phone: e.target.value.replace(/[^0-9]/g, '') })} aria-invalid={!!errors.phone} />
            </div>
            <p className="mt-0.5 text-xs text-brand-subtle">{t('checkout.phoneHint')}</p>
            {errors.phone && <p className="mt-1 text-xs text-brand-error" role="alert">{errors.phone}</p>}
          </div>
          <div>
            <label className="label" htmlFor="ck-address">{t('checkout.address')}</label>
            <textarea id="ck-address" className="input min-h-20" data-invalid={!!errors.address} maxLength={250}
              value={form.address} onChange={(e) => save({ address: e.target.value })} aria-invalid={!!errors.address} />
            <p className="mt-0.5 text-xs text-brand-subtle">{form.address.length}/250</p>
            {errors.address && <p className="mt-1 text-xs text-brand-error" role="alert">{errors.address}</p>}
          </div>
          <div>
            <label className="label" htmlFor="ck-area">{t('checkout.area')}</label>
            <input id="ck-area" className="input" data-invalid={!!errors.area} maxLength={80}
              value={form.area} onChange={(e) => save({ area: e.target.value })} aria-invalid={!!errors.area} />
            {errors.area && <p className="mt-1 text-xs text-brand-error" role="alert">{errors.area}</p>}
          </div>
          <div>
            <label className="label" htmlFor="ck-landmark">{t('checkout.landmark')} <span className="font-normal text-brand-subtle">{t('common.optional')}</span></label>
            <input id="ck-landmark" className="input" maxLength={80} value={form.landmark} onChange={(e) => save({ landmark: e.target.value })} />
          </div>

          <div>
            <label className="label" htmlFor="ck-instr">{t('checkout.instructions')} <span className="font-normal text-brand-subtle">{t('common.optional')}</span></label>
            <textarea id="ck-instr" className="input min-h-16" maxLength={250} placeholder={t('checkout.instructionsPlaceholder')}
              value={form.instructions} onChange={(e) => save({ instructions: e.target.value })} />
          </div>

          <fieldset>
            <legend className="label">{t('checkout.payment')}</legend>
            <div className="flex items-center gap-2 rounded-xl border border-brand-border bg-brand-bg p-3" aria-label={`${t('checkout.payment')}: ${t('checkout.cod')}`}>
              <Wallet size={18} className="text-brand-primary" aria-hidden="true" />
              <div className="min-w-0">
                <p className="text-sm font-semibold">{t('checkout.cod')}</p>
                <p className="text-xs text-brand-subtle">{t('checkout.codOnly')}</p>
              </div>
              <BadgeCheck size={18} className="ml-auto shrink-0 text-brand-success" aria-hidden="true" />
            </div>
          </fieldset>



          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={form.save} onChange={(e) => save({ save: e.target.checked })} className="h-5 w-5 accent-[#C83E24]" />
            {t('checkout.saveDetails')}
          </label>

          {serverError && (
            <p data-checkout-error className="text-sm text-brand-error" role="alert">{serverError}</p>
          )}
        </form>
      </main>

      {/* Sticky pay bar — always reachable with one thumb, like a native checkout. */}
      <BottomActionBar>
        <div className="min-w-0 flex-1">
          <p className="text-[11px] font-medium text-brand-subtle">{t('common.total')}</p>
          <p className="truncate text-lg font-extrabold leading-tight">{formatRupee(totals.total)}</p>
          {blockedReason && (
            <p id="checkout-submit-blocked" className="truncate text-[10px] font-semibold text-brand-warn">{blockedReason}</p>
          )}
        </div>
        {/* Guests order here too: placeOrder() signs in anonymously on the fly,
            so the button is shown regardless of session state. */}
        <button form="checkout-form" type="submit" className="btn-primary min-h-12 min-w-[132px] flex-[1.5] whitespace-nowrap px-3 text-[15px]" disabled={!canSubmit} aria-describedby={!canSubmit && blockedReason ? 'checkout-submit-blocked' : undefined} aria-busy={submitting}>
          {submitting ? t('checkout.placing') : t('checkout.placeOrder')}
        </button>
      </BottomActionBar>

      <Sheet open={!!closedInfo} onClose={() => setClosedInfo(null)} title={t('confirm.title')}>
        <p className="text-sm" role="alert">{closedInfo?.message}{closedWindow ? ` (${t('checkout.closed', { hours: closedWindow })})` : ''}</p>
        <button type="button" className="btn-primary mt-3 w-full" onClick={() => { setClosedInfo(null); navigate('/cart'); }}>{t('common.close')}</button>
      </Sheet>
    </div>
  );
}
