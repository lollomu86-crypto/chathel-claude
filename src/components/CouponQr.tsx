'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import type { CouponQrView } from '@/lib/types';
import { call } from './client-api';
import { useLatest, usePolling } from './hooks';
import { useErrorText, useI18n } from './I18n';
import { Icon } from './ui/Icon';

/**
 * QR monouso del coupon (stesso schema del bonus: vita breve, si rigenera da solo, token nel frammento #).
 * Biglietto non compatto. Lo stato "usato" si legge dalla conversazione ogni 4 s. Se la rigenerazione fallisce il QR resta.
 */
export function CouponQr({ threadId, couponId, kindLabel, onClose }: { threadId: string; couponId: string; kindLabel: string; onClose: () => void }) {
  const { t } = useI18n();
  const errRef = useLatest(useErrorText());
  const canvas = useRef<HTMLCanvasElement>(null);
  const [qr, setQr] = useState<CouponQrView | null>(null);
  const [left, setLeft] = useState(0);
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
    const r = await call('/api/guest/social-coupon-qr', { couponId });
    loading.current = false;
    if (!r.ok) { setError(errRef.current(r.error)); return; }
    setError(null);
    setQr(r.qr as CouponQrView);
  }, [couponId, errRef]);
  useEffect(() => { void refresh(true); }, [refresh]);

  useEffect(() => {
    if (!qr || !canvas.current) return;
    const url = `${window.location.origin}/bar#${qr.token}`;
    import('qrcode').then((Q) => Q.toCanvas(canvas.current!, url, { width: 300, margin: 1, errorCorrectionLevel: 'M' }))
      .then(() => setDrawFailed(false)).catch(() => setDrawFailed(true));
  }, [qr]);

  useEffect(() => {
    if (!qr || used) return;
    const exp = new Date(qr.expiresAt).getTime();
    const tick = () => {
      const s = Math.max(0, Math.round((exp - Date.now()) / 1000));
      setLeft(s);
      if (s <= 8) void refresh();
    };
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, [qr, used, refresh]);

  usePolling(async () => {
    const r = await call(`/api/guest/social-thread?id=${encodeURIComponent(threadId)}`);
    const th = r.ok ? (r.thread as { messages: { coupon?: { id: string; status: string } }[] }) : null;
    if (th?.messages.some((m) => m.coupon?.id === couponId && m.coupon.status === 'redeemed')) setUsed(true);
    return r.ok;
  }, 4000, !used);

  return (
    <section className={`ticket ${used ? 'ticket-used' : ''}`} aria-labelledby="cq-h" aria-live="polite">
      <div className="ticket-head">
        <span className={`badge ${used ? 'badge-ok' : 'badge-info'}`}>{used ? <><Icon name="check" />{t('social.coupon.status.redeemed')}</> : t('social.coupon.received')}</span>
      </div>
      <h2 id="cq-h" className="ticket-title">{used ? t('social.coupon.qrUsed') : t('social.coupon.qrTitle', { kind: kindLabel })}</h2>
      {!used && (
        <>
          <p className="small">{t('social.coupon.qrIntro')}</p>
          <div className="ticket-qr"><canvas ref={canvas} role="img" aria-label={t('social.coupon.qrAlt', { kind: kindLabel })} /></div>
          {drawFailed && qr && <p className="tokenbox">{qr.token}</p>}
          {error && <p className="notice notice-warn" role="alert"><Icon name="alert" />{error}</p>}
          <div className="ticket-foot"><span className="countdown">{qr ? t('social.coupon.qrExpiresIn', { s: left }) : t('common.loading')}</span></div>
        </>
      )}
      <button type="button" className="btn btn-secondary" onClick={onClose}>{t('social.coupon.qrClose')}</button>
    </section>
  );
}
