import { health } from '@/lib/api/handlers';
import { runApi } from '@/lib/api/http';

export const dynamic = 'force-dynamic';

export async function GET(req: Request) {
  return runApi(req, () => health());
}
