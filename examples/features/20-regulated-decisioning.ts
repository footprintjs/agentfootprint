/**
 * 20 — Regulated decisioning (#21, the compliance-wedge lighthouse).
 *
 * "Why was applicant A-1043 declined three weeks ago?"
 *
 * One agent run produces THREE compliance artifacts from the SAME typed
 * event stream, and an AUDITOR answers that question weeks later from
 * the PERSISTED files alone — no agent, no provider, no LLM, offline:
 *
 *   1. AUDIT BUNDLE   — `auditExport()` (#20) hash-chains every event;
 *                       drained per turn; `verifyAuditBundle()` proves the
 *                       log is unmodified and names any tampered record.
 *   2. OTEL SPANS     — `otelObservability` (#19) GenAI-semconv spans +
 *                       decide() evidence span events for live dashboards.
 *   3. CAUSAL MEMORY  — the snapshot store (#5) persists what the agent
 *                       said and did (query, final answer, tool calls).
 *
 * The run packs the EU-AI-Act-interesting signals into one decline:
 *   - a PERMISSION DENIAL (data-minimization policy blocks raw bank
 *     statements),
 *   - a #9 VALIDATION REJECTION (model sends `credit_score` as a string,
 *     is told the exact type mismatch, self-corrects next iteration),
 *   - footprintjs `decide()` lending rules with labels — the fired rule's
 *     conditions (`dti gt 0.43 → 0.52 (true)`) are captured as evidence.
 *
 * Non-repudiation: the bundle alone is tamper-EVIDENT, not tamper-PROOF —
 * an adversary holding the only copy can recompute the whole suffix. So
 * BOTH chain ends are anchored externally (here: a second file standing in
 * for a WORM store / second party): the final hash AND the genesis
 * identity (runId + record-0 hash), per the documented threat model in
 * docs/guides/security.md.
 *
 * Deterministic scripted mock provider — no API key needed.
 *
 * Run:  npm run example -- examples/features/20-regulated-decisioning.ts
 */

import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { FlowChartExecutor, decide, flowChart, type FlowDecisionEvent } from 'footprintjs';

import {
  Agent,
  defineMemory,
  defineTool,
  InMemoryStore,
  MEMORY_STRATEGIES,
  MEMORY_TYPES,
  mock,
  mockEmbedder,
  SNAPSHOT_PROJECTIONS,
  type PermissionChecker,
} from '../../src/index.js';
import {
  auditExport,
  otelObservability,
  verifyAuditBundle,
  type AuditBundle,
  type OtelSpanLike,
  type OtelSpanOptions,
  type OtelTracerLike,
} from '../../src/observability-providers.js';
import { isCliEntry, printResult, type ExampleMeta } from '../helpers/cli.js';

export const meta: ExampleMeta = {
  id: 'features/20-regulated-decisioning',
  title: 'Regulated decisioning — one run, three compliance artifacts, offline auditor',
  group: 'features',
  description:
    'A loan-decisioning agent declines an application under labeled decide() rules while auditExport (hash chain), otelObservability (GenAI spans) and causal memory capture the same event stream; an offline auditor then answers "why was the applicant declined?" from the persisted JSON alone — and a flipped byte is caught and named.',
  defaultInput:
    'Assess loan application APP-2209 for applicant A-1043: requested 240000 EUR over 30 years, stated income 4500 EUR/month against 2340 EUR/month in debt obligations.',
  providerSlots: ['default'],
  tags: ['feature', 'observability', 'audit', 'compliance', 'causal-memory', 'decide-evidence'],
};

// ─── The lending policy — footprintjs decide() rules with labels ──────
//
// Rules are evaluated in order; the FIRST match wins; `'refer'` (manual
// underwriting) is the default when nothing matches. Filter-style `when`
// clauses make the engine capture each condition as structured evidence:
// key, operator, threshold (developer constants) and the actual value
// summary — exactly what an audit narrative needs.

interface LendingState {
  creditScore: number;
  /** Debt-to-income ratio, monthly obligations / monthly income. */
  dti: number;
  outcome?: 'approve' | 'decline' | 'refer';
}

