/** A real runtime refusal, observed without retaining its free-text reason. */
import assert from 'node:assert/strict';
import { Agent, defineTool } from '../../src/index.js';
import { mock } from '../../src/doors/providers.js';
import { recordRun } from '../../src/doors/observe.js';
import { isCliEntry, printResult, type ExampleMeta } from '../helpers/cli.js';

export const meta: ExampleMeta = {
  id: 'features/93-trust-boundaries',
  title: 'Runtime trust-boundary evidence',
  group: 'features',
  description:
    'A mock model attempts one tool call. A real permission checker refuses it; the recorder keeps the reported decision and call identity, not the private reason.',
  defaultInput: 'Try the synthetic transfer.',
  providerSlots: [],
  tags: ['features', 'security', 'observability'],
};

export async function run(input: string): Promise<unknown> {
  const privateReason = 'PRIVATE_DEMO_POLICY_REASON';
  let executions = 0;
  const agent = Agent.create({
    provider: mock({
      replies: [
        { toolCalls: [{ id: 'attempt-1', name: 'transfer', args: {} }] },
        { content: 'The transfer was refused.' },
      ],
    }),
    model: 'mock',
    observerDelivery: 'deferred',
    permissionChecker: {
      name: 'demo-policy',
      check: () => ({ result: 'deny', policyRuleId: 'no-transfer', reason: privateReason }),
    },
  })
    .tool(
      defineTool({
        name: 'transfer',
        description: 'Synthetic side effect; no network or real money.',
        inputSchema: { type: 'object', properties: {} },
        execute: () => {
          executions += 1;
          return 'synthetic transfer';
        },
      }),
    )
    .build();

  // #region trust-boundaries
  const recording = recordRun(agent, { trustBoundaries: { maxFacts: 100 } });
  try {
    await agent.run(input);
    const bundle = recording.trustBoundaries!.toSnapshot();
    // The same bundle is included in toRecording().snapshot.recorders.
    // No missing observation becomes approval; sourcePosition can be absent.
    const denial = bundle.data.facts.find(
      (fact) => fact.eventType === 'agentfootprint.permission.check' && fact.result === 'deny',
    );
    assert.ok(denial);
    assert.equal(denial.toolCallId, 'attempt-1');
    assert.equal(executions, 0);
    assert.ok(!JSON.stringify(bundle).includes(privateReason));
    return bundle;
  } finally {
    recording.stop();
  }
  // #endregion trust-boundaries
}

if (isCliEntry(import.meta.url)) {
  run(meta.defaultInput!)
    .then(printResult)
    .catch((error: unknown) => {
      console.error(error);
      process.exitCode = 1;
    });
}
