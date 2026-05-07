/**
 * 12 — Strict output (v2.13): Instructor-style schema-retry on the
 * extended ReliabilityChecker primitives.
 *
 * v2.4 introduced outputSchema for terminal-answer validation at
 * agent.parseOutput() boundary. v2.13 wires it INTO the reliability
 * gate's retry loop so a failed schema validation can re-prompt the
 * model WITHIN the current turn (the Instructor pattern), without
 * burning a full ReAct loop iteration.
 *
 * Three new primitives:
 *
 *   1. ValidationFailure — sentinel error class to signal schema-fail
 *   2. defaultStuckLoopRule — drop-in PostDecide rule that fail-fasts
 *      after the model produces the same validation error twice
 *   3. lastNValidationErrorsMatch(scope, n) — helper for custom
 *      stuck-loop rules
 *
 * Three scenarios run:
 *
 *   1. HAPPY      — first response passes validation; no retry
 *   2. RETRY      — first fails, retry with feedback succeeds
 *   3. STUCK-LOOP — model keeps failing the same way; rule terminates
 *                   the run early via PolicyHaltError-like fail-fast
 *
 * Run:  npx tsx examples/features/12-strict-output.ts
 */

import { Agent } from '../../src/index.js';
import {
  defaultStuckLoopRule,
  ReliabilityFailFastError,
  type ReliabilityRule,
  type ReliabilityScope,
} from '../../src/reliability/index.js';
import type { LLMProvider, LLMResponse } from '../../src/adapters/types.js';
import { isCliEntry, type ExampleMeta } from '../helpers/cli.js';

export const meta: ExampleMeta = {
  id: 'features/12-strict-output',
  title: 'Strict output — Instructor-style schema-retry on the reliability gate',
  group: 'features',
  description:
    'v2.13 — outputSchema validation now runs INSIDE the reliability gate. When validation fails, postDecide rules can retry with feedbackForLLM (an ephemeral user message describing the validation error). New helpers: defaultStuckLoopRule fail-fasts after 2 identical errors. ValidationFailure sentinel. lastNValidationErrorsMatch helper. Demonstrates happy / retry-with-feedback / stuck-loop paths.',
  defaultInput: 'demo all three schema-retry paths',
  providerSlots: ['feature'],
  tags: ['feature', 'reliability', 'output-schema', 'instructor', 'retry'],
};

// ─── Fixtures ─────────────────────────────────────────────────────

// #region refund-parser
/** Toy parser — accepts JSON of shape `{action, amount}` with amount as
 *  a number. The first version of the model often emits amount as a
 *  string (`"USD 50"`); this parser rejects that. */
interface Refund {
  action: 'refund' | 'reject';
  amount: number;
}
const refundParser = {
  parse: (raw: unknown): Refund => {
    if (typeof raw !== 'object' || raw === null) {
      throw new Error('expected object');
    }
    const r = raw as { action?: unknown; amount?: unknown };
    if (r.action !== 'refund' && r.action !== 'reject') {
      throw new Error(`action must be 'refund' or 'reject' (got ${JSON.stringify(r.action)})`);
    }
    if (typeof r.amount !== 'number') {
      throw new Error(`amount must be a number (got ${JSON.stringify(r.amount)})`);
    }
    return { action: r.action, amount: r.amount };
  },
  description: 'Refund decision: { action: "refund" | "reject", amount: number }',
};
// #endregion refund-parser

// #region retry-rules
/** PostDecide rule template that retries on schema-fail with feedback,
 *  then fail-fasts after maxRetries. Stuck-loop rule goes BEFORE so
 *  it short-circuits before another wasted attempt. */
