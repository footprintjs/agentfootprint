/**
 * 01 — Trace debug session (RFC-003 Part C: the introspection toolpack).
 *
 * "The framework's internal tool for itself."
 *
 * A loan pipeline carries a PLANTED BUG: the Normalize stage computes the
 * debt-to-income ratio against ANNUAL income instead of monthly income, so
 * DTI comes out ~0.035 instead of ~0.42 — and the decide() policy approves
 * an application it should have declined. The wrong value flows through a
 * decision into the final letter.
 *
 * Then a SECOND, scripted "debugger LLM" session investigates — entirely
 * from the COMPLETED run's artifacts (snapshot + commit log + control-dep
 * lookup), no re-run, no provider, no API key. It navigates by step ids
 * exactly the way a cheap debugging model would:
 *
 *   run_overview            → what happened, broadly? (the entry point)
 *   who_wrote('decision')   → which step decided?
 *   trace_slice(...)        → the causal chain behind the decision,
 *                             [control: rule label] edges included
 *   trace_node / get_value  → drill the suspicious step, fetch exact values
 *   verdict                 → normalize#1 divided monthly debt by ANNUAL
 *                             income. Culprit named.
 *
 * THE HEADLINE: the session is charged only for what it OPENS. The
 * transcript prints total chars served by the tools vs the size of the full
 * trace dump — feed the slice, not the trace.
 *
 * Honesty markers on display (A2): the Intake stage consumes `$getArgs()`
 * (untracked input) — every view of it carries a ⚠ incomplete-slice marker.
 *
 * No LLM is called: the toolpack serves any model; the script stands in for
 * one so the example is deterministic and runs offline (the same offline
 * auditor pattern as examples/features/20).
 *
 * Run:  npx tsx examples/observability/01-trace-debug-session.ts
 */

import { decide, flowChart, FlowChartExecutor } from 'footprintjs';
import { controlDepRecorder } from 'footprintjs/trace';

import { callTraceTool, traceToolpack } from '../../src/observe.js';
import { isCliEntry, type ExampleMeta } from '../helpers/cli.js';

export const meta: ExampleMeta = {
  id: 'observability/01-trace-debug-session',
  title: 'Trace debug session — the introspection toolpack (RFC-003 Part C)',
  group: 'observability',
  description:
    'A planted wrong value (DTI computed against annual income) flows through a decide() ' +
    'decision; a scripted debugger session then finds the culprit stage from the completed ' +
    "run's artifacts alone via traceToolpack — run_overview → trace_slice → trace_node → " +
    'get_value — and prints chars-served vs full-dump size (feed the slice, not the trace).',
  defaultInput: null,
  providerSlots: [],
  tags: ['observability', 'trace', 'debugging', 'causal-slice', 'tools', 'rfc-003'],
};

// ─── Part 1 — the buggy pipeline ───────────────────────────────────────────

interface LoanState {
  applicant: string;
  annualIncome: number;
  monthlyIncome: number;
  monthlyDebt: number;
  creditScore: number;
  /** The bulky raw payload real runs carry — what makes dump-feeding expensive. */
  bureauReport: Array<Record<string, unknown>>;
  dti: number;
  decision: string;
  decisionReason: string;
  letter: string;
}

/** Deterministic stand-in for a raw credit-bureau pull (~40 tradelines). */
function fakeBureauReport(): Array<Record<string, unknown>> {
  return Array.from({ length: 40 }, (_, i) => ({
    tradeline: `TL-${1000 + i}`,
    furnisher: `Lender ${String.fromCharCode(65 + (i % 26))}`,
    opened: `20${10 + (i % 14)}-0${1 + (i % 9)}-15`,
    balanceCents: 250000 + i * 13577,
    limitCents: 500000 + i * 20011,
    status: i % 7 === 0 ? 'closed' : 'open',
    paymentHistory: Array.from({ length: 24 }, (_, m) => ((i + m) % 11 === 0 ? 30 : 0)),
  }));
}

