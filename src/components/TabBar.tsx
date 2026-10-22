'use client';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useFeatures } from './Features';
import { useI18n } from './I18n';
import { useSocialBadge } from './SocialBadge';
import { Icon } from './ui/Icon';

const tabs = [
  { href: '/stay', key: 'home', icon: 'home', feature: null },
  { href: '/stay/events', key: 'events', icon: 'calendar', feature: null },
  { href: '/stay/book', key: 'book', icon: 'clock', feature: 'bookings' },
  { href: '/stay/social', key: 'social', icon: 'users', feature: 'social' },
  { href: '/stay/reception', key: 'reception', icon: 'chat', feature: 'reception' },
] as const;

export function TabBar() {
  const path = usePathname();
  const { t } = useI18n();
  const { unread } = useSocialBadge();
  const features = useFeatures();
  // la scheda "Prenota" ospita anche i giochi delle sfide: resta se le prenotazioni sono spente ma le sfide no
  const shown = tabs.filter((x) => !x.feature || features[x.feature] || (x.key === 'book' && features.challenges));
  return (
    <nav className="tabbar" aria-label={t('nav.main')}>
      {shown.map((x) => {
        const active = path === x.href || (x.href !== '/stay' && path.startsWith(x.href + '/'));
        const n = x.key === 'social' ? unread : 0;
        return (
          <Link key={x.href} href={x.href} aria-current={active ? 'page' : undefined} aria-label={n ? `${t(`nav.${x.key}`)}, ${t('social.unreadCount', { n })}` : undefined}>
            <Icon name={x.icon} />
            <span className="tabbar-label">{t(`nav.${x.key}`)}</span>
            {n > 0 && <span className="count" aria-hidden="true">{n}</span>}
          </Link>
        );
      })}
    </nav>
  );
}
