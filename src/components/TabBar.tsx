'use client';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useI18n } from './I18n';
import { useSocialBadge } from './SocialBadge';
import { Icon } from './ui/Icon';

const tabs = [
  { href: '/stay', key: 'home', icon: 'home' },
  { href: '/stay/events', key: 'events', icon: 'calendar' },
  { href: '/stay/book', key: 'book', icon: 'clock' },
  { href: '/stay/social', key: 'social', icon: 'users' },
  { href: '/stay/reception', key: 'reception', icon: 'chat' },
] as const;

export function TabBar() {
  const path = usePathname();
  const { t } = useI18n();
  const { unread } = useSocialBadge();
  return (
    <nav className="tabbar" aria-label={t('nav.main')}>
      {tabs.map((x) => {
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
