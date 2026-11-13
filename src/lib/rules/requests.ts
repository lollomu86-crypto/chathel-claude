// Richieste degli ospiti (0012): limiti e regole condivise da store demo, store Supabase (le stesse nelle funzioni SQL) e API.
// L'ospite sceglie una categoria e puo' scrivere una nota e "dove" (camera, ombrellone...): facoltativi, visibili solo allo staff
// che gestisce la richiesta, cancellati alla partenza.

import { ChError } from '../errors';
import { CONTENT_LOCALES, DEPARTMENTS, type CreateRequestInput, type Department, type I18nText, type RequestStatus, type SaveRequestCategoryInput } from '../types';

export const REQUEST_LIMITS = { openMax: 3, perDay: 10, noteMax: 300, placeMax: 40, nameMax: 60 } as const;

export function isDepartment(x: unknown): x is Department {
  return typeof x === 'string' && (DEPARTMENTS as readonly string[]).includes(x);
}

/** Nota e luogo ripuliti (spazi tolti, vuoto = null) e controllati. */
export function cleanRequestInput(i: CreateRequestInput): { categoryId: string; note: string | null; place: string | null } {
  const note = (i.note ?? '').trim() || null;
  const place = (i.place ?? '').trim() || null;
  if (note && note.length > REQUEST_LIMITS.noteMax) throw new ChError('CH003', 'too_long');
  if (place && place.length > REQUEST_LIMITS.placeMax) throw new ChError('CH003', 'too_long');
  return { categoryId: i.categoryId, note, place };
}

/** Nome della categoria: italiano obbligatorio, altre lingue facoltative, al massimo 60 caratteri. */
export function cleanCategoryInput(i: SaveRequestCategoryInput): { name: I18nText; department: Department; active: boolean } {
  const name: I18nText = {};
  for (const l of CONTENT_LOCALES) {
    const v = (i.name[l] ?? '').trim();
    if (!v) continue;
    if (v.length > REQUEST_LIMITS.nameMax) throw new ChError('CH003', 'invalid_category');
    name[l] = v;
  }
  if (!name.it) throw new ChError('CH003', 'invalid_category');
  if (!isDepartment(i.department)) throw new ChError('CH003', 'invalid_category');
  return { name, department: i.department, active: !!i.active };
}

/** Passaggi ammessi dallo staff: aperta -> presa in carico -> fatta (oppure aperta -> fatta). Chiusa = non si tocca. */
export function nextStatus(from: RequestStatus, to: 'taken' | 'done'): RequestStatus {
  if (from === 'done' || from === 'cancelled') throw new ChError('CH003', 'request_closed');
  if (to === 'taken' && from !== 'open') throw new ChError('CH003', 'invalid_status');
  return to;
}

export const DEFAULT_CATEGORIES: { name: I18nText; department: Department }[] = [
  { name: { it: 'Pulizia e biancheria', en: 'Cleaning and linen', de: 'Reinigung und Wäsche', ru: 'Уборка и бельё' }, department: 'housekeeping' },
  { name: { it: 'Guasto o manutenzione', en: 'Fault or maintenance', de: 'Defekt oder Wartung', ru: 'Поломка или ремонт' }, department: 'maintenance' },
  { name: { it: 'Oggetti per la camera', en: 'Items for the room', de: 'Dinge für das Zimmer', ru: 'Вещи для номера' }, department: 'housekeeping' },
  { name: { it: 'Altro', en: 'Other', de: 'Sonstiges', ru: 'Другое' }, department: 'reception' },
];

/** Password iniziale di un account Team: 14 caratteri leggibili (niente 0/O, 1/l). Si mostra una sola volta. */
export function teamPassword(rand: (n: number) => number): string {
  const abc = 'abcdefghjkmnpqrstuvwxyzABCDEFGHJKMNPQRSTUVWXYZ23456789';
  let out = '';
  for (let i = 0; i < 14; i++) out += abc[rand(abc.length)];
  return out;
}
