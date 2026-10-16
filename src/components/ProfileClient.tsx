'use client';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { call } from './client-api';
import { useConfirm, useErrorText, useI18n } from './I18n';
import { LangSwitch } from './LangSwitch';
import { Icon } from './ui/Icon';

type Theme = 'system' | 'light' | 'dark';

function readTheme(): Theme {
  if (typeof document === 'undefined') return 'system';
  const v = document.documentElement.getAttribute('data-theme');
  return v === 'light' || v === 'dark' ? v : 'system';
}

export function ProfileClient({ expires }: { expires: string }) {
  const { t } = useI18n();
  const errText = useErrorText();
  const ask = useConfirm();
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [theme, setTheme] = useState<Theme>(readTheme);

  const pickTheme = (v: Theme) => {
    setTheme(v);
    // cookie non sensibile letto dal layout; l'attributo si applica subito senza ricaricare
    document.cookie = `ch_theme=${v === 'system' ? ''  : v}; Path=/; Max-Age=${v === 'system' ? 0 : 60 * 60 * 24 * 365}; SameSite=Lax`;
    if (v === 'system') document.documentElement.removeAttribute('data-theme');
    else document.documentElement.setAttribute('data-theme', v);
  };

  const del = async () => {
    if (!(await ask({ title: t('profile.deleteTitle'), body: t('profile.deleteBody'), confirmLabel: t('profile.deleteConfirm'), danger: true }))) return;
    setBusy(true); setError(null);
    const r = await call('/api/guest/delete-me', {});
    setBusy(false);
    if (r.ok) { setDone(true); setTimeout(() => router.replace('/'), 2500); } else setError(errText(r.error));
  };
  if (done) return <p className="notice notice-ok" role="status"><Icon name="check" />{t('profile.deleted')}</p>;
  const themes: Theme[] = ['system', 'light', 'dark'];
  return (
    <>
      <h1>{t('profile.title')}</h1>
      <section className="card stack" aria-labelledby="pl">
        <h2 id="pl" className="t-sub">{t('profile.language')}</h2>
        <LangSwitch saveToProfile />
      </section>
      <section className="card stack" aria-labelledby="pt">
        <h2 id="pt" className="t-sub">{t('profile.theme')}</h2>
        <div className="seg" role="group" aria-labelledby="pt">
          {themes.map((v) => (
            <button key={v} type="button" aria-pressed={theme === v} onClick={() => pickTheme(v)}>
              {t(`profile.themes.${v}`)}
            </button>
          ))}
        </div>
      </section>
      <section className="card stack" aria-labelledby="ps">
        <h2 id="ps" className="t-sub">{t('profile.socialTitle')}</h2>
        <p className="muted">{t('profile.socialBody')}</p>
        <Link className="btn btn-secondary" href="/stay/social?tab=settings">{t('profile.socialOpen')}</Link>
      </section>
      <p className="muted">{t('profile.expires', { date: expires })}</p>
      <section className="card stack" aria-labelledby="pd">
        <h2 id="pd" className="t-sub">{t('profile.deleteTitle')}</h2>
        <p>{t('profile.deleteBody')}</p>
        {error && <p className="error-text" role="alert"><Icon name="alert" />{error}</p>}
        <button type="button" className="btn btn-danger" disabled={busy} aria-busy={busy} onClick={del}>{t('profile.deleteTitle')}</button>
      </section>
      <p><Link className="link-tap" href="/privacy">{t('profile.privacy')}</Link></p>
    </>
  );
}
