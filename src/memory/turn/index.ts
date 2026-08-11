/**
 * Turn identity — which turn of a conversation is about to happen.
 *
 * One rule, shared by every memory kind, so two turns of one conversation
 * can never write the same turn-stamped ids. See `./resolveTurnNumber.ts`.
 */
// `normalizeHostTurn` is deliberately NOT re-exported: it is the shared
// "what counts as a turn number" rule two call sites need, not a question a
// consumer has. Import it from the module when composing inside the library.
export {
  maxStoredTurn,
  resolveTurnNumber,
  type MaxStoredTurnOptions,
  type ResolveTurnNumberOptions,
} from './resolveTurnNumber.js';
