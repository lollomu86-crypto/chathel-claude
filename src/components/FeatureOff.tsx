import Link from 'next/link';
import { Icon } from './ui/Icon';

/** Pagina di una funzione spenta dal direttore (link vecchio o salvato): niente errore, solo un avviso e il ritorno alla Home. */
export function FeatureOff({ title, t }: { title: string; t: (k: string, v?: Record<string, string | number>) => string }) {
  return (
    <>
      <h1>{title}</h1>
      <div className="notice notice-info" role="status">
        <Icon name="info" />
        <span className="grow">{t('common.featureOff')}</span>
      </div>
      <p><Link className="btn btn-secondary" href="/stay">{t('common.backHome')}</Link></p>
    </>
  );
}
