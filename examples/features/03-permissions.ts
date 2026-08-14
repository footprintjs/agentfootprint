/**
 * 03 — Permissions: the whole `PermissionChecker` surface, in four scenes.
 *
 * A `permissionChecker` is an EXECUTION GUARD, not tool hiding. Before every
 * `tool.execute` the Agent asks it `{ capability: 'tool_call', target: <tool> }`
 * and emits `agentfootprint.permission.check` with the decision. A `deny` skips
 * the tool and the model reads a synthetic denial; a throwing checker is
 * deny-by-default with the operator error in its rationale.
 *
 * ── Why this example is bigger than "allow or deny" ─────────────────────────
 * An independent reviewer (2026-08-13) exercised the strongest surface this
 * library has — declared tool capabilities checked against a role's capability
 * rules, with a read-only role passing the tool-name allowlist and still failing
 * the `memory_write` check — and then reported that the shipped example
 * demonstrated none of it: only `allow`/`deny` with a `policyRuleId` and a
 * `rationale`. `halt`, `reason`, `tellLLM`, `Tool.capabilities` ×
 * `PermissionChecker.governs` and `PermissionPolicy.fromRoles` had been shipped
 * for releases and were invisible to anyone reading this file. That run was
 * deterministic and local — a mock model, a thrown `Error` for the "authorizer
 * outage", no live authorization service — which is exactly why this file can
 * reproduce it byte for byte. So the four scenes below ARE that run's shape:
 *
 *   1. a read-only role passes the tool-name allowlist and fails the
 *      `memory_write` capability check → the tool executes ZERO times;
 *   2. an admin role passes `tool_call`, `memory_write` and `user_data` → the
 *      same tool executes once;
 *   3. a checker that throws fails CLOSED, with the operator's error in the
 *      rationale, and the model carries on without the tool;
 *   4. a `halt` decision ends the run cleanly with a typed `PolicyHaltError`,
 *      carrying the machine-readable `reason` an alert routes on and the
 *      `tellLLM` text the model was actually shown.
 *
 * The law worth carrying away: **enforce-when-both-sides-speak.**
 * `Tool.capabilities` is DECLARED (never inferred) and a checker's `governs` is
 * feature-detected with ABSENCE = NO — so a policy written before capabilities
 * existed is never asked about them, and a capability nobody declared is never
 * silently permitted.
 *
 * Run:  npx tsx examples/features/03-permissions.ts
 */

import {
  Agent,
  defineTool,
  type LLMProvider,
  type PermissionChecker,
  type ToolCapability,
} from '../../src/index.js';
import { mock } from '../../src/doors/providers.js';
import { PermissionPolicy, PolicyHaltError } from '../../src/doors/security.js';
import { isCliEntry, printResult, type ExampleMeta } from '../helpers/cli.js';

export const meta: ExampleMeta = {
  id: 'features/03-permissions',
  title: 'Permissions — capability gating, fail-closed, and halt',
  group: 'features',
  description:
    'PermissionChecker as an execution guard: declared Tool.capabilities checked against a role, a throwing checker failing closed, and a halt decision ending the run with a typed error.',
  defaultInput: 'save this customer note',
  providerSlots: ['default'],
  tags: ['feature', 'permission', 'policy', 'security'],
};

/** What each scene reports back — the shape the integration test reads. */
export interface PermissionsExampleResult {
  readonly readOnly: {
    readonly executions: number;
    readonly denied: readonly { capability: string; target: string; policyRuleId?: string }[];
  };
  readonly admin: {
    readonly executions: number;
    readonly allowedCapabilities: readonly string[];
  };
  readonly failClosed: {
    readonly executions: number;
    readonly rationale: string;
  };
  readonly halted: {
    readonly reason: string;
    readonly tellLLM?: string;
    readonly executions: number;
  };
}

/**
 * The tool both role scenes share. It DECLARES what it touches — the framework
 * never infers this, and a tool that declares nothing is only ever asked the
 * `'tool_call'` question.
 */
function noteTool(ran: string[]): ReturnType<typeof defineTool> {
  return defineTool<{ note: string }, string>({
    name: 'save_note',
    description: 'Write a note onto the customer record.',
    inputSchema: {
      type: 'object',
      properties: { note: { type: 'string' } },
      required: ['note'],
    },
    capabilities: ['memory_write', 'user_data'] as readonly ToolCapability[],
    execute: ({ note }) => {
      ran.push(note);
      return `saved: ${note}`;
    },
  });
}

/** Both roles may CALL the tool. Only one may exercise what it declares. */
const ROLES = {
  readonly: ['save_note'],
  admin: ['save_note'],
};
const CAPABILITY_RULES = {
  capabilities: {
    // A read-only role may read memory and nothing else — so it passes the
    // allowlist above and fails on the capability the tool declares.
    readonly: ['memory_read'] as readonly ToolCapability[],
    admin: ['memory_read', 'memory_write', 'user_data', 'external_net'] as readonly ToolCapability[],
  },
};

/**
 * A provider that always proposes the one tool, then answers.
 *
 * Deliberately the instant scripted mock rather than the shared realistic one:
 * this example is about what a POLICY decides, and four agents × two calls of
 * simulated thinking latency would be theatre in front of the thing being
 * demonstrated. A fresh instance per agent, so the four scenes cannot share a
 * script cursor.
 */
