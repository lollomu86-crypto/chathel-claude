// Avviso prioritario alla reception (emergenze). Il testo dell'ospite NON viaggia mai nell'avviso: solo hotel,
// id conversazione, etichetta generica, ora. La reception apre la coda per leggere.
//
// Canali:
//  - MemoryAlertSink: sempre attivo (ultimi avvisi in memoria, utile a demo e test);
//  - WebhookAlertSink: se EMERGENCY_WEBHOOK_URL e' impostata, POST JSON (es. ponte verso e-mail, SMS, Slack, ntfy).
//    NON verificato contro un servizio reale: qui e' provato solo con fetch simulato.
// La fonte di verita' per la UI e' la coda (priority = 'urgent'); gli avvisi servono a svegliare qualcuno.

import { readEnv } from './env';
import { logEvent } from './log';

export interface UrgentAlert {
  hotelSlug: string;
  conversationId: string;
  topic: string;
  at: string;
}
export interface AlertSink {
  notify(a: UrgentAlert): Promise<void>;
}

export class MemoryAlertSink implements AlertSink {
  items: UrgentAlert[] = [];
  async notify(a: UrgentAlert) {
    this.items.push(a);
    if (this.items.length > 100) this.items.shift();
  }
}

export class WebhookAlertSink implements AlertSink {
  constructor(private url: string, private fetchImpl: typeof fetch = fetch, private timeoutMs = 3000) {}
  async notify(a: UrgentAlert) {
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), this.timeoutMs);
    try {
      await this.fetchImpl(this.url, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ event: 'chathel.urgent', hotel: a.hotelSlug, conversationId: a.conversationId, topic: a.topic, at: a.at }),
        signal: ctl.signal,
      });
    } finally {
      clearTimeout(timer);
    }
  }
}

export const memorySink = new MemoryAlertSink();
let extraSinks: AlertSink[] | null = null;
export function setAlertSinks(s: AlertSink[] | null) {
  extraSinks = s;
}
function sinks(): AlertSink[] {
  if (extraSinks) return extraSinks;
  const url = readEnv('EMERGENCY_WEBHOOK_URL');
  return url ? [memorySink, new WebhookAlertSink(url)] : [memorySink];
}

/** Non lancia mai e non blocca la risposta all'ospite: un canale che fallisce viene registrato (senza dettagli). */
export async function raiseUrgent(a: UrgentAlert): Promise<number> {
  let delivered = 0;
  await Promise.all(
    sinks().map(async (s) => {
      try {
        await s.notify(a);
        delivered++;
      } catch (e) {
        logEvent('alert.sink_failed', { name: e instanceof Error ? e.name : 'unknown' });
      }
    }),
  );
  return delivered;
}
