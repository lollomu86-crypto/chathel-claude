import { identityAction } from '@/lib/api/handlers';
import { runApi } from '@/lib/api/http';

export const dynamic = 'force-dynamic';
type P = { params: Promise<{ action: string }> };

async function handle(req: Request, { params }: P) {
  const { action } = await params;
  return runApi(req, (ctx, input) => identityAction(ctx, action, input));
}
export const GET = handle;
export const POST = handle;
