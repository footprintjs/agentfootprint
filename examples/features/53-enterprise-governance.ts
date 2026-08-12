/**
 * 53 — The enterprise batch (9.11.0): who did it, what may it touch, what may
 * it see, and how big may one answer be.
 *
 * Four opt-in mechanisms, all off unless you ask for them, shown in one run:
 *
 *   1. `run({ identity })`     → `meta.principal` / `meta.tenant` on EVERY event
 *   2. `Tool.capabilities`     → a per-capability check, when the checker governs it
 *   3. `{ skills }` rules      → a smaller `read_skill` menu for this role
 *   4. `maxToolResultChars`    → one result replaced by a marker that TEACHES
 *
 * The thread through all four: nothing is inferred and nothing is invented. An
 * anonymous run stamps no actor; an undeclared tool is asked about nothing; a
 * policy with no skill rule hides no skill; an omitted cap measures nothing.
 *
 * Run:  npx tsx examples/features/53-enterprise-governance.ts
 */

import { Agent, defineTool, isTruncatedToolResult } from '../../src/index.js';
import { defineSkill } from '../../src/injection-engine.js';
import { PermissionPolicy } from '../../src/security/index.js';
import { isCliEntry, printResult, type ExampleMeta } from '../helpers/cli.js';
import { exampleProvider } from '../helpers/provider.js';

export const meta: ExampleMeta = {
  id: 'features/53-enterprise-governance',
  title: 'Enterprise governance — actor, capabilities, skill visibility, result cap',
  group: 'features',
  description:
    'The 9.11.0 batch in one run: an actor on every event, a per-capability permission check, a per-role skill catalog, and an opt-in ceiling on one tool result.',
  defaultInput: 'export every order we have',
  providerSlots: ['default'],
  tags: ['feature', 'permission', 'policy', 'identity', 'observability'],
};

export async function run(
  input: string,
  provider?: import('../../src/index.js').LLMProvider,
): Promise<unknown> {
  // ── The tool: it declares what it TOUCHES, and it returns far too much ────
  const ordersExport = defineTool<Record<string, never>, string>({
    name: 'orders_export',
    description: 'Export every order as CSV.',
    // Declared by the author. The framework never infers this — a tool's reach
    // is not knowable from its name or its schema.
    capabilities: ['user_data'],
    inputSchema: { type: 'object', properties: {} },
    execute: () => `id,customer,total\n${'1001,ACME,42.00\n'.repeat(4000)}`,
  });

  // ── The policy: one object, three rules ──────────────────────────────────
  const policy = PermissionPolicy.fromRoles(
    {
      support: ['orders_export', 'read_skill'],
      finance: ['orders_export', 'read_skill'],
    },
    'support',
    {
      // `support` may touch user data, but nothing else the four-value
      // vocabulary can name. Configuring this makes the policy declare it
      // governs all four capabilities.
      capabilities: { support: ['user_data'], finance: ['user_data', 'external_net'] },
      // …and it may see one of the two skills. `payroll` is not merely refused:
      // its row never appears in the menu the model reads.
      skills: { support: ['refunds'], finance: ['refunds', 'payroll'] },
    },
  );
  console.log('policy governs:', policy.governs?.join(', '));

  const agent = Agent.create({
    provider: provider ?? exampleProvider('feature'),
    model: 'mock',
    permissionChecker: policy,
    // The last-resort net. Omit it and results are never measured — which is
    // what every release before 9.11.0 did.
    maxToolResultChars: 400,
  })
    .system('Answer from the tools you have.')
    .tool(ordersExport)
    .skill(defineSkill({ id: 'refunds', description: 'How refunds work', body: 'REFUND_POLICY' }))
    .skill(defineSkill({ id: 'payroll', description: 'Payroll internals', body: 'PAYROLL_POLICY' }))
    .build();

  // ── 1. WHO: the actor rides every event ──────────────────────────────────
  let actorSeen: { principal?: string; tenant?: string } = {};
  agent.on('*', (e) => {
    if (e.meta.principal !== undefined) {
      actorSeen = { principal: e.meta.principal, tenant: e.meta.tenant };
    }
  });

  // ── 2. What was checked, and how it was answered ─────────────────────────
  agent.on('agentfootprint.permission.check', (e) => {
    console.log(
      `[permission] ${e.payload.capability} → ${e.payload.target}: ${e.payload.result}`,
    );
  });

  // ── 3. What the model was OFFERED (the filtered skill menu) ──────────────
  // read_skill's description is rebuilt per iteration; the hidden skill is not
  // named in it at all — not as available, not as refusable.

  // ── 4. What came back from the tool ──────────────────────────────────────
  agent.on('agentfootprint.stream.tool_end', (e) => {
    const result = e.payload.result;
    if (isTruncatedToolResult(result)) {
      console.log(`[tool_end] TRUNCATED → ${result.reason}`);
      console.log(`[tool_end] head begins: ${JSON.stringify(result.head?.slice(0, 40))}`);
    }
  });

  const out = await agent.run(
    { message: input },
    // The actor. Only an identity a caller NAMES becomes one — a sessionId
    // never does, because anybody who can reach the host can send any string.
    { identity: { tenant: 'acme', principal: 'alice@acme.test', conversationId: 'conv-1' } },
  );

  console.log('\nactor on the events:', JSON.stringify(actorSeen));
  console.log('Final:', out);
  return out;
}

if (isCliEntry(import.meta.url)) {
  run(meta.defaultInput ?? '').then(printResult).catch(console.error);
}
