/**
 * Output contracts are LOUD (8.18.0).
 *
 * `.outputSchema(parser)` declares that this agent's final answer has a shape.
 * Through 8.17.0, a run that broke that promise said so in exactly one place:
 * `runTyped()` threw. Every other consumer — `run()`, which is what a server
 * route, a queue worker and `standingAgent` call — received the
 * contract-violating string with no event, no warning, and (under the default
 * `retries: 0`) not even a ledger row. The record could not show that a
 * contract had been declared, let alone missed.
 *
 * Five findings from the act/window audit, one mechanism:
 *
 *   #9   exhausted retries + `run()`      → silent
 *   #26  the DEFAULT options              → judged nothing at all
 *   #10  `.outputFallback()` + `run()`    → tiers unreachable, unsaid
 *   #16  `canned` + retries               → runTyped cannot throw; spend unsaid
 *   #17  an `act({ output })` rewrite     → burned every retry on its own damage
 *
 * What did NOT change: `run()` still returns the raw answer (a string is what
 * it promises, and substituting one would be the silent switch this library
 * refuses everywhere else), and `runTyped()` still throws `OutputSchemaError`.
 *
 * Seven patterns, in the house order:
 *   unit · boundary · scenario · property · security · refusal · integration
 */

import { afterEach, describe, expect, it, vi } from 'vitest';

import { Agent, OutputSchemaError } from '../../src/index.js';
import { MessageDeniedError, allow, deny } from '../../src/core/agent/middleware/index.js';
import { mock } from '../../src/llm-providers.js';
import type { AgentState } from '../../src/core/agent/types.js';

afterEach(() => {
  vi.restoreAllMocks();
});

interface Answer {
  readonly answer: string;
}

const parser = {
  parse: (v: unknown): Answer => {
    const o = v as Answer | null;
    if (!o || typeof o.answer !== 'string') throw new Error('needs an `answer` string');
    return o;
  },
};

const GOOD = JSON.stringify({ answer: 'yes' });
const BAD = 'not json at all';

/** Silence + capture the console warning the unmet contract writes. */
function captureWarn(): { lines: () => string[] } {
  const spy = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
  return { lines: (): string[] => spy.mock.calls.map((c) => String(c[0])) };
}

function unmetOf(agent: Agent): AgentState['outputContractUnmet'] {
  return agent.outputContractUnmet();
}

// ─── 1. UNIT — #26, the default judges ────────────────────────────

describe('output contract — unit (the default judges)', () => {
  it('files a row, a fact and an event with NO options passed', async () => {
    captureWarn();
    const agent = Agent.create({ provider: mock({ reply: BAD }), model: 'm' })
      .outputSchema(parser)
      .build();
    const seen: Record<string, unknown>[] = [];
    agent.on('agentfootprint.agent.output_contract_unmet', (e) =>
      seen.push(e.payload as unknown as Record<string, unknown>),
    );

    expect(await agent.run('hi')).toBe(BAD);

    expect(seen).toHaveLength(1);
    expect(seen[0]?.['stage']).toBe('json-parse');
    expect(seen[0]?.['attempts']).toBe(1);
    expect(seen[0]?.['retriesSpent']).toBe(0);
    expect(seen[0]?.['fallbackConfigured']).toBe(false);
    expect(unmetOf(agent)?.error).toMatch(/JSON/i);
  });

  it('says nothing at all when the answer passes', async () => {
    const warn = captureWarn();
    const agent = Agent.create({ provider: mock({ reply: GOOD }), model: 'm' })
      .outputSchema(parser)
      .build();
    let fired = 0;
    agent.on('agentfootprint.agent.output_contract_unmet', () => (fired += 1));

    expect(await agent.runTyped<Answer>('hi')).toEqual({ answer: 'yes' });
    expect(fired).toBe(0);
    expect(unmetOf(agent)).toBeUndefined();
    expect(warn.lines()).toHaveLength(0);
  });

  it('an agent with no outputSchema is untouched — no key, no accessor value', async () => {
    const agent = Agent.create({ provider: mock({ reply: BAD }), model: 'm' }).build();
    await agent.run('hi');
    const state = agent.getLastSnapshot()?.sharedState as Record<string, unknown>;
    expect('outputContractUnmet' in state).toBe(false);
    expect(unmetOf(agent)).toBeUndefined();
  });

  it('costs no extra LLM call — judging is not asking', async () => {
    captureWarn();
    let calls = 0;
    const provider = {
      name: 'counter',
      complete: async () => {
        calls += 1;
        return { content: BAD, toolCalls: [], usage: { inputTokens: 1, outputTokens: 1 } };
      },
    };
    const agent = Agent.create({ provider, model: 'm' }).outputSchema(parser).build();
    await agent.run('hi');
    expect(calls).toBe(1);
  });
});

