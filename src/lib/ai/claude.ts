// Chiamata a Claude (SDK Anthropic). SOLO SERVER: la chiave arriva da ANTHROPIC_API_KEY e non
// compare mai in codice client ne' in log. NON verificato contro l'API reale (vedi NOTE-SVILUPPO).
//
// Contesto inviato al modello: regole + base di conoscenza dell'hotel + eventi + cronologia della
// conversazione. Nessun nome, camera o altro dato dell'ospite.

import type Anthropic from '@anthropic-ai/sdk';
import { dynamicBlock, HANDOFF_TOOL, kbBlock, SYSTEM_RULES } from './prompt';
import { sanitizeTopic } from './guardrails';
import type { AiContext, HandoffReason, Locale } from '../types';

export interface Turn {
  role: 'user' | 'assistant';
  content: string;
}
export interface ClaudeResult {
  text: string;
  handoff?: { reason: HandoffReason; topic: string };
  tokensIn: number;
  tokensOut: number;
  /** stop_reason === 'max_tokens': la risposta e' tagliata a meta' frase e NON va mostrata */
  truncated: boolean;
}

/** Parte dell'SDK che usiamo: permette di iniettare un client simulato nei test (nessuna rete, nessun pacchetto). */
export interface MessagesClient {
  messages: { create(req: ReturnType<typeof buildRequest>): Promise<{
    content: { type: string; text?: string; name?: string; input?: unknown }[];
    stop_reason?: string | null;
    usage?: { input_tokens?: number; output_tokens?: number };
  }> };
}

const REASONS: HandoffReason[] = ['kb_gap', 'guest_request', 'complaint', 'safety', 'other'];

let cached: { key: string; client: Anthropic } | null = null;
async function getClient(apiKey: string): Promise<Anthropic> {
  if (cached?.key === apiKey) return cached.client;
  const { default: Sdk } = await import('@anthropic-ai/sdk');
  const client = new Sdk({ apiKey, timeout: 20_000, maxRetries: 1 });
  cached = { key: apiKey, client };
  return client;
}

/** L'API richiede ruoli alternati e un primo messaggio 'user': uniamo i turni consecutivi uguali. */
export function normalizeTurns(history: Turn[]): Turn[] {
  const out: Turn[] = [];
  for (const t of history) {
    const last = out[out.length - 1];
    if (last && last.role === t.role) last.content += `\n${t.content}`;
    else out.push({ ...t });
  }
  while (out.length && out[0].role !== 'user') out.shift();
  return out;
}

/**
 * Richiesta inviata al modello. Funzione pura (testabile senza rete): contiene SOLO regole, base di
 * conoscenza dell'hotel, eventi, lingua e cronologia. Nessun dato personale dell'ospite, nessuno strumento
 * oltre al passaggio all'operatore (l'AI non prenota, non riscatta, non modifica nulla).
 */
export function buildRequest(ctx: AiContext, history: Turn[], locale: Locale, now: Date, model: string) {
  return {
    model,
    max_tokens: 500,
    system: [
      { type: 'text' as const, text: SYSTEM_RULES },
      // blocco stabile per hotel: prompt caching
      { type: 'text' as const, text: kbBlock(ctx), cache_control: { type: 'ephemeral' as const } },
      { type: 'text' as const, text: dynamicBlock(ctx, locale, now) },
    ],
    tools: [HANDOFF_TOOL],
    messages: normalizeTurns(history),
  };
}

export async function askClaude(
  apiKey: string,
  ctx: AiContext,
  history: Turn[],
  locale: Locale,
  now: Date,
  injected?: MessagesClient,
): Promise<ClaudeResult> {
  const client = injected ?? ((await getClient(apiKey)) as unknown as MessagesClient);
  const model = process.env.ANTHROPIC_MODEL || 'claude-haiku-4-5';
  const resp = await client.messages.create(buildRequest(ctx, history, locale, now, model));

  let text = '';
  let handoff: ClaudeResult['handoff'];
  for (const block of resp.content) {
    if (block.type === 'text') text += (text ? '\n' : '') + (block.text ?? '');
    else if (block.type === 'tool_use' && block.name === HANDOFF_TOOL.name) {
      const input = (block.input ?? {}) as { reason?: string; topic?: string };
      const reason = REASONS.includes(input.reason as HandoffReason) ? (input.reason as HandoffReason) : 'other';
      handoff = { reason, topic: sanitizeTopic(input.topic) };
    }
  }
  return {
    text: text.trim(),
    handoff,
    tokensIn: resp.usage?.input_tokens ?? 0,
    tokensOut: resp.usage?.output_tokens ?? 0,
    truncated: resp.stop_reason === 'max_tokens',
  };
}
