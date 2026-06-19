/**
 * observability / contextError / finders — pluggable context-bug localization.
 *
 * "Which piece of context made the agent's answer wrong?" Pick a finder and call
 * `find(input)`. Each finder is a thin, self-explaining adapter over the engines in
 * `src/lib/context-bisect` + `src/lib/influence-core`; the academic method + citation
 * live in `meta`, never in the import name.
 *
 *   import { rankSuspects } from 'agentfootprint/observability/contextError/finders';
 *   const r = await rankSuspects.find(input);   // r.lead, r.evidence ('guessed'|'proven')
 *
 * Tree-shakeable: one finder = one file = one named export. Importing one finder does
 * not pull the others (or the heavy ablation path behind removeAndRetry). This barrel
 * is re-export-only — no runtime code, no registry.
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
export { compareFinders, type CompareRow } from './compareFinders.js';
