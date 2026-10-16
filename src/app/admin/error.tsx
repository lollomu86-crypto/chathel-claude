'use client';
// Errore in una scheda del pannello: la testata e la barra restano, cambia solo il contenuto (layout /stay fuori dal confine).
import { useI18n } from '@/components/I18n';
import { Icon } from '@/components/ui/Icon';

export default function AdminError({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  const { t } = useI18n();
  return (
    <div className="card empty" role="alert">
      <Icon name="alert" />
      <h1 className="empty-title">{t('errorPage.title')}</h1>
      <p>{t('errorPage.body')}</p>
      <button type="button" className="btn btn-primary" onClick={() => reset()}>{t('common.retry')}</button>
    </div>
  );
}