const LENDING_RULES = [
  { when: { creditScore: { lt: 580 } }, then: 'decline', label: 'Credit score below the 580 floor' },
  {
    when: { dti: { gt: 0.43 } },
    then: 'decline',
    label: 'Debt-to-income above the 0.43 affordability ceiling',
  },
  {
    when: { creditScore: { gte: 680 }, dti: { lte: 0.43 } },
    then: 'approve',
    label: 'Prime credit within affordability policy',
  },
] as const;

function buildLendingPolicyChart() {
  return flowChart<LendingState>(
    'Normalize',
    async (scope) => {
      const args = scope.$getArgs<{
        credit_score: number;
        monthly_debt_eur: number;
        monthly_income_eur: number;
      }>();
      scope.creditScore = args.credit_score;
      scope.dti = Math.round((args.monthly_debt_eur / args.monthly_income_eur) * 100) / 100;
    },
    'normalize',
    { description: 'Compute the policy inputs (credit score, DTI) from the applicant figures' },
  )
    .addDeciderFunction(
      'Adjudicate',
      (scope) =>
        decide(
          scope as unknown as LendingState,
          [...LENDING_RULES],
          'refer', // no rule matched → manual underwriting
        ),
      'adjudicate',
      'Apply the lending policy rules in order; first match wins',
    )
    .addFunctionBranch('decline', 'Decline', async (scope) => {
      scope.outcome = 'decline';
    })
    .addFunctionBranch('approve', 'Approve', async (scope) => {
      scope.outcome = 'approve';
    })
    .addFunctionBranch('refer', 'Refer', async (scope) => {
      scope.outcome = 'refer';
    })
    .end()
    .build();
}

// ─── In-memory OTel tracer (same stand-in as example 18) ─────────────

interface DemoSpan {
  name: string;
  attributes: Record<string, unknown>;
  events: { name: string; attributes: Record<string, unknown> }[];
}

function makeDemoTracer(): { tracer: OtelTracerLike; spans: DemoSpan[] } {
  const spans: DemoSpan[] = [];
  const tracer: OtelTracerLike = {
    startSpan(name: string, options?: OtelSpanOptions): OtelSpanLike {
      const span: DemoSpan = { name, attributes: { ...(options?.attributes ?? {}) }, events: [] };
      spans.push(span);
      return {
        setAttribute: (key, value) => (span.attributes[key] = value),
        setStatus: () => undefined,
        end: () => undefined,
        spanContext: () => ({ traceId: 'demo', spanId: `s${spans.length}`, traceFlags: 1 }),
        addEvent: (name, attributes) =>
          span.events.push({ name, attributes: { ...(attributes ?? {}) } }),
      };
    },
  };
  return { tracer, spans };
}

// ─── Persisted artifact shapes (what the auditor reads) ──────────────

/** decide() evidence captured from the policy chart's FlowRecorder channel. */
interface LedgerEntry {
  readonly capturedAt: number;
  readonly applicantId: string;
  readonly stageId: string;
  readonly chosen: string;
  readonly evidence: {
    readonly rules: ReadonlyArray<{
      readonly matched: boolean;
      readonly label?: string;
      readonly branch: string;
      readonly conditions?: ReadonlyArray<{
        readonly key: string;
        readonly op: string;
        readonly threshold: unknown;
        readonly actualSummary: string;
        readonly result: boolean;
      }>;
    }>;
    readonly chosen: string;
    readonly default: string;
  };
}

/** The external anchor — BOTH chain ends, per the documented threat model. */
interface AuditAnchor {
  readonly anchoredAt: number;
  /** End of chain: the last segment's finalHash. */
  readonly finalHash: string;
  /** Start of chain: genesis identity (head truncation is visible too). */
  readonly genesis: { readonly runId: string; readonly recordHash: string };
}

