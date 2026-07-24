/**
 * Compile-level regression test — the 7.5.0 widening of
 * `LocalizeContextBugOptions['scorer']` from `InfluenceScorer` to
 * `InfluenceScorer | InfluenceStrategy` (src/lib/context-bisect/localize.ts)
 * must stay NON-BREAKING: 7.4.0 code that passed a bare `InfluenceScorer`
 * function still has to compile unchanged, and the new `InfluenceStrategy`
 * descriptor must be assignable too.
 *
 * `scoreLexicalInfluence` must remain assignable to `InfluenceScorer` — that
 * is the whole point of `ScoreLexicalInfluenceArgs` being a SUPERTYPE of
 * `ScoreInfluenceArgs` (parameter contravariance), so a non-embedding scorer
 * fits the seam.
 *
 * Lives under its own tsconfig (run via `npm run test:types`) so the REAL
 * TypeScript compiler checks the assignments, while its `.test.ts` name also
 * lets vitest exercise the (trivial) runtime assertions.
 */
import { describe, expect, it } from 'vitest';
import {
  lexicalOverlapStrategy,
  scoreInfluence,
  scoreLexicalInfluence,
  semanticAlignmentStrategy,
  type InfluenceScorer,
} from '../../src/lib/influence-core';
import type { LocalizeContextBugOptions } from '../../src/lib/context-bisect';

describe('InfluenceStrategy — assignability (7.5.0 widening stays non-breaking)', () => {
  it('a bare InfluenceScorer function still fits the widened scorer option', () => {
    // The assignments below ARE the assertions: they fail to COMPILE if the
    // widening ever drops the bare-function arm or the strategy arm.
    const a: LocalizeContextBugOptions['scorer'] = scoreInfluence;
    const b: LocalizeContextBugOptions['scorer'] = semanticAlignmentStrategy;
    expect(typeof a).toBe('function');
    expect(b.name).toBe('semantic-alignment');
  });

  it('scoreLexicalInfluence is assignable to InfluenceScorer (supertype-args contravariance)', () => {
    const c: InfluenceScorer = scoreLexicalInfluence;
    const d: InfluenceScorer = lexicalOverlapStrategy.scorer;
    expect(typeof c).toBe('function');
    expect(typeof d).toBe('function');
  });
});
