import { redirect } from 'next/navigation';
import { requireGuest } from '@/lib/server';
import { ChError } from '@/lib/errors';
import { ThreadClient } from '@/components/ThreadClient';
import { titleFor } from '@/components/page-meta';

export const dynamic = 'force-dynamic';
export const generateMetadata = titleFor('social.title');

export default async function ThreadPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { api, view } = await requireGuest();
  let data;
  try {
    const s = api.social();
    const [thread, settings] = await Promise.all([s.thread(decodeURIComponent(id)), s.settings()]);
    data = { thread, couponsLeft: settings.limits.couponsLeftToday };
  } catch (e) {
    // conversazione inesistente o chiusa da un blocco (errori attesi del dominio): si torna a Privati. Un guasto vero va a error.tsx.
    if (e instanceof ChError || (e as Error).message === 'social_not_available') redirect('/stay/social?tab=private');
    throw e;
  }
  return <ThreadClient initial={data.thread} timezone={view.hotel.timezone} couponsLeft={data.couponsLeft} />;
}
