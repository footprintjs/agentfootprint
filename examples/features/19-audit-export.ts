/**
 * 19 — Tamper-evident audit export (#20).
 *
 * `auditExport()` consumes the typed event stream and builds an
 * append-only, HASH-CHAINED audit log: every record carries the SHA-256
 * of its canonical serialization plus the previous record's hash. The
 * bundle is plain JSON — store it anywhere — and `verifyAuditBundle()`
 * re-verifies it OFFLINE (no agent, no strategy): flip one byte and
 * verification names the exact record that broke. That is the
 * record-keeping shape EU AI Act Art. 12 asks for: what the system
 * logged, in order, demonstrably unmodified since capture.
 *
 * The run below packs the compliance-interesting signals into one
 * chain: the agent's route decisions, a tool call (args bounded to key
 * NAMES, result to a TYPE — the #19 PII discipline), and a #9
 * validation REJECTION (the model sent malformed args and was made to
 * retry). Then we drain a second segment and show segments re-verify
 * end-to-end when concatenated.
 *
 * Deterministic mock provider — no API key needed.
 *
 * Run:  npm run example -- examples/features/19-audit-export.ts
 */

import {
  auditExport,
  verifyAuditBundle,
  type AuditBundle,
} from '../../src/observability-providers.js';
import { Agent, defineTool } from '../../src/index.js';
import { isCliEntry, printResult, type ExampleMeta } from '../helpers/cli.js';
import { exampleProvider } from '../helpers/provider.js';

export const meta: ExampleMeta = {
  id: 'features/19-audit-export',
  title: 'Tamper-evident audit export — hash-chained bundle + offline verification',
  group: 'features',
  description:
    'auditExport() hash-chains every typed event (decisions, tool calls, validation rejections) into a JSON AuditBundle; verifyAuditBundle() recomputes the chain offline and names the exact record any tamper broke.',
  defaultInput: 'audit account ACCT-1142',
  providerSlots: ['default'],
  tags: ['feature', 'observability', 'audit', 'compliance'],
};

export async function run(
  input: string,
  provider?: import('../../src/index.js').LLMProvider,
): Promise<unknown> {
  // ── 1. The audit strategy — one chain per instance ─────────────────
  const audit = auditExport({
    agent: 'ledger-auditor',
    versions: { app: '2.4.0' }, // your own pins land in the genesis record
  });

  // Scripted mock: first tool call sends BAD args (`account` as a
  // number) → #9 validation REJECTS it and the model retries with a
  // string; then it finishes. Deterministic, key-free.
  let llmCalls = 0;
  const scripted = exampleProvider('feature', {
    respond: (req) => {
      llmCalls++;
      const lastTool = [...req.messages].reverse().find((m) => m.role === 'tool');
      if (llmCalls === 1) {
        return {
          content: 'Looking up the ledger…',
          toolCalls: [{ id: 'c1', name: 'lookup', args: { account: 1142 } as never }],
          stopReason: 'tool_use',
        };
      }
      if (typeof lastTool?.content === 'string' && lastTool.content.includes('Invalid arguments')) {
        return {
          content: 'Correcting my arguments…',
          toolCalls: [{ id: 'c2', name: 'lookup', args: { account: 'ACCT-1142' } }],
          stopReason: 'tool_use',
        };
      }
      return { content: 'Ledger entry verified: balance reconciled.', stopReason: 'end_turn' };
    },
  });

  const lookup = defineTool<{ account: string }, string>({
    name: 'lookup',
    description: 'Look up a ledger account.',
    inputSchema: {
      type: 'object',
      properties: { account: { type: 'string', description: 'Account id.' } },
      required: ['account'],
    },
    execute: ({ account }) => `balance for ${account}: 1,204.50 EUR`,
  });

  const agent = Agent.create({ provider: provider ?? scripted, model: 'mock' })
    .system('You audit ledger accounts.')
    .tool(lookup)
    .build();

  // ── 2. Capture a run ────────────────────────────────────────────────
  const stop = agent.enable.observability({ strategy: audit });
  let out: unknown;
  try {
    out = await agent.run({ message: input });
  } finally {
    stop();
  }

  // ── 3. Export — the bundle is plain JSON; persistence is yours ─────
  const bundle = audit.bundle();
  console.log('══ Audit bundle ══');
  console.log(
    `format ${bundle.header.format} · ${bundle.header.recordCount} records · ` +
      `chain ${bundle.header.chainHead.slice(0, 8)}… → ${bundle.finalHash.slice(0, 8)}…`,
  );
  for (const record of bundle.records) {
    console.log(`  #${record.seq}  ${record.eventType}  (${record.hash.slice(0, 8)}…)`);
  }

  // The compliance signals are in the chain — decisions, the tool
  // call, and the validation rejection:
  const types = bundle.records.map((r) => r.eventType);
  console.log('\ncontains route decision: ', types.includes('agentfootprint.agent.route_decided'));
  console.log('contains tool call:      ', types.includes('agentfootprint.stream.tool_start'));
  console.log(
    'contains validation rejection:',
    types.includes('agentfootprint.validation.args_invalid'),
  );

  // ── 4. Verify OFFLINE (a stored copy, long after the run) ──────────
  const stored = JSON.parse(JSON.stringify(bundle)) as AuditBundle;
  console.log('\n══ Verification ══');
  console.log('pristine bundle:', JSON.stringify(verifyAuditBundle(stored)));

  // ── 5. The demo moment — flip one byte, verification names it ──────
  const tampered = JSON.parse(JSON.stringify(bundle)) as {
    records: Array<{ eventType: string; payload: Record<string, unknown> }>;
  };
  const idx = tampered.records.findIndex((r) => r.eventType === 'agentfootprint.stream.tool_start');
  tampered.records[idx]!.payload.toolName = 'l00kup'; // one byte flipped
  const result = verifyAuditBundle(tampered as unknown as AuditBundle);
  console.log(
    `tampered  bundle: valid=${result.valid} brokenAt=#${result.brokenAt} — ${result.reason}`,
  );

  // ── 6. Long runs: drain() segments re-verify end-to-end ────────────
  const segment1 = audit.drain(); // everything so far; chain state survives
  await (async () => {
    const stop2 = agent.enable.observability({ strategy: audit });
    try {
      await agent.run({ message: 'audit account ACCT-2071' });
    } finally {
      stop2();
    }
  })();
  const segment2 = audit.drain();
  console.log('\n══ Drained segments ══');
  console.log(
    `segment2.chainHead === segment1.finalHash: ${
      segment2.header.chainHead === segment1.finalHash
    }`,
  );
  console.log('concatenation verifies:', JSON.stringify(verifyAuditBundle([segment1, segment2])));

  return out;
}

if (isCliEntry(import.meta.url)) {
  run(meta.defaultInput ?? '')
    .then(printResult)
    .catch(console.error);
}
