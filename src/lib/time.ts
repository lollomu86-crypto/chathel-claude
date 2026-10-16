// Utilita' di data/ora nel fuso dell'hotel. Nessuna dipendenza esterna (Intl).

/** 'YYYY-MM-DD' del giorno locale di `d` nel fuso `tz`. */
export function localDayKey(d: Date, tz: string): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: tz,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(d);
}

/** Aggiunge `n` giorni a una chiave 'YYYY-MM-DD' (aritmetica di calendario, indipendente dal fuso). */
export function addDaysKey(key: string, n: number): string {
  const [y, m, d] = key.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d + n));
  return dt.toISOString().slice(0, 10);
}

/** Differenza in giorni di calendario tra due chiavi. */
export function diffDaysKey(a: string, b: string): number {
  const pa = a.split('-').map(Number);
  const pb = b.split('-').map(Number);
  return Math.round((Date.UTC(pb[0], pb[1] - 1, pb[2]) - Date.UTC(pa[0], pa[1] - 1, pa[2])) / 86_400_000);
}

function tzOffsetMinutes(at: Date, tz: string): number {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: tz,
    hourCycle: 'h23',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  }).formatToParts(at);
  const get = (t: string) => Number(parts.find((p) => p.type === t)!.value);
  const asUtc = Date.UTC(get('year'), get('month') - 1, get('day'), get('hour'), get('minute'), get('second'));
  return Math.round((asUtc - at.getTime()) / 60_000);
}

/** Istante UTC corrispondente a 'YYYY-MM-DD' + 'HH:MM' nel fuso `tz` (gestisce l'ora legale). */
export function zonedTime(dayKey: string, hhmm: string, tz: string): Date {
  const [y, m, d] = dayKey.split('-').map(Number);
  const [hh, mm] = hhmm.split(':').map(Number);
  const guess = Date.UTC(y, m - 1, d, hh, mm);
  let off = tzOffsetMinutes(new Date(guess), tz);
  let t = guess - off * 60_000;
  const off2 = tzOffsetMinutes(new Date(t), tz);
  if (off2 !== off) {
    off = off2;
    t = guess - off * 60_000;
  }
  return new Date(t);
}

export function isDayKey(s: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(s) && !Number.isNaN(Date.parse(s + 'T00:00:00Z'));
}

/** Valore per <input type="datetime-local"> ('YYYY-MM-DDTHH:mm') di un istante, visto nel fuso `tz`. */
export function toLocalInput(iso: string, tz: string): string {
  const d = new Date(iso);
  return `${localDayKey(d, tz)}T${new Intl.DateTimeFormat('en-GB', { timeZone: tz, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(d)}`;
}

/** Istante ISO da un valore di <input type="datetime-local"> interpretato nel fuso `tz`. */
export function fromLocalInput(v: string, tz: string): string | null {
  const m = /^(\d{4}-\d{2}-\d{2})T(\d{2}:\d{2})$/.exec(v);
  return m ? zonedTime(m[1], m[2], tz).toISOString() : null;
}
