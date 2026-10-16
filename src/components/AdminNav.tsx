'use client';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useI18n } from './I18n';
import { useStaffStatus } from './StaffStatus';

export function AdminNav({ items }: { items: { href: string; label: string; badge?: 'inbox' | 'social' }[] }) {
  const path = usePathname();
  const { t } = useI18n();
  const st = useStaffStatus();
  return (
    <nav className="admin-nav" aria-label={t('admin.nav.label')}>
      {items.map((i) => {
        const n = i.badge === 'inbox' ? st.inbox + st.urgent.length : i.badge === 'social' ? st.openReports : 0;
        return (
          <Link key={i.href} href={i.href} aria-current={path === i.href ? 'page' : undefined} aria-label={n ? `${i.label}, ${t('admin.nav.toHandle', { n })}` : undefined}>
            {i.label}
            {n > 0 && <span className="count" aria-hidden="true">{n}</span>}
          </Link>
        );
      })}
    </nav>
  );
}
