/** Findings cannot spend a retry or overwrite an owner decision withholding output. */
import { expect, it } from 'vitest';
import { Agent } from '../../../src/core/Agent.js';
import { mock } from '../../../src/providers.js';
import { allow, deny } from '../../../src/core/agent/middleware/outcomes.js';
import type { AgentState } from '../../../src/core/agent/types.js';

const cases = [
  {
    name: 'findings and configured retry preserve terminal host denial',
    findings: true,
    retries: 1,
    denied: true,
    expectedCalls: 1,
  },
  {
    name: 'unarmed host-denial control',
    findings: false,
    retries: 1,
    denied: true,
    expectedCalls: 1,
  },
  {
    name: 'findings without retry preserve terminal host denial',
    findings: true,
    retries: 0,
    denied: true,
    expectedCalls: 1,
  },
  {
    name: 'findings may spend a configured retry when no host denies release',
    findings: true,
    retries: 1,
    denied: false,
    expectedCalls: 2,
  },
] as const;

for (const scenario of cases)
  it(scenario.name, async () => {
    let calls = 0;
    const builder = Agent.create({
      provider: mock({
        respond: () => {
          calls++;
          return JSON.stringify({ answer: 'ordinary fixture' });
        },
      }),
      model: 'mock',
    })
      .outputSchema({ parse: (value: unknown) => value }, { retries: scenario.retries })
      .maxIterations(3)
      .messageMiddleware({
        name: 'rewrite',
        onMessage: (message) =>
          message.phase === 'output'
            ? allow(
                JSON.stringify({
                  answer: 'rewritten',
                  _findings: { previous: [{ toolCallId: 'not-served', standing: 'fact' }] },
                }),
                'synthetic rewrite',
              )
            : allow(),
      });
    const armed = scenario.findings ? builder.findings() : builder;
    const configured = scenario.denied
      ? armed.messageMiddleware({
          name: 'owner-denial',
          onMessage: (message) =>
            message.phase === 'output' ? deny('OWNER_RELEASE_DENIED') : allow(),
        })
      : armed;
    const agent = configured.build();
    let failure: unknown;
    try {
      await agent.run({ message: 'fixture' });
    } catch (error) {
      failure = error;
    }
    expect(calls).toBe(scenario.expectedCalls);
    const state = agent.getLastSnapshot()?.sharedState as unknown as AgentState;
    if (scenario.denied) {
      expect(failure).toMatchObject({ name: 'MessageDeniedError' });
      expect(state).toMatchObject({
        messageDeniedReason: 'OWNER_RELEASE_DENIED',
        messageDeniedPhase: 'output',
        messageDeniedBy: 'owner-denial',
      });
      expect(state.outputAttempts).toBeUndefined();
    }
    if (scenario.findings) {
      expect(state.findingsLedger).toContainEqual(
        expect.objectContaining({ kind: 'standing', toolCallId: 'not-served', unknownId: true }),
      );
      expect(state.findingsLedger).toContainEqual(
        expect.objectContaining({ kind: 'reference-refusal', reason: 'unidentified' }),
      );
    }
  });
