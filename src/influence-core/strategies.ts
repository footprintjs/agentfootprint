/**
 * Named influence strategies — a plain-named descriptor AROUND the already-
 * public `InfluenceScorer` function seam, exactly the shape a host UI's
 * strategy selector needs (mirrors the `EntryScorer` / `ConfidenceStrategy`
 * "name shown in any strategy picker" precedent).
 *
 * A strategy is `{ name, description, requirements, scorer }`. Two ship:
 *   • `semanticAlignmentStrategy` — the FDL four-signal embedding composite
 *     (`scoreInfluence`). The default; needs an embedder.
 *   • `lexicalOverlapStrategy`    — deterministic word overlap
 *     (`scoreLexicalInfluence`). Free, zero deps; requires nothing.
 *
 * `listInfluenceStrategies()` enumerates them so a selector can render the
 * two options and grey out what the host can't run (`requirements`).
 *
 * Sugar, not a replacement: `localizeContextBug({ scorer })` still accepts a
 * bare `InfluenceScorer` function; it now ALSO accepts one of these.
 */
import type { InfluenceScorer } from './signals.js';
import { scoreInfluence } from './signals.js';
import { scoreLexicalInfluence } from './lexical.js';

/**
 * What a strategy needs the host to supply before it can run. A selector UI
 * greys out strategies whose requirements the host can't meet. `'embedder'`
 * is the only well-known value today; the type stays open for consumer
 * strategies (`'llm'`, `'reference-run'`, …).
 */
export type InfluenceStrategyRequirement = 'embedder' | (string & Record<never, never>);

/**
 * A NAMED influence-scoring strategy — an `InfluenceScorer` plus the metadata
 * a strategy picker needs. Sugar AROUND the function seam, not a replacement:
 * `localizeContextBug({ scorer })` accepts either a bare `InfluenceScorer` or
 * one of these.
 */
export interface InfluenceStrategy {
  /** Stable kebab-case id — shown in a selector, echoed on `ContextBugReport.rankedBy`. */
  readonly name: string;
  /** One-or-two-sentence plain description for the picker, honesty caveat included. */
  readonly description: string;
  /** What the host must supply to run this strategy (empty = runs anywhere, $0). */
  readonly requirements: readonly InfluenceStrategyRequirement[];
  /** The scorer itself — plugs into `localizeContextBug({ scorer })` directly. */
  readonly scorer: InfluenceScorer;
}

/** The DEFAULT: the FDL four-signal embedding composite (`scoreInfluence`). */
export const semanticAlignmentStrategy: InfluenceStrategy = Object.freeze({
  name: 'semantic-alignment',
  description:
    'Ranks sources by how semantically close their content is to the final answer, using ' +
    'embeddings (the four-signal composite). The default. Needs an embedder; scores are a ' +
    'proxy for alignment, never proof of cause.',
  requirements: Object.freeze(['embedder'] as const),
  scorer: scoreInfluence,
});

/** The cheap option: deterministic word overlap (`scoreLexicalInfluence`), zero deps. */
export const lexicalOverlapStrategy: InfluenceStrategy = Object.freeze({
  name: 'lexical-overlap',
  description:
    'Ranks sources by plain word overlap with the final answer. Deterministic, free, no ' +
    'dependencies — the simpler, cheaper option. Misses paraphrases; same proxy caveat: ' +
    'overlap is not cause.',
  requirements: Object.freeze([] as const),
  scorer: scoreLexicalInfluence,
});

const BUILT_IN = Object.freeze([semanticAlignmentStrategy, lexicalOverlapStrategy]);

/**
 * The built-in strategies, default first. Frozen — a host UI renders its
 * selector straight off this (concat your own custom strategies after).
 */
export function listInfluenceStrategies(): readonly InfluenceStrategy[] {
  return BUILT_IN;
}
