// Controlli deterministici PRIMA di chiamare il modello (e anche in modalita' demo).
// Servono dove un errore costa troppo: emergenze, salute/allergie, reclami, richiesta di una persona.
// Sono in aggiunta (non al posto) delle regole del prompt. Vedi 04-privacy-qa.md, AI-23/24/35.
//
// Lingue: it, en, de, ru. Le parole si confrontano su parola intera (non per sottostringa): "questo male"
// non e' "sto male", "humanity" non e' "human". Il testo viene normalizzato (minuscole, senza accenti, senza
// punteggiatura): le liste qui sotto sono scritte in chiaro e normalizzate all'avvio.

import type { HandoffReason } from '../types';

export function normalize(s: string): string {
  return s
    .toLowerCase()
    .replace(/[\u2018\u2019\u02bc\u00b4`]/g, "'")
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .replace(/[^\p{L}\p{N}\s'-]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export type PreCheck = {
  kind: 'emergency' | 'allergy' | 'complaint' | 'operator';
  reason: HandoffReason;
  topic: string;
  /** chiave in messages/*.json (sezione ai) */
  messageKey: 'emergency' | 'allergy' | 'complaint' | 'handoffRequested';
  /** emergenze: priorita' massima in coda */
  priority: 'urgent' | 'normal';
};

/** Rileva il russo dal testo (le interfacce supportate sono it/en/de; il russo e' lingua di P0 non ancora nell'app). */
export function hasCyrillic(text: string): boolean {
  return /[\u0400-\u04FF]/.test(text);
}

function compile(phrases: string[]): RegExp {
  const parts = phrases.map((p) => normalize(p).replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/ /g, ' '));
  // prefisso opzionale: elisione italiana ("un'ambulanza", "dell'incendio")
  return new RegExp(`(?:^| |\\p{L}{1,5}')(?:${parts.join('|')})(?: |$)`, 'u');
}

// ----------------------------------------------------------------------------- emergenze
const EMERGENCY_STRONG = compile([
  // it
  'emergenza', 'ambulanza', 'infarto', 'soccorso', 'incendio', 'fiamme', 'carabinieri', 'polizia',
  'sto male', 'mi sento male', 'si sente male', 'sta male', 'svenuto', 'svenuta', 'annegando', 'annegato', 'affogando', 'non respira',
  'non riesco a respirare', 'sangue', 'sanguina', 'mi sono fatto male', 'mi sono fatta male', 'si e fatto male', 'si e fatta male', 'si e\' fatto male', 'si e\' fatta male',
  'chiamate un medico', 'chiami un medico', 'chiamate il medico', 'serve un medico', 'ho bisogno di un medico', 'medico subito',
  'mi stanno aggredendo', 'aggressione',
  // en
  'emergency', 'ambulance', 'heart attack', 'on fire', 'a fire', 'police', 'unconscious', 'fainted', 'drowning',
  'can\'t breathe', 'cannot breathe', 'not breathing', 'bleeding', 'choking', 'i feel sick', 'feeling unwell', 'i need a doctor',
  'call a doctor', 'get a doctor', 'need a doctor', 'someone is hurt', 'i am hurt', 'i\'m hurt', 'i am injured', 'being attacked',
  // de
  'notfall', 'notarzt', 'krankenwagen', 'rettungswagen', 'herzinfarkt', 'es brennt', 'brennt', 'polizei', 'bewusstlos', 'ohnmachtig',
  'ertrinkt', 'ertrinke', 'nicht atmen', 'keine luft', 'blutet', 'blutung', 'erstickt', 'ich ersticke', 'mir ist schlecht',
  'ich fuhle mich schlecht', 'ich brauche einen arzt', 'brauche einen arzt', 'rufen sie einen arzt', 'verletzt',
  // ru
  'пожар', 'горит', 'скорая', 'скорую', 'вызовите скорую', 'вызовите врача', 'нужен врач', 'нужна скорая', 'полиция', 'полицию',
  'не дышит', 'не могу дышать', 'без сознания', 'сердечный приступ', 'тону', 'тонет', 'кровь', 'кровотечение', 'истекает кровью',
  'мне плохо', 'ему плохо', 'ей плохо', 'экстренная ситуация', 'несчастный случай', 'на меня напали',
]);
/** Parole che da sole possono essere una richiesta qualunque ("help with wifi"): emergenza solo se il messaggio e' brevissimo o urgente. */
const EMERGENCY_WEAK = compile([
  'aiuto', 'help', 'hilfe', 'fire', 'feuer', 'fuoco', 'brand', 'помогите', 'помощь', 'на помощь', 'sos',
]);
const URGENCY = compile([
  'urgente', 'subito', 'presto', 'urgent', 'now', 'quick', 'quickly', 'asap', 'please help', 'schnell', 'dringend', 'sofort',
  'срочно', 'быстро', 'немедленно',
]);

const ALLERGY = compile([
  'allergia', 'allergie', 'allergico', 'allergica', 'intolleranza', 'celiaco', 'celiaca', 'celiachia', 'glutine',
  'allergy', 'allergic', 'gluten', 'intolerance', 'celiac', 'coeliac',
  'allergisch', 'glutenfrei', 'unvertraglichkeit', 'zoliakie',
  'аллергия', 'аллергик', 'непереносимость', 'глютен',
]);
const COMPLAINT = compile([
  'reclamo', 'lamentela', 'complaint', 'beschwerde', 'inaccettabile', 'unacceptable', 'unzumutbar', 'жалоба', 'жалоб', 'возмутительно',
]);
const OPERATOR = compile([
  'operatore', 'persona vera', 'parlare con una persona', 'parlare con qualcuno', 'voglio parlare con',
  'human', 'real person', 'speak to someone', 'talk to a person', 'talk to someone', 'operator',
  'mensch', 'mitarbeiter', 'echte person', 'mit jemandem sprechen', 'mit einer person', 'person sprechen',
  'оператор', 'живой человек', 'поговорить с человеком', 'позовите администратора', 'администратор',
]);

/** Numeri di emergenza: "camera 112" non e' un'emergenza; "chiama il 112" o un messaggio che e' solo "112" si'. */
const EMERGENCY_NUMBER = /(?:^| )(?:112|911)(?: |$)/;
const CALL_CONTEXT = compile([
  'chiama', 'chiamate', 'chiamare', 'chiami', 'numero', 'call', 'dial', 'number', 'rufen', 'rufe', 'anrufen', 'nummer',
  'вызовите', 'позвоните', 'позвонить', 'номер',
]);

export function isEmergency(text: string): boolean {
  const n = normalize(text);
  if (!n) return false;
  if (EMERGENCY_STRONG.test(n)) return true;
  if (EMERGENCY_NUMBER.test(n) && (n.split(' ').length <= 3 || CALL_CONTEXT.test(n))) return true;
  if (EMERGENCY_WEAK.test(n)) {
    const tokens = n.split(' ').length;
    return tokens <= 3 || URGENCY.test(n);
  }
  return false;
}

export function preCheck(text: string): PreCheck | null {
  const n = normalize(text);
  if (isEmergency(text)) return { kind: 'emergency', reason: 'safety', topic: 'emergenza', messageKey: 'emergency', priority: 'urgent' };
  if (ALLERGY.test(n)) return { kind: 'allergy', reason: 'safety', topic: 'allergie e salute', messageKey: 'allergy', priority: 'normal' };
  if (COMPLAINT.test(n)) return { kind: 'complaint', reason: 'complaint', topic: 'reclamo', messageKey: 'complaint', priority: 'normal' };
  if (OPERATOR.test(n)) {
    return { kind: 'operator', reason: 'guest_request', topic: 'richiesta operatore', messageKey: 'handoffRequested', priority: 'normal' };
  }
  return null;
}

/** Etichetta d'argomento da un vocabolario fisso: mai testo libero dell'ospite. */
const TOPICS: [string, string[]][] = [
  ['prezzi', ['prezzo', 'costa', 'costo', 'quanto', 'price', 'cost', 'preis', 'kosten', 'euro']],
  ['bagagli', ['bagagl', 'luggage', 'baggage', 'gepack', 'valigia']],
  ['check-in e check-out', ['check', 'anticipo', 'early', 'late']],
  ['wifi', ['wifi', 'wi-fi', 'wlan', 'password']],
  ['spa', ['spa', 'massaggio', 'sauna', 'massage']],
  ['piscina', ['piscina', 'pool']],
  ['ristorazione', ['colazione', 'cena', 'pranzo', 'ristorante', 'breakfast', 'dinner', 'lunch', 'fruhstuck', 'abendessen']],
  ['eventi', ['evento', 'eventi', 'event', 'serata']],
  ['trasporti', ['navetta', 'parcheggio', 'taxi', 'shuttle', 'parking', 'bus']],
  ['animali', ['cane', 'cani', 'gatto', 'animali', 'dog', 'pet', 'hund']],
  ['camera', ['camera', 'room', 'zimmer', 'upgrade', 'letto']],
  ['meteo', ['meteo', 'tempo', 'weather', 'wetter', 'pioggia']],
];
export function topicFor(text: string): string {
  const n = normalize(text);
  for (const [label, words] of TOPICS) if (words.some((w) => n.includes(w))) return label;
  return 'altro';
}

/**
 * handoff_topic resta nel database in forma anonima dopo il check-out: deve essere un'etichetta
 * generica. Il testo proposto dal modello non viene mai salvato cosi' com'e': si usa solo se
 * rientra nel vocabolario fisso (TOPICS), altrimenti 'altro'. Cosi' nomi, camere o numeri non
 * possono finire nel database neanche se il modello li scrivesse.
 */
export function sanitizeTopic(raw: string | undefined | null): string {
  return topicFor(raw ?? '');
}

/**
 * Mascheramento prima dell'invio al fornitore del modello: sequenze di 6+ cifre (telefoni, carte, camere lunghe)
 * e indirizzi e-mail. Non e' anonimizzazione: il testo libero resta un dato personale potenziale (vedi NOTE-SVILUPPO).
 */
export function maskSensitive(text: string): string {
  return text
    .replace(/[\w.+-]+@[\w-]+(?:\.[\w-]+)+/g, '[email]')
    .replace(/(?:\+?\d[\s().-]?){6,}/g, '[numero]');
}
