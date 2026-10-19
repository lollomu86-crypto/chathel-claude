'use client';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { call } from './client-api';
import { useErrorText, useI18n } from './I18n';
import { Icon } from './ui/Icon';

/** Ingresso con il codice numerico dell'hotel (6 cifre), per chi non ha il QR a portata di mano. */
export function CodeEntry() {
  const { t } = useI18n();
  const errText = useErrorText();
  const router = useRouter();
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const valid = /^\d{6}$/.test(code);

  const go = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!valid || busy) return;
    setBusy(true); setError(null);
    const r = await call('/api/hotel-code', { code });
    if (r.ok && typeof r.slug === 'string') {
      router.push(`/h/${encodeURIComponent(r.slug)}?k=${code}`);
      return;
    }
    setBusy(false);
    setError(errText(r.error));
  };

  return (
    <form className="card stack" aria-labelledby="code-h" onSubmit={go} noValidate>
      <h2 id="code-h" className="t-sub">{t('landing.codeTitle')}</h2>
      <p className="muted small" id="code-help">{t('landing.codeHelp')}</p>
      <div className="field">
        <label htmlFor="hotel-code">{t('landing.codeLabel')}</label>
        <input
          id="hotel-code" name="hotel-code" type="text" inputMode="numeric" pattern="[0-9]*" autoComplete="off" maxLength={6}
          placeholder="000000" value={code} aria-describedby="code-help" aria-invalid={error ? true : undefined}
          onChange={(e) => { setCode(e.target.value.replace(/\D/g, '').slice(0, 6)); setError(null); }}
        />
      </div>
      {error && <p className="error-text" role="alert"><Icon name="alert" />{error}</p>}
      <button type="submit" className="btn btn-primary" disabled={!valid || busy}>{t('landing.codeGo')}</button>
    </form>
  );
}
