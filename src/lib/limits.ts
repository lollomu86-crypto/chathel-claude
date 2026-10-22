// Costanti condivise tra store demo, store Supabase e handler. Modulo NEUTRO: non importa codice demo,
// cosi' le password e i dati di esempio non finiscono nel bundle di produzione.

export const KB_MAX_TOTAL = 25_000;
export const NOTIFICATIONS_PER_DAY = 10;
export const GUEST_MESSAGES_PER_DAY = 30;
export const GUEST_MESSAGES_PER_MINUTE = 12;
export const GUEST_MESSAGE_MAX_CHARS = 1000;

/** Ingresso da QR: limiti applicati nei handler (identita' = limite principale, il resto e' difesa in profondita'). */
export const ENTRY_LIMITS = {
  perIdentity: { limit: 5, windowMs: 10 * 60_000 },
  perIp: { limit: 30, windowMs: 10 * 60_000 },
  perHotel: { limit: 60, windowMs: 60_000 },
  perCode: { limit: 300, windowMs: 10 * 60_000 },
  global: { limit: 1_000, windowMs: 60_000 },
  /** tentativi con QR errato per hotel: contro la ricerca del codice */
  badCodePerHotel: { limit: 30, windowMs: 10 * 60_000 },
} as const;

/** Tetto di bonus emessi nell'ora, per hotel (oltre al tetto stagionale). Configurabile per hotel. */
export const BONUS_MAX_PER_HOUR_DEFAULT = 60;

/** Tetto di coupon per hotel (oltre ai limiti per mittente). Configurabile per hotel. */
export const HOTEL_COUPON_DAILY_CAP_DEFAULT = 60;
export const HOTEL_COUPON_ACTIVE_CAP_DEFAULT = 40;

/** Emergenze: tetto di sicurezza (non un limite di prodotto) per non allagare il database. */
export const EMERGENCY_MAX_PER_MINUTE = 60;
