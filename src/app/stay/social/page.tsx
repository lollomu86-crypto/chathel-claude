import { requireGuest } from '@/lib/server';
import { SocialClient } from '@/components/SocialClient';
import { SOCIAL_TABS, type SocialTab } from '@/components/social-tabs';
import { titleFor } from '@/components/page-meta';
import { FeatureOff } from '@/components/FeatureOff';
import { Icon } from '@/components/ui/Icon';

export const dynamic = 'force-dynamic';
export const generateMetadata = titleFor('social.title');

export default async function SocialPage({ searchParams }: { searchParams: Promise<{ tab?: string }> }) {
  const sp = await searchParams;
  const { api, view, t } = await requireGuest();
  if (!view.hotel.features.social) return <FeatureOff title={t('social.title')} t={t} />;
  let settings;
  try {
    settings = await api.social().settings();
  } catch (e) {
    // "funzione non attiva" e' uno stato previsto; qualunque altro guasto NON va nascosto: passa a error.tsx (con "Riprova")
    if ((e as { reason?: string; message?: string }).reason === 'social_not_available' || (e as Error).message === 'social_not_available') {
      return (<><h1>{t('social.title')}</h1><p className="notice notice-warn"><Icon name="info" />{t('social.unavailable')}</p></>);
    }
    throw e;
  }
  const tab: SocialTab = (SOCIAL_TABS as readonly string[]).includes(sp.tab ?? '') ? (sp.tab as SocialTab) : 'people';
  return <SocialClient initial={settings} hotelName={view.hotel.name} timezone={view.hotel.timezone} initialTab={tab} />;
}
