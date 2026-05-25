/**
 * L1c — per-method `groupTranslator` overrides on Sequence / Loop /
 * Conditional. Parallel has its own dedicated suite — see
 * `groupTranslator-parallel.test.ts`.
 *
 * Invariants under test:
 *   - Override REPLACES the member runner's own translator (not stacks).
 *   - Override sees the MEMBER RUNNER's metadata (not the parent's).
 *   - Override on one member doesn't leak to other members.
 *   - Legacy positional signatures still work (no breaking change).
 */

import { describe, expect, it } from 'vitest';
import type { GroupTranslator } from '../../../src/core/translator.js';
import { Sequence } from '../../../src/core-flow/Sequence.js';
import { Loop } from '../../../src/core-flow/Loop.js';
import { Conditional } from '../../../src/core-flow/Conditional.js';
import { LLMCall } from '../../../src/core/LLMCall.js';
import { MockProvider } from '../../../src/adapters/llm/MockProvider.js';

// Inner runner with its OWN translator so we can prove the override
// REPLACES (doesn't stack on) the runner's default.
const innerDefault: GroupTranslator = (g) => ({
  source: 'inner-default',
  kind: g.kind,
  id: g.id,
});

const innerLLM = () =>
  LLMCall.create({
    provider: new MockProvider({ reply: 'X' }),
    model: 'mock',
    groupTranslator: innerDefault,
  })
    .system('')
    .build();

// ── Sequence ─────────────────────────────────────────────────────

describe('Sequence — per-method override on .step()', () => {
  it("override on one step replaces that step's uiGroup; other steps unchanged", () => {
    const overrideForB: GroupTranslator = (g) => ({
      source: 'override',
      kind: g.kind,
      id: g.id,
    });
    const outerT: GroupTranslator = (g) => g.members.map((m) => m.uiGroup);
    const seq = Sequence.create({ groupTranslator: outerT })
      .step('a', innerLLM())
      .step('b', innerLLM(), { groupTranslator: overrideForB })
      .step('c', innerLLM())
      .build();
    const out = seq.getUIGroup() as Array<{ source: string }>;
    expect(out[0]!.source).toBe('inner-default');
    expect(out[1]!.source).toBe('override');
    expect(out[2]!.source).toBe('inner-default');
  });

  it('legacy two-arg .step(id, runner) still works without throwing', () => {
    const seq = Sequence.create({ groupTranslator: (g) => g.id })
      .step('only', innerLLM())
      .build();
    expect(seq.getUIGroup()).toBeDefined();
  });

  it("override sees the STEP RUNNER's metadata, not the Sequence's", () => {
    let capturedKind: string | undefined;
    const override: GroupTranslator = (g) => {
      capturedKind = g.kind;
      return { sawKind: g.kind };
    };
    Sequence.create({ id: 'outer-seq', groupTranslator: () => null })
      .step('only', innerLLM(), { groupTranslator: override })
      .build()
      .getUIGroup();
    expect(capturedKind).toBe('LLMCall');
  });
});

// ── Loop ─────────────────────────────────────────────────────────

describe('Loop — per-method override on .repeat()', () => {
  it("override replaces body's uiGroup", () => {
    const bodyOverride: GroupTranslator = (g) => ({
      source: 'override',
      kind: g.kind,
    });
    const outerT: GroupTranslator = (g) => g.members[0]!.uiGroup;
    const loop = Loop.create({ groupTranslator: outerT })
      .repeat(innerLLM(), { groupTranslator: bodyOverride })
      .times(3)
      .build();
    const out = loop.getUIGroup() as { source: string };
    expect(out.source).toBe('override');
  });

  it("without override, body uses its own runner's translator", () => {
    const outerT: GroupTranslator = (g) => g.members[0]!.uiGroup;
    const loop = Loop.create({ groupTranslator: outerT }).repeat(innerLLM()).times(3).build();
    const out = loop.getUIGroup() as { source: string };
    expect(out.source).toBe('inner-default');
  });

  it('legacy single-arg .repeat(runner) still works', () => {
    expect(() =>
      Loop.create({ groupTranslator: () => null })
        .repeat(innerLLM())
        .times(2)
        .build()
        .getUIGroup(),
    ).not.toThrow();
  });
});

