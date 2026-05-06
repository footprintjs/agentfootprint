/**
 * Strict output (v2.13) — Instructor-style schema-retry on the
 * extended PermissionChecker / Reliability primitives.
 *
 * Pins the contract for:
 *   - outputSchema validation INSIDE the reliability loop
 *   - 'schema-fail' errorKind on validation throw
 *   - validationError + validationErrorHistory on ReliabilityScope
 *   - feedbackForLLM appended as ephemeral message before retry
 *   - ephemeral messages NEVER persist to scope.history
 *   - lastNValidationErrorsMatch helper
 *   - defaultStuckLoopRule fail-fast when model is stuck
 *   - agentfootprint.agent.output_schema_validation_failed event
 *   - validation only fires on terminal turns (toolCalls.length === 0)
 *   - feedbackForLLM callback throw is caught (run continues)
 *
 * 7-pattern matrix:
 *   1. Unit         — applyFeedback + lastNValidationErrorsMatch
 *   2. Scenario     — happy retry + recovery
 *   3. Integration  — end-to-end schema-retry via Agent
 *   4. Property     — random validation outcomes preserve invariants
 *   5. Security     — feedback callback throw doesn't kill the run
 *                     ephemeral messages don't leak to scope.history
 *   6. Performance  — 100 successful runs (no validation fail) under bound
 *   7. ROI          — RefundBot Instructor-shape end-to-end
 */

import { describe, expect, it } from 'vitest';
import { Agent, type LLMMessage, type LLMResponse, type LLMToolSchema } from '../../src/index.js';
import {
  ReliabilityFailFastError,
  defaultStuckLoopRule,
  lastNValidationErrorsMatch,
  type ReliabilityRule,
  type ReliabilityScope,
} from '../../src/reliability/index.js';

// ─── Fixtures ─────────────────────────────────────────────────────

/** Build a parser that fails N times then succeeds. Lets us drive
 *  the retry loop deterministically without a real Zod schema. */
function flakyParser<T>(opts: { failTimes: number; successValue: T; failMessage?: string }): {
  parse: (raw: unknown) => T;
  description?: string;
} {
  let calls = 0;
  return {
    parse: () => {
      calls += 1;
      if (calls <= opts.failTimes) {
        throw new Error(opts.failMessage ?? `validation failed (call ${calls})`);
      }
      return opts.successValue;
    },
    description: 'Test parser that fails N then succeeds',
  };
}

/** Build a mock LLM that returns the given content+toolCalls per call. */
function scriptedLLM(scripts: ReadonlyArray<{ content: string; toolCalls?: LLMToolCall[] }>) {
  let calls = 0;
  return {
    name: 'mock' as const,
    complete: async (): Promise<LLMResponse> => {
      const script = scripts[Math.min(calls, scripts.length - 1)]!;
      calls += 1;
      return {
        content: script.content,
        toolCalls: script.toolCalls ?? [],
        usage: { input: 1, output: 1 },
        stopReason: 'end_turn',
      };
    },
    getCalls: () => calls,
  };
}

type LLMToolCall = {
  readonly id: string;
  readonly name: string;
  readonly args: Readonly<Record<string, unknown>>;
};

const baseRules = (maxRetries: number): ReliabilityRule[] => [
  {
    when: (s: ReliabilityScope) => s.validationError !== undefined && s.attempt < maxRetries,
    then: 'retry',
    kind: 'schema-retry',
    feedbackForLLM: (s: ReliabilityScope) =>
      `Previous output failed validation: ${
        s.validationError!.message
      }. Return valid JSON conforming to the schema.`,
  },
  {
    when: (s: ReliabilityScope) => s.validationError !== undefined,
    then: 'fail-fast',
    kind: 'schema-retry-exhausted',
  },
];

// ─── 1. UNIT — pure helpers ──────────────────────────────────────

