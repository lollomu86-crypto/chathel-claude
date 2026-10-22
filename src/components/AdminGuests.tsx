'use client';
import { useMemo, useState } from 'react';
import type { Locale } from '@/lib/types';
import { Flag } from './LangFlags';
import { useI18n } from './I18n';
import { Icon } from './ui/Icon';

export interface GuestRow {
  id: string; name: string; locale: Locale;
  arrived: string; leaves: string; leavesToday: boolean;
  /** ISO dell'ultimo accesso; "attivo" = entro 24 ore */
  lastSeen: string | null; active: boolean;
  bookings: { id: string; label: string; when: string; party: number; past: boolean }[];
  events: { id: string; label: string; when: string; past: boolean }[];
  bonus: { status: 'issued' | 'redeemed' | 'expired' | 'void'; when: string | null } | null;
}
type Filter = 'all' | 'active' | 'inactive' | 'leaving';

/** "oggi alle 14:20", "ieri", "3 giorni fa": ultimo accesso detto come lo direbbe la reception. */
function ago(iso: string | null, t: (k: string, v?: Record<string, string | number>) => string, locale: string): string {
  if (!iso) return t('admin.guests.never');
  const d = new Date(iso);
  const mins = Math.round((Date.now() - d.getTime()) / 60_000);
  if (mins < 60) return t('admin.guests.minutesAgo', { n: Math.max(1, mins) });
  const days = Math.floor((new Date().setHours(0, 0, 0, 0) - new Date(iso).setHours(0, 0, 0, 0)) / 86_400_000);
  const time = new Intl.DateTimeFormat(locale, { hour: '2-digit', minute: '2-digit' }).format(d);
  if (days <= 0) return t('admin.guests.todayAt', { time });
  if (days === 1) return t('admin.guests.yesterdayAt', { time });
  return t('admin.guests.daysAgo', { n: days });
}

export function AdminGuests({ rows }: { rows: GuestRow[] }) {
  const { t, locale } = useI18n();
  const [q, setQ] = useState('');
  const [filter, setFilter] = useState<Filter>('all');
  const [open, setOpen] = useState<string | null>(null);
  const counts = { all: rows.length, active: rows.filter((r) => r.active).length, inactive: rows.filter((r) => !r.active).length, leaving: rows.filter((r) => r.leavesToday).length };
  const list = useMemo(() => {
    const s = q.trim().toLocaleLowerCase();
    return rows.filter((r) => (!s || r.name.toLocaleLowerCase().includes(s))
      && (filter === 'all' || (filter === 'active' && r.active) || (filter === 'inactive' && !r.active) || (filter === 'leaving' && r.leavesToday)));
  }, [rows, q, filter]);

  return (
    <>
      <h1>{t('admin.guests.title')}</h1>
      <p className="muted">{t('admin.guests.intro')}</p>
      <div className="field">
        <label htmlFor="gq" className="sr-only">{t('admin.guests.search')}</label>
        <input id="gq" type="search" placeholder={t('admin.guests.search')} value={q} onChange={(e) => setQ(e.target.value)} autoComplete="off" />
      </div>
      <div className="seg seg-scroll" role="tablist" aria-label={t('admin.guests.filter')}>
        {(['all', 'active', 'inactive', 'leaving'] as Filter[]).map((f) => (
          <button key={f} type="button" role="tab" aria-selected={filter === f} onClick={() => setFilter(f)}>
            {t(`admin.guests.filters.${f}`)} <span className="seg-count">{counts[f]}</span>
          </button>
        ))}
      </div>

      {rows.length === 0 && <div className="card empty"><Icon name="users" /><p className="empty-title">{t('admin.guests.emptyTitle')}</p><p>{t('admin.guests.empty')}</p></div>}
      {rows.length > 0 && list.length === 0 && <p className="card muted">{t('admin.guests.noMatch')}</p>}

      <div className="people">
        {list.map((r) => {
          const isOpen = open === r.id;
          const upcoming = r.bookings.filter((b) => !b.past).length;
          return (
            <div key={r.id} className="person-block">
              <button type="button" className="person guest-row" aria-expanded={isOpen} aria-controls={`g-${r.id}`} onClick={() => setOpen(isOpen ? null : r.id)}>
                <span className="avatar" aria-hidden="true">{[...r.name][0] ?? '?'}</span>
                <span className="person-main">
                  <span className="person-name">{r.name}</span>
                  <span className="person-meta"><Flag locale={r.locale} size="sm" /> {r.locale.toUpperCase()} · {t('admin.guests.stay', { from: r.arrived, to: r.leaves })}</span>
                  <span className="person-meta">{t('admin.guests.lastSeen', { when: ago(r.lastSeen, t, locale) })}</span>
                </span>
                <span className="guest-side">
                  <span className={`badge ${r.active ? 'badge-ok' : 'badge-warn'}`}>{r.active ? t('admin.guests.active') : t('admin.guests.inactive')}</span>
                  {r.leavesToday && <span className="badge badge-info">{t('admin.guests.leavesToday')}</span>}
                  <span className="muted xs">{t('admin.guests.counts', { b: upcoming, e: r.events.filter((e) => !e.past).length })}</span>
                </span>
              </button>
              {isOpen && (
                <div id={`g-${r.id}`} className="guest-detail stack-sm">
                  <h3 className="label">{t('admin.guests.bookings')}</h3>
                  {r.bookings.length === 0 ? <p className="muted small">{t('admin.guests.none')}</p> : (
                    <ul className="guest-list">{r.bookings.map((b) => <li key={b.id} className={b.past ? 'muted' : ''}><strong>{b.label}</strong> · {b.when} · {t('book.persons', { n: b.party })}</li>)}</ul>
                  )}
                  <h3 className="label">{t('admin.guests.events')}</h3>
                  {r.events.length === 0 ? <p className="muted small">{t('admin.guests.none')}</p> : (
                    <ul className="guest-list">{r.events.map((e) => <li key={e.id} className={e.past ? 'muted' : ''}><strong>{e.label}</strong> · {e.when}</li>)}</ul>
                  )}
                  <h3 className="label">{t('admin.guests.bonus')}</h3>
                  <p className="small">{r.bonus ? t(`admin.guests.bonusStatus.${r.bonus.status}`, { when: r.bonus.when ?? '' }) : t('admin.guests.bonusNone')}</p>
                </div>
              )}
            </div>
          );
        })}
      </div>
      <p className="hint">{t('admin.guests.privacy')}</p>
    </>
  );
}
