// Messaggio fisso per le emergenze (it, en, de, ru). NON passa dal modello e NON dipende dai file messages/*.json:
// deve esistere anche se un file di traduzione e' incompleto. Contiene sempre il 112.
// Il numero della reception (se l'hotel lo ha impostato) e' aggiunto qui, mai dedotto dal modello.

import { hasCyrillic } from './guardrails';
import type { Locale } from '../types';

export type EmergencyLang = Locale | 'ru';

export function emergencyLang(locale: Locale, text?: string): EmergencyLang {
  return text && hasCyrillic(text) ? 'ru' : locale;
}

export function emergencyMessage(lang: EmergencyLang, receptionPhone?: string | null): string {
  const phone = receptionPhone?.trim() || null;
  switch (lang) {
    case 'en':
      return `EMERGENCY: call 112 now. ${phone ? `You can also call the hotel reception: ${phone}. ` : ''}I have alerted the hotel staff with top priority and someone will contact you as soon as possible. Do not wait for a reply here.`;
    case 'de':
      return `NOTFALL: Rufen Sie sofort die 112 an. ${phone ? `Sie können auch die Rezeption anrufen: ${phone}. ` : ''}Ich habe das Hotelpersonal mit höchster Priorität benachrichtigt, jemand meldet sich so schnell wie möglich. Warten Sie hier nicht auf eine Antwort.`;
    case 'ru':
      return `ЭКСТРЕННАЯ СИТУАЦИЯ: немедленно позвоните по номеру 112. ${phone ? `Можно также позвонить на ресепшен: ${phone}. ` : ''}Я с наивысшим приоритетом предупредил(а) персонал отеля, с вами свяжутся как можно скорее. Не ждите ответа в этом чате.`;
    default:
      return `EMERGENZA: chiama subito il 112. ${phone ? `Puoi chiamare anche la reception: ${phone}. ` : ''}Ho avvisato il personale dell'hotel con priorità massima e qualcuno ti contatterà al più presto. Non aspettare una risposta qui.`;
  }
}
