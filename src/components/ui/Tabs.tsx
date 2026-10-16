'use client';
import { useRef, type ReactNode } from 'react';

export interface TabDef { id: string; label: string; badge?: number; badgeLabel?: string }

/** Schede complete (WAI-ARIA): tablist + tab con tabindex gestito + frecce/Home/End + tabpanel collegato. */
export function Tabs({ tabs, active, onChange, label, idPrefix, children }: { tabs: TabDef[]; active: string; onChange: (id: string) => void; label: string; idPrefix: string; children: ReactNode }) {
  const list = useRef<HTMLDivElement>(null);
  const onKey = (e: React.KeyboardEvent<HTMLElement>) => {
    const i = tabs.findIndex((x) => x.id === active);
    let n = -1;
    if (e.key === 'ArrowRight') n = (i + 1) % tabs.length;
    else if (e.key === 'ArrowLeft') n = (i - 1 + tabs.length) % tabs.length;
    else if (e.key === 'Home') n = 0;
    else if (e.key === 'End') n = tabs.length - 1;
    if (n < 0) return;
    e.preventDefault();
    onChange(tabs[n].id);
    requestAnimationFrame(() => list.current?.querySelector<HTMLButtonElement>(`#${idPrefix}-tab-${tabs[n].id}`)?.focus());
  };
  return (
    <>
      <div className="seg" role="tablist" aria-label={label} ref={list} onKeyDown={onKey}>
        {tabs.map((x) => (
          <button key={x.id} type="button" role="tab" id={`${idPrefix}-tab-${x.id}`} aria-selected={active === x.id} aria-controls={`${idPrefix}-panel`} tabIndex={active === x.id ? 0 : -1}
            aria-label={x.badge ? `${x.label}, ${x.badgeLabel ?? x.badge}` : undefined} onClick={() => onChange(x.id)}>
            {x.label}
            {x.badge ? <span className="count" aria-hidden="true">{x.badge}</span> : null}
          </button>
        ))}
      </div>
      <div role="tabpanel" id={`${idPrefix}-panel`} aria-labelledby={`${idPrefix}-tab-${active}`} className="stack" tabIndex={0}>{children}</div>
    </>
  );
}
