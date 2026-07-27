'use client';

import { useEffect, useRef, useState, type RefObject } from 'react';
import { registerScroll } from '@/lib/home/scrollEngine';

/**
 * ADDITIVE stage steps for one /features beat.
 *
 * The storyboard rule is binding: every stage element arrives and STAYS — the canvas never wipes,
 * and each beat is a legible composition at any frame. So the returned step index is a HIGH-WATER
 * MARK: scrolling forward reveals the next layer, scrolling back does NOT take it away (you'd be
 * un-drawing a canvas the story says only ever fills).
 *
 * TWO drive modes, chosen from the beat's own measured height — because the same beat is a pinned
 * track on a desktop and a plain stacked section on a phone:
 *
 *  · 'pin'   — the beat is TALLER than the viewport, so it has a scroll budget: layers map onto
 *              scroll position through that track, via the home page's single shared scroll engine
 *              (lib/home/scrollEngine — one passive listener, one rAF loop, geometry cached and only
 *              re-measured on resize). Adding eight more per-beat scroll listeners is exactly the
 *              jank that engine exists to prevent. The FRACTION of the track the layers use is
 *              derived from geometry rather than hardcoded (see `measureDrive`), so re-tuning a
 *              `dwell` in beats.ts — or simply a different window height — cannot desynchronise the
 *              reveal from the beat.
 *  · 'enter' — the beat is SHORTER than the viewport (features.css drops `min-height` under 760px
 *              and unpins the stage). There is no track: scrollEngine's span would be ≤ 0 and
 *              progress would sit at 0 forever, leaving every phone stage stuck on layer 1. So the
 *              layers land on a stagger the moment the beat arrives — the stage still assembles
 *              instead of appearing pre-built.
 *
 * The mode is re-decided on resize, so rotating a phone or dragging a desktop window narrow past
 * the breakpoint switches drive — and the 760px number is never duplicated in JS. Geometry is the
 * source of truth; the media query is merely what produces it.
 *
 * prefers-reduced-motion: commit the END state (all layers) and never subscribe — no motion at all,
 * the fully-composed stage on first paint. matchMedia is read inside the effect (never during
 * render) so SSR and the client agree on the first pass.
 *
 * @param ref   the beat section (in 'pin' mode its height is the beat's scroll budget)
 * @param steps how many layers this stage has
 * @returns the number of revealed layers, 0..steps, never decreasing
 */
export function useAdditiveSteps(
  ref: RefObject<HTMLElement | null>,
  steps: number,
  /**
   * The copy the stage illustrates (the beat's rail). How long it stays on screen is one of the two
   * constraints on the reveal — see `measureDrive`. Optional; without it only the hold constrains.
   */
  copyRef?: RefObject<HTMLElement | null>,
): number {
  const [step, setStep] = useState(0);
  const [drive, setDrive] = useState<Drive | null>(null);
  const hiRef = useRef(0);

  // Decide the drive mode and (in 'pin' mode) the reveal span from MEASURED geometry — never from a
  // hardcoded fraction. Re-decided on resize.
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const decide = () => {
      const next = measureDrive(el, copyRef?.current ?? null);
      setDrive((prev) => (sameDrive(prev, next) ? prev : next));
    };
    decide();
    window.addEventListener('resize', decide);
    return () => window.removeEventListener('resize', decide);
  }, [ref, copyRef]);

  useEffect(() => {
    const el = ref.current;
    if (!el || drive === null) return;

    const commit = (next: number) => {
      if (next > hiRef.current) {
        hiRef.current = next;
        setStep(next);
      }
    };

    const reduce =
      typeof window !== 'undefined' &&
      typeof window.matchMedia === 'function' &&
      window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (reduce) {
      commit(steps);
      return;
    }

    if (drive.mode === 'enter') {
      const timers: ReturnType<typeof setTimeout>[] = [];
      const io = new IntersectionObserver(
        (entries) => {
          if (!entries.some((e) => e.isIntersecting)) return;
          io.disconnect(); // one-shot: the reveal is additive, so it never needs to run twice
          for (let layer = 1; layer <= steps; layer++) {
            timers.push(setTimeout(() => commit(layer), (layer - 1) * 210));
          }
        },
        // fire when the beat is properly on screen, not the instant its first pixel appears
        { rootMargin: '0px 0px -18% 0px', threshold: 0 },
      );
      io.observe(el);
      return () => {
        io.disconnect();
        for (const t of timers) clearTimeout(t);
      };
    }

    // Layers land over the first `span` of the (lead-extended) track, then the composed stage holds
    // for the rest. `+1` means layer 1 is already there when the beat first appears, so the stage is
    // never an empty box.
    const { span, leadVh } = drive;
    return registerScroll(
      el,
      (progress) => {
        const raw = Math.floor((progress / span) * steps) + 1;
        commit(raw < 1 ? 1 : raw > steps ? steps : raw);
      },
      { leadVh },
    );
  }, [ref, steps, drive]);

  return step;
}

