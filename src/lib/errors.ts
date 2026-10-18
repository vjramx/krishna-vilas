/** Maps raw PostgREST/RPC error text to a stable i18nable message key. */

export interface KvError {
  key: string;
  detail?: string;
}

const RPC_CODE_MAP: Record<string, string> = {
  AUTH_REQUIRED: 'err.authRequired',
  ITEMS_REQUIRED: 'err.itemsRequired',
  NAME_INVALID: 'err.nameInvalid',
  PHONE_INVALID: 'err.phoneInvalid',
  ADDRESS_INVALID: 'err.addressInvalid',
  AREA_INVALID: 'err.areaInvalid',
  IDEMPOTENCY_REQUIRED: 'err.retry',
  HOTEL_NOT_CONFIGURED: 'err.generic',
  NOT_ACCEPTING_ORDERS: 'err.notAccepting',
  HOTEL_CLOSED: 'err.hotelClosed',
  MIN_ORDER_NOT_MET: 'err.minOrder',
  ITEM_NOT_FOUND: 'err.itemUnavailable',
  ITEM_UNAVAILABLE: 'err.itemUnavailable',
  ITEM_ID_INVALID: 'err.generic',
  QUANTITY_INVALID: 'err.qtyInvalid',
  PRICE_ERROR: 'err.generic',
  NOT_ADMINISTRATOR: 'err.forbidden',
  NOT_AGENT: 'err.forbidden',
  NOT_ASSIGNED: 'err.notAssigned',
  ORDER_NOT_FOUND: 'err.orderNotFound',
  NOT_DISPATCHABLE: 'err.notDispatchable',
  ALREADY_PICKED_UP: 'err.alreadyPickedUp',
  AGENT_INACTIVE: 'err.agentInactive',
  AGENT_NOT_SIGNED_UP: 'agent.notSignedUp',
  FINAL_STATE: 'err.finalState',
  INVALID_TRANSITION: 'err.invalidTransition',
  ETA_INVALID: 'err.etaInvalid',
  PIN_MISMATCH: 'err.pinMismatch',
  AMOUNT_INVALID: 'err.amountInvalid',
  NOTHING_RECORDED: 'err.nothingRecorded',
  ALREADY_HANDED: 'err.alreadyHanded',
  WRONG_STATE: 'err.wrongState',
  NOT_DISPATCHED: 'err.notDispatched',
  NOT_HANDED_OVER: 'err.notHandedOver',
  REASON_REQUIRED: 'err.reasonRequired',
  NOT_ORDER_OWNER: 'err.forbidden',
  CANCEL_TOO_LATE: 'err.cancelTooLate',
};

export function isMissingRpcFunction(error: unknown, functionName: string): boolean {
  if (!error || typeof error !== 'object') return false;
  const value = error as { code?: unknown; message?: unknown; details?: unknown };
  const message = `${String(value.message ?? '')} ${String(value.details ?? '')}`;
  return message.includes(functionName) && (
    value.code === 'PGRST202' || /schema cache|could not find the function|no matches were found/i.test(message)
  );
}

export function parseKvError(rawUnknown: unknown): KvError {
  let initial = '';
  if (rawUnknown instanceof Error) {
    initial = rawUnknown.message;
  } else if (rawUnknown && typeof rawUnknown === 'object' && 'message' in rawUnknown) {
    initial = String((rawUnknown as { message: unknown }).message);
  } else if (rawUnknown !== null && rawUnknown !== undefined) {
    initial = String(rawUnknown);
  }
  const raw = initial;
  // PL/pgSQL raises render as: 'CODE' e.g. {'message':'PIN_MISMATCH', ...} or
  // PostgREST wraps RPC errors as {"code":"P0001","message":"AUTH_REQUIRED"}
  let text = raw;
  try {
    if (raw.startsWith('{')) {
      const parsed = JSON.parse(raw) as { message?: string };
      if (parsed.message) text = parsed.message;
    }
  } catch {
    /* keep raw text */
  }
  // Forms: "AUTH_REQUIRED", "ITEM_UNAVAILABLE:Masala Dosa", "INVALID_TRANSITION:pending->ready"
  const code = text.split(':')[0]?.trim() ?? text;
  const detail = text.includes(':') ? text.split(':').slice(1).join(':').trim() : undefined;
  const key = RPC_CODE_MAP[code];
  if (key) return { key, detail };
  if (/network|fetch|Failed to fetch/i.test(text)) return { key: 'err.network' };
  if (/JWT|expired|invalid claim|token/i.test(text)) return { key: 'err.sessionExpired' };
  return { key: 'err.generic' };
}
