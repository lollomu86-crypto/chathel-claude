'use client';
import { useEffect, useId, useRef, type ReactNode } from 'react';

/** Finestra modale accessibile basata sull'elemento nativo <dialog>: focus intrappolato, Esc chiude, il focus torna a chi l'ha aperta. */
export function Dialog({ open, onClose, title, children }: { open: boolean; onClose: () => void; title: string; children: ReactNode }) {
  const ref = useRef<HTMLDialogElement>(null);
  const id = useId();
  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (open && !d.open) d.showModal();
    if (!open && d.open) d.close();
  }, [open]);
  return (
    <dialog ref={ref} className="dialog" aria-labelledby={id} onCancel={(e) => { e.preventDefault(); onClose(); }} onClick={(e) => { if (e.target === ref.current) onClose(); }}>
      {open && (
        <div className="dialog-body stack">
          <h2 id={id} className="t-sub">{title}</h2>
          {children}
        </div>
      )}
    </dialog>
  );
}
