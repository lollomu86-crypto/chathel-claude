'use client';
import { useRouter } from 'next/navigation';
import { call } from './client-api';
import { useI18n } from './I18n';
import { Icon } from './ui/Icon';

/** Uscita dello staff: pulsante-icona 44 px per la testata blu, con il nome nell'aria-label. */
export function LogoutButton({ to }: { to: string }) {
  const { t } = useI18n();
  const router = useRouter();
  return (
    <button type="button" className="icon-btn" aria-label={t('common.logout')} title={t('common.logout')}
      onClick={async () => { await call('/api/staff/logout', {}); router.replace(to); router.refresh(); }}>
      <Icon name="logout" />
    </button>
  );
}