const POLICY_RULES = [
  { when: { creditScore: { lt: 620 } }, then: 'decline', label: 'Credit score below the 620 floor' },
  { when: { dti: { gt: 0.4 } }, then: 'decline', label: 'DTI above the 0.40 affordability ceiling' },
  {
    when: { creditScore: { gte: 680 }, dti: { lte: 0.4 } },
    then: 'approve',
    label: 'Prime credit within affordability policy',
  },
] as const;

function buildBuggyLoanChart() {
  return flowChart<LoanState>(
    'Intake',
    async (scope) => {
      // $getArgs() is an UNTRACKED input — footprintjs stamps this step with
      // an untrackedSources honesty marker, and every toolpack view shows ⚠.
      const args = scope.$getArgs<{ applicantId: string }>();
      scope.applicant = args.applicantId;
      scope.annualIncome = 66000;
      scope.monthlyIncome = 5500;
      scope.monthlyDebt = 2310;
      scope.creditScore = 702;
      scope.bureauReport = fakeBureauReport();
    },
    'intake',
    { description: 'Seed applicant figures (income, debt, credit score) from the application' },
  )
    .addFunction(
      'Normalize',
      async (scope) => {
        // ── THE PLANTED BUG ──────────────────────────────────────────────
        // DTI must be monthlyDebt / monthlyIncome (≈ 0.42 → decline).
        // Dividing by ANNUAL income yields ≈ 0.035 → wrongly approved.
        scope.dti = Math.round((scope.monthlyDebt / scope.annualIncome) * 1000) / 1000;
      },
      'normalize',
      'Compute the affordability ratio (DTI) from the applicant figures',
    )
    .addDeciderFunction(
      'Adjudicate',
      (scope) => decide(scope as unknown as LoanState, [...POLICY_RULES], 'refer'),
      'adjudicate',
      'Apply the lending policy rules in order; first match wins',
    )
    .addFunctionBranch('approve', 'Approve', async (scope) => {
      scope.decision = 'approve';
      scope.decisionReason = 'within affordability policy';
    })
    .addFunctionBranch('decline', 'Decline', async (scope) => {
      scope.decision = 'decline';
      scope.decisionReason = 'outside affordability policy';
    })
    .addFunctionBranch('refer', 'Refer', async (scope) => {
      scope.decision = 'refer';
      scope.decisionReason = 'manual underwriting required';
    })
    .end()
    .addFunction(
      'Notify',
      async (scope) => {
        scope.letter =
          `Dear ${scope.applicant}: your application was ${scope.decision}d ` +
          `(${scope.decisionReason}; assessed DTI ${scope.dti}).`;
      },
      'notify',
      'Draft the applicant letter from the decision',
    )
    .build();
}

// ─── Part 2 — the scripted debugger session ────────────────────────────────

interface SessionTurn {
  thought: string;
  tool: string;
  args: Record<string, unknown>;
}

/**
 * What a cheap debugging model does with the toolpack: enter at the
 * overview, follow the decision backwards, drill the suspicious step,
 * fetch the exact numbers, name the culprit. Scripted here so the example
 * is deterministic — the tools themselves are model-agnostic.
 */
const SESSION: SessionTurn[] = [
  {
    thought: 'Complaint: application APP-7 was approved but looks unaffordable. What ran?',
    tool: 'run_overview',
    args: {},
  },
  {
    thought: "The run decided something. Which step wrote 'decision'?",
    tool: 'who_wrote',
    args: { key: 'decision' },
  },
  {
    thought: 'Approve fired. What chain of steps produced the data behind that approval?',
    tool: 'trace_slice',
    args: { runtimeStageId: 'approve#3' },
  },
  {
    thought:
      "The control edge says the 'Prime credit within affordability policy' rule matched, " +
      'and dti came from normalize#1. Inspect that step.',
    tool: 'trace_node',
    args: { runtimeStageId: 'normalize#1' },
  },
  {
    thought:
      'Where did its inputs come from? Drill the intake step — the bulky bureau payload ' +
      'arrives as a bounded preview with its true size, not a dump.',
    tool: 'trace_node',
    args: { runtimeStageId: 'intake#0' },
  },
  {
    thought: 'dti looks far too low. Fetch the exact value.',
    tool: 'get_value',
    args: { runtimeStageId: 'normalize#1', key: 'dti' },
  },
  {
    thought: 'Now the inputs normalize read: monthly debt and the income figures.',
    tool: 'get_value',
    args: { runtimeStageId: 'intake#0', key: 'monthlyDebt' },
  },
  {
    thought: 'And the monthly income it SHOULD have divided by.',
    tool: 'get_value',
    args: { runtimeStageId: 'intake#0', key: 'monthlyIncome' },
  },
];