// ─── 2. BOUNDARY — #9, the exhausted ledger ───────────────────────

describe('output contract — boundary (retries exhausted)', () => {
  it('reports what was spent, and run() still hands back the raw answer', async () => {
    const warn = captureWarn();
    const agent = Agent.create({ provider: mock({ reply: BAD }), model: 'm' })
      .outputSchema(parser, { retries: 2 })
      .maxIterations(8)
      .build();

    expect(await agent.run('hi')).toBe(BAD);
    const unmet = unmetOf(agent);
    expect(unmet?.attempts).toBe(3);
    expect(unmet?.retriesSpent).toBe(2);
    expect(warn.lines()[0]).toMatch(/after 2 corrective re-ask\(s\) that were billed/);
  });

  it('runTyped still throws OutputSchemaError on the same run', async () => {
    captureWarn();
    const agent = Agent.create({ provider: mock({ reply: BAD }), model: 'm' })
      .outputSchema(parser, { retries: 1 })
      .maxIterations(6)
      .build();
    await expect(agent.runTyped('hi')).rejects.toBeInstanceOf(OutputSchemaError);
  });
});

// ─── 3. SCENARIO — #17, the rule that broke its own answer ────────

describe('output contract — scenario (an output rule broke a passing answer)', () => {
  const breaker = {
    name: 'redactor',
    onMessage: (msg: { phase: string }) =>
      msg.phase === 'output' ? allow('REDACTED — not json', 'policy') : allow(),
  };

  it('does not re-ask, and names the rule in row, fact, event and warning', async () => {
    const warn = captureWarn();
    const agent = Agent.create({ provider: mock({ reply: GOOD }), model: 'm' })
      .outputSchema(parser, { retries: 3 })
      .act({ output: [breaker] })
      .maxIterations(9)
      .build();
    const events: Record<string, unknown>[] = [];
    agent.on('agentfootprint.agent.output_contract_unmet', (e) =>
      events.push(e.payload as unknown as Record<string, unknown>),
    );

    await agent.run('hi');

    const state = agent.getLastSnapshot()?.sharedState as Partial<AgentState>;
    // ONE attempt. The model answered correctly the first time; three billed
    // re-asks would have produced three more correct answers for the rule to
    // break identically.
    expect(state.outputAttempts?.map((r) => r.outcome)).toEqual(['exhausted']);
    expect(state.outputAttempts?.[0]?.brokenBy).toBe('redactor');
    expect(unmetOf(agent)?.brokenBy).toBe('redactor');
    expect(events[0]?.['brokenBy']).toBe('redactor');
    expect(warn.lines()[0]).toMatch(/The model's own answer PASSED/);
  });

  it('a rewrite that keeps the shape is not blamed for anything', async () => {
    const rewriter = {
      name: 'tidy',
      onMessage: (msg: { phase: string }) =>
        msg.phase === 'output' ? allow(JSON.stringify({ answer: 'YES' }), 'upper') : allow(),
    };
    const agent = Agent.create({ provider: mock({ reply: GOOD }), model: 'm' })
      .outputSchema(parser, { retries: 1 })
      .act({ output: [rewriter] })
      .build();
    expect(await agent.runTyped<Answer>('hi')).toEqual({ answer: 'YES' });
    expect(unmetOf(agent)).toBeUndefined();
  });

  it('a model answer that was ALREADY bad still spends its retries', async () => {
    // The stop only applies when the middleware is the cause. A chain that
    // merely watched a bad answer go by must not buy it an exemption.
    captureWarn();
    const watcher = {
      name: 'observer',
      onMessage: () => allow(),
    };
    const agent = Agent.create({ provider: mock({ reply: BAD }), model: 'm' })
      .outputSchema(parser, { retries: 1 })
      .act({ output: [watcher] })
      .maxIterations(6)
      .build();
    await agent.run('hi');
    const state = agent.getLastSnapshot()?.sharedState as Partial<AgentState>;
    expect(state.outputAttempts?.map((r) => r.outcome)).toEqual(['retried', 'exhausted']);
    expect(unmetOf(agent)?.brokenBy).toBeUndefined();
  });
});

// ─── 4. PROPERTY ──────────────────────────────────────────────────

describe('output contract — property', () => {
  it('attempts === retriesSpent + 1, on every failing run', async () => {
    captureWarn();
    for (const retries of [0, 1, 2]) {
      const agent = Agent.create({ provider: mock({ reply: BAD }), model: 'm' })
        .outputSchema(parser, { retries })
        .maxIterations(10)
        .build();
      await agent.run('hi');
      const unmet = unmetOf(agent);
      expect(unmet?.attempts).toBe(unmet!.retriesSpent + 1);
      expect(unmet?.retriesSpent).toBe(retries);
    }
  });
});

// ─── 5. SECURITY — the answer never travels in the signal ─────────

describe('output contract — security', () => {
  it('neither the event nor the warning carries the answer itself', async () => {
    const warn = captureWarn();
    const secret = 'PATIENT 4471 — NOT JSON';
    const agent = Agent.create({ provider: mock({ reply: secret }), model: 'm' })
      .outputSchema(parser)
      .build();
    const events: Record<string, unknown>[] = [];
    agent.on('agentfootprint.agent.output_contract_unmet', (e) =>
      events.push(e.payload as unknown as Record<string, unknown>),
    );
    await agent.run('hi');

    // The validator's own message may quote what it parsed — that is the
    // validator's text, not ours — but the library adds no copy of its own.
    expect(JSON.stringify(events[0]?.['stage'])).not.toContain('PATIENT');
    expect(warn.lines().join(' ')).not.toContain('PATIENT 4471 — NOT JSON');
  });
});

// ─── 6. REFUSAL — #25, the two terminal error classes ─────────────

describe('output contract — refusal (a denied answer is not a schema failure)', () => {
  it('a denied output raises MessageDeniedError, and is never judged or re-asked', async () => {
    const agent = Agent.create({ provider: mock({ reply: GOOD }), model: 'm' })
      .outputSchema(parser, { retries: 2 })
      .act({
        output: [
          {
            name: 'blocker',
            onMessage: (m: { phase: string }) =>
              m.phase === 'output' ? deny('withheld') : allow(),
          },
        ],
      })
      .build();

    const err = await agent.runTyped('hi').catch((e: unknown) => e as Error);
    expect(err).toBeInstanceOf(MessageDeniedError);
    expect(err).not.toBeInstanceOf(OutputSchemaError);
    // Withheld on purpose: no contract verdict is filed about a string nobody
    // is allowed to see.
    expect(unmetOf(agent)).toBeUndefined();
  });
});

// ─── 7. INTEGRATION — #10 and #16, the fallback tiers ─────────────

describe('output contract — integration (outputFallback visibility)', () => {
  it('#10 — run() gets no tier, and the warning says which door does', async () => {
    const warn = captureWarn();
    const agent = Agent.create({ provider: mock({ reply: BAD }), model: 'm' })
      .outputSchema(parser)
      .outputFallback({ fallback: () => ({ answer: 'from-fallback' }) })
      .build();
    const events: Record<string, unknown>[] = [];
    agent.on('agentfootprint.agent.output_contract_unmet', (e) =>
      events.push(e.payload as unknown as Record<string, unknown>),
    );

    // Same agent, same failing answer, two doors.
    expect(await agent.run('hi')).toBe(BAD);
    expect(events[0]?.['fallbackConfigured']).toBe(true);
    expect(warn.lines()[0]).toMatch(/run\(\) does not reach them/);

    expect(await agent.runTyped<Answer>('hi')).toEqual({ answer: 'from-fallback' });
  });

  it('#16 — canned after billed re-asks is warned about, and carries the spend', async () => {
    const warn = captureWarn();
    const agent = Agent.create({ provider: mock({ reply: BAD }), model: 'm' })
      .outputSchema(parser, { retries: 2 })
      .outputFallback({
        fallback: () => {
          throw new Error('fallback failed too');
        },
        canned: { answer: 'canned' },
      })
      .maxIterations(9)
      .build();
    const canned: Record<string, unknown>[] = [];
    agent.on('agentfootprint.resilience.output_canned_used', (e) =>
      canned.push(e.payload as unknown as Record<string, unknown>),
    );

    // Structurally unable to throw — which is exactly why it must speak.
    expect(await agent.runTyped<Answer>('hi')).toEqual({ answer: 'canned' });
    expect(canned[0]?.['retriesSpent']).toBe(2);
    expect(
      warn.lines().some((l) => /canned outputFallback value was returned after 2/.test(l)),
    ).toBe(true);
  });

  it('#16 — a canned value on the FIRST attempt is not warned about', async () => {
    const warn = captureWarn();
    const agent = Agent.create({ provider: mock({ reply: BAD }), model: 'm' })
      .outputSchema(parser)
      .outputFallback({
        fallback: () => {
          throw new Error('nope');
        },
        canned: { answer: 'canned' },
      })
      .build();
    await agent.runTyped<Answer>('hi');
    expect(warn.lines().some((l) => /canned outputFallback value was returned after/.test(l))).toBe(
      false,
    );
  });
});
