'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import type { RedeemResult } from '@/lib/types';
import { call } from './client-api';
import { useI18n } from './I18n';
import { Icon } from './ui/Icon';
import { HotelSwitch } from './HotelSwitch';

/* Il barista vede SOLO il nickname dell'ospite e l'esito. Nessuna validazione offline (US-13 CA4). */
type Detector = { detect: (v: HTMLVideoElement) => Promise<{ rawValue: string }[]> };

/** Estrae il token da un URL del tipo https://host/bar#TOKEN, oppure accetta il token nudo. */
export function extractToken(raw: string): string {
  const s = raw.trim();
  const i = s.indexOf('#');
  return (i >= 0 ? s.slice(i + 1) : s).trim();
}

export function BarClient({ staffName, hotelId }: { staffName: string; hotelId: string }) {
  const { t, locale } = useI18n();
  const [result, setResult] = useState<RedeemResult | null>(null);
  const [offline, setOffline] = useState(false);
  const [busy, setBusy] = useState(false);
  const [times, setTimes] = useState<string[]>([]);
  const [manual, setManual] = useState('');
  const [scanning, setScanning] = useState(false);
  const [camMsg, setCamMsg] = useState<string | null>(null);
  const video = useRef<HTMLVideoElement>(null);
  const stream = useRef<MediaStream | null>(null);
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);
  const fmt = (iso: string) => new Intl.DateTimeFormat(locale, { hour: '2-digit', minute: '2-digit' }).format(new Date(iso));

  const loadTimes = useCallback(async () => {
    const r = await call('/api/staff/redemptions');
    if (r.ok) setTimes(r.times as string[]);
  }, []);

  const validate = useCallback(async (token: string) => {
    if (!token) return;
    if (!navigator.onLine) { setOffline(true); return; }
    setOffline(false); setBusy(true);
    const r = await call('/api/staff/redeem', { token });
    setBusy(false);
    if (r.status === 0) { setOffline(true); return; }
    setResult(r.ok ? (r.result as RedeemResult) : { ok: false, reason: r.error === 'rate_limited' ? 'rate_limited' : 'invalid' });
    navigator.vibrate?.(r.ok && (r.result as RedeemResult).ok ? 120 : [80, 60, 80]);
    loadTimes();
  }, [loadTimes]);

  const stop = useCallback(() => {
    if (timer.current) clearInterval(timer.current);
    stream.current?.getTracks().forEach((tr) => tr.stop());
    stream.current = null;
    setScanning(false);
  }, []);

  // il QR dell'ospite apre /bar#TOKEN: si valida subito e si toglie il token dall'indirizzo (anche se la vista e' gia' aperta: hashchange)
  useEffect(() => {
    loadTimes();
    const fromHash = () => {
      const token = extractToken(window.location.hash.replace(/^#/, ''));
      if (token) {
        history.replaceState(null, '', window.location.pathname);
        validate(token);
      }
    };
    fromHash();
    window.addEventListener('hashchange', fromHash);
    return () => { window.removeEventListener('hashchange', fromHash); stop(); };
  }, [loadTimes, validate, stop]);

  const scan = async () => {
    setCamMsg(null);
    const BD = (window as unknown as { BarcodeDetector?: new (o: { formats: string[] }) => Detector }).BarcodeDetector;
    if (!BD || !navigator.mediaDevices?.getUserMedia) { setCamMsg(t('bar.cameraUnsupported')); return; }
    try {
      const det = new BD({ formats: ['qr_code'] });
      const s = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' } });
      stream.current = s;
      setScanning(true);
      requestAnimationFrame(() => { if (video.current) { video.current.srcObject = s; void video.current.play(); } });
      timer.current = setInterval(async () => {
        if (!video.current) return;
        const codes = await det.detect(video.current).catch(() => []);
        if (codes[0]) { stop(); validate(extractToken(codes[0].rawValue)); }
      }, 250);
    } catch {
      setCamMsg(t('bar.cameraDenied'));
    }
  };

  const reasonText = (r: Extract<RedeemResult, { ok: false }>) =>
    t(`bar.reasons.${r.reason}`, { time: r.redeemedAt ? fmt(r.redeemedAt) : '' });

  return (
    <>
      <h1>{t('bar.title')}</h1>
      <p className="muted small">{staffName}</p>
      <HotelSwitch currentId={hotelId} />
      {offline && <p className="notice notice-err" role="alert">{t('bar.offline')}</p>}

      {result ? (
        <section className={`bar-result ${result.ok ? 'bar-ok' : 'bar-no'}`} role="alert" aria-live="assertive">
          <Icon name={result.ok ? 'check' : 'x'} />
          <div className="big">{result.ok ? t('bar.valid') : t('bar.notValid')}</div>
          {result.ok && <div className="badge">{result.kind === 'coupon' ? t('bar.kindCoupon') : t('bar.kindBonus')}</div>}
          <div className="detail">
            {result.ok
              ? (result.kind === 'coupon' && result.couponKind
                  ? t('bar.couponDetail', { kind: t(`social.coupon.kinds.${result.couponKind}`), name: result.guestName, from: result.fromName ?? '' })
                  : t('bar.validDetail', { label: result.label, name: result.guestName }))
              : reasonText(result)}
          </div>
        </section>
      ) : null}

      {result ? (
        <button type="button" className="btn btn-primary btn-lg btn-block" onClick={() => setResult(null)}>{t('bar.next')}</button>
      ) : (
        <div className="stack">
          {scanning ? (
            <>
              <video ref={video} className="video" playsInline muted />
              <button type="button" className="btn btn-secondary btn-lg btn-block" onClick={stop}>{t('bar.stopScan')}</button>
            </>
          ) : (
            <button type="button" className="btn btn-primary btn-lg btn-block" onClick={scan} disabled={busy}>{busy ? t('bar.validating') : t('bar.scan')}</button>
          )}
          {camMsg && <p className="notice notice-warn">{camMsg}</p>}
          <form onSubmit={(e) => { e.preventDefault(); validate(extractToken(manual)); setManual(''); }}>
            <label htmlFor="manual">{t('bar.manualLabel')}</label>
            <div className="row">
              <input id="manual" className="grow" type="text" autoComplete="off" autoCapitalize="off" spellCheck={false} value={manual} onChange={(e) => setManual(e.target.value)} />
              <button type="submit" className="btn btn-secondary" disabled={busy || !manual.trim()}>{t('bar.validate')}</button>
            </div>
          </form>
        </div>
      )}

      <p className="bar-count section-gap">{t('bar.todayCount', { n: times.length })}</p>
      {times.length > 0 && (
        <details>
          <summary>{t('bar.shiftList')}</summary>
          <ul>{times.map((x) => <li key={x}>{fmt(x)}</li>)}</ul>
        </details>
      )}
    </>
  );
}
