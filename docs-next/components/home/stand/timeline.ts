/** When things happen in the film, in beats. Small on purpose: the page imports it up front, and the engine loads later. */
import type { ChapterId } from './copy';

/* ── the timeline, in beats ─────────────────────────────────────────────── */
export const T = {
  askA: 0.9,
  ledgerA: 1.9,
  llmA: 3.25,
  logsA: 4.1,
  wordA: 5.05,
  sA: 6.2,
  tA: 9.0,
  aA: 12.0,
  mA: 14.7,
  nA: 16.5,
  namedA: 19.5,
  dA: 20.5,
  gA: 22.7,
  xA: 23.9,
  limA: 25.2,
  chainA: 26.8,
  endA: 29.0,
  uniA: 30.3,
  end: 33.8,
} as const;

/** Which caption is on screen when. `hero` is the opening H1. */
export const CHAPTERS: readonly (readonly [ChapterId | 'hero', number, number])[] = [
  ['hero', 0, 0.85],
  ['ask', T.askA, T.ledgerA - 0.05],
  ['ledger', T.ledgerA, T.llmA - 0.05],
  ['llm', T.llmA, T.logsA - 0.05],
  ['logs', T.logsA, T.wordA - 0.05],
  ['word', T.wordA, T.sA - 0.05],
  ['s', T.sA, T.tA - 0.05],
  ['t', T.tA, T.aA - 0.05],
  ['a', T.aA, T.mA - 0.05],
  ['montage', T.mA, T.nA - 0.05],
  ['n', T.nA, T.namedA - 0.05],
  ['named', T.namedA, T.dA - 0.05],
  ['d', T.dA, T.gA - 0.05],
  ['gate', T.gA, T.xA - 0.05],
  ['explain', T.xA, T.limA - 0.05],
  ['limit', T.limA, T.chainA - 0.05],
  ['chain', T.chainA, T.endA - 0.02],
  ['finale', T.endA, 1e9],
];

/** The scrubber's stops. */
export const RAIL: readonly {
  readonly label: string;
  readonly at: number;
  readonly letter: boolean;
}[] = [
  { label: 'Why', at: T.askA + 0.1, letter: false },
  { label: 'S', at: T.sA + 0.12, letter: true },
  { label: 'T', at: T.tA + 0.12, letter: true },
  { label: 'A', at: T.aA + 0.12, letter: true },
  { label: 'N', at: T.nA + 0.12, letter: true },
  { label: 'D', at: T.dA + 0.12, letter: true },
  { label: 'Limit', at: T.limA + 0.1, letter: false },
];

/** The frame each chapter holds on when motion is reduced. */
export const STILLS: Readonly<Record<ChapterId, number>> = {
  ask: T.ledgerA - 0.2,
  ledger: T.llmA - 0.12,
  llm: T.logsA - 0.12,
  logs: T.wordA - 0.14,
  word: T.sA - 0.12,
  s: T.tA - 0.14,
  t: T.aA - 0.75,
  a: T.mA - 0.15,
  montage: T.mA + 0.32,
  n: T.nA + 1.75,
  named: T.dA - 0.15,
  d: T.gA - 0.14,
  gate: T.xA - 0.14,
  explain: T.limA - 0.14,
  limit: T.chainA - 0.14,
  chain: T.endA - 0.14,
  finale: T.end,
};