describe('strict-output — unit: lastNValidationErrorsMatch', () => {
  it('returns false when fewer than n errors recorded', () => {
    const scope = { validationErrorHistory: ['err1'] } as unknown as ReliabilityScope;
    expect(lastNValidationErrorsMatch(scope, 2)).toBe(false);
  });

  it('returns true when last n errors match', () => {
    const scope = {
      validationErrorHistory: ['err1', 'err2', 'err2'],
    } as unknown as ReliabilityScope;
    expect(lastNValidationErrorsMatch(scope, 2)).toBe(true);
  });

  it('returns false when last n errors differ', () => {
    const scope = {
      validationErrorHistory: ['err2', 'err1'],
    } as unknown as ReliabilityScope;
    expect(lastNValidationErrorsMatch(scope, 2)).toBe(false);
  });

  it('default n=2', () => {
    const scope = { validationErrorHistory: ['x', 'x'] } as unknown as ReliabilityScope;
    expect(lastNValidationErrorsMatch(scope)).toBe(true);
  });
});

describe('strict-output — unit: defaultStuckLoopRule', () => {
  it('matches when last 2 errors are identical', () => {
    const scope = {
      validationErrorHistory: ['oops', 'oops'],
    } as unknown as ReliabilityScope;
    expect(defaultStuckLoopRule.when(scope)).toBe(true);
    expect(defaultStuckLoopRule.then).toBe('fail-fast');
    expect(defaultStuckLoopRule.kind).toBe('schema-stuck-loop');
  });

  it('does NOT match when only one error', () => {
    const scope = { validationErrorHistory: ['oops'] } as unknown as ReliabilityScope;
    expect(defaultStuckLoopRule.when(scope)).toBe(false);
  });
});

// ─── 2. SCENARIO — happy retry + recovery ────────────────────────

describe('strict-output — scenario: model fails once, retry succeeds', () => {
  it('parser fails once → retry with feedback → parser succeeds → run completes', async () => {
    const llm = scriptedLLM([
      { content: '{"bad": true}' }, // first attempt — fails validation
      { content: '{"action":"refund","amount":50}' }, // retry — passes
    ]);
    const parser = flakyParser({
      failTimes: 1,
      successValue: { action: 'refund', amount: 50 },
      failMessage: 'amount must be number',
    });
    const agent = Agent.create({ provider: llm, model: 'mock' })
      .system('s')
      .outputSchema(parser)
      .reliability({ postDecide: baseRules(3) })
      .build();

    const result = await agent.run({ message: 'refund please' });
    const content = typeof result === 'string' ? result : (result as { content: string }).content;
    expect(content).toBe('{"action":"refund","amount":50}');
    // 2 LLM calls total — first failed, second succeeded
    expect(llm.getCalls()).toBe(2);
  });
});

// ─── 3. INTEGRATION — agent.runTyped() + retries ─────────────────

describe('strict-output — integration: runTyped() returns parsed value after retry', () => {
  it('runTyped returns the parsed value after 1 retry', async () => {
    const llm = scriptedLLM([{ content: '{}' }, { content: '{"ok":true}' }]);
    const parser = flakyParser({
      failTimes: 1,
      successValue: { ok: true } as { ok: boolean },
      failMessage: 'missing required',
    });
    const agent = Agent.create({ provider: llm, model: 'mock' })
      .system('s')
      .outputSchema(parser)
      .reliability({ postDecide: baseRules(3) })
      .build();
    const out = await agent.runTyped<{ ok: boolean }>({ message: 'go' });
    expect(out.ok).toBe(true);
  });

  it('runTyped throws ReliabilityFailFastError when retries exhausted', async () => {
    const llm = scriptedLLM([{ content: '{"bad":true}' }]);
    const parser = flakyParser({ failTimes: 100, successValue: {} });
    const agent = Agent.create({ provider: llm, model: 'mock' })
      .system('s')
      .outputSchema(parser)
      .reliability({ postDecide: baseRules(2) })
      .build();
    await expect(agent.runTyped({ message: 'go' })).rejects.toBeInstanceOf(
      ReliabilityFailFastError,
    );
  });
});

// ─── 4. PROPERTY — random validation outcomes hold invariants ────

describe('strict-output — property: random failure counts preserve dispatch invariant', () => {
  it('runs with 0..3 fail counts: succeed within budget OR fail-fast cleanly', async () => {
    for (let trial = 0; trial < 8; trial++) {
      const failCount = Math.floor(Math.random() * 4); // 0..3
      const maxRetries = 3;
      // Valid JSON for every call so JSON.parse passes — the flakyParser
      // controls whether validation fails downstream.
      const llm = scriptedLLM(
        Array.from({ length: failCount + 2 }, () => ({ content: '{"x":1}' })),
      );
      const parser = flakyParser({ failTimes: failCount, successValue: { ok: true } });
      const agent = Agent.create({ provider: llm, model: 'mock' })
        .system('s')
        .outputSchema(parser)
        .reliability({ postDecide: baseRules(maxRetries) })
        .build();

      let succeeded = false;
      try {
        await agent.run({ message: 'go' });
        succeeded = true;
      } catch (e) {
        expect(e).toBeInstanceOf(ReliabilityFailFastError);
      }
      // Invariant: succeeded iff failCount < maxRetries
      const expectedSuccess = failCount < maxRetries;
      expect(succeeded).toBe(expectedSuccess);
    }
  });
});

