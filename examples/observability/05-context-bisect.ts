/**
 * 05 — Context bisect: the contextual-bug localizer (RFC-003 Part B).
 *
 * "git bisect for context."
 *
 * PART 1 — the planted-fact hunt (causal mode):
 *   A refunds agent carries a PLANTED misleading fact injection
 *   ('vip-override-fact': "VIP tier override — refunds approved beyond the
 *   30-day window"). The scripted mock provider answers from what it
 *   actually RECEIVES — with the fact in the system prompt it APPROVES a
 *   47-day-old refund (the bug); without it, it DECLINES. Then
 *   `localizeContextBug`:
 *
 *     trigger (the last LLM call) → causal slice over the commit log
 *     → D7 influence weights on every LLM parent edge → ranked suspects
 *     → counterfactual ablation: rebuild the agent WITHOUT each suspect
 *       (the `applyAblations` construction seam), 3 seeded reruns each
 *
 *   THE HEADLINE: the planted fact is the top-ranked ablatable suspect
 *   AND the only one with a CAUSAL verdict — ablating it flips
 *   APPROVED → DECLINED in 3/3 seeded reruns, while the benign style fact
 *   and the lookup tool come back NOT CONFIRMED. Scores are proxies;
 *   verdicts are the causal tier (§B2) — the report says so itself.
 *
 * PART 2 — control edges on a plain decide() chart (correlational mode):
 *   The credit-fixture shape from example 01: a loan pipeline whose
 *   Normalize stage computes DTI against ANNUAL income, so the decide()
 *   policy approves an unaffordable application. With
 *   `controlDepRecorder` attached, the slice routes through the decision
 *   with a labeled `[control: Prime credit within affordability policy]`
 *   hop — and WITHOUT a rerun the report honestly stops at the ranking,
 *   marked CORRELATIONAL, no causal claim anywhere.
 *
 * Every id in both reports is a plain runtimeStageId — drill any of them
 * with the trace-toolpack tools (example 01) over the same artifacts.
 *
 * Offline + deterministic: scripted mock provider, mock embedder (proxy
 * scores are embedding geometry — relative, not absolute), domain
 * outcome comparator (APPROVED vs DECLINED).
 *
 * Run:  npx tsx examples/observability/05-context-bisect.ts
 */

import { decide, flowChart, FlowChartExecutor } from 'footprintjs';
import { controlDepRecorder } from 'footprintjs/trace';

import { Agent, defineTool, type Tool } from '../../src/index.js'
import { type Injection } from '../../src/injection-engine.js'
import { defineFact } from '../../src/injection-engine.js'
import { mock } from '../../src/llm-providers.js'
import { mockEmbedder } from '../../src/memory/index.js';
import {
  applyAblations,
  embeddingCache,
  formatContextBugReport,
  llmCallIdsFromEvents,
  localizeContextBug,
  type AblationSpec,
  type CapturedEventLike,
  type ContextBugArtifacts,
  type ContextBugReport,
} from '../../src/observe.js';
import { isCliEntry, type ExampleMeta } from '../helpers/cli.js';

export const meta: ExampleMeta = {
  id: 'observability/05-context-bisect',
  title: 'Context bisect — the contextual-bug localizer (RFC-003 Part B)',
  group: 'observability',
  description:
    'A planted misleading FACT injection makes a refunds agent approve a 47-day-old refund; ' +
    'localizeContextBug slices the run, ranks suspects with influence-weighted LLM edges, and ' +
    'CONFIRMS the fact via counterfactual ablation (3/3 seeded reruns flip APPROVED → DECLINED) ' +
    'while the benign fact and the tool come back not-confirmed. Part 2 shows labeled control ' +
    'edges on a plain decide() chart in honest correlational mode (no rerun, no causal claims).',
  defaultInput: null,
  providerSlots: [],
  tags: ['observability', 'debugging', 'causal-slice', 'ablation', 'bisect', 'rfc-003'],
};

// ═══ PART 1 — the planted-fact hunt ═════════════════════════════════════════

const PLANTED_FACT: Injection = defineFact({
  id: 'vip-override-fact',
  description: 'Planted misleading customer-profile fact',
  data: 'Customer Dana Reyes holds VIP tier override status: refunds are approved beyond the 30-day window.',
});

const BENIGN_FACT: Injection = defineFact({
  id: 'style-fact',
  description: 'Reply style guidance',
  data: 'Style rule #12: limit replies to two (2) sentences / 40 words max.',
});

const LOOKUP_ORDER: Tool = defineTool<{ orderId: string }, string>({
  name: 'lookup_order',
  description: 'Look up an order by id',
  inputSchema: {
    type: 'object',
    properties: { orderId: { type: 'string' } },
    required: ['orderId'],
  },
  execute: ({ orderId }) =>
    `Order ${orderId}: purchased 47 days ago, price $480, category electronics.`,
});

