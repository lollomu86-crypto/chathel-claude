// Risposte DEMO per parole chiave. NON e' intelligenza artificiale e l'interfaccia lo dichiara.
// Serve solo a provare il flusso (risposta dalla base di conoscenza / "non so" + passaggio
// all'operatore) senza chiave API. Principio: meglio non rispondere che rispondere male.

import { normalize, topicFor } from './guardrails';
import type { AiContext, AiKnowledgeEntry } from '../types';

const STOP = new Set([
  // it
  'che', 'chi', 'come', 'cosa', 'dove', 'quando', 'quanto', 'quale', 'quali', 'sono', 'siete', 'avete', 'ho', 'ha', 'hai', 'per', 'con', 'una', 'uno', 'gli', 'delle', 'della', 'dello', 'degli', 'del', 'dei', 'nel', 'nella', 'nei', 'alla', 'alle', 'allo', 'dopo', 'prima', 'posso', 'puo', 'puoi', 'potete', 'fino', 'ora', 'ore', 'orari', 'orario', 'oggi', 'domani', 'stasera', 'mio', 'mia', 'miei', 'vostro', 'qui', 'questo', 'questa', 'essere', 'fare', 'devo', 'serve', 'lasciare', 'anni', 'figlio', 'figlia', 'entrare', 'aperta', 'aperto', 'costa', 'costo', 'prezzo',
  // en
  'what', 'when', 'where', 'how', 'does', 'the', 'and', 'you', 'your', 'have', 'can', 'could', 'there', 'with', 'for', 'are', 'any', 'time', 'times', 'hours', 'open', 'much', 'cost', 'price', 'does', 'from', 'this', 'that', 'will', 'our',
  // de
  'wann', 'wie', 'was', 'wo', 'ist', 'sind', 'gibt', 'haben', 'kann', 'kann', 'ich', 'wir', 'ihr', 'der', 'die', 'das', 'und', 'mit', 'fur', 'von', 'bei', 'zeiten', 'uhr', 'offen', 'geoffnet', 'kostet', 'preis', 'kosten',
]);

/** Gruppi di sinonimi (it/en/de) -> parola canonica presente nelle voci della base (scritta in italiano). */
const SYN: Record<string, string[]> = {
  colazione: ['breakfast', 'fruhstuck'],
  cena: ['dinner', 'abendessen'],
  pranzo: ['lunch', 'mittagessen'],
  piscina: ['pool', 'schwimmbad'],
  spa: ['wellness', 'sauna'],
  bar: ['drink', 'cocktail'],
  wifi: ['wlan', 'internet'],
  parcheggio: ['parking', 'parkplatz'],
  navetta: ['shuttle', 'bus'],
  animali: ['dog', 'dogs', 'cani', 'cane', 'pet', 'pets', 'hund', 'haustiere'],
  palestra: ['gym', 'fitness'],
  tennis: [],
  reception: ['rezeption', 'front'],
  evento: ['event', 'eventi', 'events', 'veranstaltung'],
  caffe: ['coffee', 'kaffee'],
  bonus: ['benvenuto', 'welcome', 'willkommen'],
  sala: ['games', 'spielzimmer'],
};

function canon(token: string): string {
  for (const [c, alts] of Object.entries(SYN)) if (token === c || alts.includes(token)) return c;
  return token;
}

/** Come normalize(), ma senza trattini: "Wi-Fi" e "wifi" diventano la stessa parola. */
const flat = (s: string) => normalize(s).replace(/-/g, '');

function tokens(question: string): string[] {
  return flat(question)
    .split(' ')
    .map((t) => t.replace(/^'+|'+$/g, ''))
    .filter((t) => t.length >= 4 && !STOP.has(t))
    .map(canon);
}

interface Scored {
  entry: AiKnowledgeEntry;
  matched: number;
}

function matches(text: string, token: string): boolean {
  if (text.includes(token)) return true;
  // radice grossolana per plurali/coniugazioni (colazione/colazioni, prenotare/prenotazione)
  return token.length >= 6 && text.includes(token.slice(0, token.length - 2));
}

export interface DemoAnswer {
  known: boolean;
  text?: string;
  sourceTitle?: string;
  topic?: string;
}

export function demoAnswer(ctx: AiContext, question: string): DemoAnswer {
  const qTokens = [...new Set(tokens(question))];
  const topic = topicFor(question);
  if (qTokens.length === 0) return { known: false, topic };

  const asksPrice = /\b(costa|costo|prezzo|prezzi|quanto|price|cost|how much|preis|kosten|kostet)\b/.test(normalize(question));

  const scored: Scored[] = ctx.knowledge
    .filter((k) => k.active !== false)
    .map((entry) => {
      const hay = flat(`${entry.title} ${entry.content}`);
      const matched = qTokens.filter((t) => matches(hay, t)).length;
      return { entry, matched };
    })
    .filter((s) => s.matched > 0)
    .sort((a, b) => b.matched - a.matched);

  const best = scored[0];
  if (!best) return { known: false, topic };

  // termini che DEVONO comparire nella voce: se la domanda chiede una password, la voce deve contenerla
  // (altrimenti si risponderebbe con mezza informazione, es. il nome della rete senza la password)
  const must = qTokens.filter((t) => t === 'password' || t === 'passwort');
  if (must.some((t) => !flat(`${best.entry.title} ${best.entry.content}`).includes(t))) return { known: false, topic: 'wifi' };

  // copertura: almeno meta' dei termini significativi della domanda devono comparire nella voce
  if (best.matched / qTokens.length < 0.5) return { known: false, topic };

  // le domande di prezzo si rispondono solo se la voce contiene davvero un importo
  if (asksPrice && !/(€|\beuro\b|\beur\b)/i.test(best.entry.content)) return { known: false, topic: 'prezzi' };

  return { known: true, text: best.entry.content, sourceTitle: best.entry.title, topic };
}
