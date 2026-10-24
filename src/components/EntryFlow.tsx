'use client';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { finishGoogleLogin, signInWithGoogle, type BrowserAuthClient } from '@/lib/auth/google-client';
import { call, setLangCookie } from './client-api';
import { ConsentFields, NO_CONSENTS, type SocialConsents } from './ConsentFields';
import { useErrorText, useI18n } from './I18n';
import { Icon } from './ui/Icon';

const pad = (n: number) => String(n).padStart(2, '0');
const dayKey = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

interface IdentityOptions { mode: 'demo' | 'supabase'; demo: { id: string; label: string }[] }
interface Me { givenName: string; provider: string }

/**
 * Ingresso dell'ospite, in due passi:
 *  1. identita': "Continua con Google" (demo: scelta di un'identita' simulata; supabase: signInWithOAuth, NON verificabile qui);
 *  2. onboarding: nickname, data di partenza, maggiore eta', tre consensi sociali separati e non precompilati, informativa.
 * Il QR dell'hotel e' gia' nell'indirizzo della pagina (token `k`): qui si mostra solo che e' presente.
 */
export function EntryFlow({ slug, token, hotelName }: { slug: string; token: string; hotelName: string }) {
  const { t, locale } = useI18n();
  const errText = useErrorText();
  const router = useRouter();
  const [options, setOptions] = useState<IdentityOptions | null>(null);
  const [me, setMe] = useState<Me | null>(null);
  const [checking, setChecking] = useState(true);
  const [pickDemo, setPickDemo] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [setupWarn, setSetupWarn] = useState(false);

  const { today, def } = useMemo(() => {
    const now = new Date();
    const d = new Date(now);
    d.setDate(d.getDate() + 7);
    return { today: dayKey(now), def: dayKey(d) };
  }, []);
  const [nickname, setNickname] = useState('');
  const [checkout, setCheckout] = useState(def);
  const [adult, setAdult] = useState(false);
  const [consents, setConsents] = useState<SocialConsents>(NO_CONSENTS);
  const [privacy, setPrivacy] = useState(false);

  // al montaggio: identita' gia' presente? opzioni del provider? ritorno da Google (solo modalita' supabase)?
  useEffect(() => {
    let alive = true;
    (async () => {
      const [o, m] = await Promise.all([call('/api/identity/options'), call('/api/identity/me')]);
      if (!alive) return;
      const opt = o.ok ? ({ mode: o.mode, demo: (o.demo as IdentityOptions['demo']) ?? [] } as IdentityOptions) : null;
      setOptions(opt);
      let identity = m.ok ? (m.identity as Me) : null;
      const back = typeof window !== 'undefined' && (/access_token=|[?&]code=/.test(window.location.hash + window.location.search));
      if (!identity && opt?.mode === 'supabase' && back) {
        const client = await browserClient(true);
        if (client) {
          const r = await finishGoogleLogin(client, call);
          if (r.ok) {
            const m2 = await call('/api/identity/me');
            identity = m2.ok ? (m2.identity as Me) : null;
          } else setError(t('onboarding.googleFailed'));
        }
        // toglie i parametri OAuth dall'indirizzo, tenendo il codice QR dell'hotel
        const u = new URL(window.location.href);
        u.hash = '';
        u.searchParams.delete('code');
        window.history.replaceState(null, '', u.pathname + (u.search || ''));
      }
      if (!alive) return;
      setMe(identity);
      setChecking(false);
    })();
    return () => { alive = false; };
    // t cambia solo con la lingua: l'ingresso non deve ripartire
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const loginDemo = useCallback(async (id: string) => {
    setBusy(true); setError(null);
    const r = await call('/api/identity/demo-login', { id });
    setBusy(false);
    if (r.ok) { setMe(r.identity as Me); setPickDemo(false); } else setError(errText(r.error));
  }, [errText]);

  const google = async () => {
    setError(null);
    if (options?.mode === 'demo') { setPickDemo((v) => !v); return; }
    setBusy(true);
    const client = await browserClient(false);
    if (!client) { setBusy(false); setError(t('onboarding.googleUnavailable')); return; }
    const redirectTo = `${window.location.origin}/h/${encodeURIComponent(slug)}?k=${encodeURIComponent(token)}`;
    const r = await signInWithGoogle(client, redirectTo);
    if (r.error) { setBusy(false); setError(t('onboarding.googleFailed')); }
  };

  const switchAccount = async () => {
    await call('/api/identity/logout', {});
    setMe(null); setPickDemo(false);
  };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true); setError(null); setSetupWarn(false);
    setLangCookie(locale);
    const wantList = adult && consents.list;
    const wantDm = wantList && consents.dm;
    // sicuro per costruzione: l'elenco si attiva subito solo se anche i privati sono consentiti (il valore predefinito del
    // dominio e' "accetto privati"); altrimenti si entra non visibili e si attiva l'elenco DOPO aver spento i privati
    const r = await call('/api/onboarding', {
      slug, k: token, nickname: nickname.trim() || undefined, locale, checkout, isAdult: adult, socialOptIn: wantDm, consent: privacy,
    });
    if (!r.ok) {
      setBusy(false);
      if (r.error === 'identity_required') { setMe(null); }
      setError(r.error === 'invalid_qr' ? t('onboarding.invalidQr') : errText(r.error, 'onboarding'));
      return;
    }
    let failed = false;
    if (wantList && !wantDm) {
      const a = await call('/api/guest/social-settings-update', { acceptsPrivate: false });
      const b = a.ok ? await call('/api/guest/social-settings-update', { visible: true }) : a;
      if (!b.ok) failed = true;
    }
    // con i privati consentiti l'ingresso registra gia' le regole (start_stay): la chiamata serve solo negli altri casi
    if (wantList && !wantDm && consents.chat) {
      const c = await call('/api/guest/social-rules', {});
      if (!c.ok) failed = true;
    }
    if (failed) { setBusy(false); setSetupWarn(true); return; }
    router.replace('/stay?welcome=1');
    router.refresh();
  };

  if (!token) return <p className="notice notice-err" role="alert"><Icon name="alert" />{t('onboarding.missingQr')}</p>;
  if (checking) return <div className="stack" aria-busy="true"><span className="skeleton sk-56" /><span className="skeleton sk-120" /></div>;

  return (
    <div className="stack-lg">
      <p className="notice notice-ok" role="status"><Icon name="check" />{t('onboarding.qrOk', { hotel: hotelName })}</p>

      {!me ? (
        <section className="card stack" aria-labelledby="idh">
          <h2 id="idh" className="t-sub">{t('onboarding.identityTitle')}</h2>
          <p>{t('onboarding.identityBody')}</p>
          <button type="button" className="btn btn-primary btn-lg btn-block" onClick={google} disabled={busy} aria-expanded={options?.mode === 'demo' ? pickDemo : undefined}>
            <Icon name="google" />{t('onboarding.google')}
          </button>
          {options?.mode === 'demo' && (
            <p className="notice notice-warn"><Icon name="info" />{t('onboarding.demoIdentity')}</p>
          )}
          {pickDemo && options && (
            <div className="stack-sm" role="group" aria-label={t('onboarding.demoPick')}>
              <p className="label">{t('onboarding.demoPick')}</p>
              {options.demo.map((d) => (
                <button key={d.id} type="button" className="btn btn-secondary btn-block" disabled={busy} onClick={() => loginDemo(d.id)}>{d.label}</button>
              ))}
            </div>
          )}
          {error && <p className="error-text" role="alert"><Icon name="alert" />{error}</p>}
          <p className="hint">{t('onboarding.googleNote')}</p>
        </section>
      ) : (
        <form onSubmit={submit} className="form" noValidate>
          <div className="row-between">
            <p className="grow" role="status"><strong>{t('onboarding.hello', { name: me.givenName })}</strong></p>
            <button type="button" className="btn btn-ghost btn-small" onClick={switchAccount}>{t('onboarding.switchAccount')}</button>
          </div>
          <div className="field">
            <label htmlFor="nick">{t('onboarding.nickLabel')} <span className="muted">({t('common.optional')})</span></label>
            <input id="nick" type="text" autoComplete="nickname" minLength={2} maxLength={20} value={nickname} placeholder={me.givenName} aria-describedby="nick-hint" onChange={(e) => setNickname(e.target.value)} />
            <p className="hint" id="nick-hint">{t('onboarding.nickHint')}</p>
          </div>
          <div className="field">
            <label htmlFor="checkout">{t('onboarding.checkoutLabel')}</label>
            <input id="checkout" type="date" required min={today} value={checkout} aria-describedby="co-hint" onChange={(e) => setCheckout(e.target.value)} />
            <p className="hint" id="co-hint">{t('onboarding.checkoutHint')}</p>
          </div>
          <label className="check">
            <input type="checkbox" checked={adult} onChange={(e) => { setAdult(e.target.checked); if (!e.target.checked) setConsents(NO_CONSENTS); }} />
            <span>{t('onboarding.adultLabel')}</span>
          </label>
          <ConsentFields value={consents} onChange={setConsents} adult={adult} idPrefix="ob" />
          <label className="check">
            <input type="checkbox" required checked={privacy} onChange={(e) => setPrivacy(e.target.checked)} />
            <span>
              {t('onboarding.consentPrefix')}
              <Link href="/privacy" target="_blank">{t('onboarding.consentLink')}</Link>
              {t('onboarding.consentSuffix')}
            </span>
          </label>
          {error && <p className="error-text" role="alert"><Icon name="alert" />{error}</p>}
          {setupWarn && (
            <div className="notice notice-warn" role="alert">
              <Icon name="alert" />
              <span>{t('onboarding.socialSetupFailed')} <Link href="/stay/social?tab=settings">{t('onboarding.socialSetupGo')}</Link></span>
            </div>
          )}
          <button className="btn btn-primary btn-lg btn-block" type="submit" disabled={busy || !privacy || !checkout} aria-busy={busy}>
            {busy ? t('common.loading') : t('onboarding.start')}
          </button>
        </form>
      )}
    </div>
  );
}

/** Client Supabase del browser per il login Google. NON VERIFICABILE senza progetto Supabase e Google OAuth reali. */
async function browserClient(detectSession: boolean): Promise<BrowserAuthClient | null> {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !key) return null;
  try {
    const { createClient } = await import('@supabase/supabase-js');
    return createClient(url, key, { auth: { persistSession: true, autoRefreshToken: false, detectSessionInUrl: detectSession } }) as unknown as BrowserAuthClient;
  } catch {
    return null;
  }
}
