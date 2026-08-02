// Single source of truth for the homepage chapter arc. Plain data — NO 'use client', NO
// component imports — so it is safe to import from BOTH the client (Chapters.tsx sticky bars,
// ChapterRail jump-nav) AND the server (app/static.json/route.ts search index). Keeping the
// data here means the sticky bars, the rail, and the search entries can never drift apart.
//
// The story reads as one sentence top-to-bottom: PROBLEM → SOLUTION → BENEFITS → HOW → PAYOFF.

export type ChapterMeta = {
  /** stable anchor id — the rail's #-target and the search entry url */
  id: string;
  /** two-digit index shown in the rail + bar */
  ix: string;
  /** category eyebrow, e.g. "The problem" */
  cat: string;
  /** chapter title */
  ti: string;
  /** one-line subtitle — also the search entry description */
  sub: string;
};

export const CHAPTERS_META: ChapterMeta[] = [
  {
    id: 'af-ch-problem',
    ix: '01',
    cat: 'The problem',
    ti: 'It answered wrong',
    sub: 'Asking the model why only gets you a confident guess.',
  },
  {
    id: 'af-ch-solution',
    ix: '02',
    cat: 'The solution',
    ti: 'Rewind to the cause',
    sub: 'Every piece of context lands in one place, so you can trace back to it.',
  },
  {
    id: 'af-ch-benefits',
    ix: '03',
    cat: 'What you get',
    ti: 'Catch it before it answers',
    sub: 'The same trace runs forward — see why it picked that, and fix it.',
  },
  {
    id: 'af-ch-how',
    ix: '04',
    cat: 'How it works',
    ti: 'The run records itself',
    sub: 'Every step is captured as it happens, so you can rewind to any moment.',
  },
  {
    id: 'af-ch-payoff',
    ix: '05',
    cat: 'The payoff',
    ti: 'Proven, not guessed',
    sub: 'Record the run, rewind to the cause, prove the fix by replaying it.',
  },
];

export const TECHNICAL_CHAPTERS_META: ChapterMeta[] = [
  {
    id: 'af-ch-problem',
    ix: '01',
    cat: 'Failure surface',
    ti: 'Wrong output, hidden cause',
    sub: 'Logs preserve sequence; provenance preserves which context influenced the result.',
  },
  {
    id: 'af-ch-solution',
    ix: '02',
    cat: 'Context model',
    ti: 'Slots, sources, and triggers',
    sub: 'Typed injections make every context contribution addressable and traceable.',
  },
  {
    id: 'af-ch-benefits',
    ix: '03',
    cat: 'Causal analysis',
    ti: 'Slice, score, and ablate',
    sub: 'Rank influence, remove a suspect source, and measure the counterfactual result.',
  },
  {
    id: 'af-ch-how',
    ix: '04',
    cat: 'Runtime model',
    ti: 'Record inline, not afterward',
    sub: 'Execution and provenance are captured together at each traversal boundary.',
  },
  {
    id: 'af-ch-payoff',
    ix: '05',
    cat: 'Technical payoff',
    ti: 'A queryable causal record',
    sub: 'Backward slicing and replay operate on typed evidence instead of reconstructed logs.',
  },
];

export const HOME_VIEW_CHAPTERS = {
  product: CHAPTERS_META,
  technical: TECHNICAL_CHAPTERS_META,
} as const;