/** How the beat's layers are driven. In 'pin' mode, `span` is the fraction of the track they use. */
type Drive =
  | { readonly mode: 'enter' }
  | { readonly mode: 'pin'; readonly span: number; readonly leadVh: number };

/**
 * The whole choreography is tuned by TWO numbers, both in viewport heights rather than fractions of
 * a track — because that is the unit the reader actually experiences, and it has to feel the same on
 * every beat even though the beats are different lengths (the flagship WHY is 184vh, the rest ~160).
 *
 *  · LEAD_VH — how early the reveal starts, measured back from the moment the beat's top reaches the
 *    top of the viewport. The stage is `sticky`, not a full-viewport pin, so the beat is already on
 *    screen (and its verb + line are at their most readable) while it rises into view. Starting the
 *    reveal there is what makes the stage assemble WHILE you read the line, instead of only after
 *    the line has begun scrolling away.
 *  · HOLD_VH — how long the finished stage holds before the beat ends, so the last thing you look at
 *    is the completed composition rather than a still-assembling one.
 *
 * Everything else — the span, the per-layer pace — falls out of these two plus measured geometry.
 */
const LEAD_VH = 0.55;
const HOLD_VH = 0.22;
/**
 * How much of the copy must still be on screen when the last layer lands. It has to clear the
 * STICKY SITE HEADER, not just the top of the viewport — at 60px the beat's line was technically
 * "visible" and actually sliding under the 56px header. 150px leaves the whole line plus air.
 */
const READ_MARGIN_PX = 150;

function measureDrive(beat: HTMLElement, copy: HTMLElement | null): Drive {
  const vh = window.innerHeight;
  // The 1.1 margin keeps a beat that is only *barely* taller than the viewport out of 'pin' mode —
  // a 40px track would fire every layer in one flick, which reads as a glitch, not a reveal.
  if (beat.offsetHeight <= vh * 1.1) return { mode: 'enter' };

  // Once we ask the engine for a lead, its progress 0..1 covers `lead + travel` px.
  const travel = beat.offsetHeight - vh;
  const lead = vh * LEAD_VH;
  const usable = lead + travel;

  // TWO constraints on where the last layer may land; whichever binds first wins.
  //   1. leave room for the hold — the finished stage must be what you end the beat looking at.
  //   2. land before the copy leaves — the stage must never finish explaining itself to an empty
  //      screen. The copy sits `copyTop` into the beat and is `offsetHeight` tall, so it clears the
  //      top of the viewport `copyTop + height` px after progress 0, i.e. `lead + that` into the
  //      reveal. Rects, not `offsetTop`: neither element is positioned, so `offsetParent` is some
  //      ancestor further up and `offsetTop` would not be beat-relative.
  const beforeHold = usable - vh * HOLD_VH;
  const beforeCopyLeaves = copy
    ? lead +
      (copy.getBoundingClientRect().top - beat.getBoundingClientRect().top) +
      copy.offsetHeight -
      READ_MARGIN_PX
    : Infinity;

  // A longer beat therefore reveals SLOWER (more pixels per layer) rather than just idling longer —
  // exactly what the storyboard asks of the flagship: "longest beat, slowest scroll".
  const span = Math.min(0.95, Math.max(0.3, Math.min(beforeHold, beforeCopyLeaves) / usable));
  return { mode: 'pin', span, leadVh: LEAD_VH };
}

function sameDrive(a: Drive | null, b: Drive): boolean {
  if (a === null || a.mode !== b.mode) return false;
  if (a.mode === 'enter' || b.mode === 'enter') return true;
  // sub-half-percent span jitter (a scrollbar appearing, a font settling) isn't worth a resubscribe
  return Math.abs(a.span - b.span) < 0.005;
}

/**
 * Build the class-name helper a stage uses to mark its layers.
 *
 * `on(3)` → the reveal classes for layer 3: `aff-in` (hidden, but still occupying its box so
 * nothing reflows as the stage fills) plus `on` once the step index has reached it.
 */
export function revealer(step: number): (layer: number) => string {
  return (layer: number) => (step >= layer ? 'aff-in on' : 'aff-in');
}
