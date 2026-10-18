import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { z } from 'zod';
import { useCart } from '@/context/CartContext';
import { useHotelSettings } from '@/hooks/useHotelSettings';
import { useLanguage } from '@/context/LanguageContext';
import { useAuth } from '@/context/AuthContext';
import { TopBackBar } from '@/components/nav';
import { Sheet, BottomActionBar } from '@/components/ui';
import { cartTotalsPaise, formatRupee, rupeesToPaise } from '@/lib/money';
import { parseKvError } from '@/lib/errors';
import { supabase } from '@/lib/supabase';
import { DeliveryMap } from '@/components/DeliveryMap';
import { describeGeolocationError, getCurrentLocation, isGoodLocationAccuracy, isValidCoordinates, type ConfirmedDeliveryLocation, type Coordinates } from '@/lib/deliveryLocation';
import { BadgeCheck, ChevronRight, Crosshair, LogIn, MapPin, Wallet } from 'lucide-react';

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
const LOCATION_DRAFT_KEY = 'kv-checkout-location';

function readLocationDraft(): { location: ConfirmedDeliveryLocation | null; confirmed: boolean } {
  try {
    const raw = JSON.parse(sessionStorage.getItem(LOCATION_DRAFT_KEY) ?? 'null') as { location?: ConfirmedDeliveryLocation; confirmed?: boolean } | null;
    const valid = raw?.location && isValidCoordinates(raw.location) ? raw.location : null;
    const confirmed = !!valid && raw?.confirmed === true;
    return { location: confirmed ? valid : null, confirmed };
  } catch { return { location: null, confirmed: false }; }
}

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
      save: saved.save !== false,
    };
  });
  useEffect(() => {
    try {
      window.sessionStorage.setItem(DRAFT_KEY, JSON.stringify(form));
    } catch {
      // Checkout remains usable when storage is unavailable.
    }
  }, [form]);
  const [location, setLocation] = useState<ConfirmedDeliveryLocation | null>(() => readLocationDraft().location);
  const [locationConfirmed, setLocationConfirmed] = useState(() => readLocationDraft().confirmed);
  const [mapDraft, setMapDraft] = useState<ConfirmedDeliveryLocation | null>(null);
  useEffect(() => {
    try { sessionStorage.setItem(LOCATION_DRAFT_KEY, JSON.stringify({ location, confirmed: locationConfirmed })); } catch { /* best effort session draft */ }
  }, [location, locationConfirmed]);
  const [errors, setErrors] = useState<Partial<Record<keyof FormState, string>>>({});
  const [submitting, setSubmitting] = useState(false);
  const [serverError, setServerError] = useState<string | null>(null);
  const [closedInfo, setClosedInfo] = useState<{ message: string } | null>(null);
  const [locating, setLocating] = useState(false);
  const [locationError, setLocationError] = useState<string | null>(null);
  const [locationNotice, setLocationNotice] = useState<string | null>(null);
  const [mapOpen, setMapOpen] = useState(false);

  const feePaise = settings ? rupeesToPaise(settings.delivery_fee) : 0;
  const minTotal = settings ? rupeesToPaise(settings.min_order_total) : 0;
  const totals = useMemo(() => cartTotalsPaise(cart.lines, feePaise), [cart.lines, feePaise]);
  const belowMin = minTotal > 0 && totals.subtotal < minTotal;

  const save = (patch: Partial<FormState>) => setForm((f) => ({ ...f, ...patch }));
  function openMapPicker(seed = location) {
    setMapDraft(seed);
    setLocationError(null);
    setMapOpen(true);
  }

  function closeMapPicker() {
    setMapOpen(false);
    setMapDraft(null);
  }

  function confirmMapPicker() {
    if (!mapDraft) return;
    setLocation({ ...mapDraft, confirmedAt: new Date().toISOString() });
    setLocationConfirmed(true);
    setMapOpen(false);
    setMapDraft(null);
    setLocationError(null);
    setLocationNotice(t('checkout.locationSelected'));
  }

  async function locateCustomer() {
    setLocationError(null);
    setLocationNotice(null);
    if (!navigator.geolocation) { setLocationError(t('checkout.locationUnsupported')); return; }
    if (!window.isSecureContext) { setLocationError(t('checkout.locationHttps')); return; }
    setLocating(true);
    try {
      const position = await getCurrentLocation(navigator.geolocation);
      const coords = { latitude: position.coords.latitude, longitude: position.coords.longitude };
      if (!isValidCoordinates(coords)) throw new Error('invalid coordinates');
      const accuracy = Number.isFinite(position.coords.accuracy) ? position.coords.accuracy : null;
      const selected: ConfirmedDeliveryLocation = {
        ...coords,
        accuracyMeters: accuracy,
        source: 'browser_geolocation',
        confirmedAt: new Date().toISOString(),
      };
      setMapDraft(selected);
      setLocationNotice(accuracy !== null && isGoodLocationAccuracy(accuracy) ? t('checkout.locationFound') : t('checkout.locationPoorAccuracy', { accuracy: accuracy === null ? '—' : Math.round(accuracy) }));
      setMapOpen(true);
    } catch (error) {
      const code = typeof error === 'object' && error && 'code' in error ? Number((error as { code: unknown }).code) : -1;
      const key = describeGeolocationError({ code } as GeolocationPositionError);
      setLocationError(t(key === 'permission_denied' ? 'checkout.locationDenied' : key === 'timeout' ? 'checkout.locationTimeout' : key === 'unavailable' ? 'checkout.locationUnavailable' : 'checkout.locationGeneric'));
    } finally { setLocating(false); }
  }

  function adjustMapPin(next: Coordinates) {
    if (!isValidCoordinates(next)) return;
    setMapDraft({ ...next, accuracyMeters: null, source: 'map_pin', confirmedAt: new Date().toISOString() });
  }

  async function placeOrder() {
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
        first?.scrollIntoView({ behavior: 'smooth', block: 'center' });
      });
      return;
    }
    setErrors({});
    if (!session) {
      // Not an error: sign in (or tap the CTA) and come straight back here.
      navigate('/login?next=%2Fcheckout');
      return;
    }

    // Idempotency: reuse the generated key if a previous attempt never got a response.
    let idem = readPendingKey();
    if (!idem) {
      idem = crypto.randomUUID();
      try {
        window.sessionStorage.setItem('kv-order-pending', idem);
      } catch {
        /* ignore */
      }
    }

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
      p_delivery_latitude: location?.latitude ?? null,
      p_delivery_longitude: location?.longitude ?? null,
      p_location_accuracy_meters: location?.accuracyMeters ?? null,
      p_location_source: location?.source ?? 'manual_address',
      p_location_confirmed_at: locationConfirmed && location ? location.confirmedAt : null,
      p_delivery_details: {},
    };
    const { data, error } = await supabase.rpc('place_order_with_location', payload);
    if (error) {
      const kv = parseKvError(error);
      // A network failure is ambiguous: the server may have committed but the
      // response was lost. Keep the idempotency key so retry cannot duplicate.
      if (kv.key !== 'err.network') clearPendingKey();
      if (kv.key === 'err.hotelClosed' || kv.key === 'err.notAccepting') {
        setClosedInfo({ message: t(kv.key) });
        setSubmitting(false);
        return;
      }
      setServerError(kv.detail ? `${t(kv.key)} (${kv.detail})` : t(kv.key));
      setSubmitting(false);
      requestAnimationFrame(() =>
        document.querySelector('[data-checkout-error]')?.scrollIntoView({ behavior: 'smooth', block: 'center' }),
      );
      return;
    }
    // Backend confirmed — now (and only now) clear the cart.
    clearPendingKey();
    try {
      window.sessionStorage.removeItem(DRAFT_KEY);
      window.sessionStorage.removeItem(LOCATION_DRAFT_KEY);
    } catch {
      // Storage may be unavailable.
    }
    cart.clear();
    if (form.save) {
      try {
        const { save: _s, ...details } = form;
        window.localStorage.setItem(DETAILS_KEY, JSON.stringify(details));
        void _s;
        if ( userId) {
          await supabase.from('profiles').upsert({ id: userId, display_name: form.name.trim(), phone: form.phone.trim() });
        }
      } catch {
        /* non-critical */
      }
    }
    navigate(`/order/${(data as { order_id: string }).order_id}?confirmed=1`, { replace: true });
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
    ? t('checkout.minOrder', {
        amount: formatRupee(minTotal, { withSymbol: false }),
        more: formatRupee(minTotal - totals.subtotal, { withSymbol: false }),
      })
    : null;
  const blockedReason = settingsUnavailable
    ? t('err.network')
    : closed
      ? t('checkout.notAccepting')
      : minOrderNotice;
  const canSubmit =
    !submitting && !authLoading && !!session && !!settings && !settingsLoading && !settingsUnavailable && !closed && !belowMin && cart.lines.length > 0;

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
            <div className="flex justify-between"><dt>{t('cart.deliveryFee')}</dt><dd>{formatRupee(totals.fee)}</dd></div>
            <div className="flex justify-between font-bold"><dt>{t('common.total')}</dt><dd>{formatRupee(totals.total)}</dd></div>
          </dl>
          {belowMin && (
            <p className="mt-2 text-xs text-brand-warn">
              {t('checkout.minOrder', { amount: formatRupee(minTotal, { withSymbol: false }), more: formatRupee(minTotal - totals.subtotal, { withSymbol: false }) })}
            </p>
          )}
        </section>

        {signedOut && (
          <section
            className="card mt-3 flex items-center gap-3 border-brand-primary/25 bg-brand-primary/[0.04] p-3.5"
            aria-label={t('checkout.signInToOrder')}
          >
            <span className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-brand-primary/10 text-brand-primary" aria-hidden="true">
              <LogIn size={20} />
            </span>
            <div className="min-w-0 flex-1">
              <p className="text-sm font-semibold leading-snug">{t('checkout.signInToOrder')}</p>
              <p className="text-[12px] leading-snug text-brand-subtle">{t('checkout.signInHint')}</p>
            </div>
            <Link to="/login?next=%2Fcheckout" className="btn-primary shrink-0 px-4 text-sm">
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
            <input id="ck-phone" className="input tabular-nums" data-invalid={!!errors.phone} inputMode="tel" autoComplete="tel"
              maxLength={10} value={form.phone} onChange={(e) => save({ phone: e.target.value.replace(/[^0-9]/g, '') })} aria-invalid={!!errors.phone} />
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
          <section className="grid gap-2 rounded-2xl border border-brand-border bg-white p-3" data-location-picker aria-labelledby="delivery-location-heading">
            <div>
              <h2 id="delivery-location-heading" className="text-sm font-bold">{t('checkout.locationHeading')}</h2>
              <p className="mt-0.5 text-xs text-brand-subtle">{t('checkout.locationPrivacy')}</p>
            </div>
            <div className="overflow-hidden rounded-xl border border-brand-border divide-y divide-brand-border">
              <button type="button" aria-label={t('checkout.useCurrentLocation')} className="flex min-h-[56px] w-full items-center gap-3 px-3 text-left active:bg-brand-bg disabled:opacity-60" onClick={() => void locateCustomer()} disabled={locating}>
                <Crosshair size={19} className="shrink-0 text-brand-primary" aria-hidden="true" />
                <span className="min-w-0 flex-1">
                  <span className="block text-sm font-semibold">{locating ? t('checkout.locating') : t('checkout.useCurrentLocation')}</span>
                  <span className="block text-xs text-brand-subtle">{t('checkout.locationCurrentSubtitle')}</span>
                </span>
                {locating ? <span className="h-4 w-4 animate-spin rounded-full border-2 border-brand-border border-t-brand-primary" role="status" aria-label={t('checkout.locating')} /> : <ChevronRight size={18} className="text-brand-subtle" aria-hidden="true" />}
              </button>
              <button type="button" aria-label={t('checkout.chooseMap')} className="flex min-h-[56px] w-full items-center gap-3 px-3 text-left active:bg-brand-bg" onClick={() => openMapPicker()}>
                <MapPin size={19} className="shrink-0 text-brand-primary" aria-hidden="true" />
                <span className="min-w-0 flex-1">
                  <span className="block text-sm font-semibold">{t('checkout.chooseMap')}</span>
                  <span className="block text-xs text-brand-subtle">{t('checkout.mapSubtitle')}</span>
                </span>
                <ChevronRight size={18} className="text-brand-subtle" aria-hidden="true" />
              </button>
            </div>
            {locationError && <p className="rounded-lg bg-brand-warnBg/60 px-2.5 py-1.5 text-xs leading-snug text-brand-warn" role="alert">{locationError}</p>}
            {locationNotice && !locationConfirmed && <p className="text-xs text-brand-success" role="status">{locationNotice}</p>}
            {locationConfirmed && location && (
              <div className="flex flex-wrap items-center gap-x-2 gap-y-1 rounded-lg bg-brand-successBg px-2.5 py-2" role="status">
                <BadgeCheck size={17} className="shrink-0 text-brand-success" aria-hidden="true" />
                <span className="min-w-0 flex-1 text-xs font-semibold text-brand-success">
                  <span className="block">{t('checkout.locationSelected')}</span>
                  <span className="block font-normal">{t('checkout.reviewLocation')}</span>
                </span>
                <button type="button" className="min-h-[40px] px-2 text-xs font-semibold text-brand-primary" onClick={() => openMapPicker(location)}>{t('checkout.changeLocation')}</button>
                <button type="button" className="min-h-[40px] px-2 text-xs font-semibold text-brand-subtle" onClick={() => { setLocation(null); setLocationConfirmed(false); setLocationNotice(null); setLocationError(null); }}>{t('checkout.removeLocation')}</button>
              </div>
            )}
          </section>

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
          {!signedOut && blockedReason && (
            <p className="truncate text-[10px] font-semibold text-brand-warn">{blockedReason}</p>
          )}
        </div>
        {signedOut ? (
          <Link to="/login?next=%2Fcheckout" className="btn-primary min-w-0 flex-[1.5] text-[15px]">
            {t('common.signIn')}
          </Link>
        ) : (
          <button form="checkout-form" type="submit" className="btn-primary min-w-0 flex-[1.5] text-[15px]" disabled={!canSubmit}>
            {submitting ? t('checkout.placing') : t('checkout.placeOrder')}
          </button>
        )}
      </BottomActionBar>

      <Sheet open={mapOpen} onClose={closeMapPicker} title={t('checkout.chooseMap')}>
        <div className="grid gap-3">
          <p className="text-sm text-brand-subtle">{t('checkout.mapInstructions')}</p>
          <DeliveryMap coordinates={mapDraft} onChange={adjustMapPin} interactive height={360} label={t('checkout.mapLabel')} />
          {mapDraft && <p className="text-xs text-brand-subtle">{t('checkout.pinCoordinates', { latitude: mapDraft.latitude.toFixed(6), longitude: mapDraft.longitude.toFixed(6) })}</p>}
          <button type="button" className="btn-primary w-full" disabled={!mapDraft} onClick={confirmMapPicker}>{t('checkout.confirmPin')}</button>
        </div>
      </Sheet>

      <Sheet open={!!closedInfo} onClose={() => setClosedInfo(null)} title={t('confirm.title')}>
        <p className="text-sm" role="alert">{closedInfo?.message}{closedWindow ? ` (${t('checkout.closed', { hours: closedWindow })})` : ''}</p>
        <button type="button" className="btn-primary mt-3 w-full" onClick={() => { setClosedInfo(null); navigate('/cart'); }}>{t('common.close')}</button>
      </Sheet>
    </div>
  );
}