// ── Conditional ───────────────────────────────────────────────────

describe('Conditional — per-method override on .when() + .otherwise()', () => {
  it('override on .when() applies only to that branch', () => {
    const whenOverride: GroupTranslator = (g) => ({
      source: 'when-override',
      kind: g.kind,
    });
    const outerT: GroupTranslator = (g) => g.members.map((m) => m.uiGroup);
    const cond = Conditional.create({ groupTranslator: outerT })
      .when('hi', () => true, innerLLM(), { groupTranslator: whenOverride })
      .otherwise('lo', innerLLM())
      .build();
    const out = cond.getUIGroup() as Array<{ source: string }>;
    expect(out[0]!.source).toBe('when-override');
    expect(out[1]!.source).toBe('inner-default');
  });

  it('override on .otherwise() applies only to the fallback branch', () => {
    const fallbackOverride: GroupTranslator = (g) => ({
      source: 'fallback-override',
      kind: g.kind,
    });
    const outerT: GroupTranslator = (g) => g.members.map((m) => m.uiGroup);
    const cond = Conditional.create({ groupTranslator: outerT })
      .when('hi', () => true, innerLLM())
      .otherwise('lo', innerLLM(), { groupTranslator: fallbackOverride })
      .build();
    const out = cond.getUIGroup() as Array<{ source: string }>;
    expect(out[0]!.source).toBe('inner-default');
    expect(out[1]!.source).toBe('fallback-override');
  });

  it('legacy positional .when(id, pred, runner, name?) still works', () => {
    expect(() =>
      Conditional.create({ groupTranslator: () => null })
        .when('hi', () => true, innerLLM(), 'Hi Branch')
        .otherwise('lo', innerLLM(), 'Lo Branch')
        .build()
        .getUIGroup(),
    ).not.toThrow();
  });

  it("override sees the BRANCH RUNNER's metadata, not the Conditional's", () => {
    let capturedKind: string | undefined;
    const override: GroupTranslator = (g) => {
      capturedKind = g.kind;
      return null;
    };
    Conditional.create({ id: 'outer-cond', groupTranslator: () => null })
      .when('hi', () => true, innerLLM(), { groupTranslator: override })
      .otherwise('lo', innerLLM())
      .build()
      .getUIGroup();
    expect(capturedKind).toBe('LLMCall');
  });
});

// ── Cross-composition: override semantics are uniform ────────────

describe('All compositions — per-method override semantics are uniform', () => {
  it('Sequence + Loop + Conditional all let an override replace exactly one member', () => {
    const o: GroupTranslator = () => ({ tag: 'OVERRIDE' });
    const seq = Sequence.create({ groupTranslator: (g) => g.members.map((m) => m.uiGroup) })
      .step('a', innerLLM(), { groupTranslator: o })
      .step('b', innerLLM())
      .build();
    const loop = Loop.create({ groupTranslator: (g) => g.members[0]!.uiGroup })
      .repeat(innerLLM(), { groupTranslator: o })
      .times(2)
      .build();
    const cond = Conditional.create({ groupTranslator: (g) => g.members.map((m) => m.uiGroup) })
      .when('hi', () => true, innerLLM(), { groupTranslator: o })
      .otherwise('lo', innerLLM())
      .build();
    expect((seq.getUIGroup() as Array<{ tag?: string }>)[0]!.tag).toBe('OVERRIDE');
    expect((loop.getUIGroup() as { tag?: string }).tag).toBe('OVERRIDE');
    expect((cond.getUIGroup() as Array<{ tag?: string }>)[0]!.tag).toBe('OVERRIDE');
  });
});
