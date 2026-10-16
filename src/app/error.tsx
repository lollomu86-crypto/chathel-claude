'use client';
// Errore in una pagina server o in un componente: schermata tradotta con "Riprova" (F-02). Next la mostra DENTRO il layout radice.
import Link from 'next/link';
import { useEffect } from 'react';
import { useI18n } from '@/components/I18n';
import { Icon } from '@/components/ui/Icon';

export default function ErrorPage({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  const { t } = useI18n();
  useEffect(() => {
    // nessun dettaglio all'utente; solo il digest (identificativo) per chi indaga nei log del server
    console.error('ChatHel UI error', error.digest ?? '');
  }, [error]);
  return (
    <main id="main" className="shell shell-bare">
      <div className="card empty" role="alert">
        <Icon name="alert" />
        <h1 className="empty-title">{t('errorPage.title')}</h1>
        <p>{t('errorPage.body')}</p>
        <div className="btn-group">
          <button type="button" className="btn btn-primary" onClick={() => reset()}>{t('common.retry')}</button>
          <Link className="btn btn-secondary" href="/">{t('errorPage.home')}</Link>
        </div>
      </div>
    </main>
  );
}
