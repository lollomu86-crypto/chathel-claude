// Messaggio fisso per le emergenze, in tutte le 12 lingue dell'app. NON passa dal modello e NON dipende dai file messages/*.json:
// deve esistere anche se un file di traduzione e' incompleto. Contiene sempre il 112.
// Il numero della reception (se l'hotel lo ha impostato) e' aggiunto qui, mai dedotto dal modello.

import { hasCyrillic } from './guardrails';
import type { Locale } from '../types';

export type EmergencyLang = Locale;

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
    case 'fr':
      return `URGENCE : appelez immédiatement le 112. ${phone ? `Vous pouvez aussi appeler la réception de l'hôtel : ${phone}. ` : ''}J'ai alerté le personnel de l'hôtel en priorité absolue et quelqu'un vous contactera dès que possible. N'attendez pas de réponse ici.`;
    case 'es':
      return `EMERGENCIA: llama ahora mismo al 112. ${phone ? `También puedes llamar a la recepción del hotel: ${phone}. ` : ''}He avisado al personal del hotel con la máxima prioridad y alguien se pondrá en contacto contigo lo antes posible. No esperes una respuesta aquí.`;
    case 'nl':
      return `NOODGEVAL: bel nu meteen 112. ${phone ? `Je kunt ook de receptie van het hotel bellen: ${phone}. ` : ''}Ik heb het hotelpersoneel met de hoogste prioriteit gewaarschuwd en er neemt zo snel mogelijk iemand contact met je op. Wacht hier niet op een antwoord.`;
    case 'pl':
      return `NAGŁY WYPADEK: natychmiast zadzwoń pod 112. ${phone ? `Możesz też zadzwonić do recepcji hotelu: ${phone}. ` : ''}Powiadomiłem personel hotelu z najwyższym priorytetem i ktoś skontaktuje się z Tobą jak najszybciej. Nie czekaj tutaj na odpowiedź.`;
    case 'sv':
      return `NÖDSITUATION: ring 112 nu. ${phone ? `Du kan också ringa hotellets reception: ${phone}. ` : ''}Jag har larmat hotellpersonalen med högsta prioritet och någon kontaktar dig så snart som möjligt. Vänta inte på svar här.`;
    case 'pt':
      return `EMERGÊNCIA: ligue já para o 112. ${phone ? `Também pode ligar para a receção do hotel: ${phone}. ` : ''}Avisei o pessoal do hotel com prioridade máxima e alguém entrará em contacto consigo o mais depressa possível. Não fique à espera de resposta aqui.`;
    case 'cs':
      return `NOUZE: okamžitě volejte 112. ${phone ? `Můžete také zavolat na recepci hotelu: ${phone}. ` : ''}Upozornil jsem personál hotelu s nejvyšší prioritou a někdo se vám co nejdříve ozve. Nečekejte tady na odpověď.`;
    case 'zh':
      return `紧急情况：请立即拨打 112。${phone ? `您也可以拨打酒店前台电话：${phone}。` : ''}我已以最高优先级通知酒店工作人员，会有人尽快联系您。请不要在这里等待回复。`;
    default:
      return `EMERGENZA: chiama subito il 112. ${phone ? `Puoi chiamare anche la reception: ${phone}. ` : ''}Ho avvisato il personale dell'hotel con priorità massima e qualcuno ti contatterà al più presto. Non aspettare una risposta qui.`;
  }
}
