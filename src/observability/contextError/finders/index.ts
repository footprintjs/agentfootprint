/**
 * observability / contextError / finders — pluggable context-bug localization.
 *
 * "Which piece of context made the agent's answer wrong?" Pick a finder and call
 * `find(input)`. Each finder is a thin, self-explaining adapter over the engines in
 * `src/lib/context-bisect` + `src/lib/influence-core`; the academic method + citation
 * live in `meta`, never in the import name.
 *
 *   import { rankSuspects } from 'agentfootprint/observe';
 *   const r = await rankSuspects.find(input);   // r.lead, r.evidence ('guessed'|'proven')
 *
 * Tree-shakeable: one finder = one file = one named export. Importing one finder does
 * not pull the others (or the heavy ablation path behind removeAndRetry). This barrel
 * is re-export-only — no runtime code, no registry.
 *
 * Not an import path of its own since 9.0.0. This is the implementation barrel
 * behind `agentfootprint/observe`, which re-exports every name here — same
 * symbols, one door. Import from the door.
 */
export type {
  ContextPiece,
  Evidence,
  Finder,
  FinderMeta,
  FindInput,
  FindResult,
  Granularity,
  ScoredSuspect,
  StepInput,
} from './types.js';

export { rankSuspects } from './rankSuspects.js';
export { removeAndRetry } from './removeAndRetry.js';
export { traceSteps } from './traceSteps.js';
export { testManyCombos } from './testManyCombos.js';
export { shrinkToCause } from './shrinkToCause.js';
export { compareFinders, type CompareRow } from './compareFinders.js';
