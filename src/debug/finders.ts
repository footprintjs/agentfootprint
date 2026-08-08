/**
 * debug/finders — context-error finder strategies.
 *
 * Collapsed home for what was the 3-level-deep
 * `src/observability/contextError/finders/` barrel. Same tree-shakeable,
 * re-export-only shape — one finder = one file = one named export — now under
 * the Debug category where it belongs.
 *
 * Not an import path of its own since 9.0.0. This is the implementation barrel
 * behind `agentfootprint/observe`, which re-exports every name here — same
 * symbols, one door. Import from the door.
 */
export * from '../observability/contextError/finders/index.js';
