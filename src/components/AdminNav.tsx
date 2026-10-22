'use client';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect, useState } from 'react';
import { useI18n } from './I18n';
import { useStaffStatus } from './StaffStatus';
import { Icon } from './ui/Icon';

export interface NavItem { href: string; label: string; badge?: 'inbox' | 'social' }
export interface NavGroup { label: string | null; items: NavItem[] }

/**
 * Menu del pannello a gruppi (Oggi · Ospiti · Servizi · Hotel). Da 900 px e' una colonna laterale sempre aperta;
 * sul telefono un pulsante con la pagina attuale e il totale "da gestire" apre l'elenco (si richiude cambiando pagina).
 */
export function AdminNav({ groups }: { groups: NavGroup[] }) {
  const path = usePathname();
  const { t } = useI18n();
  const st = useStaffStatus();
  const [open, setOpen] = useState(false);
  useEffect(() => { setOpen(false); }, [path]);
  const count = (i: NavItem) => (i.badge === 'inbox' ? st.inbox + st.urgent.length : i.badge === 'social' ? st.openReports : 0);
  const all = groups.flatMap((g) => g.items);
  const current = all.find((i) => i.href === path) ?? all.find((i) => i.href !== '/admin' && path.startsWith(`${i.href}/`)) ?? all[0];
  const total = all.reduce((n, i) => n + count(i), 0);

  return (
    <nav className={`admin-nav${open ? ' admin-nav-open' : ''}`} aria-label={t('admin.nav.label')}>
      <button type="button" className="admin-nav-toggle" aria-expanded={open} aria-controls="admin-nav-list" onClick={() => setOpen((o) => !o)}>
        <Icon name="more" />
        <span className="grow">{current?.label}</span>
        {total > 0 && <span className="count" aria-label={t('admin.nav.toHandle', { n: total })}>{total}</span>}
        <span className="admin-nav-toggle-label">{t('admin.nav.menu')}</span>
      </button>
      <div id="admin-nav-list" className="admin-nav-list">
        {groups.map((g, gi) => (
          <div key={gi} className="admin-nav-group" role="group" aria-label={g.label ?? undefined}>
            {g.label && <p className="admin-nav-title" aria-hidden="true">{g.label}</p>}
            {g.items.map((i) => {
              const n = count(i);
              return (
                <Link key={i.href} href={i.href} aria-current={i === current ? 'page' : undefined} aria-label={n ? `${i.label}, ${t('admin.nav.toHandle', { n })}` : undefined}>
                  <span className="grow">{i.label}</span>
                  {n > 0 && <span className="count" aria-hidden="true">{n}</span>}
                </Link>
              );
            })}
          </div>
        ))}
      </div>
    </nav>
  );
}
