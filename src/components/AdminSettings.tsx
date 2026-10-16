'use client';
import { useEffect, useRef, useState } from 'react';
import { call } from './client-api';
import { useConfirm, useI18n } from './I18n';

/**
 * QR dell'hotel. Con Supabase nel database c'e' solo l'hash del token: il token in chiaro si vede UNA volta
 * alla generazione ("Rigenera"). In demo il token corrente e' noto e il QR si mostra subito.
 */
export function AdminSettings({ slug, initialToken }: { slug: string; initialToken: string | null }) {
  const { t } = useI18n();
  const ask = useConfirm();
  const [token, setToken] = useState<string | null>(initialToken);
  const [busy, setBusy] = useState(false);
  const [warn, setWarn] = useState(false);
  const canvas = useRef<HTMLCanvasElement>(null);
  const [link, setLink] = useState('');

  useEffect(() => {
    if (!token) { setLink(''); return; }
    const url = `${window.location.origin}/h/${slug}?k=${encodeURIComponent(token)}`;
    setLink(url);
    if (canvas.current) import('qrcode').then((Q) => Q.toCanvas(canvas.current!, url, { width: 480, margin: 2, errorCorrectionLevel: 'M' })).catch(() => undefined);
  }, [token, slug]);

  const rotate = async () => {
    if (!(await ask({ title: t('admin.settings.rotate'), body: t('admin.settings.rotateWarn'), confirmLabel: t('admin.settings.rotate'), danger: true }))) return;
    setBusy(true);
    const r = await call('/api/staff/rotate-qr', {});
    setBusy(false);
    if (r.ok) { setToken(r.token as string); setWarn(true); }
  };
  const download = () => {
    const c = canvas.current;
    if (!c) return;
    const a = document.createElement('a');
    a.download = `chathel-qr-${slug}.png`;
    a.href = c.toDataURL('image/png');
    a.click();
  };
  return (
    <section className="card stack" aria-labelledby="qr">
      <h2 id="qr" className="h3">{t('admin.settings.qrTitle')}</h2>
      <p className="muted">{t('admin.settings.qrHelp')}</p>
      {token ? (
        <>
          <div className="qrbox"><canvas ref={canvas} aria-label={t('admin.settings.qrAlt')} /></div>
          <p className="small"><strong>{t('admin.settings.qrLink')}</strong></p>
          <p className="tokenbox">{link}</p>
          {warn && <p className="notice notice-warn" role="status">{t('admin.settings.rotateWarn')}</p>}
          <button type="button" className="btn btn-secondary" onClick={download}>{t('admin.settings.download')}</button>
        </>
      ) : <p className="notice notice-info">{t('admin.settings.rotateWarn')}</p>}
      <button type="button" className="btn btn-secondary" disabled={busy} onClick={rotate}>{t('admin.settings.rotate')}</button>
    </section>
  );
}
