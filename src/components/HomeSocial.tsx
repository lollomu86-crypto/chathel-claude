'use client';
import Link from 'next/link';
import { useI18n } from './I18n';
import { useSocialBadge } from './SocialBadge';
import { Icon } from './ui/Icon';

/** Avviso in home: richieste di chat o novita' nelle conversazioni (stesso conteggio della barra). Niente se non c'e' nulla. */
export function HomeSocial() {
  const { t } = useI18n();
  const { unread, incoming } = useSocialBadge();
  if (unread === 0) return null;
  return (
    <Link className="card card-link notice-card" href="/stay/social?tab=private">
      <span className="row row-nowrap">
        <span className="avatar" aria-hidden="true"><Icon name="chat" /></span>
        <span className="grow">
          <strong>{incoming > 0 ? t('home.socialRequests', { n: incoming }) : t('home.socialNew', { n: unread })}</strong>
          <span className="muted small block">{t('home.socialOpen')}</span>
        </span>
        <span className="count" aria-hidden="true">{unread}</span>
      </span>
    </Link>
  );
}
