'use client';
// Errore nel layout radice: sostituisce tutto, quindi qui non c'e' il provider delle traduzioni. Si leggono solo le sezioni
// `errorPage` dei file di messaggi (piccole) e la lingua dal cookie ch_lang.
import './globals.css';
import it from '../../messages/it.json';
import en from '../../messages/en.json';
import de from '../../messages/de.json';
import ru from '../../messages/ru.json';

const COPY: Record<string, { title: string; body: string; home: string; retry: string }> = {
  it: { ...it.errorPage, retry: it.common.retry },
  en: { ...en.errorPage, retry: en.common.retry },
  de: { ...de.errorPage, retry: de.common.retry },
  ru: { ...ru.errorPage, retry: ru.common.retry },
};

function lang(): string {
  if (typeof document === 'undefined') return 'it';
  const m = /(?:^|; )ch_lang=(it|en|de|ru)/.exec(document.cookie);
  return m ? m[1] : 'it';
}

export default function GlobalError({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  const l = lang();
  const c = COPY[l];
  return (
    <html lang={l}>
      <body>
        <main className="shell shell-bare">
          <div className="card empty" role="alert">
            <h1 className="empty-title">{c.title}</h1>
            <p>{c.body}</p>
            <div className="btn-group">
              <button type="button" className="btn btn-primary" onClick={() => reset()}>{c.retry}</button>
              <a className="btn btn-secondary" href="/">{c.home}</a>
            </div>
          </div>
        </main>
      </body>
    </html>
  );
}
