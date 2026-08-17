'use client';

import { useEffect, useRef } from 'react';

/**
 * A quiet brand-colour pointer aura for the marketing routes. The native cursor
 * stays visible; this is only an ambient response and is disabled for touch,
 * coarse pointers, and reduced motion.
 */
export function MarketingPointer() {
  const aura = useRef<HTMLSpanElement>(null);

  useEffect(() => {
    const element = aura.current;
    if (!element) return;

    const finePointer = window.matchMedia('(hover: hover) and (pointer: fine)');
    const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
    if (!finePointer.matches || reducedMotion.matches) return;

    let frame = 0;
    let x = -100;
    let y = -100;
    const paint = () => {
      frame = 0;
      element.style.transform = `translate3d(${x}px, ${y}px, 0)`;
    };
    const move = (event: PointerEvent) => {
      x = event.clientX;
      y = event.clientY;
      if (!frame) frame = requestAnimationFrame(paint);
      element.classList.add('is-visible');
    };
    const over = (event: PointerEvent) => {
      const target = event.target;
      element.classList.toggle(
        'is-interactive',
        target instanceof Element && Boolean(target.closest('a, button, summary')),
      );
    };
    const leave = () => element.classList.remove('is-visible', 'is-interactive');

    window.addEventListener('pointermove', move, { passive: true });
    window.addEventListener('pointerover', over, { passive: true });
    document.documentElement.addEventListener('mouseleave', leave);
    return () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerover', over);
      document.documentElement.removeEventListener('mouseleave', leave);
      if (frame) cancelAnimationFrame(frame);
    };
  }, []);

  return <span ref={aura} className="af-pointer-aura" aria-hidden="true" />;
}
