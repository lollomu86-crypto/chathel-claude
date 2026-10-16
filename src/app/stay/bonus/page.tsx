import Link from 'next/link';
import { requireGuest } from '@/lib/server';
import { formatDate } from '@/lib/format';
import { BonusQr } from '@/components/BonusQr';
import { titleFor } from '@/components/page-meta';
import { Icon } from '@/components/ui/Icon';

export const dynamic = 'force-dynamic';
export const generateMetadata = titleFor('bonus.title');

export default async function BonusPage() {
  const { api, view, locale, t } = await requireGuest();
  const bonus = await api.bonus();
  if (bonus.state === 'redeemed') {
    return (
      <>
        <section className="ticket ticket-accent ticket-used">
          <div className="ticket-head"><span className="badge badge-ok"><Icon name="check" />{t('bonus.usedBadge')}</span></div>
          <h1 className="ticket-title">{t('bonus.used')}</h1>
        </section>
        <Link className="btn btn-primary" href="/stay/events">{t('bonus.nextEvents')}</Link>
      </>
    );
  }
  if (bonus.state !== 'issued') {
    return (
      <>
        <h1>{t('bonus.title')}</h1>
        <p className="notice notice-warn"><Icon name="info" />{bonus.state === 'cap_reached' ? t('home.bonusCap') : t('bonus.unavailable')}</p>
        <Link className="btn btn-secondary" href="/stay/events">{t('bonus.nextEvents')}</Link>
      </>
    );
  }
  return <BonusQr label={view.hotel.bonusLabel} validUntil={formatDate(bonus.expiresAt!, locale, view.hotel.timezone)} />;
}
