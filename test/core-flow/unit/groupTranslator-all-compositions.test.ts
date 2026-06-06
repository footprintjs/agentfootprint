/**
 * L1b — `groupTranslator` smoke-tests across the remaining 5
 * compositions (Sequence, Loop, Conditional, LLMCall, Agent).
 *
 * Per-composition expectations:
 *   - `getUIGroup()` returns `undefined` without a translator.
 *   - With a translator, it sees the right `kind`, `id`, `name`,
 *     and `members` shape for that composition.
 *   - `extra` carries composition-specific config (Sequence has none,
 *     Loop has iteration budgets, Conditional has fallbackId,
 *     LLMCall + Agent have slot ids in `extra.slots`).
 *   - Reference-stable across calls (cached).
 *
 * Parallel has its own dedicated suite — see
 * `groupTranslator-parallel.test.ts`.
 */

import { describe, expect, it } from 'vitest';
import type { GroupMetadata, GroupTranslator } from '../../../src/core/translator.js';
import { Sequence } from '../../../src/core-flow/Sequence.js';
import { Loop } from '../../../src/core-flow/Loop.js';
import { Conditional } from '../../../src/core-flow/Conditional.js';
import { LLMCall } from '../../../src/core/LLMCall.js';
import { Agent } from '../../../src/core/Agent.js';
import { MockProvider } from '../../../src/adapters/llm/MockProvider.js';

const llmCall = (reply: string) =>
  LLMCall.create({
    provider: new MockProvider({ reply }),
    model: 'mock',
  })
    .system('')
    .build();

// ── Sequence ──────────────────────────────────────────────────────

describe('Sequence — groupTranslator', () => {
  it('returns undefined without a translator', () => {
    const seq = Sequence.create().step('a', llmCall('A')).step('b', llmCall('B')).build();
    expect(seq.getUIGroup()).toBeUndefined();
  });

  it('translator sees kind=Sequence + ordered step members', () => {
    let captured: GroupMetadata | undefined;
    const t: GroupTranslator = (g) => {
      captured = g;
      return { ids: g.members.map((m) => m.memberId) };
    };
    const seq = Sequence.create({ id: 'seq', name: 'Seq', groupTranslator: t })
      .step('classify', llmCall('c'))
      .step('respond', llmCall('r'))
      .build();
    expect(seq.getUIGroup()).toEqual({ ids: ['classify', 'respond'] });
    expect(captured!.kind).toBe('Sequence');
    expect(captured!.id).toBe('seq');
    expect(captured!.name).toBe('Seq');
    expect(captured!.members).toHaveLength(2);
  });
});

// ── Loop ──────────────────────────────────────────────────────────

describe('Loop — groupTranslator', () => {
  it('returns undefined without a translator', () => {
    const loop = Loop.create().repeat(llmCall('body')).times(3).build();
    expect(loop.getUIGroup()).toBeUndefined();
  });

  it('translator sees kind=Loop + single body member + extra budgets', () => {
    let captured: GroupMetadata | undefined;
    const t: GroupTranslator = (g) => {
      captured = g;
      return null;
    };
    Loop.create({ id: 'loop', name: 'Loop', groupTranslator: t })
      .repeat(llmCall('body'))
      .times(5)
      .forAtMost(2000)
      .build()
      .getUIGroup();
    expect(captured!.kind).toBe('Loop');
    expect(captured!.id).toBe('loop');
    expect(captured!.members).toHaveLength(1);
    expect(captured!.members[0]!.memberId).toBe('body');
    expect(captured!.extra?.['maxIterations']).toBe(5);
    expect(captured!.extra?.['maxWallclockMs']).toBe(2000);
    expect(captured!.extra?.['hasUntilGuard']).toBe(false);
  });
});

// ── Conditional ───────────────────────────────────────────────────

describe('Conditional — groupTranslator', () => {
  it('returns undefined without a translator', () => {
    const cond = Conditional.create()
      .when('hi', () => true, llmCall('H'))
      .otherwise('lo', llmCall('L'))
      .build();
    expect(cond.getUIGroup()).toBeUndefined();
  });

  it('translator sees kind=Conditional + branches as members + extra.fallbackId', () => {
    let captured: GroupMetadata | undefined;
    const t: GroupTranslator = (g) => {
      captured = g;
      return null;
    };
    Conditional.create({ id: 'router', name: 'Router', groupTranslator: t })
      .when('hi', () => true, llmCall('H'))
      .otherwise('lo', llmCall('L'))
      .build()
      .getUIGroup();
    expect(captured!.kind).toBe('Conditional');
    expect(captured!.id).toBe('router');
    expect(captured!.members.map((m) => m.memberId)).toEqual(['hi', 'lo']);
    expect(captured!.extra?.['fallbackId']).toBe('lo');
  });
});

