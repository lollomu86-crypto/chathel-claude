import { hotelByCode } from '@/lib/api/handlers';
import { runApi } from '@/lib/api/http';

export const dynamic = 'force-dynamic';

export async function POST(req: Request) {
  return runApi(req, (ctx, input) => hotelByCode(ctx, input));
}
