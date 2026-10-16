// Dati di esempio della modalita' DEMO: un hotel finto, eventi, spa/piscina/sala giochi, base di conoscenza.
// Il contenuto della base di conoscenza riprende l'hotel di prova di docs/04-privacy-qa.md (6.5).
// Nessun prezzo inventato: dove il documento non ne ha, la voce non ne ha (l'AI deve dire "non lo so").

import type { AiKnowledgeEntry, FacilityKind, I18nText } from '../types';

export const DEMO_STAFF = [
  { id: 'staff-admin', email: 'admin@demo.chathel.test', password: 'demo-admin', role: 'hotel_admin' as const, name: 'Marco (direttore)' },
  { id: 'staff-reception', email: 'reception@demo.chathel.test', password: 'demo-reception', role: 'reception' as const, name: 'Marta (reception)' },
  { id: 'staff-bar', email: 'bar@demo.chathel.test', password: 'demo-bar', role: 'bartender' as const, name: 'Luca (bar)' },
];

export const DEMO_KB: Omit<AiKnowledgeEntry, 'id'>[] = [
  { category: 'dining', title: 'Colazione', content: 'La colazione è servita dalle 7:30 alle 10:30 nella sala Ulivo.', locale: 'it', active: true },
  { category: 'dining', title: 'Pranzo e cena', content: 'Pranzo dalle 12:30 alle 14:30. Cena dalle 19:30 alle 21:30, con prenotazione consigliata.', locale: 'it', active: true },
  { category: 'dining', title: 'Bar Terrazza', content: 'Il bar Terrazza è aperto dalle 8:00 alle 24:00.', locale: 'it', active: true },
  { category: 'pool', title: 'Piscine', content: 'Piscina esterna aperta dalle 9:00 alle 19:00 (da giugno). Piscina coperta aperta dalle 8:00 alle 20:00.', locale: 'it', active: true },
  { category: 'spa', title: 'Spa', content: 'La spa è aperta dalle 10:00 alle 19:00 solo su prenotazione (nell\'app, sezione Prenota). È vietata ai minori di 16 anni.', locale: 'it', active: true },
  { category: 'general', title: 'Sala giochi', content: 'La sala giochi è aperta dalle 15:00 alle 23:00. Ci sono calcio balilla, ping pong e console.', locale: 'it', active: true },
  { category: 'rooms', title: 'Check-in e check-out', content: 'Il check-in è dalle 15:00. Il check-out è entro le 11:00.', locale: 'it', active: true },
  { category: 'general', title: 'Wi-Fi', content: 'Il Wi-Fi è gratuito, la rete si chiama Alba-Guest.', locale: 'it', active: true },
  { category: 'rules', title: 'Animali', content: 'Gli animali sono ammessi con un supplemento da concordare con la reception.', locale: 'it', active: true },
  { category: 'transport', title: 'Parcheggio', content: 'Il parcheggio è gratuito fino a esaurimento posti.', locale: 'it', active: true },
  { category: 'transport', title: 'Navetta per la spiaggia', content: 'La navetta per la spiaggia passa ogni 30 minuti, dalle 9:00 alle 18:00.', locale: 'it', active: true },
  { category: 'contacts', title: 'Reception', content: 'La reception è aperta 24 ore su 24. Telefono interno 9.', locale: 'it', active: true },
  { category: 'general', title: 'Bonus di benvenuto', content: 'Il bonus di benvenuto è un caffè o un analcolico al bar Terrazza, uno per ospite. Si mostra al barista con il QR dell\'app.', locale: 'it', active: true },
  { category: 'other', title: 'Servizi non presenti', content: 'Non sono presenti: palestra, campo da tennis.', locale: 'it', active: true },
];

export interface DemoFacilitySeed {
  kind: FacilityKind;
  name: I18nText;
  description: I18nText;
  capacity: number;
  start: string;
  end: string;
  minutes: number;
}
export const DEMO_FACILITIES: DemoFacilitySeed[] = [
  {
    kind: 'spa',
    name: { it: 'Spa', en: 'Spa', de: 'Spa' },
    description: { it: 'Dalle 10 alle 19. Vietata ai minori di 16 anni.', en: '10 am to 7 pm. Not for under 16s.', de: '10 bis 19 Uhr. Nicht für unter 16-Jährige.' },
    capacity: 4,
    start: '10:00',
    end: '19:00',
    minutes: 60,
  },
  {
    kind: 'pool',
    name: { it: 'Piscina', en: 'Pool', de: 'Pool' },
    description: { it: 'Turni di due ore.', en: 'Two-hour sessions.', de: 'Zwei-Stunden-Slots.' },
    capacity: 30,
    start: '09:00',
    end: '19:00',
    minutes: 120,
  },
  {
    kind: 'gamesroom',
    name: { it: 'Sala giochi', en: 'Games room', de: 'Spielzimmer' },
    description: { it: 'Calcio balilla, ping pong, console.', en: 'Table football, ping pong, consoles.', de: 'Tischfußball, Tischtennis, Konsolen.' },
    capacity: 6,
    start: '15:00',
    end: '23:00',
    minutes: 60,
  },
];

export interface DemoEventSeed {
  title: I18nText;
  description: I18nText;
  location: string;
  /** giorni da oggi (ora locale dell'hotel) */
  day: number;
  time: string;
  durationMin: number;
  capacity: number | null;
  published: boolean;
}
export const DEMO_EVENTS: DemoEventSeed[] = [
  {
    title: { it: 'Serata musica dal vivo', en: 'Live music night', de: 'Abend mit Livemusik' },
    description: { it: 'Musica dal vivo sulla terrazza.', en: 'Live music on the terrace.', de: 'Livemusik auf der Terrasse.' },
    location: 'Bar Terrazza',
    day: 0,
    time: '21:00',
    durationMin: 120,
    capacity: null,
    published: true,
  },
  {
    title: { it: 'Animazione per bambini', en: 'Kids entertainment', de: 'Kinderanimation' },
    description: { it: 'Giochi e laboratori per i più piccoli.', en: 'Games and workshops for the little ones.', de: 'Spiele und Workshops für die Kleinen.' },
    location: 'Sala giochi',
    day: 1,
    time: '10:30',
    durationMin: 90,
    capacity: null,
    published: true,
  },
  {
    title: { it: 'Yoga all\'alba', en: 'Sunrise yoga', de: 'Yoga bei Sonnenaufgang' },
    description: { it: 'Lezione di gruppo, posti limitati.', en: 'Group class, limited places.', de: 'Gruppenkurs, begrenzte Plätze.' },
    location: 'Terrazza spa',
    day: 2,
    time: '07:30',
    durationMin: 60,
    capacity: 3,
    published: true,
  },
  {
    title: { it: 'Cena di gala (bozza)', en: 'Gala dinner (draft)', de: 'Galadinner (Entwurf)' },
    description: { it: 'Non ancora pubblicato: gli ospiti non lo vedono.', en: 'Not published yet.', de: 'Noch nicht veröffentlicht.' },
    location: 'Sala Ulivo',
    day: 3,
    time: '20:00',
    durationMin: 150,
    capacity: null,
    published: false,
  },
];
