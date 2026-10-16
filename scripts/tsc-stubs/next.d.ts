declare module 'next/link' { const Link: (p: { href: string; children?: import('react').ReactNode; className?: string; [k: string]: unknown }) => import('react').ReactElement; export default Link; }
declare module 'next/navigation' {
  export function useRouter(): { push(u: string): void; replace(u: string): void; refresh(): void; back(): void };
  export function usePathname(): string;
  export function useSearchParams(): URLSearchParams;
  export function redirect(url: string): never;
  export function notFound(): never;
}
declare module 'next/headers' {
  export function cookies(): Promise<{ get(n: string): { value: string } | undefined }>;
  export function headers(): Promise<{ get(n: string): string | null }>;
}
declare module 'next' {
  export interface Metadata { [k: string]: unknown }
  export interface Viewport { [k: string]: unknown }
}
declare module 'next/font/google' {
  type F = (o: Record<string, unknown>) => { variable: string; className: string };
  export const Inter: F; export const Montserrat: F;
}
declare module 'next/server' {
  export class NextRequest extends Request { cookies: { get(n: string): { value: string } | undefined; getAll(): { name: string; value: string }[] } }
  export const NextResponse: { next(o?: unknown): { cookies: { set(n: string, v: string, o?: unknown): void } }; json(b: unknown, o?: unknown): Response };
}
declare module 'qrcode' { export function toCanvas(c: HTMLCanvasElement, text: string, o?: unknown): Promise<void>; }
declare module '@supabase/supabase-js' { export function createClient(url: string, key: string, opts?: unknown): any; export type SupabaseClient = any; }
declare module '@anthropic-ai/sdk' { class Anthropic { constructor(o?: any); [k: string]: any } export default Anthropic; }
declare module '*.json' { const v: any; export default v; }
declare module '*.css' {}
