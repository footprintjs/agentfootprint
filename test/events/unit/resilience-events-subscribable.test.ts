/**
 * The two `resilience.*` events are subscribable BY NAME and really fire.
 *
 * Pattern: Test-as-specification (contract-level).
 * Role:    Prove the truth correction from the consumer's side.
 *
 * `test/core/outputFallback.test.ts` already proved these two events fire —
 * but it subscribed with `.on(name as never)`. That cast is what made the bug
 * survivable: it silenced the compile error that WAS the bug report, so a
 * passing suite coexisted for months with a name `runner.on()` could not
 * accept. Every subscription below is written WITHOUT a cast. If either name
 * leaves `ALL_EVENT_TYPES` / `AgentfootprintEventMap`, these lines stop
 * compiling (`npm run build`, `npx tsc --noEmit`) rather than quietly passing.
 *
 * The runtime half — that a real `agent.runTyped()` actually delivers them to
 * a listener registered by name — is what `npm test` enforces.
 */

import { describe, expect, it, expectTypeOf } from 'vitest';
import { z } from 'zod';
import { Agent } from '../../../src/core/Agent.js';
import { mock } from '../../../src/adapters/llm/MockProvider.js';
import {
  ALL_EVENT_TYPES,
  EVENT_NAMES,
  type AgentfootprintEventMap,
} from '../../../src/events/registry.js';
import type { DomainWildcard } from '../../../src/events/dispatcher.js';

const Refund = z.object({
  amount: z.number().nonnegative(),
  reason: z.string().min(1),
});
type Refund = z.infer<typeof Refund>;

/** An agent whose LLM answers with prose, so the outputSchema ladder engages. */
function makeLadderAgent(opts: { fallback: () => Refund; canned?: Refund }) {
  const builder = Agent.create({
    provider: mock({ replies: [{ content: 'not JSON at all' }] }),
    model: 'mock',
  })
    .system('You decide refund amounts.')
    .outputSchema(Refund)
    .outputFallback({
      fallback: opts.fallback,
      ...(opts.canned !== undefined && { canned: opts.canned }),
    });
  return builder.build();
}

describe('resilience.* — registered in the contract', () => {
  it('both names are in ALL_EVENT_TYPES', () => {
    expect(ALL_EVENT_TYPES).toContain('agentfootprint.resilience.output_fallback_triggered');
    expect(ALL_EVENT_TYPES).toContain('agentfootprint.resilience.output_canned_used');
  });

  it('the resilience domain is reachable in EVENT_NAMES', () => {
    expect(EVENT_NAMES.resilience.outputFallbackTriggered).toBe(
      'agentfootprint.resilience.output_fallback_triggered',
    );
    expect(EVENT_NAMES.resilience.outputCannedUsed).toBe(
      'agentfootprint.resilience.output_canned_used',
    );
  });

  it('the domain has a wildcard, so the group is subscribable as a group', () => {
    // The credential-domain lesson (9.4.0): a domain whose events exist but
    // whose wildcard does not cannot be watched by the one audience that
    // wants all of it. Type-level — a missing arm fails to compile.
    expectTypeOf<'agentfootprint.resilience.*'>().toMatchTypeOf<DomainWildcard>();
  });

  it('each name keys the typed event map with its own payload shape', () => {
    expectTypeOf<
      AgentfootprintEventMap['agentfootprint.resilience.output_fallback_triggered']['payload']
    >().toMatchTypeOf<{ stage: 'json-parse' | 'schema-validate'; primaryErrorMessage: string }>();
    expectTypeOf<
      AgentfootprintEventMap['agentfootprint.resilience.output_canned_used']['payload']
    >().toMatchTypeOf<{ fallbackErrorMessage: string }>();
  });
});

describe('resilience.* — accepted by .on() and delivered by a real run', () => {
  it('output_fallback_triggered: subscribed by name, no cast, fires on tier 2', async () => {
    const agent = makeLadderAgent({
      fallback: () => ({ amount: 0, reason: 'recovered' }),
      canned: { amount: 0, reason: 'canned' },
    });

    const seen: Array<{ stage: string; primaryErrorMessage: string }> = [];
    // No `as never`. This line compiles only because the event is registered.
    agent.on('agentfootprint.resilience.output_fallback_triggered', (event) => {
      // `event.payload` is typed by the registry — `stage` is a known field,
      // not an index into `unknown`.
      seen.push({
        stage: event.payload.stage,
        primaryErrorMessage: event.payload.primaryErrorMessage,
      });
    });

    await agent.runTyped<Refund>({ message: 'refund please' });

    expect(seen).toHaveLength(1);
    expect(seen[0]?.stage).toBe('json-parse');
    expect(seen[0]?.primaryErrorMessage).toBeTruthy();
  });

  it('output_canned_used: subscribed by name, no cast, fires on tier 3', async () => {
    const agent = makeLadderAgent({
      fallback: () => {
        throw new Error('fallback exploded');
      },
      canned: { amount: 0, reason: 'safety net' },
    });

    const seen: string[] = [];
    agent.on('agentfootprint.resilience.output_canned_used', (event) => {
      seen.push(event.payload.fallbackErrorMessage);
    });

    const result = await agent.runTyped<Refund>({ message: 'refund please' });

    expect(seen).toHaveLength(1);
    expect(seen[0]).toMatch(/exploded/);
    // Tier 3 really did answer — the event is not decorative.
    expect(result.reason).toBe('safety net');
  });

  it('the domain wildcard delivers both events to one listener', async () => {
    const agent = makeLadderAgent({
      fallback: () => {
        throw new Error('fallback exploded');
      },
      canned: { amount: 0, reason: 'safety net' },
    });

    const types: string[] = [];
    agent.on('agentfootprint.resilience.*', (event) => {
      types.push(event.type);
    });

    await agent.runTyped<Refund>({ message: 'refund please' });

    expect(types).toEqual([
      'agentfootprint.resilience.output_fallback_triggered',
      'agentfootprint.resilience.output_canned_used',
    ]);
  });
});