// ── LLMCall ───────────────────────────────────────────────────────

describe('LLMCall — groupTranslator', () => {
  it('returns undefined without a translator', () => {
    const c = LLMCall.create({ provider: new MockProvider({ reply: 'X' }), model: 'mock' })
      .system('')
      .build();
    expect(c.getUIGroup()).toBeUndefined();
  });

  it('translator sees kind=LLMCall + empty members + extra.slots (2 slot ids — no tools)', () => {
    let captured: GroupMetadata | undefined;
    const t: GroupTranslator = (g) => {
      captured = g;
      return null;
    };
    LLMCall.create({
      provider: new MockProvider({ reply: 'X' }),
      model: 'mock',
      id: 'one-shot',
      name: 'OneShot',
      groupTranslator: t,
    })
      .system('')
      .build()
      .getUIGroup();
    expect(captured!.kind).toBe('LLMCall');
    expect(captured!.id).toBe('one-shot');
    expect(captured!.name).toBe('OneShot');
    expect(captured!.members).toEqual([]); // slots are not Runner members
    const slots = captured!.extra?.['slots'] as readonly string[];
    // LLMCall surfaces 2 slots — system-prompt + messages. No tools
    // (LLMCall has no tools; that's Agent's affordance).
    expect(slots).toHaveLength(2);
    expect(slots).toEqual(expect.arrayContaining(['sf-system-prompt', 'sf-messages']));
  });
});

// ── Agent ─────────────────────────────────────────────────────────

describe('Agent — groupTranslator', () => {
  it('returns undefined without a translator', () => {
    const agent = Agent.create({ provider: new MockProvider({ reply: 'X' }), model: 'mock' })
      .system('')
      .build();
    expect(agent.getUIGroup()).toBeUndefined();
  });

  it('translator sees kind=Agent + slots + toolNames + maxIterations', () => {
    let captured: GroupMetadata | undefined;
    const t: GroupTranslator = (g) => {
      captured = g;
      return null;
    };
    Agent.create({
      provider: new MockProvider({ reply: 'X' }),
      model: 'mock',
      id: 'react',
      name: 'ReAct',
      maxIterations: 7,
      groupTranslator: t,
    })
      .system('')
      .tool({
        schema: { name: 'lookup', description: '', inputSchema: { type: 'object' } },
        execute: () => 'found',
      })
      .tool({
        schema: { name: 'calculate', description: '', inputSchema: { type: 'object' } },
        execute: () => '42',
      })
      .build()
      .getUIGroup();
    expect(captured!.kind).toBe('Agent');
    expect(captured!.id).toBe('react');
    expect(captured!.name).toBe('ReAct');
    expect(captured!.members).toEqual([]); // tools are not Runner members
    const toolNames = captured!.extra?.['toolNames'] as readonly string[];
    expect(toolNames).toEqual(['lookup', 'calculate']);
    expect(captured!.extra?.['maxIterations']).toBe(7);
    const slots = captured!.extra?.['slots'] as readonly string[];
    expect(slots).toEqual(expect.arrayContaining(['sf-system-prompt', 'sf-messages', 'sf-tools']));
  });
});

// ── Cross-composition reference-identity ──────────────────────────

describe('All compositions — getUIGroup() identity', () => {
  it('Sequence + Loop + Conditional + LLMCall + Agent all return stable references', () => {
    const t: GroupTranslator = (g) => ({ id: g.id, kind: g.kind });
    const checks: ReadonlyArray<{ name: string; r: { getUIGroup: () => unknown } }> = [
      {
        name: 'Sequence',
        r: Sequence.create({ groupTranslator: t }).step('s', llmCall('s')).build(),
      },
      {
        name: 'Loop',
        r: Loop.create({ groupTranslator: t }).repeat(llmCall('b')).times(2).build(),
      },
      {
        name: 'Conditional',
        r: Conditional.create({ groupTranslator: t })
          .when('hi', () => true, llmCall('h'))
          .otherwise('lo', llmCall('l'))
          .build(),
      },
      {
        name: 'LLMCall',
        r: LLMCall.create({
          provider: new MockProvider({ reply: 'X' }),
          model: 'mock',
          groupTranslator: t,
        })
          .system('')
          .build(),
      },
      {
        name: 'Agent',
        r: Agent.create({
          provider: new MockProvider({ reply: 'X' }),
          model: 'mock',
          groupTranslator: t,
        })
          .system('')
          .build(),
      },
    ];
    for (const { name, r } of checks) {
      const a = r.getUIGroup();
      const b = r.getUIGroup();
      expect(a, `${name} getUIGroup() reference identity`).toBe(b);
    }
  });
});
