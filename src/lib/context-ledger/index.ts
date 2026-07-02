/**
 * context-ledger — which context pieces EARNED their tokens?
 *
 * Post-run bookkeeping over the run's own commit log (offers, structural
 * uses, consumer outcomes) whose rows feed the gating seams so future turns
 * include less. See README.md for the honesty model and the L2 gates.
 */

export { contextLedger } from './contextLedger.js';
export type {
  ContextLedger,
  LedgerJSON,
  LedgerRow,
  PieceKind,
  RecordedRun,
  UsedSignal,
} from './types.js';
