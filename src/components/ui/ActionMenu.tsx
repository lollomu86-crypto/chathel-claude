'use client';
import { useEffect, useId, useRef, useState } from 'react';
import { useI18n } from '../I18n';
import { Icon } from './Icon';

export interface MenuItem { key: string; label: string; icon?: string; danger?: boolean; onSelect: () => void }

/** Menu "..." (Segnala, Blocca). Tastiera: Invio/Spazio/Freccia giu' aprono, frecce spostano, Esc chiude e riporta il focus. */
export function ActionMenu({ items, label }: { items: MenuItem[]; label?: string }) {
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
  const wrap = useRef<HTMLDivElement>(null);
  const btn = useRef<HTMLButtonElement>(null);
  const id = useId();

  useEffect(() => {
    if (!open) return;
    const first = wrap.current?.querySelector<HTMLButtonElement>('[role="menuitem"]');
    first?.focus();
    const onDoc = (e: MouseEvent) => { if (wrap.current && !wrap.current.contains(e.target as Node)) setOpen(false); };
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, [open]);

  const onKey = (e: React.KeyboardEvent<HTMLElement>) => {
    if (e.key === 'Escape') { setOpen(false); btn.current?.focus(); return; }
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      const all = Array.from(wrap.current?.querySelectorAll<HTMLButtonElement>('[role="menuitem"]') ?? []);
      const i = all.indexOf(document.activeElement as HTMLButtonElement);
      const next = e.key === 'ArrowDown' ? (i + 1) % all.length : (i - 1 + all.length) % all.length;
      all[next]?.focus();
    }
    if (e.key === 'Tab') setOpen(false);
  };

  return (
    <div className="menu-wrap" ref={wrap} onKeyDown={onKey}>
      <button ref={btn} type="button" className="menu-btn" aria-haspopup="menu" aria-expanded={open} aria-controls={open ? id : undefined} aria-label={label ?? t('common.more')} onClick={() => setOpen((o) => !o)}>
        <Icon name="more" />
      </button>
      {open && (
        <div className="menu" role="menu" id={id}>
          {items.map((it) => (
            <button key={it.key} type="button" role="menuitem" className={it.danger ? 'danger' : undefined} onClick={() => { setOpen(false); btn.current?.focus(); it.onSelect(); }}>
              {it.icon && <Icon name={it.icon} />}
              {it.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
