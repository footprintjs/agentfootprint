/**
 * A middleware whose answer cannot be honoured has not permitted anything (8.18.0).
 *
 * `runChain` has always had one law for a link that fails: **a middleware that
 * throws is a denial, never a pass** — a governance layer whose failure mode is
 * "allow" is not a governance layer. Two answers at the MESSAGE boundary fell
 * outside it and were treated as permission:
 *
 *   • `ask({ question })`. `MessageOutcome` has no ask arm, so TypeScript
 *     refuses it at the call site — but a JS consumer, an `as any`, or a link
 *     written for the TOOL chain and reused here reaches the runtime, where the
 *     ask fell straight through the value test and filed an **allow** row. A
 *     rule that believed it had paused for a person had approved the message,
 *     and the ledger agreed with the rule.
 *
 *   • `allow(value)` where the value is not text. It was assigned anyway:
 *     `content` became an object, which surfaced as `s.slice is not a function`
 *     at the input phase and as an unattributed "unexpected result shape" at
 *     the output phase.
 *
 * Both are now denials naming the middleware — the same shape `askPolicy:
 * 'refuse'` already gave the tool chain wherever no pause exists to carry an
 * ask.
 *
 * Seven patterns, in the house order:
 *   unit · boundary · scenario · property · security · refusal · integration
 */

import { describe, expect, it } from 'vitest';

import { Agent } from '../../src/index.js';
import { MessageDeniedError, allow, ask } from '../../src/core/agent/middleware/index.js';
import { runMessageChain } from '../../src/core/agent/middleware/runChain.js';
import type { MessageMiddleware } from '../../src/core/agent/middleware/types.js';
import { mock } from '../../src/llm-providers.js';

const chainOf = (mw: MessageMiddleware): readonly MessageMiddleware[] => [mw];

const walk = (
  mw: MessageMiddleware,
  phase: 'input' | 'output' = 'output',
): ReturnType<typeof runMessageChain> =>
  runMessageChain(chainOf(mw), { phase, content: 'the answer', history: [], iteration: 1 });

// ─── 1. UNIT — the chain itself ───────────────────────────────────

describe('message boundary — unit', () => {
  it('an ask becomes a denial that names the middleware and quotes the question', async () => {
    const verdict = await walk({
      name: 'approver',
      onMessage: () => ask({ question: 'may I release this?' }) as never,
    });
    expect(verdict.kind).toBe('deny');
    expect(verdict.middleware).toBe('approver');
    expect(verdict.reason).toMatch(/no pause at the message boundary to carry that ask/);
    expect(verdict.reason).toMatch(/may I release this\?/);
  });

  it('the ROW says deny — the ledger and the rule cannot disagree', async () => {
    const verdict = await walk({
      name: 'approver',
      onMessage: () => ask({ question: 'ok?' }) as never,
    });
    expect(verdict.decisions.map((d) => d.outcome)).toEqual(['deny']);
  });

  it('a non-text allow becomes a denial naming the shape it returned', async () => {
    const verdict = await walk({
      name: 'objectifier',
      onMessage: () => allow({ rewritten: true } as never, 'why'),
    });
    expect(verdict.kind).toBe('deny');
    expect(verdict.reason).toMatch(/returned allow\(an object\).*a message is text/s);
    expect(verdict.reason).toMatch(/allow\(someString, why\)/);
  });

  it('leaves every legitimate answer exactly as it was', async () => {
    expect((await walk({ name: 'pass', onMessage: () => allow() })).kind).toBe('allow');
    const rewritten = await walk({
      name: 'edit',
      onMessage: () => allow('a different answer', 'policy'),
    });
    expect(rewritten.kind).toBe('allow');
    expect((rewritten as { content: string }).content).toBe('a different answer');
    expect(rewritten.decisions[0]?.changed).toBe(true);
  });
});

// ─── 2. BOUNDARY — every non-text shape ───────────────────────────

