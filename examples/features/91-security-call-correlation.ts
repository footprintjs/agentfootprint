/** Two calls to one tool leave distinct permission and credential facts. */
import assert from 'node:assert/strict';
import { Agent, defineTool } from '../../src/index.js';
import { mock } from '../../src/doors/providers.js';
import { staticTokens } from '../../src/doors/security.js';
import { isCliEntry, printResult, type ExampleMeta } from '../helpers/cli.js';

export const meta: ExampleMeta = {
  id: 'features/91-security-call-correlation',
  title: 'Security events identify their tool call',
  group: 'features',
  description:
    'Two mock calls to the same tool and credential service carry distinct call ids. Permission and credential events retain that identity under deferred delivery.',
  defaultInput: 'Read both synthetic items.',
  providerSlots: [],
  tags: ['features', 'security', 'observability', 'credentials'],
};

export async function run(input: string): Promise<unknown> {
  const agent = Agent.create({
    provider: mock({
      replies: [
        {
          toolCalls: [
            { id: 'first-call', name: 'read_item', args: {} },
            { id: 'second-call', name: 'read_item', args: {} },
          ],
        },
        { content: 'Both synthetic items were read.' },
      ],
    }),
    model: 'mock',
    observerDelivery: 'deferred',
    permissionChecker: { name: 'demo-policy', check: () => ({ result: 'allow' }) },
    credentials: staticTokens({ inventory: 'synthetic-token' }),
  })
    .tool(
      defineTool({
        name: 'read_item',
        description: 'Return one synthetic item without network access.',
        inputSchema: { type: 'object', properties: {} },
        needs: { credential: 'inventory' },
        execute: () => 'synthetic item',
      }),
    )
    .build();

  // #region security-call-correlation
  const facts: { event: string; runId: string; toolCallId: string; iteration: number }[] = [];
  agent.on('*', (event) => {
    if (
      event.type !== 'agentfootprint.permission.check' &&
      event.type !== 'agentfootprint.credential.requested' &&
      event.type !== 'agentfootprint.credential.acquired'
    )
      return;
    const { toolCallId, iteration } = event.payload;
    // Old recordings and caller-emitted facts may have no call identity.
    // Do not guess it from a tool name, service or arrival order.
    if (toolCallId === undefined || iteration === undefined) return;
    facts.push({ event: event.type, runId: event.meta.runId, toolCallId, iteration });
  });
  await agent.run(input);

  assert.deepEqual(
    facts.map((fact) => fact.toolCallId),
    ['first-call', 'first-call', 'first-call', 'second-call', 'second-call', 'second-call'],
  );
  assert.ok(facts.every((fact) => fact.iteration === 1));
  assert.equal(new Set(facts.map((fact) => fact.runId)).size, 1);
  // A check's allow result is not proof that execution or later checks passed.
  // #endregion security-call-correlation
  return facts;
}

if (isCliEntry(import.meta.url)) {
  run(meta.defaultInput!)
    .then(printResult)
    .catch((error: unknown) => {
      console.error(error);
      process.exitCode = 1;
    });
}
