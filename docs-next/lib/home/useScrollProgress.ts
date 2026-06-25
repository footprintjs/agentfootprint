'use client';

import { useEffect, useRef, useState, type RefObject } from 'react';
import { registerScroll } from './scrollEngine';

/**
 * Subscribe a pinned track to the shared scroll engine and derive a value from its 0..1 progress.
 *
 * The key win: `map` quantizes progress (to a step index, a phase, a coarse float, …) and the
 * component re-renders ONLY when the mapped value actually changes (Object.is). So an engine
 * chapter whose visible state changes ~12 times re-renders ~12 times across the whole track
 * instead of on every scroll pixel. For a genuinely continuous consumer, round in `map`
 * (e.g. `p => Math.round(p * 240) / 240`) to cap renders at an imperceptible granularity.
 *
 * Replaces the per-component `useState + useEffect(scroll + rAF + getBoundingClientRect + setState)`
 * block that was copied across every chapter — the engine owns the listener/rAF/layout-read now.
 *
 * @param ref     the pinned track element
 * @param map     pure function progress(0..1) → the value this component renders from
 * @param initial value before the first measurement (SSR / first paint)
 */
export function useScrollProgress<T>(
  ref: RefObject<HTMLElement | null>,
  map: (progress: number) => T,
  initial: T,
): T {
  const [value, setValue] = useState<T>(initial);
  const mapRef = useRef(map);
  mapRef.current = map; // always use the latest map without re-subscribing
  const lastRef = useRef<T>(initial);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;

    const commit = (next: T) => {
      if (!Object.is(next, lastRef.current)) {
        lastRef.current = next;
        setValue(next);
      }
    };

    // Reduced motion: show the END state (progress = 1) and never subscribe to scroll, so there
    // is no scroll-driven motion. Read matchMedia in the effect (client-only) — never during
    // render — to avoid the SSR/client hydration mismatch that caused React #418. Centralizes the
    // per-chapter reduced-motion branch that used to set the final phase by hand.
    const reduce =
      typeof window !== 'undefined' &&
      typeof window.matchMedia === 'function' &&
      window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (reduce) {
      commit(mapRef.current(1));
      return;
    }

    return registerScroll(el, (progress) => commit(mapRef.current(progress)));
  }, [ref]);

  return value;
}