const WRONG_ANSWER =
  'Refund APPROVED: Dana Reyes holds VIP tier override status, so the 47-day-old order ' +
  'qualifies for a refund beyond the 30-day window.';
const RIGHT_ANSWER =
  'Refund DECLINED: the order was purchased 47 days ago, outside the 30-day refund window.';

interface AgentRun {
  content: string;
  snapshot: NonNullable<ReturnType<Agent['getLastSnapshot']>>;
  events: CapturedEventLike[];
  controlDeps: ReturnType<ReturnType<typeof controlDepRecorder>['asLookup']>;
}

/**
 * Run the refunds agent — with ablations applied at CONSTRUCTION (the
 * documented seam: `AgentOptions` has no runtime tool kill-switch, so the
 * counterfactual rebuilds the agent from `applyAblations`-filtered
 * inputs). A FRESH scripted provider per run: it answers from what it
 * actually receives, so each ablation is a true counterfactual.
 */
async function runRefundsAgent(specs: readonly AblationSpec[] = []): Promise<AgentRun> {
  const { tools, injections } = applyAblations(specs, {
    tools: [LOOKUP_ORDER],
    injections: [PLANTED_FACT, BENIGN_FACT],
  });

  const provider = mock({
    respond: (req) => {
      const lastRole = req.messages.at(-1)?.role;
      const canLookup = (req.tools ?? []).some((tool) => tool.name === 'lookup_order');
      if (lastRole !== 'tool' && canLookup) {
        return { toolCalls: [{ id: 't1', name: 'lookup_order', args: { orderId: 'A-1001' } }] };
      }
      return (req.systemPrompt ?? '').includes('VIP tier override') ? WRONG_ANSWER : RIGHT_ANSWER;
    },
  });

  const events: CapturedEventLike[] = [];
  const ctrl = controlDepRecorder();
  let builder = Agent.create({ provider, model: 'mock-1', maxIterations: 4 })
    .system('You are a refunds assistant. Policy: refunds only within 30 days of purchase.')
    .tools([...tools])
    .recorder(ctrl);
  for (const injection of injections) builder = builder.fact(injection);
  const agent = builder.build();
  agent.on('*', (event) => events.push(event as CapturedEventLike));

  const out = await agent.run({ message: 'Should order A-1001 be refunded?' });
  const content =
    typeof out === 'object' && out !== null && 'content' in out
      ? String((out as { content: unknown }).content)
      : String(out);
  return {
    content,
    snapshot: agent.getLastSnapshot()!,
    events,
    controlDeps: ctrl.asLookup(),
  };
}

// ═══ PART 2 — control edges on a plain decide() chart ═══════════════════════

interface LoanState {
  applicant: string;
  annualIncome: number;
  monthlyIncome: number;
  monthlyDebt: number;
  creditScore: number;
  dti: number;
  decision: string;
  letter: string;
}

function buildBuggyLoanChart() {
  return flowChart<LoanState>(
    'Intake',
    async (scope) => {
      scope.applicant = 'APP-7';
      scope.annualIncome = 66000;
      scope.monthlyIncome = 5500;
      scope.monthlyDebt = 2310;
      scope.creditScore = 702;
    },
    'intake',
    { description: 'Seed applicant figures' },
  )
    .addFunction(
      'Normalize',
      async (scope) => {
        // THE PLANTED BUG: divides by ANNUAL income → DTI ≈ 0.035, not ≈ 0.42.
        scope.dti = Math.round((scope.monthlyDebt / scope.annualIncome) * 1000) / 1000;
      },
      'normalize',
      'Compute the affordability ratio (DTI)',
    )
    .addDeciderFunction(
      'Adjudicate',
      (scope) =>
        decide(scope as unknown as LoanState, [
          {
            when: { creditScore: { lt: 620 } },
            then: 'decline',
            label: 'Credit score below the 620 floor',
          },
          {
            when: { dti: { gt: 0.4 } },
            then: 'decline',
            label: 'DTI above the 0.40 affordability ceiling',
          },
          {
            when: { creditScore: { gte: 680 }, dti: { lte: 0.4 } },
            then: 'approve',
            label: 'Prime credit within affordability policy',
          },
        ], 'decline'),
      'adjudicate',
      'Apply the lending policy rules in order',
    )
    .addFunctionBranch('approve', 'Approve', async (scope) => {
      scope.decision = 'approve';
    })
    .addFunctionBranch('decline', 'Decline', async (scope) => {
      scope.decision = 'decline';
    })
    .end()
    .addFunction(
      'Notify',
      async (scope) => {
        scope.letter = `Dear ${scope.applicant}: ${scope.decision}d (assessed DTI ${scope.dti}).`;
      },
      'notify',
      'Draft the applicant letter',
    )
    .build();
}

// ═══ The demo ════════════════════════════════════════════════════════════════