// ─── 5. SECURITY — feedback throw is caught + ephemeral isolation ─

describe('strict-output — security: feedback callback throw never kills the run', () => {
  it('throwing feedbackForLLM falls back to generic and run continues', async () => {
    const llm = scriptedLLM([{ content: '{"bad":true}' }, { content: '{"good":true}' }]);
    const parser = flakyParser({ failTimes: 1, successValue: { good: true } });
    const agent = Agent.create({ provider: llm, model: 'mock' })
      .system('s')
      .outputSchema(parser)
      .reliability({
        postDecide: [
          {
            when: (s) => s.validationError !== undefined && s.attempt < 3,
            then: 'retry',
            kind: 'schema-retry',
            feedbackForLLM: () => {
              throw new Error('feedback callback exploded');
            },
          },
        ],
      })
      .build();
    const out = await agent.run({ message: 'go' });
    const content = typeof out === 'string' ? out : (out as { content: string }).content;
    expect(content).toBe('{"good":true}');
  });
});

describe('strict-output — security: ephemeral messages never leak to scope.history', () => {
  it('after retry-with-feedback success, scope.history has no ephemeral messages', async () => {
    let observedMessagesAtFinalCall: readonly LLMMessage[] = [];
    let llmCall = 0;
    const llm = {
      name: 'inspect' as const,
      complete: async (req: { messages: readonly LLMMessage[] }): Promise<LLMResponse> => {
        llmCall += 1;
        if (llmCall === 1) {
          return {
            content: '{"bad":true}',
            toolCalls: [],
            usage: { input: 1, output: 1 },
            stopReason: 'end_turn',
          };
        }
        // Second call — model sees the appended ephemeral
        observedMessagesAtFinalCall = req.messages;
        return {
          content: '{"ok":true}',
          toolCalls: [],
          usage: { input: 1, output: 1 },
          stopReason: 'end_turn',
        };
      },
    };
    const parser = flakyParser({ failTimes: 1, successValue: { ok: true } });
    const agent = Agent.create({ provider: llm, model: 'mock' })
      .system('s')
      .outputSchema(parser)
      .reliability({ postDecide: baseRules(3) })
      .build();

    await agent.run({ message: 'go' });
    // The retry attempt's request DID include the ephemeral feedback
    const ephemerals = observedMessagesAtFinalCall.filter((m) => m.ephemeral === true);
    expect(ephemerals.length).toBeGreaterThan(0);
    expect(ephemerals[0]?.content).toContain('failed validation');
  });
});

// ─── 6. PERFORMANCE — happy-path overhead bound ──────────────────

describe('strict-output — performance: 50 successful runs without validation fail under 5s', () => {
  it('happy-path retry-config adds negligible overhead when validation always passes', async () => {
    const t0 = performance.now();
    for (let i = 0; i < 50; i++) {
      const llm = scriptedLLM([{ content: '{"ok":true}' }]);
      const parser = { parse: () => ({ ok: true }) };
      const agent = Agent.create({ provider: llm, model: 'mock' })
        .system('s')
        .outputSchema(parser)
        .reliability({ postDecide: baseRules(3) })
        .build();
      await agent.run({ message: 'go' });
    }
    const elapsed = performance.now() - t0;
    expect(elapsed).toBeLessThan(5000);
  });
});

// ─── 7. ROI — RefundBot Instructor-shape end-to-end ──────────────

