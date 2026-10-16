'use client';
import { useState } from 'react';
import { REPORT_REASONS, type ReportReason } from '@/lib/types';
import { useI18n } from './I18n';
import { Dialog } from './ui/Dialog';
import { Icon } from './ui/Icon';

/** Segnalazione: motivo + invio. `onSend` restituisce un testo d'errore tradotto, oppure null se e' andata bene. */
export function ReportDialog({ open, onClose, onSend, defaultReason = 'inappropriate' }: { open: boolean; onClose: () => void; onSend: (reason: ReportReason) => Promise<string | null>; defaultReason?: ReportReason }) {
  const { t } = useI18n();
  const [reason, setReason] = useState<ReportReason>(defaultReason);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const send = async () => {
    setBusy(true); setError(null);
    const err = await onSend(reason);
    setBusy(false);
    if (err) setError(err); else onClose();
  };
  return (
    <Dialog open={open} onClose={onClose} title={t('social.chat.report')}>
      <div className="field">
        <label htmlFor="report-why">{t('social.chat.reportWhy')}</label>
        <select id="report-why" value={reason} onChange={(e) => setReason(e.target.value as ReportReason)}>
          {REPORT_REASONS.map((x) => <option key={x} value={x}>{t(`social.report.${x}`)}</option>)}
        </select>
      </div>
      <p className="hint">{t('social.chat.reportHint')}</p>
      {error && <p className="error-text" role="alert"><Icon name="alert" />{error}</p>}
      <div className="btn-group dialog-actions">
        <button type="button" className="btn btn-primary" disabled={busy} aria-busy={busy} onClick={send}>{t('social.chat.reportSend')}</button>
        <button type="button" className="btn btn-secondary" onClick={onClose}>{t('common.cancel')}</button>
      </div>
    </Dialog>
  );
}
