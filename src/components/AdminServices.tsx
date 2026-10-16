'use client';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { call } from './client-api';
import { useErrorText, useI18n } from './I18n';

export interface SvcSlot { id: string; time: string; day: string; dayLabel: string; capacity: number; booked: number; status: 'open' | 'closed' }
export interface Svc { id: string; name: string; defaultCapacity: number; slots: SvcSlot[] }

export function AdminServices({ services, today, defaultTo }: { services: Svc[]; today: string; defaultTo: string }) {
  const { t } = useI18n();
  const errText = useErrorText();
  const router = useRouter();
  const [fac, setFac] = useState(services[0]?.id ?? '');
  const [form, setForm] = useState({ from: today, to: defaultTo, start: '10:00', end: '18:00', minutes: '60', capacity: '' });
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const svc = services.find((s) => s.id === fac);

  const gen = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true); setMsg(null);
    const r = await call('/api/staff/slots-generate', { facilityId: fac, from: form.from, to: form.to, start: form.start, end: form.end, minutes: Number(form.minutes), capacity: form.capacity ? Number(form.capacity) : null });
    setBusy(false);
    setMsg(r.ok ? { ok: true, text: t('admin.services.created', { n: r.created as number }) } : { ok: false, text: errText(r.error) });
    router.refresh();
  };
  const update = async (id: string, patch: { capacity?: number; status?: 'open' | 'closed' }) => {
    setMsg(null);
    const r = await call('/api/staff/slot-update', { id, ...patch });
    if (!r.ok) setMsg({ ok: false, text: errText(r.error, 'admin.services') });
    router.refresh();
  };

  const days = new Map<string, { label: string; slots: SvcSlot[] }>();
  for (const s of svc?.slots ?? []) {
    if (!days.has(s.day)) days.set(s.day, { label: s.dayLabel, slots: [] });
    days.get(s.day)!.slots.push(s);
  }
  const set = (k: keyof typeof form, v: string) => setForm((f) => ({ ...f, [k]: v }));

  return (
    <>
      <h1>{t('admin.services.title')}</h1>
      <div className="chips" role="group">
        {services.map((s) => <button key={s.id} type="button" className={`chip ${s.id === fac ? 'chip-on' : ''}`} aria-pressed={s.id === fac} onClick={() => setFac(s.id)}>{s.name}</button>)}
      </div>

      <form className="card stack section" onSubmit={gen}>
        <h2 className="h3">{t('admin.services.generate')} · {svc?.name}</h2>
        <div className="grid2">
          <div><label htmlFor="f1">{t('admin.services.from')}</label><input id="f1" type="date" required value={form.from} onChange={(e) => set('from', e.target.value)} /></div>
          <div><label htmlFor="f2">{t('admin.services.to')}</label><input id="f2" type="date" required value={form.to} onChange={(e) => set('to', e.target.value)} /></div>
          <div><label htmlFor="f3">{t('admin.services.start')}</label><input id="f3" type="time" required value={form.start} onChange={(e) => set('start', e.target.value)} /></div>
          <div><label htmlFor="f4">{t('admin.services.end')}</label><input id="f4" type="time" required value={form.end} onChange={(e) => set('end', e.target.value)} /></div>
          <div><label htmlFor="f5">{t('admin.services.minutes')}</label><input id="f5" type="number" min={15} max={480} step={5} required value={form.minutes} onChange={(e) => set('minutes', e.target.value)} /></div>
          <div><label htmlFor="f6">{t('admin.services.capacity')}</label><input id="f6" type="number" min={1} placeholder={String(svc?.defaultCapacity ?? '')} value={form.capacity} onChange={(e) => set('capacity', e.target.value)} /><p className="hint">{t('admin.services.capacityHint')}</p></div>
        </div>
        {msg && <p className={msg.ok ? 'notice notice-ok' : 'error-text'} role="status">{msg.text}</p>}
        <button type="submit" className="btn btn-primary" disabled={busy || !fac}>{t('admin.services.generate')}</button>
      </form>

      {days.size === 0 && <p className="muted">{t('admin.services.noSlots')}</p>}
      {[...days.entries()].map(([key, d]) => (
        <details key={key} className="card" open={key === today}>
          <summary><strong>{d.label}</strong> · {d.slots.length}</summary>
          <table className="t">
            <tbody>
              {d.slots.map((s) => (
                <tr key={s.id}>
                  <td>{s.time}</td>
                  <td>{t('admin.services.booked', { booked: s.booked, capacity: s.capacity })}{s.status === 'closed' && <> <span className="badge badge-warn">{t('admin.services.closed')}</span></>}</td>
                  <td>
                    <label className="sr-only" htmlFor={`c-${s.id}`}>{t('admin.services.slotCapacity')}</label>
                    <input id={`c-${s.id}`} type="number" min={Math.max(1, s.booked)} defaultValue={s.capacity} className="input-narrow"
                      onBlur={(e) => { const v = Number(e.target.value); if (v && v !== s.capacity) update(s.id, { capacity: v }); }} />
                  </td>
                  <td><button type="button" className="btn btn-secondary btn-small" onClick={() => update(s.id, { status: s.status === 'open' ? 'closed' : 'open' })}>{s.status === 'open' ? t('admin.services.close') : t('admin.services.open')}</button></td>
                </tr>
              ))}
            </tbody>
          </table>
        </details>
      ))}
    </>
  );
}
