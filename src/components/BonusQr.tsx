'use client';
import Link from 'next/link';
import { useCallback, useEffect, useRef, useState } from 'react';
import { call } from './client-api';
import { useLatest, usePolling } from './hooks';
import { useErrorText, useI18n } from './I18n';
import { Icon } from './ui/Icon';

/**
 * QR monouso a vita breve (90 s). Si rigenera da solo mentre la pagina e' aperta; lo stato "usato" si legge ogni 4 s (CA5).
 * Il token viaggia nel frammento URL (#), che non finisce nei log del server. Il token in chiaro non e' mai salvato dall'app.
 * Se la rigenerazione fallisce (rete debole al bar della piscina) il QR a schermo NON sparisce: resta con un avviso (F-09).
 * `errText` e' stabile, ma non e' comunque una dipendenza degli effetti che chiamano l'API (F-01).
 */
export function BonusQr({ label, validUntil }: { label: string; validUntil: string }) {
  const { t } = useI18n();
  const errText = useErrorText();
  const errRef = useLatest(errText);
  const tRef = useLatest(t);
  const canvas = useRef<HTMLCanvasElement>(null);
  const [expires, setExpires] = useState<number | null>(null);
  const [left, setLeft] = useState(0);
  const [token, setToken] = useState<string | null>(null);
  const [used, setUsed] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [drawFailed, setDrawFailed] = useState(false);
  const loading = useRef(false);
  const lastTry = useRef(0);

  const refresh = useCallback(async (force = false) => {
    if (loading.current) return;
    if (!force && Date.now() - lastTry.current < 5000) return;
    loading.current = true;
    lastTry.current = Date.now();
    const r = await call('/api/guest/bonus-qr', {});
    loading.current = false;
    if (!r.ok) { setError(r.status === 0 ? tRef.current('bonus.refreshOffline') : errRef.current(r.error)); return; }
    const qr = r.qr as { token: string; expiresAt: string };
    setError(null);
    setToken(qr.token);
    setExpires(new Date(qr.expiresAt).getTime());
  }, [errRef, tRef]);

  useEffect(() => { void refresh(true); }, [refresh]);

  useEffect(() => {
    if (!token || !canvas.current) return;
    const url = `${window.location.origin}/bar#${token}`;
    import('qrcode')
      .then((Q) => Q.toCanvas(canvas.current!, url, { width: 300, margin: 1, errorCorrectionLevel: 'M' }))
      .then(() => setDrawFailed(false))
      .catch(() => setDrawFailed(true));
  }, [token]);

  // conto alla rovescia; rigenerazione 8 s prima della scadenza
  useEffect(() => {
    if (!expires || used) return;
    const tick = () => {
      const s = Math.max(0, Math.round((expires - Date.now()) / 1000));
      setLeft(s);
      if (s <= 8) void refresh();
    };
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, [expires, used, refresh]);

  usePolling(async () => {
    const r = await call('/api/guest/bonus');
    if (r.ok && (r.bonus as { state: string }).state === 'redeemed') setUsed(true);
    return r.ok;
  }, 4000, !used);

  if (used) {
    return (
      <>
        <section className="ticket ticket-accent ticket-used" aria-live="polite" aria-labelledby="bq-h">
          <div className="ticket-head"><span className="badge badge-ok"><Icon name="check" />{t('bonus.usedBadge')}</span></div>
          <h1 id="bq-h" className="ticket-title">{t('bonus.used')}</h1>
        </section>
        <section className="stack" aria-labelledby="nx">
          <h2 id="nx" className="t-sub">{t('bonus.next')}</h2>
          <Link className="btn btn-primary btn-block" href="/stay/events">{t('bonus.nextEvents')}</Link>
          <Link className="btn btn-secondary btn-block" href="/stay/book">{t('bonus.nextBook')}</Link>
        </section>
      </>
    );
  }
  const expired = expires !== null && left === 0;
  return (
    <>
      <h1 className="sr-only">{t('bonus.title')}</h1>
      <p>{t('bonus.intro')}</p>
      <section className="ticket ticket-accent" aria-labelledby="bq-h">
        <div className="ticket-head">
          <span className="badge badge-bonus">{t('home.bonusBadge')}</span>
          <span className="ticket-meta">{t('home.validUntil', { date: validUntil })}</span>
        </div>
        <h2 id="bq-h" className="ticket-title">{label}</h2>
        <div className="ticket-qr" aria-busy={!token}>
          <canvas ref={canvas} role="img" aria-label={t('bonus.qrAlt', { label })} />
        </div>
        {drawFailed && token && <p className="tokenbox">{token}</p>}
        <div className="ticket-foot">
          <span className="countdown" aria-live="off">
            {!expires ? t('common.loading') : expired ? t('bonus.expired') : t('bonus.expiresIn', { s: left })}
          </span>
          <button type="button" className="btn btn-secondary" onClick={() => void refresh(true)}>{t('bonus.refresh')}</button>
        </div>
      </section>
      {error && <p className="notice notice-warn" role="alert"><Icon name="alert" />{error}{token ? ` ${t('bonus.keepShowing')}` : ''}</p>}
      <p className="hint">{t('bonus.oneOnly')}</p>
    </>
  );
}
