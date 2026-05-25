/**
 * L1b tests — `groupTranslator` option on Parallel.
 *
 * Per-composition translator that receives `GroupMetadata` (kind, id,
 * name, members[]) and returns a consumer-shaped UI value. Independent
 * of `buildTimeExtractor` (per-node, L1a). Both can be attached
 * together for orthogonal coverage.
 *
 * 7-pattern matrix where applicable: unit, functional, integration,
 * property, security, performance, ROI.
 */

import { describe, it, expect, vi } from 'vitest';
import type { GroupMetadata, GroupTranslator } from '../../../src/core/translator.js';
import { Parallel } from '../../../src/core-flow/Parallel.js';
import { LLMCall } from '../../../src/core/LLMCall.js';
import { MockProvider } from '../../../src/adapters/llm/MockProvider.js';

const ok = (reply: string, groupTranslator?: GroupTranslator) =>
  LLMCall.create({
    provider: new MockProvider({ reply }),
    model: 'mock',
    // Threading the translator into nested compositions is opt-in per
    // composition (L1c will add a per-method override). At v0.1 the
    // consumer threads manually — see the cascade test below.
    // (LLMCall doesn't accept the option yet — it's a v0.1 follow-up.)
  })
    .system('')
    .build();

// ── 1. Unit — without translator, getUIGroup() returns undefined ────

describe('Parallel — groupTranslator absent', () => {
  it('getUIGroup() returns undefined when no translator was attached', () => {
    const par = Parallel.create()
      .branch('a', ok('A'))
      .branch('b', ok('B'))
      .mergeWithFn((r) => Object.values(r).join('|'))
      .build();
    expect(par.getUIGroup()).toBeUndefined();
  });
});

// ── 2. Functional — translator receives the right metadata ──────────

describe('Parallel — groupTranslator metadata shape', () => {
  it('translator sees kind=Parallel + id + name + members + extra.mergeStrategy', () => {
    let captured: GroupMetadata | undefined;
    const t: GroupTranslator = (g) => {
      captured = g;
      return { rfType: 'group', primitiveKind: g.kind };
    };
    const par = Parallel.create({
      name: 'Committee',
      id: 'committee',
      groupTranslator: t,
    })
      .branch('legal', ok('L'))
      .branch('ethics', ok('E'))
      .mergeWithFn((r) => Object.values(r).join('|'))
      .build();
    void par.getUIGroup();
    expect(captured).toBeDefined();
    expect(captured!.kind).toBe('Parallel');
    expect(captured!.id).toBe('committee');
    expect(captured!.name).toBe('Committee');
    expect(captured!.members).toHaveLength(2);
    expect(captured!.members[0]!.memberId).toBe('legal');
    expect(captured!.members[1]!.memberId).toBe('ethics');
    expect(captured!.extra?.['mergeStrategy']).toBe('fn');
  });

  it('translator output is what getUIGroup() returns', () => {
    const t: GroupTranslator = (g) => ({
      rfType: 'group',
      label: `${g.kind}:${g.name}`,
    });
    const par = Parallel.create({ name: 'C', groupTranslator: t })
      .branch('a', ok('A'))
      .branch('b', ok('B'))
      .mergeWithFn((r) => Object.values(r).join('|'))
      .build();
    expect(par.getUIGroup()).toEqual({ rfType: 'group', label: 'Parallel:C' });
  });

  it('extra.mergeStrategy reflects the chosen merge variant', () => {
    let captured: GroupMetadata | undefined;
    const t: GroupTranslator = (g) => {
      captured = g;
      return null;
    };
    Parallel.create({ groupTranslator: t })
      .branch('a', ok('A'))
      .branch('b', ok('B'))
      .mergeOutcomesWithFn(() => 'out')
      .build()
      .getUIGroup();
    expect(captured!.extra?.['mergeStrategy']).toBe('outcomes-fn');
  });
});

// ── 3. Reference identity — getUIGroup() is cache-stable ────────────

describe('Parallel — getUIGroup() reference identity', () => {
  it('returns the same reference across calls (cached)', () => {
    const t: GroupTranslator = () => ({ shape: 'group', members: [] });
    const par = Parallel.create({ groupTranslator: t })
      .branch('a', ok('A'))
      .branch('b', ok('B'))
      .mergeWithFn((r) => Object.values(r).join(','))
      .build();
    const first = par.getUIGroup();
    const second = par.getUIGroup();
    expect(first).toBe(second);
  });

  it('translator is invoked exactly ONCE per runner', () => {
    const t = vi.fn(() => ({ result: 'once' }));
    const par = Parallel.create({ groupTranslator: t })
      .branch('a', ok('A'))
      .branch('b', ok('B'))
      .mergeWithFn((r) => Object.values(r).join(','))
      .build();
    par.getUIGroup();
    par.getUIGroup();
    par.getUIGroup();
    expect(t).toHaveBeenCalledTimes(1);
  });
});

// ── 4. Integration — nested compositions + cascade ──────────────────