function strictOutputRules(maxRetries: number): ReliabilityRule[] {
  return [
    defaultStuckLoopRule, // fail-fast on 2 identical errors in a row
    {
      when: (s: ReliabilityScope) =>
        s.validationError !== undefined && s.attempt < maxRetries,
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
}
// #endregion retry-rules

/** Build a scripted LLM that returns the given content per call. */
function scriptedLLM(scripts: ReadonlyArray<string>): LLMProvider {
  let calls = 0;
  return {
    name: 'mock',
    complete: async (): Promise<LLMResponse> => {
      const content = scripts[Math.min(calls, scripts.length - 1)]!;
      calls += 1;
      return {
        content,
        toolCalls: [],
        usage: { input: 1, output: 1 },
        stopReason: 'end_turn',
      };
    },
  };
}

// ─── Scenario 1 — happy path ─────────────────────────────────────

async function scenarioHappy(): Promise<void> {
  console.log('\n[1] happy path — first response passes validation');
  const llm = scriptedLLM(['{"action":"refund","amount":50}']);
  const agent = Agent.create({ provider: llm, model: 'mock' })
    .system('You decide refund requests. Output JSON.')
    .outputSchema(refundParser)
    .reliability({ postDecide: strictOutputRules(3) })
    .build();
  const result = await agent.runTyped<Refund>({ message: 'refund order #42 for $50' });
  console.log(`    ✓ parsed: action=${result.action} amount=${result.amount}`);
}

// ─── Scenario 2 — retry succeeds ─────────────────────────────────

async function scenarioRetry(): Promise<void> {
  console.log('\n[2] retry path — first fails (amount as string), retry succeeds');
  const llm = scriptedLLM([
    '{"action":"refund","amount":"USD 50"}', // ← amount is a STRING — fails
    '{"action":"refund","amount":50}', // ← amount is a NUMBER — passes
  ]);
  const events: string[] = [];
  const agent = Agent.create({ provider: llm, model: 'mock' })
    .system('You decide refund requests. Output JSON.')
    .outputSchema(refundParser)
    .reliability({ postDecide: strictOutputRules(3) })
    .build();
  agent.on('agentfootprint.agent.output_schema_validation_failed', (e) => {
    events.push(
      `  validation_failed: attempt=${e.payload.attempt} message="${e.payload.message}"`,
    );
  });
  const result = await agent.runTyped<Refund>({ message: 'refund order #42 for $50' });
  events.forEach((e) => console.log(e));
  console.log(`    ✓ parsed after retry: action=${result.action} amount=${result.amount}`);
}

// ─── Scenario 3 — stuck-loop terminates early ────────────────────

async function scenarioStuckLoop(): Promise<void> {
  console.log('\n[3] stuck-loop — model keeps failing the same way → fail-fast early');
  // Same bad response 4 times. With defaultStuckLoopRule the run halts
  // after the SECOND identical failure, NOT after exhausting maxRetries=5.
  const llm = scriptedLLM([
    '{"action":"refund","amount":"USD 50"}',
    '{"action":"refund","amount":"USD 50"}',
    '{"action":"refund","amount":"USD 50"}',
    '{"action":"refund","amount":"USD 50"}',
  ]);
  let validationFailures = 0;
  const agent = Agent.create({ provider: llm, model: 'mock' })
    .system('You decide refund requests. Output JSON.')
    .outputSchema(refundParser)
    .reliability({ postDecide: strictOutputRules(5) })
    .build();
  agent.on('agentfootprint.agent.output_schema_validation_failed', () => {
    validationFailures += 1;
  });
  try {
    await agent.runTyped<Refund>({ message: 'refund order #42 for $50' });
  } catch (e) {
    if (e instanceof ReliabilityFailFastError) {
      console.log(`    ✓ caught: kind='${e.kind}' reason='${e.reason}'`);
      console.log(`      validation failures emitted: ${validationFailures}`);
      console.log(
        `      → maxRetries was 5, but stuck-loop rule fired after 2 identical errors`,
      );
    } else {
      throw e;
    }
  }
}

// ─── Driver ──────────────────────────────────────────────────────

async function main(): Promise<void> {
  await scenarioHappy();
  await scenarioRetry();
  await scenarioStuckLoop();
  console.log('\nAll three scenarios complete.');
}

// Browser-safe auto-run guard (see helpers/cli.ts).
if (isCliEntry(import.meta.url)) {
  main().catch((e) => {
    console.error(e);
    process.exit(1);
  });
}
