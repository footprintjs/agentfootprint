/**
 * `AgentInput.messageFrom` — which runners a composition marks, and when
 * (honesty layer 2, step 5: another model's message never counts as "the
 * person said it").
 *
 * Test types (Convention 3):
 *   - UNIT         — `composedInput` hands a runner that does not read the
 *                    marker the SAME input object (every other composition's
 *                    bytes are what they were); an armed Agent reads it, and a
 *                    composition holding a reader reads it too;
 *   - INTEGRATION  — `Sequence`: the first step is the caller's message, a later
 *                    step's is composed; nested, the composed message reaches
 *                    the inner Sequence's first step; `Loop`: the first
 *                    iteration is the caller's, a later one is composed;
 *                    `Parallel` and `Conditional` pass a composed message on to
 *                    their branches; an unarmed agent in the same slot records
 *                    nothing.
 */

import { describe, expect, it } from 'vitest';

import { Agent, Conditional, Loop, Parallel, Sequence, defineTool } from '../../src/index.js';
import { composedInput, readsMessageFrom } from '../../src/core/messageFrom.js';

const reply = (content: string) => ({
  name: 'm',
  complete: async () => ({ content, toolCalls: [], usage: { input: 0, output: 0 } }),
});

const ruled = defineTool({
  name: 'search_logs',
  description: 'Error lines.',
  inputSchema: { type: 'object', properties: { window: { type: 'string' } } },
  askOrAssume: { window: { assume: '2h' } },
  execute: async () => 'ok',
});

/** An agent whose declared sources are armed — it reads the marker. */
const armed = (content = 'done') =>
  Agent.create({ provider: reply(content) as never, model: 'm' })
    .tool(ruled)
    .findings({ argumentSources: true })
    .build();

/** The same agent without the arm — it reads nothing. */
const plain = (content = 'done') =>
  Agent.create({ provider: reply(content) as never, model: 'm' })
    .tool(ruled)
    .build();

type Snap = {
  subflowResults?: Record<string, { treeContext?: { globalContext?: Record<string, unknown> } }>;
};

/**
 * The mounted runners of a composition, by subflow key — its steps, branches
 * and loop bodies (and theirs, nested), never an agent's own slot subflows
 * (`sf-*`, `final`). A loop body is keyed by its runtime id (`body#N`), one per
 * iteration; every other runner by its plain key.
 */
function runners(snapshot: unknown): [string, Record<string, unknown>][] {
  const results = (snapshot as Snap).subflowResults ?? {};
  return Object.entries(results)
    .filter(([key]) => {
      const segments = key.split('/');
      if (segments.some((s) => s.startsWith('sf-') || s === 'final' || s.startsWith('final#'))) {
        return false;
      }
      const last = segments[segments.length - 1]!;
      return last.startsWith('body#') || !last.includes('#');
    })
    .map(([key, r]) => [key, r.treeContext?.globalContext ?? {}]);
}

/**
 * The runners that were handed a COMPOSED message: an armed agent records it
 * as `userMessageFrom`, a composition carries it as its input key `messageFrom`.
 */
function composedSteps(snapshot: unknown): string[] {
  return runners(snapshot)
    .filter(([, g]) => g.userMessageFrom === 'composed' || g.messageFrom === 'composed')
    .map(([key]) => key)
    .sort();
}

/** The runners whose state holds an agent's seed (`userMessage`). */
function agentSteps(snapshot: unknown): string[] {
  return runners(snapshot)
    .filter(([, g]) => typeof g.userMessage === 'string')
    .map(([key]) => key)
    .sort();
}

describe('UNIT — composedInput marks only a runner that reads the marker', () => {
  it('the SAME input object for any other runner; a marked copy for a reader', () => {
    const input = { message: 'hi' };
    const other = {};
    expect(composedInput(other, input)).toBe(input);
    const reader = {};
    readsMessageFrom(reader);
    expect(composedInput(reader, input)).toEqual({ message: 'hi', messageFrom: 'composed' });
    expect(input).toEqual({ message: 'hi' });
  });

  it('an armed Agent reads it; the same agent unarmed does not', () => {
    expect(composedInput(armed(), { message: 'x' })).toHaveProperty('messageFrom', 'composed');
    const input = { message: 'x' };
    expect(composedInput(plain(), input)).toBe(input);
  });
});

describe('INTEGRATION — each composition marks the message it did not get from a person', () => {
  it('Sequence: the first step is the caller’s message, a later step’s is composed', async () => {
    const seq = Sequence.create().step('a', armed('plan')).step('b', armed()).build();
    await seq.run({ message: 'hi' });
    const snap = seq.getSnapshot();
    expect(agentSteps(snap)).toEqual(['step-a', 'step-b']);
    expect(composedSteps(snap)).toEqual(['step-b']);
  });

  it('an unarmed agent in the same slot records nothing (its bytes are what they were)', async () => {
    const seq = Sequence.create().step('a', plain('plan')).step('b', plain()).build();
    await seq.run({ message: 'hi' });
    expect(composedSteps(seq.getSnapshot())).toEqual([]);
  });

  it('nested: a composed message reaches the inner Sequence’s FIRST step', async () => {
    const inner = Sequence.create().step('x', armed('inner')).build();
    const outer = Sequence.create().step('a', plain('plan')).step('b', inner).build();
    await outer.run({ message: 'hi' });
    expect(composedSteps(outer.getSnapshot())).toEqual(['step-b', 'step-b/step-x']);
  });

  it('Loop: the first iteration is the caller’s message, a later one is composed', async () => {
    const loop = Loop.create().repeat(armed('again')).times(2).build();
    await loop.run({ message: 'hi' });
    const snap = loop.getSnapshot();
    // One `body#N` per iteration (the plain `body` key is the last iteration again).
    const order = (k: string) => Number(k.slice('body#'.length));
    const bodies = agentSteps(snap)
      .filter((k) => k.startsWith('body#'))
      .sort((a, b) => order(a) - order(b));
    expect(bodies.length).toBe(2);
    // Exactly one of the two iterations recorded the marker: the second.
    const marked = composedSteps(snap).filter((k) => k.startsWith('body#'));
    expect(marked).toEqual([bodies[bodies.length - 1]]);
  });

  it('Parallel and Conditional pass a composed message on to their branches', async () => {
    const par = Parallel.create()
      .branch('p', armed('p'))
      .branch('q', plain('q'))
      .mergeWithFn((r) => Object.values(r).join(' '))
      .build();
    const cond = Conditional.create()
      .when('always', () => true, armed('c'))
      .otherwise('never', plain('n'))
      .build();
    const outer = Sequence.create()
      .step('a', plain('plan'))
      .step('par', par)
      .step('cond', cond)
      .build();
    await outer.run({ message: 'hi' });
    const marked = composedSteps(outer.getSnapshot());
    expect(marked).toContain('step-par');
    expect(marked).toContain('step-cond');
    expect(marked.some((k) => k.startsWith('step-par/p'))).toBe(true);
    expect(marked.some((k) => k.startsWith('step-par/q'))).toBe(false);
    expect(marked.some((k) => k.startsWith('step-cond/always'))).toBe(true);
  });
});