describe('Parallel — nested cascade', () => {
  it('inner Parallel\'s uiGroup surfaces in outer\'s members[].uiGroup', () => {
    const t: GroupTranslator = (g) => ({
      kind: g.kind,
      id: g.id,
      childIds: g.members.map((m) => m.memberId),
      // Drill once: each member's uiGroup is the inner translation
      // (or undefined for runners without the translator threaded).
      innerKinds: g.members.map((m) =>
        (m.uiGroup as { kind?: string } | undefined)?.kind,
      ),
    });
    const inner = Parallel.create({ id: 'inner', name: 'Inner', groupTranslator: t })
      .branch('x', ok('X'))
      .branch('y', ok('Y'))
      .mergeWithFn((r) => Object.values(r).join(','))
      .build();
    // Compose inner under an outer Parallel — both with the same
    // translator threaded by the consumer.
    const outer = Parallel.create({ id: 'outer', name: 'Outer', groupTranslator: t })
      .branch('nested', inner)
      .branch('peer', ok('P'))
      .mergeWithFn((r) => Object.values(r).join(','))
      .build();
    const outerGroup = outer.getUIGroup() as {
      kind: string;
      id: string;
      childIds: string[];
      innerKinds: Array<string | undefined>;
    };
    expect(outerGroup.kind).toBe('Parallel');
    expect(outerGroup.id).toBe('outer');
    expect(outerGroup.childIds).toEqual(['nested', 'peer']);
    // The nested Parallel was translated; its inner kind surfaces.
    expect(outerGroup.innerKinds[0]).toBe('Parallel');
    // The peer LLMCall was NOT given a translator; its slot is
    // undefined (LLMCall doesn't accept the option yet — will when
    // L1b.5 lands).
    expect(outerGroup.innerKinds[1]).toBeUndefined();
  });
});

// ── 5. Security — translator throwing doesn't crash construction ────

describe('Parallel — translator error containment', () => {
  it('throwing translator surfaces on getUIGroup() but build() still succeeds', () => {
    const t: GroupTranslator = () => {
      throw new Error('translator boom');
    };
    // Build is unaffected — translator is lazy (called on first
    // getUIGroup access). Consumers that never call getUIGroup never
    // see the error.
    const par = Parallel.create({ groupTranslator: t })
      .branch('a', ok('A'))
      .branch('b', ok('B'))
      .mergeWithFn((r) => Object.values(r).join(','))
      .build();
    expect(par.getSpec()).toBeDefined(); // chart still works
    expect(() => par.getUIGroup()).toThrow(/translator boom/);
  });

  it('called-ONCE invariant holds for throwing translators (cache sealed before invocation)', () => {
    // A throwing translator with side effects must NOT be re-invoked
    // on subsequent `getUIGroup()` calls — telemetry / counters
    // would double-count. Cache is sealed BEFORE the translator
    // runs, so on throw the first call sees the error and every
    // subsequent call returns `undefined` (the sealed value).
    const t = vi.fn(() => {
      throw new Error('boom');
    });
    const par = Parallel.create({ groupTranslator: t as GroupTranslator })
      .branch('a', ok('A'))
      .branch('b', ok('B'))
      .mergeWithFn((r) => Object.values(r).join(','))
      .build();
    expect(() => par.getUIGroup()).toThrow(/boom/);
    // Second call returns the sealed undefined (no re-throw, no
    // re-invocation).
    expect(par.getUIGroup()).toBeUndefined();
    expect(par.getUIGroup()).toBeUndefined();
    expect(t).toHaveBeenCalledTimes(1);
  });
});

// ── 6. Performance — translator invocation is amortised ─────────────

describe('Parallel — getUIGroup() perf', () => {
  it('1000 reads after first call complete under 50ms (cache-only)', () => {
    const t: GroupTranslator = (g) => ({ count: g.members.length });
    const par = Parallel.create({ groupTranslator: t })
      .branch('a', ok('A'))
      .branch('b', ok('B'))
      .mergeWithFn((r) => Object.values(r).join(','))
      .build();
    par.getUIGroup(); // warm
    const start = performance.now();
    for (let i = 0; i < 1000; i++) par.getUIGroup();
    const ms = performance.now() - start;
    expect(ms).toBeLessThan(50);
  });
});

// ── 7. ROI — same translator across many runners ───────────────────

describe('Parallel — same translator reused across many runners', () => {
  it('one translator instance can shape N independent Parallels', () => {
    const t: GroupTranslator = (g) => ({ id: g.id, n: g.members.length });
    const a = Parallel.create({ id: 'a', groupTranslator: t })
      .branch('x', ok('X'))
      .branch('y', ok('Y'))
      .mergeWithFn(() => 'a')
      .build();
    const b = Parallel.create({ id: 'b', groupTranslator: t })
      .branch('x', ok('X'))
      .branch('y', ok('Y'))
      .branch('z', ok('Z'))
      .mergeWithFn(() => 'b')
      .build();
    expect(a.getUIGroup()).toEqual({ id: 'a', n: 2 });
    expect(b.getUIGroup()).toEqual({ id: 'b', n: 3 });
  });
});