/** Minimal slice of the causal SnapshotEntry the auditor renders. */
interface StoredSnapshot {
  readonly value: {
    readonly query: string;
    readonly finalContent: string;
    readonly iterations: number;
    readonly durationMs: number;
    readonly tokenUsage: { readonly input: number; readonly output: number };
    readonly toolCalls: ReadonlyArray<{
      readonly name: string;
      readonly args: Readonly<Record<string, unknown>>;
      readonly resultPreview: string;
      readonly errored: boolean;
    }>;
  };
}

const FILES = {
  segment1: 'audit-segment-001.json',
  segment2: 'audit-segment-002.json',
  anchor: 'anchor.json', // ← stands in for the WORM store / second party
  snapshots: 'causal-snapshots.json',
  ledger: 'decision-evidence.json',
} as const;

// ─── THE AUDITOR — offline, weeks later ──────────────────────────────
//
// Loads ONLY the persisted JSON files. No agent, no provider, no LLM.
// 1. Re-verifies the hash chain (verifyAuditBundle is a pure function).
// 2. Cross-checks BOTH externally anchored chain ends.
// 3. Reconstructs the decision story as a human-readable narrative from
//    the bounded audit records, the decide() evidence ledger, and the
//    causal snapshot.

export function auditDeclinedApplication(evidenceDir: string): string {
  const read = <T>(file: string): T =>
    JSON.parse(readFileSync(join(evidenceDir, file), 'utf8')) as T;

  const segments = [read<AuditBundle>(FILES.segment1), read<AuditBundle>(FILES.segment2)];
  const anchor = read<AuditAnchor>(FILES.anchor);
  const snapshots = read<StoredSnapshot[]>(FILES.snapshots);
  const ledger = read<LedgerEntry[]>(FILES.ledger);

  const lines: string[] = [];
  const records = segments.flatMap((s) => s.records);

  // 1. Integrity — recompute the chain.
  const check = verifyAuditBundle(segments);
  lines.push(
    `chain verification    valid=${check.valid} · ${check.recordsChecked} records across ` +
      `${segments.length} per-turn segments`,
  );
  if (!check.valid) {
    lines.push(`  BROKEN at record #${check.brokenAt}: ${check.reason}`);
    return lines.join('\n');
  }

  // 2. Non-repudiation — both anchored ends must match the store.
  const genesis = records[0]!;
  const finalOk = segments[segments.length - 1]!.finalHash === anchor.finalHash;
  const genesisOk =
    genesis.hash === anchor.genesis.recordHash && genesis.meta.runId === anchor.genesis.runId;
  lines.push(
    `anchor cross-check    finalHash ${finalOk ? 'matches' : 'DOES NOT MATCH'} the external ` +
      `anchor · genesis identity ${genesisOk ? 'matches' : 'DOES NOT MATCH'}`,
  );

  // 3. The decision story, from the bounded audit records.
  lines.push('', '— Audit narrative (from the hash-chained records) —');
  for (const r of records) {
    const p = r.payload as Record<string, unknown>;
    switch (r.eventType) {
      case 'audit.genesis': {
        const lib = p.library as { name: string; version: string };
        const versions = (p.versions ?? {}) as Record<string, string>;
        lines.push(
          `  [genesis]    run ${String(p.runId).slice(0, 8)}… by '${String(p.agent)}' · ` +
            `${lib.name} ${lib.version} · ` +
            Object.entries(versions)
              .map(([k, v]) => `${k} ${v}`)
              .join(' · '),
        );
        break;
      }
      case 'agentfootprint.agent.turn_start':
        lines.push(
          `  [turn]       user prompt received (${String(p.userPrompt)} — bounded; ` +
            `the text itself lives in the causal snapshot)`,
        );
        break;
      case 'agentfootprint.permission.check':
        if (p.result === 'deny') {
          lines.push(
            `  [permission] ${String(p.capability)} → ${String(p.target)}: DENY ` +
              `(rule ${String(p.policyRuleId)} — ${String(p.rationale)})`,
          );
        }
        break;
      case 'agentfootprint.validation.args_invalid': {
        const issues = (p.issues as Array<{ path: string; expected: string; got: string }>) ?? [];
        lines.push(
          `  [validation] ${String(p.toolName)} REJECTED before dispatch: ` +
            issues.map((i) => `${i.path || 'arguments'} expected ${i.expected}, got ${i.got}`).join('; ') +
            ` (enforced=${String(p.enforced)} — the model was told and retried)`,
        );
        break;
      }
      case 'agentfootprint.stream.tool_start':
        lines.push(`  [tool]       ${String(p.toolName)} called (args ${String(p.args)})`);
        break;
      case 'agentfootprint.agent.route_decided':
        lines.push(`  [route]      iteration ${String(p.iterIndex)} → ${String(p.chosen)} — ${String(p.rationale)}`);
        break;
      case 'agentfootprint.agent.turn_end':
        lines.push(
          `  [turn end]   final answer ${String(p.finalContent)} · ` +
            `${String(p.iterationCount)} iterations · ` +
            `${String(p.totalInputTokens)}/${String(p.totalOutputTokens)} tokens in/out`,
        );
        break;
      default:
        break; // every other record participates in the chain silently
    }
  }

  // 4. WHICH RULE FIRED — the decide() evidence ledger.
  lines.push('', '— Decision evidence (footprintjs decide() ledger) —');
  for (const entry of ledger) {
    const fired = entry.evidence.rules.find((r) => r.matched);
    lines.push(
      `  applicant ${entry.applicantId} · stage '${entry.stageId}' → chose '${entry.evidence.chosen}'` +
        (entry.evidence.chosen === entry.evidence.default ? ' (default — no rule matched)' : ''),
    );
    for (const rule of entry.evidence.rules) {
      lines.push(
        `    ${rule === fired ? '▶ FIRED   ' : '  checked '}"${rule.label ?? rule.branch}" → ${rule.branch}`,
      );
      for (const c of rule.conditions ?? []) {
        lines.push(
          `        ${c.key} ${c.op} ${JSON.stringify(c.threshold)} → ${c.actualSummary} (${c.result})`,
        );
      }
      if (rule === fired) break; // first match wins — later rules were not evaluated
    }
  }

  // 5. WHAT THE AGENT SAID — the causal snapshot of the decline turn.
  const decline = snapshots[0];
  if (decline) {
    lines.push('', '— Causal snapshot (what the agent said and did) —');
    lines.push(`  Q: ${decline.value.query}`);
    lines.push(`  A: ${decline.value.finalContent}`);
    for (const t of decline.value.toolCalls) {
      const preview = t.resultPreview.replace(/\n+/g, ' ⏎ ');
      lines.push(
        `  tool ${t.name}(${JSON.stringify(t.args)})${t.errored ? ' [errored]' : ''} → ${preview}`,
      );
    }
  }

  return lines.join('\n');
}

