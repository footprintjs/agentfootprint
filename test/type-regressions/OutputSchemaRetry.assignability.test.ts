/**
 * Compile-level regression test — 7.26's output-boundary surface.
 *
 * Three things the compiler has to keep true, and that a runtime test cannot
 * see:
 *
 *   1. `.outputSchema(parser, opts)` still narrows `runTyped<T>()`. The
 *      options bag grew three fields; if any of them widened the generic's
 *      inference path, every consumer would silently go back to `unknown`
 *      and reach for `as MyType` again — the exact thing the contract exists
 *      to remove.
 *   2. `OutputAttempt['outcome']` is a CLOSED union. It is committed state a
 *      consumer branches on, so an exhaustive switch must stay exhaustive:
 *      adding a fourth outcome should break this file, not somebody's app.
 *   3. `route_decided.chosen` carries `'output-retry'` in the map's payload
 *      as well as in the standalone payload type. The event and its map entry
 *      are two declarations of one fact, and a consumer reads the map.
 *
 * Lives under its own tsconfig (./tsconfig.json, `npm run test:types`) so the
 * real compiler checks the assignments, while the filename still matches
 * `test/**\/*.test.ts` so `npm test` runs the assertions too.
 */
import { describe, expect, it } from 'vitest';
import { Agent, type OutputAttempt, type OutputSchemaParser } from '../../src/index';
import { mock } from '../../src/llm-providers';
import type { AgentfootprintEventMap, Payloads } from '../../src/events';

interface Refund {
  amount: number;
  reason: string;
}

const parser: OutputSchemaParser<Refund> = {
  parse: (v: unknown): Refund => v as Refund,
};

describe('outputSchema options — the generic still flows (7.26)', () => {
  it('narrows runTyped<T>() with every combination of the options bag', async () => {
    const plain = Agent.create({ provider: mock({ reply: '{}' }), model: 'mock' })
      .outputSchema(parser)
      .build();
    const withRetries = Agent.create({ provider: mock({ reply: '{}' }), model: 'mock' })
      .outputSchema(parser, { retries: 2 })
      .build();
    const forced = Agent.create({ provider: mock({ reply: '{}' }), model: 'mock' })
      .outputSchema(parser, {
        strategy: 'tool-forced',
        retries: 1,
        jsonSchema: { type: 'object' },
      })
      .build();

    // The assertion IS the assignment: `Promise<Refund>` on every path.
    const a: Promise<Refund> = plain.runTyped<Refund>({ message: 'x' });
    const b: Promise<Refund> = withRetries.runTyped<Refund>({ message: 'x' });
    const c: Promise<Refund> = forced.runTyped<Refund>({ message: 'x' });
    await Promise.allSettled([a, b, c]);
    expect(typeof plain.runTyped).toBe('function');
  });

  it('refuses an unknown strategy at compile time', () => {
    const bad = { strategy: 'coax-it-nicely' } as const;
    // @ts-expect-error — the strategy union is closed; a typo must not compile.
    Agent.create({ provider: mock({ reply: '{}' }), model: 'mock' }).outputSchema(parser, bad);
    expect(bad.strategy).toBe('coax-it-nicely');
  });
});

describe('OutputAttempt.outcome — stays a closed union (7.26)', () => {
  it('is exhaustively switchable', () => {
    const describeRow = (row: OutputAttempt): string => {
      switch (row.outcome) {
        case 'passed':
          return 'the answer satisfied the schema';
        case 'retried':
          return 'it failed and the loop asked again';
        case 'exhausted':
          return 'it failed with no retries left';
        default: {
          const never: never = row.outcome;
          return never;
        }
      }
    };
    expect(describeRow({ attempt: 1, iteration: 1, outcome: 'passed' })).toContain('satisfied');
  });
});

describe("route_decided.chosen — 'output-retry' in both declarations (7.26)", () => {
  it('assigns through the standalone payload type', () => {
    const payload: Payloads.AgentRouteDecidedPayload = {
      turnIndex: 0,
      iterIndex: 1,
      chosen: 'output-retry',
    };
    expect(payload.chosen).toBe('output-retry');
  });

  it('assigns through the event map — what a consumer actually reads', () => {
    type Dispatched = AgentfootprintEventMap['agentfootprint.agent.route_decided']['payload'];
    const payload: Dispatched = { turnIndex: 0, iterIndex: 1, chosen: 'output-retry' };
    expect(payload.chosen).toBe('output-retry');
  });

  it('carries the retry event payload with its error as a plain string', () => {
    type Retry = AgentfootprintEventMap['agentfootprint.agent.output_schema_retry']['payload'];
    const payload: Retry = {
      attempt: 1,
      retriesRemaining: 1,
      iteration: 1,
      stage: 'schema-validate',
      error: 'amount must be a number',
      correctiveMessageHash: 'deadbeef',
    };
    expect(payload.stage).toBe('schema-validate');
  });
});
