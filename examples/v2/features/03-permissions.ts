/**
 * 09 — Permissions: tool-call gating via PermissionChecker.
 *
 * Supply a `permissionChecker` to the Agent. Before every `tool.execute`,
 * the Agent calls `checker.check({capability: 'tool_call', target: <tool>, ...})`
 * and emits `agentfootprint.permission.check` with the decision. On
 * `deny`, the tool is skipped and the LLM sees a synthetic denial
 * string. Throwing from the checker is treated as deny-by-default.
 *
 * Run:  npx tsx examples/v2/09-permissions.ts
 */

import {
  Agent,
  type LLMProvider,
  type PermissionChecker,
} from '../../src/index.js';
import { isCliEntry, printResult, type ExampleMeta } from '../../helpers/cli.js';

export const meta: ExampleMeta = {
  id: 'v2/features/03-permissions',
  title: 'Permissions — tool-call gating',
  group: 'v2-features',
  description: 'Supply a PermissionChecker; Agent calls check() before every tool.execute and emits permission.check events. Deny skips the tool.',
  defaultInput: 'delete the test record',
  providerSlots: ['default'],
  tags: ['v2', 'feature', 'permission', 'policy'],
};


export async function run(input: string, _provider?: import("../../src/index.js").LLMProvider): Promise<unknown> {
  // Allow read-only tools; deny write/delete tools.
  const readOnlyOnly: PermissionChecker = {
    name: 'read-only-policy',
    check: async (req) => {
      const target = req.target ?? '';
      if (target.startsWith('read_') || target === 'search') {
        return { result: 'allow' };
      }
      return {
        result: 'deny',
        policyRuleId: 'read-only-v1',
        rationale: `capability "${target}" not in the read-only allowlist`,
      };
    },
  };

  const provider: LLMProvider = {
    name: 'mock',
    complete: async (req) => {
      const hadTool = req.messages.some((m) => m.role === 'tool');
      if (hadTool) {
        return {
          content: 'Attempt recorded.',
          toolCalls: [],
          usage: { input: 40, output: 10 },
          stopReason: 'stop',
        };
      }
      return {
        content: "I'll delete the record.",
        toolCalls: [{ id: 'c1', name: 'delete_record', args: { id: 42 } }],
        usage: { input: 30, output: 10 },
        stopReason: 'tool_use',
      };
    },
  };

  const agent = Agent.create({
    provider,
    model: 'mock',
    permissionChecker: readOnlyOnly,
  })
    .system('Follow the policy strictly.')
    .tool({
      schema: {
        name: 'delete_record',
        description: 'Delete a record (write operation).',
        inputSchema: { type: 'object' },
      },
      execute: () => {
        throw new Error('should never execute — policy denies');
      },
    })
    .build();

  agent.on('agentfootprint.permission.check', (e) => {
    console.log(
      `[permission] ${e.payload.capability} → ${e.payload.target}: ${e.payload.result}${
        e.payload.rationale ? ` (${e.payload.rationale})` : ''
      }`,
    );
  });

  const out = await agent.run({ message: 'delete the test record' });
  console.log('\nFinal:', out);
  return out;
}

if (isCliEntry(import.meta.url)) {
  run(meta.defaultInput ?? '').then(printResult).catch(console.error);
}
