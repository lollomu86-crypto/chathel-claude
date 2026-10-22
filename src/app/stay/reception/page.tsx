import { requireGuest } from '@/lib/server';
import { aiMode } from '@/lib/ai';
import { ChatClient } from '@/components/ChatClient';
import { FeatureOff } from '@/components/FeatureOff';
import { titleFor } from '@/components/page-meta';

export const dynamic = 'force-dynamic';
export const generateMetadata = titleFor('nav.reception');

export default async function ReceptionPage() {
  const { api, view, t } = await requireGuest();
  if (!view.hotel.features.reception) return <FeatureOff title={t('nav.reception')} t={t} />;
  const chat = await api.chat();
  return <ChatClient initial={chat} hotelName={view.hotel.name} aiMode={aiMode()} timezone={view.hotel.timezone} />;
}
