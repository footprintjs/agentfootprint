import Link from 'next/link';
import type { ReactNode } from 'react';

/** One idea on a reading page: words on the left, and the code or picture on the right. */
export function ReadingRow({
  id,
  kicker,
  title,
  children,
  more,
  aside,
}: {
  readonly id?: string;
  readonly kicker?: string;
  readonly title: string;
  readonly children: ReactNode;
  readonly more?: { readonly href: string; readonly label: string };
  readonly aside: ReactNode;
}) {
  return (
    <section className="rp-row" id={id}>
      <div className="rp-words">
        {kicker ? <p className="v2-kicker">{kicker}</p> : null}
        <h3>{title}</h3>
        {children}
        {more ? (
          <Link className="pf-more" href={more.href} prefetch={false}>
            {more.label} <span aria-hidden="true">→</span>
          </Link>
        ) : null}
      </div>
      <div className="rp-aside">{aside}</div>
    </section>
  );
}
