import { getStore } from '@/lib/store';

export const dynamic = 'force-dynamic';

// Solo demo: immagini caricate dal pannello e tenute in memoria. Con Supabase le immagini stanno nel bucket "hotel-media".
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const store = await getStore();
  const f = /^(logo|cover)-[0-9a-f-]{36}$/.test(id) ? store.media?.(id) : null;
  if (!f) return new Response('not found', { status: 404 });
  return new Response(new Uint8Array(f.bytes), {
    headers: { 'Content-Type': f.type, 'Cache-Control': 'public, max-age=31536000, immutable', 'X-Content-Type-Options': 'nosniff' },
  });
}
