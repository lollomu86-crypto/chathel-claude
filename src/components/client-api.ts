// Chiamate JSON alle API dell'app (stessa origine, cookie HttpOnly gestiti dal browser).

export interface ApiResult {
  ok: boolean;
  error?: string;
  status: number;
  [key: string]: unknown;
}

export async function call(url: string, body?: unknown): Promise<ApiResult> {
  try {
    const r = await fetch(url, {
      method: body === undefined ? 'GET' : 'POST',
      headers: { 'content-type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
      credentials: 'same-origin',
      cache: 'no-store',
    });
    let j: Record<string, unknown>;
    try {
      j = await r.json();
    } catch {
      j = { ok: false, error: 'internal' };
    }
    return { ...j, ok: j.ok === true, status: r.status } as ApiResult;
  } catch {
    return { ok: false, error: 'network', status: 0 };
  }
}

export function setLangCookie(locale: string) {
  // cookie non sensibile (solo la lingua), leggibile dal server per il rendering
  document.cookie = `ch_lang=${locale}; Path=/; Max-Age=${60 * 60 * 24 * 365}; SameSite=Lax`;
}