describe('message boundary — boundary', () => {
  const shapes: ReadonlyArray<readonly [string, unknown, RegExp]> = [
    ['an object', { a: 1 }, /allow\(an object\)/],
    ['an array', ['a'], /allow\(an array\)/],
    ['a number', 7, /allow\(a number\)/],
    ['null', null, /allow\(null\)/],
    ['a boolean', true, /allow\(a boolean\)/],
  ];
  for (const [label, value, pattern] of shapes) {
    it(`refuses ${label}`, async () => {
      const verdict = await walk({ name: 'x', onMessage: () => allow(value as never, 'w') });
      expect(verdict.kind).toBe('deny');
      expect(verdict.reason).toMatch(pattern);
    });
  }

  it('the empty string is TEXT, and passes', async () => {
    // `allow(undefined)` means "unchanged"; `allow('')` means "make it empty",
    // and that is a decision a rule is allowed to make.
    const verdict = await walk({ name: 'blanker', onMessage: () => allow('', 'suppressed') });
    expect(verdict.kind).toBe('allow');
  });
});

// ─── 3. SCENARIO + 4. PROPERTY ────────────────────────────────────

describe('message boundary — scenario', () => {
  it('an ask at the OUTPUT phase surfaces as MessageDeniedError, not as an answer', async () => {
    const agent = Agent.create({ provider: mock({ reply: 'the secret answer' }), model: 'm' })
      .act({ output: [{ name: 'approver', onMessage: () => ask({ question: 'ok?' }) as never }] })
      .build();
    const err = await agent.run('hi').catch((e: unknown) => e as MessageDeniedError);
    expect(err).toBeInstanceOf(MessageDeniedError);
    expect(err.phase).toBe('output');
    expect(err.middleware).toBe('approver');
  });

  it('an ask at the INPUT phase stops the run before the model is called', async () => {
    let called = 0;
    const provider = {
      name: 'counter',
      complete: async () => {
        called += 1;
        return { content: 'x', toolCalls: [], usage: { inputTokens: 1, outputTokens: 1 } };
      },
    };
    const agent = Agent.create({ provider, model: 'm' })
      .act({ input: [{ name: 'gate', onMessage: () => ask({ question: 'ok?' }) as never }] })
      .build();
    await expect(agent.run('hi')).rejects.toBeInstanceOf(MessageDeniedError);
    expect(called).toBe(0);
  });
});

describe('message boundary — property', () => {
  it('for every malfunction, the chain stops at the first one and later links do not run', async () => {
    const ran: string[] = [];
    const chain: readonly MessageMiddleware[] = [
      { name: 'first', onMessage: () => (ran.push('first'), allow(9 as never, 'w')) },
      { name: 'second', onMessage: () => (ran.push('second'), allow()) },
    ];
    const verdict = await runMessageChain(chain, {
      phase: 'output',
      content: 'x',
      history: [],
      iteration: 1,
    });
    expect(verdict.kind).toBe('deny');
    expect(ran).toEqual(['first']);
  });
});

// ─── 5. SECURITY + 6. REFUSAL + 7. INTEGRATION ────────────────────

describe('message boundary — security', () => {
  it('the refusal names the shape, never the value the middleware returned', async () => {
    const verdict = await walk({
      name: 'leaky',
      onMessage: () => allow({ apiKey: 'sk-live-SECRET' } as never, 'w'),
    });
    expect(verdict.reason).not.toContain('sk-live');
    expect(verdict.reason).toContain('an object');
  });

  it('a denied output answer is never released to the caller', async () => {
    const agent = Agent.create({ provider: mock({ reply: 'the secret answer' }), model: 'm' })
      .act({
        output: [{ name: 'objectifier', onMessage: () => allow({ not: 'text' } as never, 'w') }],
      })
      .build();
    const err = await agent.run('hi').catch((e: unknown) => e as Error);
    expect(err).toBeInstanceOf(MessageDeniedError);
    expect(err.message).not.toContain('the secret answer');
  });
});

describe('message boundary — integration', () => {
  it('the tool chain still PAUSES on an ask — the boundary is what differs, not the verb', async () => {
    // The point of refusing at the message boundary is that no pause exists
    // there. Where one does, `ask` keeps working exactly as it did.
    const { defineTool, isPaused } = await import('../../src/index.js');
    const agent = Agent.create({
      provider: mock({
        replies: [{ toolCalls: [{ id: 'c0', name: 'act', args: {} }] }, { content: 'FINAL' }],
      }),
      model: 'm',
    })
      .tool(
        defineTool({
          name: 'act',
          description: 'does a thing',
          inputSchema: { type: 'object', properties: {} },
          execute: async () => 'done',
        }),
      )
      .act({ beforeTool: [{ name: 'gate', onToolCall: () => ask({ question: 'run it?' }) }] })
      .build();

    const out = await agent.run('go');
    expect(isPaused(out)).toBe(true);
  });
});
