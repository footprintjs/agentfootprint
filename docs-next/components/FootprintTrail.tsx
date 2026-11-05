'use client';

import { useEffect, useState, type CSSProperties, type RefObject } from 'react';

/* The distance between two prints, and the longest a walk may take, however far it goes. */
const STRIDE = 15;
const WALK_MS = 440;

interface Print {
  readonly key: string;
  readonly style: CSSProperties;
}

/**
 * Real footprints across the header: they walk from the page you're on to the label you're pointing
 * at, one foot then the other, and fade behind you. `data-walking` holds back the pair under that label
 * until they arrive. With reduced motion nothing walks, and the pair just appears.
 */
export function FootprintTrail({ nav }: { readonly nav: RefObject<HTMLElement | null> }) {
  const [prints, setPrints] = useState<readonly Print[]>([]);

  useEffect(() => {
    const el = nav.current;
    const header = el?.closest('.af-sh-inner');
    if (!el || !header) return;
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    let target: Element | null = null;
    let lastX: number | null = null;
    let walks = 0;
    let arrive = 0;
    let timer = 0;

    const centerOf = (link: Element) => {
      const box = link.getBoundingClientRect();
      return box.left + box.width / 2 - header.getBoundingClientRect().left;
    };
    /* From the page you're on, or from the logo when you're on none of them. */
    const startX = () => {
      const current =
        el.querySelector('.af-sh-link.on') ?? header.querySelector('.af-sh-brand img');
      return current ? centerOf(current) : 0;
    };
    const walkTo = (event: Event) => {
      const link = (event.target as Element).closest?.('.af-sh-link');
      if (!link || link === target) return;
      target = link;
      const from = lastX ?? startX();
      const to = centerOf(link);
      lastX = to;
      /* A stride clear of the pair at each end, so no print lands on a standing foot. */
      const count = Math.floor(Math.abs(to - from) / STRIDE) - 1;
      window.clearTimeout(arrive);
      if (reduced || count < 2) {
        el.removeAttribute('data-walking');
        return;
      }
      const gap = Math.min(28, WALK_MS / count);
      const direction = to > from ? 1 : -1;
      const y = link.getBoundingClientRect().bottom - header.getBoundingClientRect().top + 8;
      el.setAttribute('data-walking', '');
      arrive = window.setTimeout(() => el.removeAttribute('data-walking'), count * gap);
      walks += 1;
      setPrints(
        Array.from({ length: count }, (_, i) => ({
          key: `${walks}-${i}`,
          style: {
            '--x': `${from + direction * STRIDE * (i + 1)}px`,
            '--y': `${y + (i % 2 ? 3 : -3)}px`,
            '--r': `${direction * 90}deg`,
            '--f': i % 2 ? -1 : 1,
            animationDelay: `${Math.round(i * gap)}ms`,
          } as CSSProperties,
        })),
      );
      window.clearTimeout(timer);
      timer = window.setTimeout(() => setPrints([]), count * gap + 800);
    };
    const leave = () => {
      target = null;
      lastX = null;
    };

    el.addEventListener('pointerover', walkTo);
    el.addEventListener('focusin', walkTo);
    el.addEventListener('pointerleave', leave);
    return () => {
      window.clearTimeout(arrive);
      window.clearTimeout(timer);
      el.removeEventListener('pointerover', walkTo);
      el.removeEventListener('focusin', walkTo);
      el.removeEventListener('pointerleave', leave);
    };
  }, [nav]);

  return (
    <div className="af-sh-trail" aria-hidden="true">
      {prints.map((print) => (
        <span key={print.key} style={print.style} />
      ))}
    </div>
  );
}
