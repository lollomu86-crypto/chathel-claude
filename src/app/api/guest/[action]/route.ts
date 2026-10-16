import { guestAction } from '@/lib/api/handlers';
import { runApi } from '@/lib/api/http';

export const dynamic = 'force-dynamic';
type P = { params: Promise<{ action: string }> };

export async function GET(req: Request, { params }: P) {
  const { action } = await params;
  return runApi(req, (ctx, input) => guestAction(ctx, action, input));
}
export async function POST(req: Request, { params }: P) {
  const { action } = await params;
  return runApi(req, (ctx, input) => guestAction(ctx, action, input));
}
