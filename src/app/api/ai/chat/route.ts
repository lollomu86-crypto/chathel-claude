import { aiChat } from '@/lib/api/handlers';
import { runApi } from '@/lib/api/http';

export const dynamic = 'force-dynamic';
// La chiave ANTHROPIC_API_KEY si legge solo qui, sul server (lib/ai/index.ts): mai nel client.
export const runtime = 'nodejs';

export async function POST(req: Request) {
  return runApi(req, (ctx, input) => aiChat(ctx, input));
}
