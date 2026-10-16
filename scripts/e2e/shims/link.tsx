import type { AnchorHTMLAttributes, ReactNode } from 'react';
// Sostituto di next/link: un <a>. La navigazione lato client la fa il runtime del harness (client.tsx).
type P = Omit<AnchorHTMLAttributes<HTMLAnchorElement>, 'href'> & { href: string | { pathname?: string }; prefetch?: boolean; replace?: boolean; scroll?: boolean; children?: ReactNode };
export default function Link({ href, prefetch: _p, replace: _r, scroll: _s, ...rest }: P) {
  return <a href={typeof href === 'string' ? href : href.pathname ?? '/'} {...rest} />;
}
