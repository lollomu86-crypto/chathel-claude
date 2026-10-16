'use client';
// Stato in tempo quasi reale del pannello: emergenze (staff/alerts) e segnalazioni sociali aperte. Un solo polling per tutto il pannello.
// Il numero di richieste "Da gestire" arriva dal server a ogni navigazione/azione (non esiste un endpoint di conteggio): limite dichiarato.
import Link from 'next/link';
import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import type { SocialReportView } from '@/lib/types';
import { call } from './client-api';
import { usePolling } from './hooks';
import { useI18n } from './I18n';
import { Icon } from './ui/Icon';

interface Alert { conversationId: string; at: string; topic: string }
interface Status { urgent: Alert[]; openReports: number; inbox: number; total: number }
const Ctx = createContext<Status>({ urgent: [], openReports: 0, inbox: 0, total: 0 });
export const useStaffStatus = () => useContext(Ctx);

export function StaffStatusProvider({ inbox, canModerate, children }: { inbox: number; canModerate: boolean; children: ReactNode }) {
  const [urgent, setUrgent] = useState<Alert[]>([]);
  const [openReports, setOpenReports] = useState(0);

  usePolling(async () => {
    const r = await call('/api/staff/alerts');
    if (r.ok) setUrgent((r.alerts as Alert[]) ?? []);
    return r.ok;
  }, 10_000);
  usePolling(async () => {
    const r = await call('/api/staff/social-reports');
    if (r.ok) setOpenReports((r.reports as SocialReportView[]).filter((x) => x.status === 'open').length);
    return r.ok;
  }, 20_000, canModerate);

  const value = useMemo<Status>(() => ({ urgent, openReports, inbox, total: urgent.length + openReports + inbox }), [urgent, openReports, inbox]);

  // il titolo della scheda porta il numero: si vede anche con il pannello in un'altra scheda del browser.
  // Una navigazione riscrive il titolo (metadata di pagina): un osservatore rimette il prefisso senza ricadere in cicli.
  useEffect(() => {
    const apply = () => {
      const base = document.title.replace(/^\(\d+\)\s/, '');
      const want = value.total > 0 ? `(${value.total}) ${base}` : base;
      if (document.title !== want) document.title = want;
    };
    apply();
    const el = document.querySelector('title');
    if (!el) return;
    const mo = new MutationObserver(apply);
    mo.observe(el, { childList: true, characterData: true, subtree: true });
    return () => mo.disconnect();
  }, [value.total]);

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

/** Avviso prioritario: compare in cima a ogni pagina del pannello finche' c'e' un'emergenza aperta. */
export function UrgentBanner() {
  const { t } = useI18n();
  const { urgent } = useStaffStatus();
  if (urgent.length === 0) return null;
  return (
    <div className="notice notice-err emergency" role="alert">
      <Icon name="alert" />
      <span className="grow"><strong>{t('admin.alerts.urgent', { n: urgent.length })}</strong> <span className="block">{t('admin.alerts.urgentHint')}</span></span>
      <Link className="btn btn-danger btn-small" href="/admin/inbox">{t('admin.alerts.open')}</Link>
    </div>
  );
}