const VERDICT =
  'VERDICT: dti = 0.035 = 2310 / 66000 — normalize#1 divided monthly debt by ANNUAL income ' +
  '(annualIncome) instead of monthly income (5500; true DTI ≈ 0.42 > 0.40 ceiling → should ' +
  'have been declined). Culprit: normalize#1 ("Normalize").';

export interface TraceDebugSessionResult {
  /** The step the scripted session identifies as the bug's origin. */
  culprit: string;
  /** What the buggy run decided (the bug manifesting). */
  decision: string;
  toolCalls: number;
  /** Total chars the toolpack served across the session. */
  charsServed: number;
  /** Size of the full trace dump (snapshot JSON + narrative). */
  dumpChars: number;
  /** charsServed / dumpChars — THE headline ratio. */
  ratio: number;
  transcript: string;
}

export async function run(_input?: string | null): Promise<TraceDebugSessionResult> {
  // ── Run the buggy pipeline once (the "production" run) ──────────────────
  const executor = new FlowChartExecutor(buildBuggyLoanChart());
  const controlDeps = controlDepRecorder();
  executor.attachCombinedRecorder(controlDeps);
  executor.enableNarrative();
  await executor.run({ input: { applicantId: 'APP-7' } });

  const snapshot = executor.getSnapshot();
  const narrative = executor.getNarrativeEntries().map((entry) => entry.text);
  const decision = String((snapshot.sharedState as { decision?: unknown }).decision);
  if (decision !== 'approve') {
    throw new Error(`expected the planted bug to produce 'approve', got '${decision}'`);
  }

  // ── The debugger session: artifacts only — no re-run, no provider ───────
  const tools = traceToolpack({
    snapshot,
    controlDeps: controlDeps.asLookup(),
    narrative,
  });

  const out: string[] = [];
  let charsServed = 0;
  out.push('═══ TRACE DEBUG SESSION (scripted debugger LLM over completed-run artifacts) ═══');
  for (const turn of SESSION) {
    out.push('', `🧠 ${turn.thought}`, `→ ${turn.tool}(${JSON.stringify(turn.args)})`);
    const response = await callTraceTool(tools, turn.tool, turn.args);
    charsServed += response.length;
    out.push(response.replace(/^/gm, '   '));
  }
  out.push('', `🧠 ${VERDICT}`);

  // ── The token-economics headline ─────────────────────────────────────────
  const dumpChars = JSON.stringify(snapshot).length + narrative.join('\n').length;
  const ratio = charsServed / dumpChars;
  out.push(
    '',
    '═══ TOKEN ECONOMICS ═══',
    `tool calls: ${SESSION.length}`,
    `chars served by the toolpack: ${charsServed}`,
    `full trace dump (snapshot JSON + narrative): ${dumpChars} chars`,
    `ratio: ${(ratio * 100).toFixed(1)}% — feed the slice, not the trace.`,
  );

  const transcript = out.join('\n');
  console.log(transcript);

  return {
    culprit: 'normalize#1',
    decision,
    toolCalls: SESSION.length,
    charsServed,
    dumpChars,
    ratio,
    transcript,
  };
}

if (isCliEntry(import.meta.url)) {
  run().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
