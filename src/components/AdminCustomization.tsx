'use client';
import { useRouter } from 'next/navigation';
import { useRef, useState } from 'react';
import { LOCALES, type FeatureKey, type HotelFeatures, type HotelMediaKind, type I18nText, type Locale } from '@/lib/types';
import { safeImage } from '@/lib/safe-image';
import { call } from './client-api';
import { useConfirm, useErrorText, useI18n } from './I18n';

const WELCOME_MAX = 500;
const MAX_BYTES = 2 * 1024 * 1024;
/** Lato lungo massimo dopo la riduzione nel browser. */
const MAX_SIDE: Record<HotelMediaKind, number> = { logo: 800, cover: 1600 };
const UNDER_SOCIAL: FeatureKey[] = ['publicChat', 'challenges', 'coupons'];
const SWITCHES: FeatureKey[] = ['social', 'publicChat', 'challenges', 'coupons', 'bookings', 'reception'];

/** Riduce l'immagine (lato lungo al massimo 800/1600 px) e la ricodifica: niente dati EXIF (posizione) ne' file enormi. */
async function shrink(file: File, kind: HotelMediaKind): Promise<Blob> {
  const url = URL.createObjectURL(file);
  try {
    const img = new Image();
    img.src = url;
    await img.decode();
    const scale = Math.min(1, MAX_SIDE[kind] / Math.max(img.naturalWidth, img.naturalHeight));
    const c = document.createElement('canvas');
    c.width = Math.max(1, Math.round(img.naturalWidth * scale));
    c.height = Math.max(1, Math.round(img.naturalHeight * scale));
    c.getContext('2d')!.drawImage(img, 0, 0, c.width, c.height);
    const enc = (type: string, q?: number) => new Promise<Blob | null>((res) => c.toBlob(res, type, q));
    // il logo resta PNG (trasparenza); la copertina e' una foto: JPG
    let out = kind === 'logo' ? await enc('image/png') : await enc('image/jpeg', 0.85);
    if (!out || out.size > MAX_BYTES) out = await enc('image/jpeg', 0.8);
    if (!out) throw new Error('encode');
    return out;
  } finally {
    URL.revokeObjectURL(url);
  }
}

