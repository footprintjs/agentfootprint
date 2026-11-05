/** When things happen in the How it works scenes, in beats. Small on purpose: the page imports it up front, and the engine loads later. */
import type { HowChapter } from './howCopy';

export const H = {
  wrongA: 0.9,
  askA: 2.5,
  recordA: 3.9,
  walkA: 5.7,
  addressA: 7.9,
  suspectA: 10.0,
  rerunA: 11.3,
  forwardA: 13.4,
  loopA: 15.2,
  endA: 16.8,
  end: 18.4,
} as const;

export type HowScene = 'wrong' | 'ask' | 'record' | 'address' | 'rerun' | 'forward' | 'loop' | 'end';

/* The scene each chapter shows and the stretch of it to play, stopping before that scene starts to leave. */
export const HOW_SCENES: Readonly<Record<HowChapter, { readonly scene: HowScene; readonly from: number; readonly to: number }>> = {
  wrong: { scene: 'wrong', from: H.wrongA, to: H.askA - 0.04 },
  ask: { scene: 'ask', from: H.askA, to: H.recordA - 0.2 },
  record: { scene: 'record', from: H.recordA, to: H.walkA - 0.02 },
  walk: { scene: 'record', from: H.walkA, to: H.addressA - 0.18 },
  address: { scene: 'address', from: H.addressA, to: H.suspectA - 0.02 },
  suspect: { scene: 'address', from: H.suspectA, to: H.rerunA - 0.18 },
  rerun: { scene: 'rerun', from: H.rerunA, to: H.forwardA - 0.18 },
  forward: { scene: 'forward', from: H.forwardA, to: H.loopA - 0.18 },
  loop: { scene: 'loop', from: H.loopA, to: H.endA - 0.18 },
  end: { scene: 'end', from: H.endA, to: H.end },
};