function scriptedProvider(): LLMProvider {
  return mock({
    replies: [
      { toolCalls: [{ id: 't1', name: 'save_note', args: { note: 'prefers email' } }] },
      { content: 'done' },
    ],
  });
}

export async function run(
  input: string,
  provider?: LLMProvider,
): Promise<PermissionsExampleResult> {
  const message = input.length > 0 ? input : (meta.defaultInput ?? 'save this customer note');

  // ── Scene 1 — the allowlist passes, the CAPABILITY does not ────────
  const readOnlyRan: string[] = [];
  const readOnlyDenials: { capability: string; target: string; policyRuleId?: string }[] = [];
  const readOnly = Agent.create({
    provider: provider ?? scriptedProvider(),
    model: 'mock',
    maxIterations: 3,
    // `governs` is DERIVED from these rules, so "unconfigured" and "never
    // asked" cannot drift apart.
    permissionChecker: PermissionPolicy.fromRoles(ROLES, 'readonly', CAPABILITY_RULES),
  })
    .system('Follow the policy strictly.')
    .tool(noteTool(readOnlyRan))
    .build();

  readOnly.on('agentfootprint.permission.check', (e) => {
    if (e.payload.result === 'deny') {
      readOnlyDenials.push({
        capability: e.payload.capability,
        target: e.payload.target ?? '',
        ...(e.payload.policyRuleId !== undefined && { policyRuleId: e.payload.policyRuleId }),
      });
    }
  });
  await readOnly.run({ message });

  // ── Scene 2 — the admin role clears all three questions ────────────
  const adminRan: string[] = [];
  const adminAllowed: string[] = [];
  const admin = Agent.create({
    provider: provider ?? scriptedProvider(),
    model: 'mock',
    maxIterations: 3,
    permissionChecker: PermissionPolicy.fromRoles(ROLES, 'admin', CAPABILITY_RULES),
  })
    .system('Follow the policy strictly.')
    .tool(noteTool(adminRan))
    .build();

  admin.on('agentfootprint.permission.check', (e) => {
    if (e.payload.result === 'allow') adminAllowed.push(e.payload.capability);
  });
  await admin.run({ message });

  // ── Scene 3 — the authorizer is down, and the door stays shut ──────
  // The trial's own probe: a checker throwing `simulated authorizer outage`.
  // Fail-closed is the only safe reading of "I could not decide", and the
  // operator's error travels in the RATIONALE so the outage is diagnosable
  // rather than merely denied.
  const outageRan: string[] = [];
  let outageRationale = '';
  const throwing: PermissionChecker = {
    name: 'authorizer-that-is-down',
    check: () => {
      throw new Error('simulated authorizer outage');
    },
  };
  const failClosed = Agent.create({
    provider: provider ?? scriptedProvider(),
    model: 'mock',
    maxIterations: 3,
    permissionChecker: throwing,
  })
    .system('Follow the policy strictly.')
    .tool(noteTool(outageRan))
    .build();

  failClosed.on('agentfootprint.permission.check', (e) => {
    if (e.payload.result === 'deny') outageRationale = e.payload.rationale ?? '';
  });
  await failClosed.run({ message });

  // ── Scene 4 — `halt`: stop the run, and say why in two vocabularies ─
  // `reason` is MACHINE-readable telemetry an alert routes on
  // (`'security:exfiltration'` → page somebody). `tellLLM` is what the model
  // is shown as the synthetic tool result — and it never falls back to
  // `reason`, because a routing tag is not an explanation for a reader.
  const haltedRan: string[] = [];
  const halting: PermissionChecker = {
    name: 'exfiltration-guard',
    check: () => ({
      result: 'halt',
      policyRuleId: 'no-bulk-export-v3',
      reason: 'security:exfiltration',
      rationale: 'bulk write to a customer record outside an approved workflow',
      tellLLM: 'That action needs a human approver. Stopping here and handing off.',
    }),
  };
  const halted = Agent.create({
    provider: provider ?? scriptedProvider(),
    model: 'mock',
    maxIterations: 3,
    permissionChecker: halting,
  })
    .system('Follow the policy strictly.')
    .tool(noteTool(haltedRan))
    .build();

  let haltReason = '';
  let haltTellLLM: string | undefined;
  try {
    await halted.run({ message });
  } catch (err) {
    if (!(err instanceof PolicyHaltError)) throw err;
    haltReason = err.reason;
    haltTellLLM = err.tellLLM;
  }

  const result: PermissionsExampleResult = {
    readOnly: { executions: readOnlyRan.length, denied: readOnlyDenials },
    admin: { executions: adminRan.length, allowedCapabilities: adminAllowed },
    failClosed: { executions: outageRan.length, rationale: outageRationale },
    halted: { reason: haltReason, ...(haltTellLLM !== undefined && { tellLLM: haltTellLLM }), executions: haltedRan.length },
  };

  console.log(
    `[read-only] executed ${result.readOnly.executions}× — denied: ` +
      result.readOnly.denied.map((d) => `${d.capability}(${d.policyRuleId ?? '—'})`).join(', '),
  );
  console.log(`[admin]     executed ${result.admin.executions}×`);
  console.log(`[outage]    executed ${result.failClosed.executions}× — ${result.failClosed.rationale}`);
  console.log(`[halt]      reason='${result.halted.reason}' executed ${result.halted.executions}×`);
  return result;
}

if (isCliEntry(import.meta.url)) {
  run(meta.defaultInput ?? '')
    .then(printResult)
    .catch(console.error);
}
