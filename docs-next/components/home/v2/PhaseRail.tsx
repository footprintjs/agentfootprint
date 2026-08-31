'use client';

import { useEffect, useRef, useState } from 'react';

/**
 * The three phases as a STICKY rail that knows where you are.
 *
 * Build / Iterate / Run were all on the page and none of them were visible as a
 * shape — a reader met numbered scenes and had to infer the structure. The rail
 * names the shape once, keeps it on screen while you read, and lights the phase
 * you are actually standing in.
 *
 * CLICK BEHAVIOUR is a plain anchor, deliberately — the same rule ChapterRail
 * arrived at and wrote down: a JS-driven "scroll you there" tween moves the page
 * under the reader and fights their own wheel/touch. So a click jumps, then YOU
 * scroll, and `scroll-padding-top` lands the target clear of the sticky nav.
 *
 * SCROLL-SPY is the same rule too: the active phase is the LAST section whose top
 * has passed the rail's bottom edge. Reading it off the rail's own rect rather
 * than a hard-coded offset means it stays correct when the nav height changes.
 *
 * The listener is attached lazily, when the rail first approaches the viewport,
 * because the links already work as anchors from the server-rendered HTML — the
 * spy is an enhancement, not the mechanism.
 */
export interface Phase {
  /** The id of the section this phase opens. Must exist in the DOM. */
  readonly id: string;
  /** The step number, shown small. Decorative — the name carries the meaning. */
  readonly step: string;
  readonly name: string;
  readonly what: string;
}

export function PhaseRail({ phases }: { phases: readonly Phase[] }) {
  const railRef = useRef<HTMLElement>(null);
  const [active, setActive] = useState(phases[0]?.id ?? '');

  useEffect(() => {
    const rail = railRef.current;
    if (!rail) return;
    let cleanupActive: (() => void) | undefined;

    const activate = () => {
      if (cleanupActive) return;
      const sections = phases
        .map((phase) => document.getElementById(phase.id))
        .filter((el): el is HTMLElement => el !== null);
      if (sections.length === 0) return;

      let raf = 0;
      const onScroll = () => {
        cancelAnimationFrame(raf);
        raf = requestAnimationFrame(() => {
          const line = (railRef.current?.getBoundingClientRect().bottom ?? 96) + 8;
          let current = sections[0]!.id;
          for (const section of sections) {
            if (section.getBoundingClientRect().top <= line) current = section.id;
          }
          setActive((previous) => (previous === current ? previous : current));
        });
      };
      onScroll();
      window.addEventListener('scroll', onScroll, { passive: true });
      window.addEventListener('resize', onScroll);
      cleanupActive = () => {
        window.removeEventListener('scroll', onScroll);
        window.removeEventListener('resize', onScroll);
        cancelAnimationFrame(raf);
      };
    };

    if (typeof IntersectionObserver === 'undefined') {
      activate();
      return () => cleanupActive?.();
    }

    const approaching = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) {
          approaching.disconnect();
          activate();
        }
      },
      { rootMargin: '400px 0px' },
    );
    approaching.observe(rail);

    return () => {
      approaching.disconnect();
      cleanupActive?.();
    };
  }, [phases]);

  return (
    <nav
      ref={railRef}
      className="v21-phases"
      aria-label="How agentfootprint fits your work"
    >
      {phases.map((phase) => {
        const isActive = phase.id === active;
        return (
          <a
            key={phase.id}
            href={`#${phase.id}`}
            className={isActive ? 'is-active' : undefined}
            aria-current={isActive ? 'true' : undefined}
          >
            <span aria-hidden="true">{phase.step}</span>
            <strong>{phase.name}</strong>
            <small>{phase.what}</small>
          </a>
        );
      })}
    </nav>
  );
}
