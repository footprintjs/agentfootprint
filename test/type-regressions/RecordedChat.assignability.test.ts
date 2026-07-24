/**
 * Compile-level regression test — recordedChat must COMPOSE with the 7.5
 * context-bisect surface, never wrap it:
 *
 *  - `rerunTurn`'s return is EXACTLY `RerunWithoutSourcesResult` (assignable
 *    both ways — no bespoke wrapper type ever creeps in and hides the honesty
 *    tiers).
 *  - `ReasonOptions` accepts every `LocalizeContextBugOptions` field EXCEPT
 *    `artifacts`/`rerun` (the turn provides those).
 *  - `RerunTurnOptions` rejects `runner`/`originalAnswer` (derived from the
 *    turn + makeAgent) but accepts `report`.
 *
 * The assignments ARE the assertions — they fail to COMPILE if the surface
 * drifts. Lives under `test/type-regressions` (run via `npm run test:types`);
 * the `.test.ts` name also lets vitest exercise the trivial runtime checks.
 */
import { describe, expect, it } from 'vitest';
import type { ReasonOptions, RecordedChat, RerunTurnOptions } from '../../src/lib/recorded-chat';
import type {
  ContextBugReport,
  LocalizeContextBugOptions,
  RerunWithoutSourcesResult,
} from '../../src/lib/context-bisect';
import type { Embedder } from '../../src/lib/influence-core';

type RerunTurnReturn = Awaited<ReturnType<RecordedChat['rerunTurn']>>;

const EMB = null as unknown as Embedder;

describe('RecordedChat — assignability regressions', () => {
  it('rerunTurn returns exactly RerunWithoutSourcesResult (no wrapper type)', () => {
    // Both directions compile ⇒ the two types are mutually assignable (exact).
    const a: RerunTurnReturn = null as unknown as RerunWithoutSourcesResult;
    const b: RerunWithoutSourcesResult = null as unknown as RerunTurnReturn;
    expect(a ?? b ?? null).toBeNull();
  });

  it('ReasonOptions accepts LocalizeContextBugOptions minus artifacts/rerun', () => {
    const passthrough: ReasonOptions = null as unknown as Omit<
      LocalizeContextBugOptions,
      'artifacts' | 'rerun'
    >;
    expect(passthrough ?? null).toBeNull();
  });

  it('ReasonOptions rejects artifacts and rerun', () => {
    const withArtifacts: ReasonOptions = {
      embedder: EMB,
      // @ts-expect-error artifacts comes from the turn, not the caller
      artifacts: { snapshot: null },
    };
    const withRerun: ReasonOptions = {
      embedder: EMB,
      // @ts-expect-error the causal loop goes through rerunTurn, not localize's rerun tier
      rerun: {},
    };
    expect(withArtifacts).toBeDefined();
    expect(withRerun).toBeDefined();
  });

  it('RerunTurnOptions rejects runner/originalAnswer but accepts report', () => {
    const withReport: RerunTurnOptions = {
      ignore: ['x'],
      embedder: EMB,
      report: null as unknown as ContextBugReport,
    };
    const withRunner: RerunTurnOptions = {
      ignore: ['x'],
      embedder: EMB,
      // @ts-expect-error runner is derived from makeAgent, not passed
      runner: async () => 'x',
    };
    const withOriginal: RerunTurnOptions = {
      ignore: ['x'],
      embedder: EMB,
      // @ts-expect-error originalAnswer is the turn's frozen reply
      originalAnswer: 'x',
    };
    expect(withReport).toBeDefined();
    expect(withRunner).toBeDefined();
    expect(withOriginal).toBeDefined();
  });
});