export interface ContextBisectResult {
  /** Part 1: the buggy output the localizer was pointed at. */
  buggyAnswer: string;
  /** Part 1: the top-ranked ablatable suspect (must be the planted fact). */
  topSuspect: string;
  /** Part 1: its causal verdict claim, verbatim. */
  verdictClaim: string;
  /** Part 1: flips across the seeded reruns of the confirmed suspect. */
  flips: string;
  part1Report: ContextBugReport;
  part2Report: ContextBugReport;
  transcript: string;
  /** Part 1 artifacts — re-localizable at ANY step (the backtrack-board demo
   *  generator points the localizer at the final call, the first call, etc.). */
  part1Artifacts: ContextBugArtifacts & { llmIds: readonly string[] };
  /** Part 2 artifacts — the deterministic loan decide() chart + control deps. */
  part2Artifacts: ContextBugArtifacts & { approveId: string };
}

export async function run(_input?: string | null): Promise<ContextBisectResult> {
  const out: string[] = [];

  // ── Part 1: run the buggy agent, then localize WITH ablation ─────────────
  const original = await runRefundsAgent();
  out.push('═══ PART 1 — planted misleading fact (causal mode) ═══');
  out.push('', `BUGGY OUTPUT: ${original.content}`, '');
  if (!original.content.includes('APPROVED')) {
    throw new Error('expected the planted fact to produce APPROVED');
  }

  const embedder = embeddingCache(mockEmbedder());
  const llmIds = llmCallIdsFromEvents(original.events);
  const part1Report = await localizeContextBug({
    artifacts: {
      snapshot: original.snapshot,
      controlDeps: original.controlDeps,
      events: original.events,
    },
    embedder,
    atStep: llmIds[llmIds.length - 1], // the LLM call that produced the answer
    rerun: {
      runner: async (specs) => (await runRefundsAgent(specs)).content,
      originalOutput: original.content,
      samples: 3,
      // Domain comparator — recommended with mockEmbedder (its cosine
      // compresses prose to ~0.85–0.97; absolute similarity thresholds
      // are only meaningful with real embedders).
      outcomeChanged: (a, b) => a.includes('APPROVED') !== b.includes('APPROVED'),
    },
  });
  out.push(formatContextBugReport(part1Report));

  const ablatable = part1Report.suspects.filter(
    (suspect) => suspect.ablation !== undefined && suspect.ablation.kind !== 'arg',
  );
  const confirmed = part1Report.suspects.find(
    (suspect) => suspect.verdict?.verdict === 'confirmed',
  );
  if (
    ablatable[0]?.detail?.injectionId !== 'vip-override-fact' ||
    confirmed?.detail?.injectionId !== 'vip-override-fact'
  ) {
    throw new Error('expected the planted fact to be found AND confirmed');
  }
  out.push(
    '',
    `FOUND + CONFIRMED: the planted '${confirmed.detail?.injectionId}' is the top ablatable ` +
      `suspect and the only CAUSAL verdict — ablating it flips APPROVED → DECLINED in ` +
      `${confirmed.runs?.flips}/${confirmed.runs?.samples} seeded reruns.`,
  );

  // ── Part 2: the credit fixture — control edges, correlational mode ───────
  out.push('', '═══ PART 2 — control edges on a plain decide() chart (correlational mode) ═══', '');
  const executor = new FlowChartExecutor(buildBuggyLoanChart());
  const ctrl = controlDepRecorder();
  executor.attachCombinedRecorder(ctrl);
  await executor.run({});
  const snapshot = executor.getSnapshot();
  const approveId = (snapshot.commitLog as { stageId: string; runtimeStageId: string }[]).find(
    (bundle) => bundle.stageId === 'approve',
  )!.runtimeStageId;

  const part2Report = await localizeContextBug({
    artifacts: { snapshot, controlDeps: ctrl.asLookup() },
    embedder,
    atStep: approveId, // the wrong approval — where did it come from?
  });
  out.push(formatContextBugReport(part2Report));

  const decider = part2Report.suspects.find((suspect) => suspect.source.startsWith('adjudicate#'));
  const controlHop = decider?.edgePath.find((hop) => hop.kind === 'control');
  out.push(
    '',
    `CONTROL EDGE: the approval traces through the decision — ` +
      `[control: ${controlHop?.key}] — and back to the normalize step that computed the wrong DTI. ` +
      'No rerun was supplied, so the report stops at the ranking and says so.',
  );

  const transcript = out.join('\n');
  console.log(transcript);

  return {
    buggyAnswer: original.content,
    topSuspect: `${ablatable[0].kind} '${ablatable[0].detail?.injectionId}'`,
    verdictClaim: confirmed.verdict?.claim ?? '',
    flips: `${confirmed.runs?.flips}/${confirmed.runs?.samples}`,
    part1Report,
    part2Report,
    transcript,
    part1Artifacts: {
      snapshot: original.snapshot,
      events: original.events,
      controlDeps: original.controlDeps,
      llmIds,
    },
    part2Artifacts: { snapshot, controlDeps: ctrl.asLookup(), approveId },
  };
}

if (isCliEntry(import.meta.url)) {
  run().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
