// Schede della pagina Ospiti. In un file SENZA 'use client': una costante esportata da un modulo client e importata
// da un server component diventerebbe un riferimento client inutilizzabile (bug trovato dal harness e2e).
export type SocialTab = 'people' | 'chat' | 'private' | 'settings';
export const SOCIAL_TABS: readonly SocialTab[] = ['people', 'chat', 'private', 'settings'];
