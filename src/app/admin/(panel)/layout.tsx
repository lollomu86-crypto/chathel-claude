import { redirect } from 'next/navigation';
import { getLocale, getStaff } from '@/lib/server';
import { makeT } from '@/lib/i18n';
import { AdminNav } from '@/components/AdminNav';
import { HotelSwitch } from '@/components/HotelSwitch';
import { LangSwitch } from '@/components/LangSwitch';
import { LogoMark } from '@/components/LogoMark';
import { LogoutButton } from '@/components/LogoutButton';
import { StaffStatusProvider, UrgentBanner } from '@/components/StaffStatus';

export const dynamic = 'force-dynamic';

export default async function PanelLayout({ children }: { children: React.ReactNode }) {
  const staff = await getStaff();
  if (!staff) redirect('/admin/login');
  if (staff.info.role === 'bartender') redirect('/bar');
  const t = makeT(await getLocale(staff.info.hotel.defaultLocale));
  const admin = staff.info.role === 'hotel_admin';
  // richieste passate all'operatore ancora da prendere in carico (aggiornato a ogni navigazione e azione)
  const queue = await staff.handoffQueue(false).catch(() => []);
  const inbox = queue.filter((c) => c.status === 'handoff_pending').length;
  // menu per uso: oggi, ospiti (cosa chiedono e scrivono), servizi (cosa offre l'hotel), hotel (impostazioni e numeri)
  const groups = [
    { label: null, items: [{ href: '/admin', label: t('admin.nav.today') }] },
    { label: t('admin.nav.groupGuests'), items: [
      { href: '/admin/guests', label: t('admin.nav.guests') },
      { href: '/admin/inbox', label: t('admin.nav.inbox'), badge: 'inbox' as const },
      { href: '/admin/social', label: t('admin.nav.social'), badge: 'social' as const },
      { href: '/admin/notifications', label: t('admin.nav.notifications') },
    ] },
    { label: t('admin.nav.groupServices'), items: [
      { href: '/admin/events', label: t('admin.nav.events') },
      { href: '/admin/services', label: t('admin.nav.services') },
      { href: '/admin/games', label: t('admin.nav.games') },
    ] },
    { label: t('admin.nav.groupHotel'), items: [
      { href: '/admin/ai', label: t('admin.nav.ai') },
      ...(admin ? [{ href: '/admin/stats', label: t('admin.nav.stats') }, { href: '/admin/settings', label: t('admin.nav.settings') }] : []),
    ] },
  ];
  return (
    <StaffStatusProvider inbox={inbox} canModerate>
      <header className="app-head">
        <div className="app-head-in app-head-wide">
          <LogoMark />
          <p className="app-head-title">
            <span className="app-head-name">{staff.info.hotel.name}</span>
            <span className="app-head-sub">{t(`staff.roles.${staff.info.role}`)} · {staff.info.displayName}</span>
          </p>
          <div className="app-head-actions">
            <LangSwitch variant="compact" />
            <LogoutButton to="/admin/login" />
          </div>
        </div>
      </header>
      <div className="wide">
        <HotelSwitch currentId={staff.info.hotel.id} />
        <UrgentBanner />
        <div className="admin-shell">
          <AdminNav groups={groups} />
          <main id="main" className="admin-main">{children}</main>
        </div>
      </div>
    </StaffStatusProvider>
  );
}
