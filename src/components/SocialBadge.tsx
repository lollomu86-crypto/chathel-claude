'use client';
// Indicatore dei non letti del livello sociale. Il server non traccia le letture: ogni dispositivo ricorda da se'
// (localStorage, solo comodita') fino a quando ha visto ciascuna conversazione. Le richieste in arrivo contano finche' non
// si risponde. Un'unica sorgente (questo provider) alimenta barra, scheda Privati ed elenco conversazioni.
import { createContext, useCallback, useContext, useMemo, useRef, useState, type ReactNode } from 'react';
import type { ThreadSummary } from '@/lib/types';
import { call } from './client-api';
import { useFeatures } from './Features';
import { safeStore, usePolling } from './hooks';

const KEY = 'ch_seen_v1';
type Seen = Record<string, string>;

function readSeen(): Seen {
  try { return JSON.parse(safeStore.get(KEY) ?? '{}') as Seen; } catch { return {}; }
}

interface Badge {
  threads: ThreadSummary[] | null;
  error: boolean;
  available: boolean;
  unreadIds: ReadonlySet<string>;
  unread: number;
  incoming: number;
  reload: () => Promise<void>;
  markSeen: (threadId: string) => Promise<void>;
}
const Ctx = createContext<Badge | null>(null);

export function useSocialBadge(): Badge {
  const c = useContext(Ctx);
  if (!c) throw new Error('SocialBadgeProvider mancante');
  return c;
}

export function SocialBadgeProvider({ children }: { children: ReactNode }) {
  const [threads, setThreads] = useState<ThreadSummary[] | null>(null);
  const [error, setError] = useState(false);
  const [available, setAvailable] = useState(true);
  const [seen, setSeen] = useState<Seen>({});
  const loaded = useRef(false);
  const { social } = useFeatures();

  const reload = useCallback(async () => {
    // livello sociale spento dal direttore: nessuna richiesta
    if (!social) { setThreads([]); setAvailable(false); return; }
    const r = await call('/api/guest/social-threads');
    if (!loaded.current) { loaded.current = true; setSeen(readSeen()); }
    if (r.ok) {
      setThreads(r.threads as ThreadSummary[]);
      setError(false);
      setAvailable(true);
    } else if (r.status === 403 || r.status === 401) {
      // minorenne, fuori dall'elenco, escluso, funzioni non attive: niente indicatore (si ricontrolla piu' di rado)
      setThreads([]);
      setAvailable(false);
      setError(false);
    } else setError(true);
  }, [social]);

  // ogni 12 s a schermo visibile; piu' di rado se le funzioni non sono disponibili per questa persona
  usePolling(async () => { await reload(); return true; }, available ? 12_000 : 60_000);

  const markSeen = useCallback(async (threadId: string) => {
    const r = await call('/api/guest/social-threads');
    if (!r.ok) return;
    const list = r.threads as ThreadSummary[];
    setThreads(list);
    const th = list.find((x) => x.id === threadId);
    if (!th) return;
    const next = { ...readSeen(), [threadId]: th.lastAt };
    safeStore.set(KEY, JSON.stringify(next));
    setSeen(next);
  }, []);

  const value = useMemo<Badge>(() => {
    const ids = new Set<string>();
    let incoming = 0;
    for (const th of threads ?? []) {
      if (th.status === 'pending' && th.incoming) { ids.add(th.id); incoming++; }
      else if (th.status === 'accepted' || (th.status === 'declined' && !th.incoming)) {
        if (th.lastAt > (seen[th.id] ?? '')) ids.add(th.id);
      }
    }
    return { threads, error, available, unreadIds: ids, unread: ids.size, incoming, reload, markSeen };
  }, [threads, error, available, seen, reload, markSeen]);

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}