// ─── The capture run ─────────────────────────────────────────────────

export async function run(
  input: string,
  provider?: import('../../src/index.js').LLMProvider,
): Promise<unknown> {
  // 1. The three observers — one event stream, three artifacts.
  const audit = auditExport({
    agent: 'loan-decisioning-agent',
    versions: { app: '1.0.0', lendingPolicy: '2026-03' }, // pinned in the genesis record
  });
  const { tracer, spans } = makeDemoTracer();
  const otel = otelObservability({
    serviceName: 'loan-decisioning-agent',
    tracer,
    genAiSpanNames: true,
  });

  // 2. decide() evidence ledger — the FlowRecorder channel of the policy
  //    chart's OWN executor (a tool runs its flowchart on a fresh
  //    executor, so we attach the taps there; see the follow-up note in
  //    the paired .md about feeding this into the causal snapshot natively).
  const decisionLedger: LedgerEntry[] = [];

  // 3. Tools. `adjudicate_application` mounts the footprintjs policy
  //    chart; its strict inputSchema is what the #9 validation rejection
  //    fires against.
  const fetchCreditReport = defineTool<{ applicant_id: string }, string>({
    name: 'fetch_credit_report',
    description: 'Fetch the credit bureau report for an applicant id.',
    inputSchema: {
      type: 'object',
      properties: { applicant_id: { type: 'string', description: 'Internal applicant id.' } },
      required: ['applicant_id'],
    },
    execute: ({ applicant_id }) =>
      JSON.stringify({ applicantId: applicant_id, creditScore: 632, openTradelines: 7, delinquencies12m: 0 }),
  });

  const fetchBankStatements = defineTool<{ applicant_id: string; months: number }, string>({
    name: 'fetch_bank_statements',
    description: 'Fetch raw bank statements for an applicant (last N months).',
    inputSchema: {
      type: 'object',
      properties: { applicant_id: { type: 'string' }, months: { type: 'integer' } },
      required: ['applicant_id', 'months'],
    },
    execute: () => {
      throw new Error('unreachable — the permission policy denies this tool');
    },
  });

  const adjudicate = defineTool<
    {
      applicant_id: string;
      credit_score: number;
      monthly_debt_eur: number;
      monthly_income_eur: number;
      requested_amount_eur: number;
    },
    string
  >({
    name: 'adjudicate_application',
    description:
      'Run the bank lending policy over the applicant figures. Returns the decision and the rule that fired.',
    inputSchema: {
      type: 'object',
      properties: {
        applicant_id: { type: 'string' },
        credit_score: { type: 'integer', description: 'Bureau credit score.' },
        monthly_debt_eur: { type: 'number' },
        monthly_income_eur: { type: 'number' },
        requested_amount_eur: { type: 'number' },
      },
      required: [
        'applicant_id',
        'credit_score',
        'monthly_debt_eur',
        'monthly_income_eur',
        'requested_amount_eur',
      ],
    },
    execute: async (args, ctx) => {
      const executor = new FlowChartExecutor(buildLendingPolicyChart());
      // decide() evidence travels on footprintjs's FlowRecorder channel —
      // bridge it into the OTel spans (documented pattern, example 18)…
      executor.attachCombinedRecorder(otel.decisionEvidenceRecorder());
      // …and into the persisted ledger (example-level tap).
      executor.attachCombinedRecorder({
        id: 'decision-ledger',
        onDecision(event: FlowDecisionEvent): void {
          if (event.evidence === undefined) return;
          decisionLedger.push({
            capturedAt: Date.now(),
            applicantId: args.applicant_id,
            stageId: String(event.traversalContext?.stageId ?? event.decider),
            chosen: String(event.chosen),
            evidence: event.evidence as unknown as LedgerEntry['evidence'],
          });
        },
      });
      const env: { signal?: AbortSignal } = {};
      if (ctx.signal) env.signal = ctx.signal;
      await executor.run({ input: args, env });
      const state = executor.getSnapshot().sharedState as unknown as LendingState;
      const fired = decisionLedger[decisionLedger.length - 1];
      const rule = fired?.evidence.rules.find((r) => r.matched)?.label ?? 'no rule — default';
      return JSON.stringify({ outcome: state.outcome, rule, creditScore: state.creditScore, dti: state.dti });
    },
  });

  // 4. The permission policy — deny raw bank statements (data
  //    minimization): the credit report already carries what the policy
  //    needs, so pulling full statements exceeds the purpose.
  const dataMinimization: PermissionChecker = {
    name: 'lending-data-minimization',
    check: async (req) => {
      if (req.target === 'fetch_bank_statements') {
        return {
          result: 'deny',
          policyRuleId: 'lending-data-minimization-v2',
          rationale:
            'raw bank statements exceed the data needed for a creditworthiness assessment (GDPR Art. 5(1)(c))',
        };
      }
      return { result: 'allow' };
    },
  };

  // 5. Causal memory — the snapshot store. In production this is Redis /
  //    Postgres / DynamoDB via `agentfootprint/memory-providers`; here the
  //    in-memory store's entries are exported to JSON below.
  const store = new InMemoryStore();
  const causal = defineMemory({
    id: 'loan-decisions',
    description: 'Persists decision snapshots for follow-up questions and audits.',
    type: MEMORY_TYPES.CAUSAL,
    strategy: { kind: MEMORY_STRATEGIES.TOP_K, topK: 1, threshold: 0.5, embedder: mockEmbedder() },
    store,
    projection: SNAPSHOT_PROJECTIONS.DECISIONS,
  });
  const identity = { tenant: 'helios-bank', conversationId: 'application-APP-2209' };

  // 6. Scripted mock (when no real provider is injected): pulls the
  //    credit report AND the (denied) bank statements, sends the
  //    adjudication with a WRONG TYPE once (credit_score as a string →
  //    #9 rejection), corrects itself, then declines citing the rule.
  let llmCalls = 0;
  const scripted = mock({
    respond: (req) => {
      llmCalls++;
      const lastTool = [...req.messages].reverse().find((m) => m.role === 'tool');
      if (llmCalls === 1) {
        return {
          content: 'Pulling the applicant file.',
          toolCalls: [
            { id: 'c1', name: 'fetch_credit_report', args: { applicant_id: 'A-1043' } },
            { id: 'c2', name: 'fetch_bank_statements', args: { applicant_id: 'A-1043', months: 3 } },
          ],
          usage: { input: 220, output: 30 },
          stopReason: 'tool_use',
        };
      }
      if (llmCalls === 2) {
        return {
          content: 'Adjudicating against the lending policy.',
          toolCalls: [
            {
              id: 'c3',
              name: 'adjudicate_application',
              // credit_score as a STRING — the #9 validator rejects this
              // before dispatch and the model sees the typed issue list.
              args: {
                applicant_id: 'A-1043',
                credit_score: '632',
                monthly_debt_eur: 2340,
                monthly_income_eur: 4500,
                requested_amount_eur: 240000,
              } as never,
            },
          ],
          usage: { input: 310, output: 45 },
          stopReason: 'tool_use',
        };
      }
      if (typeof lastTool?.content === 'string' && lastTool.content.includes('Invalid arguments')) {
        return {
          content: 'Correcting the argument types.',
          toolCalls: [
            {
              id: 'c4',
              name: 'adjudicate_application',
              args: {
                applicant_id: 'A-1043',
                credit_score: 632,
                monthly_debt_eur: 2340,
                monthly_income_eur: 4500,
                requested_amount_eur: 240000,
              },
            },
          ],
          usage: { input: 360, output: 48 },
          stopReason: 'tool_use',
        };
      }
      if (typeof lastTool?.content === 'string' && lastTool.content.includes('"outcome"')) {
        return {
          content:
            'Application APP-2209 is DECLINED. The adjudication fired the rule ' +
            '"Debt-to-income above the 0.43 affordability ceiling": the applicant\'s DTI of 0.52 ' +
            '(2340/4500 EUR monthly) exceeds the 0.43 policy maximum. Credit score 632 passed the ' +
            '580 floor and was not the blocking factor.',
          usage: { input: 540, output: 90 },
          stopReason: 'end_turn',
        };
      }
      return {
        content: 'Noted — the decline decision and the applicant notification are on record.',
        usage: { input: 180, output: 22 },
        stopReason: 'end_turn',
      };
    },
  });

  const agent = Agent.create({
    provider: provider ?? scripted,
    model: 'mock',
    permissionChecker: dataMinimization,
    toolArgValidation: 'enforce', // the default — explicit for the example
    maxIterations: 6,
  })
    .system(
      'You are a loan decisioning agent at Helios Bank. Always adjudicate via the ' +
        'adjudicate_application tool — never decide on your own.',
    )
    .tool(fetchCreditReport)
    .tool(fetchBankStatements)
    .tool(adjudicate)
    .memory(causal)
    .build();

  // 7. Multi-strategy attach: each enable.observability() call subscribes
  //    independently to the same dispatcher — audit AND spans in parallel.
  const stopAudit = agent.enable.observability({ strategy: audit });
  const stopOtel = agent.enable.observability({ strategy: otel });

  console.log('══ CAPTURE — the "three weeks ago" run ══');
  let declineAnswer: unknown;
  let segment1: AuditBundle;
  let segment2: AuditBundle;
  let snapshots: readonly unknown[];
  try {
    // TURN 1 — the decline. Evidence ships PER TURN: drain the audit
    // segment and export the turn's causal snapshot together.
    declineAnswer = await agent.run({ message: input, identity });
    segment1 = audit.drain(); // the chain survives drains
    // Export now, not after turn 2: the agent seeds `turnNumber = 1` on
    // every run, so a later turn in the SAME conversation overwrites the
    // snapshot id `snap-1`. (Reported as a library follow-up — see the
    // paired .md.)
    snapshots = (await store.list(identity)).entries;

    // TURN 2 — a follow-up on the same case (shows per-turn segmentation;
    // the causal memory read injects the turn-1 snapshot here).
    await agent.run({
      message: 'Confirm what was decided for application APP-2209 — the applicant was notified.',
      identity,
    });
    segment2 = audit.drain();
  } finally {
    stopAudit();
    stopOtel();
  }
  console.log(`decision: ${String(declineAnswer)}`);

  // 8. Persist the evidence — plain JSON, store anywhere. The anchor goes
  //    to a SECOND file: in production a WORM bucket, an RFC 3161
  //    timestamp, or simply a second party.
  const evidenceDir = mkdtempSync(join(tmpdir(), 'regulated-decisioning-'));
  const anchor: AuditAnchor = {
    anchoredAt: Date.now(),
    finalHash: segment2.finalHash,
    genesis: { runId: String(segment1.records[0]!.meta.runId), recordHash: segment1.records[0]!.hash },
  };
  writeFileSync(join(evidenceDir, FILES.segment1), JSON.stringify(segment1, null, 2));
  writeFileSync(join(evidenceDir, FILES.segment2), JSON.stringify(segment2, null, 2));
  writeFileSync(join(evidenceDir, FILES.anchor), JSON.stringify(anchor, null, 2));
  writeFileSync(join(evidenceDir, FILES.snapshots), JSON.stringify(snapshots, null, 2));
  writeFileSync(join(evidenceDir, FILES.ledger), JSON.stringify(decisionLedger, null, 2));

  const evidenceEvents = spans.flatMap((s) => s.events).filter((e) => e.name === 'agentfootprint.decision.evidence');
  console.log(
    `captured: ${segment1.header.recordCount}+${segment2.header.recordCount} audit records in 2 ` +
      `per-turn segments · ${spans.length} OTel spans (${evidenceEvents.length} decide() evidence ` +
      `event) · ${snapshots.length} causal snapshots · ${decisionLedger.length} ledger entry`,
  );
  console.log(`persisted: 5 files → ${evidenceDir}`);

  // ── Weeks later. A different process. Nothing live. ────────────────
  console.log('\n══ AUDITOR — offline (no agent, no provider, no LLM) ══');
  console.log(auditDeclinedApplication(evidenceDir));

  // ── The demo moment: flip one byte in the stored evidence ──────────
  // Someone edits the permission denial's rationale after the fact —
  // verification names the exact record.
  console.log('\n══ Tamper demo ══');
  const tampered = JSON.parse(readFileSync(join(evidenceDir, FILES.segment1), 'utf8')) as AuditBundle;
  const denial = (tampered.records.find((r) => r.eventType === 'agentfootprint.permission.check') ??
    tampered.records[1]!) as { payload: { rationale?: string }; seq: number };
  denial.payload.rationale = 'applicant consented to full statement review'; // the forged justification
  const result = verifyAuditBundle([tampered, segment2]);
  console.log(`rewrote the permission denial rationale in record #${denial.seq}…`);
  console.log(
    `verifyAuditBundle: valid=${result.valid} brokenAt=#${result.brokenAt} — ${result.reason}`,
  );

  rmSync(evidenceDir, { recursive: true, force: true });
  return declineAnswer;
}

if (isCliEntry(import.meta.url)) {
  run(meta.defaultInput ?? '')
    .then(printResult)
    .catch(console.error);
}