export function AdminCustomization({ logoUrl, coverUrl, welcome, features, bonusEnabled }: {
  logoUrl: string | null; coverUrl: string | null; welcome: I18nText; features: HotelFeatures; bonusEnabled: boolean;
}) {
  const { t } = useI18n();
  const errText = useErrorText();
  const ask = useConfirm();
  const router = useRouter();
  const [media, setMedia] = useState<Record<HotelMediaKind, string | null>>({ logo: logoUrl, cover: coverUrl });
  const [text, setText] = useState<Record<Locale, string>>(() => Object.fromEntries(LOCALES.map((l) => [l, welcome[l] ?? ''])) as Record<Locale, string>);
  const [feat, setFeat] = useState<HotelFeatures>(features);
  const [bonus, setBonus] = useState(bonusEnabled);
  const [busy, setBusy] = useState<string | null>(null);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const inputs = { logo: useRef<HTMLInputElement>(null), cover: useRef<HTMLInputElement>(null) };

  const done = (ok: boolean, error?: string) => {
    setMsg(ok ? { ok: true, text: t('admin.custom.saved') } : { ok: false, text: errText(error, 'admin.custom') });
    if (ok) router.refresh();
  };

  const upload = async (kind: HotelMediaKind, file: File | undefined) => {
    if (!file) return;
    setMsg(null);
    if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type)) { done(false, 'invalid_image'); return; }
    setBusy(kind);
    try {
      const blob = await shrink(file, kind);
      const r = await fetch(`/api/staff/media?kind=${kind}`, { method: 'POST', headers: { 'content-type': blob.type }, body: blob, credentials: 'same-origin', cache: 'no-store' });
      const j = (await r.json().catch(() => ({ ok: false, error: 'internal' }))) as { ok?: boolean; url?: string; error?: string };
      if (j.ok && j.url) setMedia((m) => ({ ...m, [kind]: j.url! }));
      done(!!j.ok, j.error);
    } catch {
      done(false, 'invalid_image');
    } finally {
      setBusy(null);
      const el = inputs[kind].current;
      if (el) el.value = '';
    }
  };
  const remove = async (kind: HotelMediaKind) => {
    if (!(await ask({ title: t(`admin.custom.${kind}Remove`), body: t('admin.custom.removeConfirm'), confirmLabel: t('admin.custom.remove'), danger: true }))) return;
    setBusy(kind); setMsg(null);
    const r = await call('/api/staff/media-remove', { kind });
    setBusy(null);
    if (r.ok) setMedia((m) => ({ ...m, [kind]: null }));
    done(r.ok, r.error);
  };

  const saveWelcome = async (ev: React.FormEvent) => {
    ev.preventDefault();
    setBusy('welcome'); setMsg(null);
    const r = await call('/api/staff/customization-save', { welcome: text });
    setBusy(null);
    done(r.ok, r.error);
  };
  const toggle = async (key: FeatureKey, on: boolean) => {
    const prev = feat;
    setFeat({ ...feat, [key]: on }); setBusy('features'); setMsg(null);
    const r = await call('/api/staff/customization-save', { features: { [key]: on } });
    setBusy(null);
    if (!r.ok) setFeat(prev);
    done(r.ok, r.error);
  };
  const toggleBonus = async (on: boolean) => {
    setBonus(on); setBusy('features'); setMsg(null);
    const r = await call('/api/staff/customization-save', { bonusEnabled: on });
    setBusy(null);
    if (!r.ok) setBonus(!on);
    done(r.ok, r.error);
  };

  const imageBlock = (kind: HotelMediaKind) => {
    const src = safeImage(media[kind]);
    return (
      <div className="stack-sm">
        <h3 className="t-sub" id={`m-${kind}`}>{t(`admin.custom.${kind}`)}</h3>
        <p className="hint">{t(`admin.custom.${kind}Hint`)}</p>
        <div className={`media-preview media-preview-${kind}`}>
          {src ? <img src={src} alt={t(`admin.custom.${kind}Alt`)} /> : <span className="muted small">{t('admin.custom.none')}</span>}
        </div>
        <input ref={inputs[kind]} id={`f-${kind}`} className="sr-only" type="file" accept="image/jpeg,image/png,image/webp"
          aria-labelledby={`m-${kind}`} disabled={busy !== null} onChange={(e) => void upload(kind, e.target.files?.[0])} />
        <div className="btn-group">
          <button type="button" className="btn btn-secondary btn-small" disabled={busy !== null} onClick={() => inputs[kind].current?.click()}>
            {busy === kind ? t('admin.custom.uploading') : src ? t('admin.custom.change') : t('admin.custom.upload')}
          </button>
          {src && <button type="button" className="btn btn-danger btn-small" disabled={busy !== null} onClick={() => void remove(kind)}>{t('admin.custom.remove')}</button>}
        </div>
      </div>
    );
  };

  return (
    <section className="card stack" aria-labelledby="cu">
      <h2 id="cu" className="h3">{t('admin.custom.title')}</h2>
      <p className="muted">{t('admin.custom.intro')}</p>
      {msg && <p className={`notice ${msg.ok ? 'notice-ok' : 'notice-err'}`} role={msg.ok ? 'status' : 'alert'}>{msg.text}</p>}

      <div className="grid2">
        {imageBlock('logo')}
        {imageBlock('cover')}
      </div>
      <p className="hint">{t('admin.custom.imageRules')}</p>

      <hr />
      <form className="stack" onSubmit={saveWelcome}>
        <h3 className="t-sub">{t('admin.custom.welcomeTitle')}</h3>
        <p className="hint">{t('admin.custom.welcomeHint')}</p>
        <div className="grid2">
          {LOCALES.map((l) => (
            <div key={l} className="field">
              <label htmlFor={`w-${l}`}>{t(`admin.custom.welcome_${l}`)}</label>
              <textarea id={`w-${l}`} maxLength={WELCOME_MAX} rows={3} value={text[l]} onChange={(e) => setText({ ...text, [l]: e.target.value })} />
              <span className="hint">{t('admin.custom.chars', { n: text[l].length, max: WELCOME_MAX })}</span>
            </div>
          ))}
        </div>
        <div><button type="submit" className="btn btn-primary" disabled={busy !== null}>{t('admin.custom.welcomeSave')}</button></div>
      </form>

      <hr />
      <h3 className="t-sub">{t('admin.custom.featuresTitle')}</h3>
      <p className="hint">{t('admin.custom.featuresHint')}</p>
      <div>
        {SWITCHES.map((k) => {
          const sub = UNDER_SOCIAL.includes(k);
          const locked = sub && !feat.social;
          return (
            <label key={k} className={`setting${sub ? ' setting-sub' : ''}`}>
              <span id={`sw-${k}`}><strong className="block">{t(`admin.custom.f_${k}`)}</strong>
                <span className="hint block">{locked ? t('admin.custom.needsSocial') : t(`admin.custom.f_${k}Hint`)}</span></span>
              <input type="checkbox" role="switch" className="switch" aria-labelledby={`sw-${k}`} disabled={busy !== null || locked}
                checked={feat[k] && !locked} onChange={(e) => void toggle(k, e.target.checked)} />
            </label>
          );
        })}
        <label className="setting">
          <span id="sw-bonus"><strong className="block">{t('admin.custom.f_bonus')}</strong><span className="hint block">{t('admin.custom.f_bonusHint')}</span></span>
          <input type="checkbox" role="switch" className="switch" aria-labelledby="sw-bonus" disabled={busy !== null} checked={bonus} onChange={(e) => void toggleBonus(e.target.checked)} />
        </label>
      </div>
      <p className="notice notice-info">{t('admin.custom.offKeeps')}</p>
    </section>
  );
}
