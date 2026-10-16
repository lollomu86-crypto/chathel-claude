// Orchestrazione della reception AI: controlli deterministici -> Claude (se c'e' la chiave)
// oppure risposte DEMO per parole chiave. Nessun contenuto dei messaggi finisce nei log.
//
// Ordine (importante): 1) emergenze e controlli di sicurezza, SENZA modello e fuori da ogni tetto/limite
// (li gestisce il chiamante prima dei limiti: vedi aiChat); 2) modello; 3) validazione dell'output;
// 4) in caso di dubbio, "non so" + passaggio alla reception.

import { makeT } from '../i18n';
import { maskSensitive, preCheck, sanitizeTopic } from './guardrails';
import { demoAnswer } from './demo';
import { askClaude, type MessagesClient, type Turn } from './claude';
import { validateModelOutput } from './output-guard';
import { emergencyLang, emergencyMessage } from './emergency';
import type { AiContext, HandoffReason, Locale } from '../types';
import { logEvent } from '../log';

export type AiMode = 'claude' | 'keyword';

export function aiMode(): AiMode {
  return process.env.ANTHROPIC_API_KEY ? 'claude' : 'keyword';
}

export interface AnswerResult {
  text: string;
  handoff?: { reason: HandoffReason; topic: string; priority?: 'urgent' | 'normal' };
  /** 'rules' = risposta fissa dei controlli di sicurezza, senza modello */
  source: 'claude' | 'keyword' | 'rules' | 'fallback';
  tokensIn?: number;
  tokensOut?: number;
}

export interface AnswerInput {
  ctx: AiContext;
  /** cronologia recente, compresa la domanda appena posta come ultimo turno 'user' */
  history: Turn[];
  question: string;
  locale: Locale;
  now?: Date;
  /** solo test: client del modello simulato */
  client?: MessagesClient;
}

/**
 * Solo i controlli deterministici (nessuna chiamata di rete). Il chiamante lo esegue PRIMA di tetti e limiti:
 * un'emergenza non deve mai ricevere "limite di risposte raggiunto".
 */
export function safetyAnswer(question: string, locale: Locale, ctx: Pick<AiContext, 'receptionPhone'>): AnswerResult | null {
  const pre = preCheck(question);
  if (!pre) return null;
  const t = makeT(locale);
  if (pre.kind === 'emergency') {
    return {
      text: emergencyMessage(emergencyLang(locale, question), ctx.receptionPhone),
      handoff: { reason: pre.reason, topic: pre.topic, priority: 'urgent' },
      source: 'rules',
    };
  }
  return { text: t(`ai.${pre.messageKey}`), handoff: { reason: pre.reason, topic: pre.topic, priority: pre.priority }, source: 'rules' };
}

export async function answerQuestion(input: AnswerInput): Promise<AnswerResult> {
  const { ctx, question, locale } = input;
  const now = input.now ?? new Date();
  const t = makeT(locale);

  const safe = safetyAnswer(question, locale, ctx);
  if (safe) return safe;

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (apiKey || input.client) {
    const fallback = (): AnswerResult => ({ text: t('ai.unavailable'), handoff: { reason: 'other', topic: 'altro' }, source: 'fallback' });
    try {
      // il testo libero dell'ospite parte verso il fornitore: prima si mascherano telefoni, carte ed e-mail
      const history = input.history.map((h) => (h.role === 'user' ? { ...h, content: maskSensitive(h.content) } : h));
      const r = await askClaude(apiKey ?? 'test', ctx, history, locale, now, input.client);
      if (r.truncated) {
        logEvent('ai.output_blocked', { reason: 'truncated' });
        return fallback();
      }
      const handoff = r.handoff;
      // il modello ha riconosciuto un tema di sicurezza: si usa il testo fisso, mai il suo
      if (handoff?.reason === 'safety') {
        return {
          text: emergencyMessage(emergencyLang(locale, question), ctx.receptionPhone),
          handoff: { ...handoff, priority: 'urgent' },
          source: 'rules',
        };
      }
      const text = r.text || (handoff ? t(handoff.reason === 'guest_request' ? 'ai.handoffRequested' : 'ai.notKnown') : '');
      if (!text) return fallback();
      if (r.text) {
        const check = validateModelOutput(r.text, ctx);
        if (!check.ok) {
          // link, telefono, prezzo o orario che l'hotel non ha scritto: non si mostra
          logEvent('ai.output_blocked', { reason: check.violations.join(',') });
          return { text: t('ai.notKnown'), handoff: { reason: 'kb_gap', topic: 'altro' }, source: 'fallback' };
        }
      }
      return { text, handoff, source: 'claude', tokensIn: r.tokensIn, tokensOut: r.tokensOut };
    } catch (e) {
      // timeout/errore del fornitore: messaggio di cortesia + operatore (AI-39). Si logga solo il tipo di errore.
      logEvent('ai.provider_error', { name: e instanceof Error ? e.name : 'unknown' });
      return fallback();
    }
  }

  const d = demoAnswer(ctx, question);
  if (d.known && d.text) {
    return { text: `${d.text}\n\n${t('ai.source', { title: d.sourceTitle ?? '' })}`, source: 'keyword' };
  }
  return {
    text: t('ai.notKnown'),
    handoff: { reason: 'kb_gap', topic: sanitizeTopic(d.topic) },
    source: 'keyword',
  };
}
