import { requireGuest } from '@/lib/server';
import { CONTENT_LOCALES } from '@/lib/types';
import { RequestsClient } from '@/components/RequestsClient';
import { FeatureOff } from '@/components/FeatureOff';
import { titleFor } from '@/components/page-meta';

export const dynamic = 'force-dynamic';
export const generateMetadata = titleFor('requests.title');

export default async function RequestsPage() {
  const { api, view, t } = await requireGuest();
  if (!view.hotel.features.requests) return <FeatureOff title={t('requests.title')} t={t} />;
  const [categories, requests] = await Promise.all([api.requestCategories(), api.myRequests()]);
  const def = (CONTENT_LOCALES as readonly string[]).includes(view.hotel.defaultLocale) ? view.hotel.defaultLocale as 'it' | 'en' | 'de' | 'ru' : 'it';
  return <RequestsClient initialCategories={categories} initialRequests={requests} timezone={view.hotel.timezone} hotelDefault={def} />;
}
