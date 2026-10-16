'use client';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { call } from './client-api';
import { useI18n } from './I18n';
import { Icon } from './ui/Icon';

export function StaffLogin({ next }: { next: string }) {
  const { t } = useI18n();
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true); setError(null);
    const r = await call('/api/staff/login', { email, password });
    setBusy(false);
    if (r.ok) { router.replace(r.role === 'bartender' ? '/bar' : next); router.refresh(); }
    else setError(r.error === 'rate_limited' ? t('errors.rate_limited') : t('staff.invalid'));
  };
  return (
    <form onSubmit={submit} className="form card" aria-labelledby="sl-h">
      <h2 id="sl-h" className="t-sub">{t('staff.loginTitle')}</h2>
      <div className="field">
        <label htmlFor="email">{t('staff.email')}</label>
        <input id="email" type="email" autoComplete="username" required value={email} aria-invalid={error ? true : undefined} onChange={(e) => setEmail(e.target.value)} />
      </div>
      <div className="field">
        <label htmlFor="pw">{t('staff.password')}</label>
        <input id="pw" type="password" autoComplete="current-password" required value={password} aria-invalid={error ? true : undefined} aria-describedby={error ? 'sl-err' : undefined} onChange={(e) => setPassword(e.target.value)} />
        {error && <p className="error-text" id="sl-err" role="alert"><Icon name="alert" />{error}</p>}
      </div>
      <button className="btn btn-primary btn-block" type="submit" disabled={busy} aria-busy={busy}>{busy ? t('common.loading') : t('staff.signIn')}</button>
    </form>
  );
}
