// Giochi dell'hotel (ping pong, calcio balilla...): elenco gestito dal pannello, usato dalle sfide. Non si prenotano.
// Validazione condivisa da store demo e store Supabase.

import { ChError } from '../errors';
import { LOCALES, type I18nText, type SaveGameInput } from '../types';

export const GAME_LIMITS = { nameMax: 60, descriptionMax: 300, locationMax: 120, perHotel: 30 } as const;

function cleanText(t: I18nText | null | undefined, max: number): I18nText {
  const out: I18nText = {};
  for (const l of LOCALES) {
    const v = t?.[l]?.trim();
    if (!v) continue;
    if ([...v].length > max) throw new ChError('CH003', 'invalid_game');
    out[l] = v;
  }
  return out;
}

/** Nome obbligatorio almeno in una lingua; descrizione e luogo facoltativi. */
export function cleanGameInput(i: SaveGameInput): { name: I18nText; description: I18nText | null; location: string | null; active: boolean } {
  const name = cleanText(i.name, GAME_LIMITS.nameMax);
  if (!Object.keys(name).length) throw new ChError('CH003', 'invalid_game');
  const description = cleanText(i.description, GAME_LIMITS.descriptionMax);
  const location = i.location?.trim() || null;
  if (location && [...location].length > GAME_LIMITS.locationMax) throw new ChError('CH003', 'invalid_game');
  return { name, description: Object.keys(description).length ? description : null, location, active: !!i.active };
}
