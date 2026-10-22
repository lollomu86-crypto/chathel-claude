'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import type { ChatMessage, ChatView } from '@/lib/types';
import { formatTime } from '@/lib/format';
import { call } from './client-api';
import { nearBottom, scrollToBottom, usePolling } from './hooks';
import { useI18n } from './I18n';
import { Icon } from './ui/Icon';

type Local = ChatMessage & { state?: 'pending' | 'error' };

/**
 * Chat con la reception: assistente automatico, passaggio allo staff, emergenze.
 * - il testo si svuota solo a invio riuscito; se fallisce il messaggio resta nella chat con "tocca per riprovare";
 * - risposta di emergenza (emergency / emergencyText): banner con il 112, messaggio dell'assistente comunque in chat;
 * - scorrimento in fondo solo se si era gia' in fondo; i nuovi messaggi sono annunciati da una regione aria-live.
 */
export function ChatClient({ initial, hotelName, aiMode, timezone }: { initial: ChatView; hotelName: string; aiMode: 'claude' | 'keyword'; timezone: string }) {
  const { t, locale } = useI18n();
  const [chat, setChat] = useState<ChatView>(initial);
  const [pending, setPending] = useState<Local[]>([]);
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [emergency, setEmergency] = useState<string | null>(null);
  const [announce, setAnnounce] = useState('');
  const end = useRef<HTMLDivElement>(null);
  const known = useRef(new Set(initial.messages.map((m) => m.id)));
  const stick = useRef(true); // all'apertura si va all'ultimo messaggio; poi si segue solo chi e' gia' in fondo
  const human = chat.status === 'handoff_pending' || chat.status === 'operator';

  const messages: Local[] = [...chat.messages, ...pending];

  useEffect(() => {
    if (stick.current) scrollToBottom();
    // annuncio ai lettori di schermo dei soli messaggi NUOVI che non sono dell'ospite
    for (const m of chat.messages) {
      if (known.current.has(m.id)) continue;
      known.current.add(m.id);
      if (m.role !== 'guest') setAnnounce(`${m.role === 'operator' ? t('reception.badgeStaff') : t('reception.badgeAi')}: ${m.content}`);
    }
  }, [chat.messages, pending.length, t]);

  const poll = useCallback(async () => {
    const r = await call('/api/guest/chat');
    if (r.ok) { stick.current = nearBottom(); setChat(r.chat as ChatView); }
    return r.ok;
  }, []);
  // con l'operatore coinvolto si controllano le risposte dello staff (nessun realtime nel P0 demo)
  usePolling(poll, 6000, human);

  const send = async (msg: string, retryId?: string) => {
    const m = msg.trim();
    if (!m || busy) return;
    setBusy(true); setError(null);
    const id = retryId ?? `tmp-${Date.now()}`;
    stick.current = true;
    setPending((p) => (retryId ? p.map((x) => (x.id === id ? { ...x, state: 'pending' } : x)) : [...p, { id, role: 'guest', content: m, createdAt: new Date().toISOString(), state: 'pending' }]));
    const r = await call('/api/ai/chat', { text: m });
    setBusy(false);
    if (r.ok) {
      setPending((p) => p.filter((x) => x.id !== id));
      if (!retryId) setText('');
      stick.current = true;
      setChat(r.chat as ChatView);
      if (r.emergency === true) setEmergency(t('reception.emergencyBanner'));
    } else {
      // l'emergenza arriva anche con 429: il testo con il 112 si mostra comunque
      if (typeof r.emergencyText === 'string') { setEmergency(r.emergencyText); setPending((p) => p.filter((x) => x.id !== id)); return; }
      setPending((p) => p.map((x) => (x.id === id ? { ...x, state: 'error' } : x)));
      setError(r.error === 'daily_limit' ? t('reception.dailyLimit') : r.error === 'too_long' ? t('reception.tooLong') : r.error === 'rate_limited' ? t('reception.rateLimited') : t('reception.error'));
    }
  };

  const onKey = (e: React.KeyboardEvent<HTMLElement>) => {
    // Invio invia, Maiusc+Invio va a capo (non durante la composizione IME)
    if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) { e.preventDefault(); void send(text); }
  };

  const quick = [t('reception.quickBreakfast'), t('reception.quickWifi'), t('reception.quickSpa')];
  const tm = (iso: string) => formatTime(iso, locale, timezone);
  return (
    <>
      <h1>{t('reception.title')}</h1>
      <p className="muted small">{t('reception.assistantOf', { hotel: hotelName })}</p>
      {aiMode === 'keyword' && <p className="notice notice-warn"><Icon name="info" />{t('reception.demoMode')}</p>}
      {emergency && (
        <div className="notice notice-err emergency" role="alert">
          <Icon name="phone" />
          <span className="grow">
            <strong className="block">{emergency}</strong>
            <a className="btn btn-danger btn-lg" href="tel:112"><Icon name="phone" />{t('reception.call112')}</a>
          </span>
        </div>
      )}
      <div className="chat" role="log" aria-label={t('reception.title')}>
        <div className="bubble bubble-ai"><span className="who">{t('reception.badgeAi')}</span>{t('reception.intro')}</div>
        {messages.map((m) => (
          <div key={m.id}
            className={`bubble ${m.role === 'guest' ? 'bubble-me' : m.role === 'operator' ? 'bubble-staff' : 'bubble-ai'} ${m.state === 'pending' ? 'bubble-pending' : ''} ${m.state === 'error' ? 'bubble-error' : ''}`}>
            {m.role === 'assistant' && <span className="who">{t('reception.badgeAi')}</span>}
            {m.role === 'operator' && <span className="who">{t('reception.badgeStaff')}</span>}
            {m.content}
            {m.state === 'error'
              ? <button type="button" className="bubble-retry" onClick={() => send(m.content, m.id)}>{t('reception.tapRetry')}</button>
              : <span className="time">{m.state === 'pending' ? t('reception.sending') : tm(m.createdAt)}</span>}
          </div>
        ))}
        {busy && <div className="typing" aria-hidden="true"><i /><i /><i /></div>}
        {human && <p className="notice notice-info" role="status"><Icon name="clock" />{t('reception.waiting')}</p>}
        {chat.status === 'closed' && <p className="muted small">{t('reception.closed')}</p>}
        <div ref={end} />
      </div>
      <div className="sr-only" role="status" aria-live="polite" aria-atomic="true">{announce}</div>

      {chat.messages.length === 0 && pending.length === 0 && (
        <div className="chips">
          {quick.map((q) => <button key={q} type="button" className="chip" onClick={() => send(q)}>{q}</button>)}
        </div>
      )}
      {error && <p className="error-text" role="alert"><Icon name="alert" />{error}</p>}
      {!human && (
        <button type="button" className="btn btn-secondary btn-small" disabled={busy} onClick={() => send(t('reception.operatorRequestText'))}>{t('reception.talkToOperator')}</button>
      )}
      <form className="composer" onSubmit={(e) => { e.preventDefault(); void send(text); }}>
        <label htmlFor="msg" className="sr-only">{t('reception.placeholder')}</label>
        <textarea id="msg" className="composer-text" rows={1} maxLength={1000} placeholder={t('reception.placeholder')} value={text} onChange={(e) => setText(e.target.value)} onKeyDown={onKey} autoComplete="off" />
        <button type="submit" className="btn btn-primary" disabled={busy || !text.trim()} aria-busy={busy}>{t('reception.send')}</button>
      </form>
    </>
  );
}
