'use client';
import { useEffect, useState } from 'react';
import { useI18n } from './I18n';

interface BIPEvent extends Event {
  prompt: () => Promise<void>;
}

/** Invito a installare la PWA, mostrato DOPO il valore (home con bonus), mai come primo ostacolo. */
export function InstallHint() {
  const { t } = useI18n();
  const [evt, setEvt] = useState<BIPEvent | null>(null);
  const [ios, setIos] = useState(false);
  const [standalone, setStandalone] = useState(true);
  useEffect(() => {
    const ua = navigator.userAgent;
    setIos(/iPad|iPhone|iPod/.test(ua));
    setStandalone(window.matchMedia('(display-mode: standalone)').matches || (navigator as unknown as { standalone?: boolean }).standalone === true);
    const h = (e: Event) => { e.preventDefault(); setEvt(e as BIPEvent); };
    window.addEventListener('beforeinstallprompt', h);
    return () => window.removeEventListener('beforeinstallprompt', h);
  }, []);
  if (standalone || (!evt && !ios)) return null;
  return (
    <section className="card" aria-labelledby="inst">
      <h2 id="inst" className="h3">{t('home.installTitle')}</h2>
      {evt ? (
        <button className="btn btn-secondary" type="button" onClick={() => evt.prompt()}>{t('home.installAndroid')}</button>
      ) : (
        <p>{t('home.installIos')}</p>
      )}
      <p className="muted small">{t('home.installNote')}</p>
    </section>
  );
}
