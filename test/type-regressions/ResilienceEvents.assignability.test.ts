/**
 * Compile-level regression test — the `resilience.*` event contract.
 *
 * The bug this file exists to prevent was invisible to every runtime test in
 * the repo, because it was a TYPE fact: `agentfootprint.resilience.output_
 * fallback_triggered` and `…output_canned_used` were emitted by
 * `src/core/outputFallback.ts` and documented on the site, but absent from
 * `ALL_EVENT_TYPES` — so `runner.on(<either name>)` did not compile. The only
 * test that touched them, `test/core/outputFallback.test.ts`, wrote
 * `.on(name as never)`; the cast silenced the compile error that WAS the bug
 * report, and the suite stayed green for months.
 *
 * A cast is how this class of defect hides, so this file contains none. Every
 * assertion below is an assignment the real compiler has to accept (or, for
 * the closed-union check, one it has to reject).
 *
 * Lives under its own tsconfig (./tsconfig.json, `npm run test:types`) so tsc
 * checks the assignments, while the filename still matches `test/**\/*.test.ts`
 * so `npm test` runs the assertions too.
 */
import { describe, expect, it } from 'vitest';
import { Agent, type OutputSchemaParser } from '../../src/index';
import { mock } from '../../src/llm-providers';
import type {
  AgentfootprintEventMap,
  AgentfootprintEventType,
  DomainWildcard,
  Payloads,
} from '../../src/events';

interface Refund {
  amount: number;
  reason: string;
}

const parser: OutputSchemaParser<Refund> = {
  parse: (v: unknown): Refund => v as Refund,
};

describe('resilience.* — the names are part of the event union (9.44.0)', () => {
  it('both names assign to AgentfootprintEventType', () => {
    const triggered: AgentfootprintEventType =
      'agentfootprint.resilience.output_fallback_triggered';
    const canned: AgentfootprintEventType = 'agentfootprint.resilience.output_canned_used';
    expect([triggered, canned]).toHaveLength(2);
  });

  it('rejects a plausible near-miss, so the union is still closed', () => {
    // `reliability` and `resilience` are one letter apart and both real
    // domains. If the union ever widened to `string`, this line would start
    // compiling and every typo would reach production as silence.
    // @ts-expect-error — no such event; the union must refuse it.
    const typo: AgentfootprintEventType = 'agentfootprint.resilience.output_canned_use';
    expect(typo).toContain('resilience');
  });

  it('the domain wildcard exists', () => {
    const wildcard: DomainWildcard = 'agentfootprint.resilience.*';
    expect(wildcard).toBe('agentfootprint.resilience.*');
  });
});

describe('resilience.* — payloads assign through both declarations', () => {
  it('assigns through the standalone payload types', () => {
    const triggered: Payloads.ResilienceOutputFallbackTriggeredPayload = {
      stage: 'json-parse',
      rawOutputPreview: 'Sure! Here is your refund:',
      primaryErrorMessage: 'Unexpected token S in JSON at position 0',
      retriesSpent: 2,
    };
    const canned: Payloads.ResilienceOutputCannedUsedPayload = {
      rawOutputPreview: 'Sure! Here is your refund:',
      fallbackErrorMessage: 'fallback exploded',
    };
    expect(triggered.stage).toBe('json-parse');
    expect(canned.retriesSpent).toBeUndefined();
  });

  it('assigns through the event map — what a consumer actually reads', () => {
    type Triggered =
      AgentfootprintEventMap['agentfootprint.resilience.output_fallback_triggered']['payload'];
    type Canned = AgentfootprintEventMap['agentfootprint.resilience.output_canned_used']['payload'];

    const triggered: Triggered = {
      stage: 'schema-validate',
      rawOutputPreview: '{"amount":"lots"}',
      primaryErrorMessage: 'amount must be a number',
    };
    const canned: Canned = {
      rawOutputPreview: '{"amount":"lots"}',
      fallbackErrorMessage: 'fallback returned an invalid value',
      retriesSpent: 0,
    };
    expect(triggered.stage).toBe('schema-validate');
    expect(canned.retriesSpent).toBe(0);
  });

  it('keeps `stage` a closed union rather than a bare string', () => {
    type Triggered =
      AgentfootprintEventMap['agentfootprint.resilience.output_fallback_triggered']['payload'];
    // @ts-expect-error — only 'json-parse' | 'schema-validate' are real stages.
    const bad: Triggered['stage'] = 'vibes';
    expect(bad).toBe('vibes');
  });
});

describe('resilience.* — .on() accepts the names WITHOUT a cast', () => {
  it('subscribes by name and receives a typed payload', () => {
    const agent = Agent.create({ provider: mock({ reply: '{}' }), model: 'mock' })
      .outputSchema(parser)
      .outputFallback({
        fallback: (): Refund => ({ amount: 0, reason: 'fallback' }),
        canned: { amount: 0, reason: 'canned' },
      })
      .build();

    // The assertion IS the call: no `as never` anywhere, and `event.payload`
    // resolves to the registered shape rather than `unknown`.
    const offTriggered = agent.on(
      'agentfootprint.resilience.output_fallback_triggered',
      (event) => {
        const stage: 'json-parse' | 'schema-validate' = event.payload.stage;
        void stage;
      },
    );
    const offCanned = agent.on('agentfootprint.resilience.output_canned_used', (event) => {
      const reason: string = event.payload.fallbackErrorMessage;
      void reason;
    });
    const offWildcard = agent.on('agentfootprint.resilience.*', (event) => {
      const type: AgentfootprintEventType = event.type;
      void type;
    });

    offTriggered();
    offCanned();
    offWildcard();
    expect(typeof offTriggered).toBe('function');
  });
});
