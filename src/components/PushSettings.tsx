'use client';
import { useCallback, useEffect, useState } from 'react';
import { call } from './client-api';
import { useI18n } from './I18n';

type Prefs = { announcements: boolean; reception: boolean; private: boolean; public: boolean };
type State = 'loading' | 'unsupported' | 'ios-install' | 'unavailable' | 'denied' | 'off' | 'on';
const KEYS: (keyof Prefs)[] = ['announcements', 'reception', 'private', 'public'];
const DEFAULT: Prefs = { announcements: true, reception: true, private: true, public: false };

function keyBytes(b64: string): Uint8Array<ArrayBuffer> {
  const s = atob(b64.replace(/-/g, '+').replace(/_/g, '/').padEnd(Math.ceil(b64.length / 4) * 4, '='));
  const out = new Uint8Array(new ArrayBuffer(s.length));
  for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i);
  return out;
}
const enc = (b: ArrayBuffer | null) => (b ? btoa(String.fromCharCode(...new Uint8Array(b))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '') : '');

/** Notifiche push dell'ospite: attivazione per dispositivo e scelta dei tipi. Nessun contenuto personale nelle notifiche. */
export function PushSettings() {
  const { t, locale } = useI18n();
  const [state, setState] = useState<State>('loading');
  const [prefs, setPrefs] = useState<Prefs>(DEFAULT);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState(false);

  const refresh = useCallback(async () => {
    try {
      const ua = navigator.userAgent;
      const standalone = window.matchMedia('(display-mode: standalone)').matches || (navigator as unknown as { standalone?: boolean }).standalone === true;
      const supported = 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;
      if (!supported) { setState(/iPad|iPhone|iPod/.test(ua) && !standalone ? 'ios-install' : 'unsupported'); return; }
      const cfg = await call('/api/guest/push-config');
      if (!cfg.ok || !cfg.publicKey) { setState('unavailable'); return; }
      if (Notification.permission === 'denied') { setState('denied'); return; }
      const reg = await navigator.serviceWorker.ready;
      const sub = await reg.pushManager.getSubscription();
      if (!sub) { setState('off'); return; }
      const r = await call('/api/guest/push-state', { endpoint: sub.endpoint });
      if (r.ok && r.prefs) { setPrefs(r.prefs as Prefs); setState('on'); } else setState('off');
    } catch { setState('unsupported'); }
  }, []);
  useEffect(() => { void refresh(); }, [refresh]);

  const turnOn = async () => {
    setBusy(true); setErr(false);
    try {
      if ((await Notification.requestPermission()) !== 'granted') { setState('denied'); return; }
      const cfg = await call('/api/guest/push-config');
      const reg = await navigator.serviceWorker.ready;
      const sub = (await reg.pushManager.getSubscription()) ?? (await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: keyBytes(String(cfg.publicKey)) }));
      const r = await call('/api/guest/push-subscribe', { endpoint: sub.endpoint, p256dh: enc(sub.getKey('p256dh')), auth: enc(sub.getKey('auth')), locale, prefs });
      if (r.ok) { setPrefs(r.prefs as Prefs); setState('on'); } else { await sub.unsubscribe().catch(() => undefined); setErr(true); }
    } catch { setErr(true); } finally { setBusy(false); }
  };
  const turnOff = async () => {
    setBusy(true); setErr(false);
    try {
      const reg = await navigator.serviceWorker.ready;
      const sub = await reg.pushManager.getSubscription();
      if (sub) { await call('/api/guest/push-unsubscribe', { endpoint: sub.endpoint }); await sub.unsubscribe(); }
      setState('off');
    } catch { setErr(true); } finally { setBusy(false); }
  };
  const toggle = async (k: keyof Prefs, v: boolean) => {
    const next = { ...prefs, [k]: v };
    setPrefs(next);
    try {
      const reg = await navigator.serviceWorker.ready;
      const sub = await reg.pushManager.getSubscription();
      if (!sub) return;
      const r = await call('/api/guest/push-subscribe', { endpoint: sub.endpoint, p256dh: enc(sub.getKey('p256dh')), auth: enc(sub.getKey('auth')), locale, prefs: next });
      if (!r.ok) setErr(true);
    } catch { setErr(true); }
  };

  if (state === 'loading' || state === 'unavailable') return null;
  return (
    <section className="card stack" aria-labelledby="pn">
      <h2 id="pn" className="t-sub">{t('push.title')}</h2>
      {state === 'unsupported' && <p className="muted">{t('push.unsupported')}</p>}
      {state === 'ios-install' && <p className="muted">{t('push.iosInstall')}</p>}
      {state === 'denied' && <p className="muted">{t('push.denied')}</p>}
      {state === 'off' && (<>
        <p className="muted">{t('push.intro')}</p>
        <button type="button" className="btn btn-primary" disabled={busy} aria-busy={busy} onClick={turnOn}>{t('push.enable')}</button>
      </>)}
      {state === 'on' && (<>
        <p className="muted">{t('push.on')}</p>
        {KEYS.map((k) => (
          <label key={k} className="check">
            <input type="checkbox" checked={prefs[k]} onChange={(e) => void toggle(k, e.target.checked)} />
            <span>{t(`push.kinds.${k}`)}</span>
          </label>
        ))}
        <button type="button" className="btn btn-secondary" disabled={busy} onClick={turnOff}>{t('push.disable')}</button>
      </>)}
      {err && <p className="error-text" role="alert">{t('push.error')}</p>}
    </section>
  );
}
