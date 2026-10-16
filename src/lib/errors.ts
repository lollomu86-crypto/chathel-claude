// Codici d'errore applicativi, identici agli SQLSTATE di schema.sql:
// CH001 bonus_cap_reached, CH002 slot_full, CH003 invalid_*, CH004 forbidden,
// CH005 conflict (gia' prenotato/aderito), CH006 too_late, CH007 rate_limited, CH900 immutabile.

export type ChCode = 'CH001' | 'CH002' | 'CH003' | 'CH004' | 'CH005' | 'CH006' | 'CH007' | 'CH900';

export class ChError extends Error {
  constructor(
    public readonly code: ChCode,
    public readonly reason: string,
  ) {
    super(reason);
    this.name = 'ChError';
  }
}

export function httpStatusFor(code: ChCode): number {
  switch (code) {
    case 'CH003':
      return 400;
    case 'CH004':
      return 403;
    case 'CH001':
    case 'CH002':
    case 'CH005':
    case 'CH006':
      return 409;
    case 'CH007':
      return 429;
    default:
      return 500;
  }
}

/** Estrae un ChError da un errore Postgres/PostgREST (campo `code` = SQLSTATE, `message` = reason). */
export function fromPgError(e: { code?: string; message?: string } | null | undefined): ChError | null {
  if (!e?.code || !/^CH\d{3}$/.test(e.code)) return null;
  return new ChError(e.code as ChCode, e.message ?? 'error');
}