// ── L1c — Per-method override on .branch() ──────────────────────────

describe('Parallel — per-method translator override (L1c)', () => {
  // Inner runner has its OWN translator so we can verify the override
  // REPLACES (not stacks on) the runner's default.
  const innerT: GroupTranslator = (g) => ({
    source: 'inner-default',
    kind: g.kind,
    id: g.id,
  });
  const innerLLM = () =>
    LLMCall.create({
      provider: new MockProvider({ reply: 'X' }),
      model: 'mock',
      groupTranslator: innerT,
    })
      .system('')
      .build();

  it('legacy .branch(id, runner, name) string signature still works', () => {
    const t: GroupTranslator = (g) => ({ kind: g.kind });
    const par = Parallel.create({ groupTranslator: t })
      .branch('a', innerLLM(), 'Branch A')
      .branch('b', innerLLM())
      .mergeWithFn((r) => Object.values(r).join(','))
      .build();
    expect(() => par.getUIGroup()).not.toThrow();
  });

  it('per-branch override replaces the branch runner\'s own translator output', () => {
    const outerT: GroupTranslator = (g) => ({
      kind: g.kind,
      childUIs: g.members.map((m) => m.uiGroup),
    });
    const overrideForB: GroupTranslator = (g) => ({
      source: 'override',
      kind: g.kind,
      id: g.id,
    });
    const par = Parallel.create({ groupTranslator: outerT })
      // No override: branch 'a' uses its runner's own innerT → produces
      // { source: 'inner-default', ... }
      .branch('a', innerLLM())
      // Override: branch 'b' uses `overrideForB` → produces
      // { source: 'override', ... }
      .branch('b', innerLLM(), { groupTranslator: overrideForB })
      .mergeWithFn((r) => Object.values(r).join(','))
      .build();
    const result = par.getUIGroup() as {
      kind: string;
      childUIs: Array<{ source: string; kind: string; id: string }>;
    };
    expect(result.kind).toBe('Parallel');
    expect(result.childUIs[0]!.source).toBe('inner-default');
    expect(result.childUIs[1]!.source).toBe('override');
  });

  it('override gets the BRANCH RUNNER\'s GroupMetadata, not the parent\'s', () => {
    let capturedKind: string | undefined;
    let capturedId: string | undefined;
    const override: GroupTranslator = (g) => {
      capturedKind = g.kind;
      capturedId = g.id;
      return { sawKind: g.kind, sawId: g.id };
    };
    const par = Parallel.create({
      id: 'outer-parallel',
      groupTranslator: () => null,
    })
      .branch('only', innerLLM(), { groupTranslator: override })
      .branch('peer', innerLLM())
      .mergeWithFn(() => 'done')
      .build();
    void par.getUIGroup();
    // The override saw the branch RUNNER's metadata — kind=LLMCall.
    // It did NOT see the Parallel's metadata (kind=Parallel).
    expect(capturedKind).toBe('LLMCall');
    expect(capturedId).not.toBe('outer-parallel');
  });

  it('per-method override does NOT leak to other branches', () => {
    const outerT: GroupTranslator = (g) => g.members.map((m) => m.uiGroup);
    const override: GroupTranslator = () => ({ tag: 'OVERRIDE_ONLY' });
    const par = Parallel.create({ groupTranslator: outerT })
      .branch('a', innerLLM(), { groupTranslator: override })
      .branch('b', innerLLM())
      .branch('c', innerLLM())
      .mergeWithFn(() => 'x')
      .build();
    const result = par.getUIGroup() as Array<{ tag?: string; source?: string }>;
    // Branch 'a' uses override.
    expect(result[0]!.tag).toBe('OVERRIDE_ONLY');
    // Branches 'b' + 'c' use the inner runner's default.
    expect(result[1]!.source).toBe('inner-default');
    expect(result[2]!.source).toBe('inner-default');
  });

  it('override on a branch whose runner has NO translator still works (overrides absence)', () => {
    const noTranslatorRunner = () =>
      LLMCall.create({ provider: new MockProvider({ reply: 'X' }), model: 'mock' })
        .system('')
        .build();
    const override: GroupTranslator = (g) => ({
      from: 'override',
      kind: g.kind,
    });
    const par = Parallel.create({
      groupTranslator: (g) => g.members.map((m) => m.uiGroup),
    })
      .branch('a', noTranslatorRunner(), { groupTranslator: override })
      .branch('b', noTranslatorRunner())
      .mergeWithFn(() => 'x')
      .build();
    const result = par.getUIGroup() as Array<unknown>;
    expect(result[0]).toEqual({ from: 'override', kind: 'LLMCall' });
    // No override + no runner translator = undefined uiGroup.
    expect(result[1]).toBeUndefined();
  });
});
