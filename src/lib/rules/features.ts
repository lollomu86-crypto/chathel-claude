// Personalizzazione dell'hotel: interruttori delle funzioni, messaggio di benvenuto e immagini (migrazione 0010).
// Stesse regole del database: chiave mancante = accesa; "social" spento spegne chat pubblica, sfide e coupon.
// Una funzione spenta si nasconde nell'app, le API rispondono 403 e le scritture vengono rifiutate. Non si cancella nulla.

import { ChError } from '../errors';
import { FEATURE_KEYS, LOCALES, type FeatureKey, type HotelFeatures, type HotelMediaKind, type I18nText, type Locale } from '../types';

const DB_KEY: Record<FeatureKey, string> = {
  social: 'social', publicChat: 'public_chat', challenges: 'challenges', coupons: 'coupons', bookings: 'bookings', reception: 'reception',
};
/** Funzioni che dipendono dall'interruttore generale "social". */
const UNDER_SOCIAL: FeatureKey[] = ['publicChat', 'challenges', 'coupons'];

export const ALL_FEATURES_ON: HotelFeatures = Object.fromEntries(FEATURE_KEYS.map((k) => [k, true])) as HotelFeatures;

/** Dal jsonb `hotels.features` (chiavi del database) alle scelte salvate. */
export function featuresFromDb(j: unknown): HotelFeatures {
  const o = j && typeof j === 'object' ? (j as Record<string, unknown>) : {};
  return Object.fromEntries(FEATURE_KEYS.map((k) => [k, o[DB_KEY[k]] !== false])) as HotelFeatures;
}
export function featuresToDb(f: HotelFeatures): Record<string, boolean> {
  return Object.fromEntries(FEATURE_KEYS.map((k) => [DB_KEY[k], f[k]]));
}

/** Quello che vale davvero per gli ospiti. */
export function effectiveFeatures(f: HotelFeatures): HotelFeatures {
  const out = { ...f };
  if (!f.social) for (const k of UNDER_SOCIAL) out[k] = false;
  return out;
}

/** 403 se una delle funzioni e' spenta (`f` gia' effettive). */
export function requireFeature(f: HotelFeatures, ...keys: FeatureKey[]): void {
  for (const k of keys) if (!f[k]) throw new ChError('CH004', 'feature_disabled');
}

// ---------------------------------------------------------------- benvenuto
export const WELCOME_MAX_CHARS = 500;

/** Testo ripulito: spazi tolti, lingue vuote eliminate, al massimo 500 caratteri per lingua. */
export function cleanWelcome(w: I18nText): I18nText {
  const out: I18nText = {};
  for (const l of LOCALES) {
    const v = (w[l] ?? '').trim();
    if (!v) continue;
    if (v.length > WELCOME_MAX_CHARS) throw new ChError('CH003', 'welcome_too_long');
    out[l] = v;
  }
  return out;
}

/** Benvenuto nella lingua dell'ospite, altrimenti in quella predefinita dell'hotel; '' se manca. */
export function welcomeFor(w: I18nText | null | undefined, locale: Locale, hotelDefault: Locale): string {
  return (w?.[locale] || w?.[hotelDefault] || '').trim();
}

// ---------------------------------------------------------------- immagini
export const MEDIA_MAX_BYTES = 2 * 1024 * 1024;
export const MEDIA_TYPES = ['image/jpeg', 'image/png', 'image/webp'] as const;
export type MediaType = (typeof MEDIA_TYPES)[number];
export const MEDIA_EXT: Record<MediaType, string> = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp' };
export const MEDIA_KINDS: HotelMediaKind[] = ['logo', 'cover'];

/** Tipo reale dai primi byte (mai fidarsi solo dell'intestazione): JPG, PNG o WebP, altrimenti null. Niente SVG. */
export function sniffImage(b: Uint8Array): MediaType | null {
  if (b.length >= 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return 'image/jpeg';
  if (b.length >= 8 && [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a].every((x, i) => b[i] === x)) return 'image/png';
  const ascii = (from: number, to: number) => String.fromCharCode(...b.subarray(from, to));
  if (b.length >= 12 && ascii(0, 4) === 'RIFF' && ascii(8, 12) === 'WEBP') return 'image/webp';
  return null;
}

/** Controlla un'immagine caricata: dimensione e tipo dichiarato uguale a quello reale. */
export function checkImage(bytes: Uint8Array, declared: string): MediaType {
  if (bytes.length === 0) throw new ChError('CH003', 'invalid_image');
  if (bytes.length > MEDIA_MAX_BYTES) throw new ChError('CH003', 'image_too_large');
  const t = sniffImage(bytes);
  if (!t || t !== declared.split(';')[0].trim().toLowerCase()) throw new ChError('CH003', 'invalid_image');
  return t;
}
