'use client';
import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { call } from './client-api';
import { useErrorText, useI18n } from './I18n';

/** Selezione dell'hotel per chi lavora in piu' hotel (staff/hotels, staff/select-hotel). Con un solo hotel non compare. */
export function HotelSwitch({ currentId }: { currentId: string }) {
  const { t } = useI18n();
  const errText = useErrorText();
  const router = useRouter();
  const [hotels, setHotels] = useState<{ id: string; name: string; role: string }[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let alive = true;
    call('/api/staff/hotels').then((r) => { if (alive && r.ok) setHotels(r.hotels as { id: string; name: string; role: string }[]); });
    return () => { alive = false; };
  }, []);

  if (!hotels || hotels.length < 2) return null;
  const choose = async (id: string) => {
    setBusy(true); setError(null);
    const r = await call('/api/staff/select-hotel', { hotelId: id });
    setBusy(false);
    if (r.ok) router.refresh(); else setError(errText(r.error));
  };
  return (
    <div className="field hotel-switch">
      <label htmlFor="hotel-sel">{t('staff.hotel')}</label>
      <select id="hotel-sel" value={currentId} disabled={busy} onChange={(e) => void choose(e.target.value)}>
        {hotels.map((h) => <option key={h.id} value={h.id}>{h.name}</option>)}
      </select>
      {error && <p className="error-text" role="alert">{error}</p>}
    </div>
  );
}
