import { staffMedia } from '@/lib/api/handlers';
import { runUpload } from '@/lib/api/http';

export const dynamic = 'force-dynamic';

// POST /api/staff/media?kind=logo|cover, corpo = l'immagine (JPG, PNG o WebP, max 2 MB)
export async function POST(req: Request) {
  const kind = new URL(req.url).searchParams.get('kind');
  return runUpload(req, (ctx, bytes, type) => staffMedia(ctx, kind, bytes, type));
}
