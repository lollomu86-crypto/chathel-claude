// Formato del cookie di sessione Supabase (ospite e staff): JSON {a: access_token, r: refresh_token}
// codificato base64url. Compatibile con l'Edge runtime del middleware (niente Buffer).
// Il cookie e' HttpOnly: il browser non lo legge mai.

export interface TokenPair {
  a: string;
  r: string;
}

function b64urlEncode(s: string): string {
  const bytes = new TextEncoder().encode(s);
  let bin = '';
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
function b64urlDecode(s: string): string {
  const pad = s.length % 4 ? '='.repeat(4 - (s.length % 4)) : '';
  const bin = atob(s.replace(/-/g, '+').replace(/_/g, '/') + pad);
  const bytes = Uint8Array.from(bin, (c) => c.charCodeAt(0));
  return new TextDecoder().decode(bytes);
}

export function encodeSession(p: TokenPair): string {
  return b64urlEncode(JSON.stringify(p));
}
export function decodeSession(s: string | undefined): TokenPair | null {
  if (!s) return null;
  try {
    const o = JSON.parse(b64urlDecode(s));
    return typeof o?.a === 'string' && typeof o?.r === 'string' ? { a: o.a, r: o.r } : null;
  } catch {
    return null;
  }
}

/** Scadenza (secondi epoch) letta dal payload del JWT, senza verificare la firma (solo per decidere il refresh). */
export function jwtExp(token: string): number | null {
  try {
    const payload = JSON.parse(b64urlDecode(token.split('.')[1]));
    return typeof payload.exp === 'number' ? payload.exp : null;
  } catch {
    return null;
  }
}

/** `sub` (id utente) dal payload del JWT, senza verificare la firma: serve solo come filtro in piu', la verifica la fa il database. */
export function jwtSub(token: string): string | null {
  try {
    const payload = JSON.parse(b64urlDecode(token.split('.')[1]));
    return typeof payload.sub === 'string' ? payload.sub : null;
  } catch {
    return null;
  }
}

export const GUEST_COOKIE = 'ch_guest';
/** Identita' dell'ospite (login Google), distinta dalla sessione di soggiorno. */
export const IDENT_COOKIE = 'ch_ident';
/** Hotel scelto dallo staff che appartiene a piu' hotel. */
export const HOTEL_COOKIE = 'ch_hotel';
export const STAFF_COOKIE = 'ch_staff';
export const LANG_COOKIE = 'ch_lang';
