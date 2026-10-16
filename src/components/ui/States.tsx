'use client';
import Link from 'next/link';
import { useI18n } from '../I18n';
import { Icon } from './Icon';

/** Scheletro di caricamento: annunciato una volta ai lettori di schermo, righe che pulsano (ferme con movimento ridotto). */
export function LoadingSkeleton({ rows = 3 }: { rows?: number }) {
  const { t } = useI18n();
  return (
    <div className="stack" role="status" aria-busy="true">
      <span className="sr-only">{t('common.loading')}</span>
      <span className="skeleton sk-title" aria-hidden="true" />
      {Array.from({ length: rows }, (_, i) => <span key={i} className="skeleton sk-88" aria-hidden="true" />)}
    </div>
  );
}

/** Stato vuoto invitante: icona, titolo, frase, azione facoltativa. */
export function EmptyState({ icon = 'info', title, text, action }: { icon?: string; title: string; text?: string; action?: { label: string; onClick?: () => void; href?: string } }) {
  return (
    <div className="card empty">
      <Icon name={icon} />
      <p className="empty-title">{title}</p>
      {text && <p>{text}</p>}
      {action && (action.href
        ? <Link className="btn btn-secondary btn-small" href={action.href}>{action.label}</Link>
        : <button type="button" className="btn btn-secondary btn-small" onClick={action.onClick}>{action.label}</button>)}
    </div>
  );
}

/** Errore con "Riprova" (caricamenti che falliscono: mai uno schermo vuoto). */
export function ErrorState({ text, onRetry }: { text: string; onRetry?: () => void }) {
  const { t } = useI18n();
  return (
    <div className="notice notice-err" role="alert">
      <Icon name="alert" />
      <span className="grow">{text}</span>
      {onRetry && <button type="button" className="btn btn-secondary btn-small" onClick={onRetry}>{t('common.retry')}</button>}
    </div>
  );
}