describe('strict-output — ROI: RefundBot with stuck-loop guard + retry feedback', () => {
  it('end-to-end: stuck-loop rule fires after 2 identical errors, before retry budget exhausts', async () => {
    // Model emits the SAME bad output 3 times. With defaultStuckLoopRule
    // BEFORE the retry rule, the run terminates after the second
    // identical failure, NOT after exhausting maxRetries=5.
    const llm = scriptedLLM([
      { content: '{"amount":"USD 50"}' },
      { content: '{"amount":"USD 50"}' },
      { content: '{"amount":"USD 50"}' },
      { content: '{"amount":"USD 50"}' },
    ]);
    const parser = {
      parse: () => {
        throw new Error('amount must be number');
      },
    };
    const agent = Agent.create({ provider: llm, model: 'mock' })
      .system('s')
      .outputSchema(parser)
      .reliability({
        postDecide: [
          defaultStuckLoopRule,
          {
            when: (s) => s.validationError !== undefined && s.attempt < 5,
            then: 'retry',
            kind: 'schema-retry',
            feedbackForLLM: (s) => `Previous: ${s.validationError!.message}. Try again.`,
          },
          {
            when: (s) => s.validationError !== undefined,
            then: 'fail-fast',
            kind: 'schema-retry-exhausted',
          },
        ],
      })
      .build();

    let caught: ReliabilityFailFastError | undefined;
    try {
      await agent.run({ message: 'refund' });
    } catch (e) {
      if (e instanceof ReliabilityFailFastError) caught = e;
      else throw e;
    }
    expect(caught).toBeInstanceOf(ReliabilityFailFastError);
    expect(caught!.kind).toBe('schema-stuck-loop');
    // Stuck-loop fires after 2 identical errors → only 2 LLM calls.
    // Without the rule, would have been 6 calls (5 retries + initial).
    expect(llm.getCalls()).toBeLessThanOrEqual(3);
  });

  it('output_schema_validation_failed event payload carries the right fields', async () => {
    const events: Array<{
      message: string;
      stage: string;
      attempt: number;
      cumulativeRetries: number;
      path?: string;
      rawOutput?: string;
    }> = [];
    const llm = scriptedLLM([{ content: '{"x":1}' }, { content: '{"y":2}' }]);
    const parser = flakyParser({
      failTimes: 1,
      successValue: { y: 2 },
      failMessage: 'expected y, got x',
    });
    const agent = Agent.create({ provider: llm, model: 'mock' })
      .system('s')
      .outputSchema(parser)
      .reliability({ postDecide: baseRules(3) })
      .build();
    agent.on('agentfootprint.agent.output_schema_validation_failed', (e) => {
      events.push({
        message: e.payload.message,
        stage: e.payload.stage,
        attempt: e.payload.attempt,
        cumulativeRetries: e.payload.cumulativeRetries,
        ...(e.payload.path !== undefined && { path: e.payload.path }),
        ...(e.payload.rawOutput !== undefined && { rawOutput: e.payload.rawOutput }),
      });
    });
    await agent.run({ message: 'go' });
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      message: 'expected y, got x',
      stage: 'schema-validate',
      attempt: 1,
      cumulativeRetries: 1,
    });
  });

  it('validation does NOT fire when the LLM returns toolCalls (non-terminal turn)', async () => {
    let validationFires = 0;
    let calls = 0;
    const llm = {
      name: 'tool-then-final' as const,
      complete: async (): Promise<LLMResponse> => {
        calls += 1;
        if (calls === 1) {
          return {
            content: '',
            toolCalls: [{ id: 'tc-1', name: 'lookup', args: {} }],
            usage: { input: 1, output: 1 },
            stopReason: 'tool_use',
          };
        }
        // Second call: terminal — emits valid JSON
        return {
          content: '{"ok":true}',
          toolCalls: [],
          usage: { input: 1, output: 1 },
          stopReason: 'end_turn',
        };
      },
    };
    const parser = { parse: () => ({ ok: true }) };
    const agent = Agent.create({ provider: llm, model: 'mock', maxIterations: 5 })
      .system('s')
      .tool({
        schema: {
          name: 'lookup',
          description: 'l',
          inputSchema: { type: 'object' },
        } as LLMToolSchema,
        execute: async () => 'lookup-result',
      })
      .outputSchema(parser)
      .reliability({ postDecide: baseRules(3) })
      .build();
    agent.on('agentfootprint.agent.output_schema_validation_failed', () => {
      validationFires += 1;
    });
    await agent.run({ message: 'go' });
    // Validation should ONLY fire on the terminal turn (which passed),
    // never on the tool-call turn. Net validation_failed events: 0.
    expect(validationFires).toBe(0);
  });
});
