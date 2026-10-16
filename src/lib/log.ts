// Log applicativo minimale. Regola privacy: MAI nickname, testo dei messaggi, token o IP.
// Si accettano solo valori scalari con chiavi in elenco; il resto viene scartato.

const ALLOWED = new Set(['name', 'code', 'status', 'hotel', 'route', 'reason', 'count', 'mode', 'ms']);

export function logEvent(event: string, fields: Record<string, string | number | boolean | undefined> = {}) {
  const safe: Record<string, string | number | boolean> = {};
  for (const [k, v] of Object.entries(fields)) {
    if (v === undefined || !ALLOWED.has(k)) continue;
    safe[k] = typeof v === 'string' ? v.slice(0, 60) : v;
  }
  if (process.env.NODE_ENV === 'test') return;
  console.log(JSON.stringify({ t: new Date().toISOString(), event, ...safe }));
}
