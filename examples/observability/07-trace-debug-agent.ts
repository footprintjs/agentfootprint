/**
 * 07 — traceDebugAgent: the DEDICATED conversational debugger.
 *
 * Example 01 drove the trace toolpack with a SCRIPT standing in for a
 * model. This example productizes that session: `traceDebugAgent()`
 * returns a ready Agent — toolpack mounted, methodology system prompt
 * baked in — that you point at any completed run's artifacts and ASK.
 *
 *   const debuggerAi = traceDebugAgent({ artifacts, provider, model });
 *   await debuggerAi.run({ message: 'Why was the loan approved?' });
 *
 * The scenario is example 01's planted bug: a loan pipeline computes DTI
 * against ANNUAL income (0.035 instead of ~0.42), so the decide() policy
 * approves an unaffordable application. The debugger walks the evidence
 * by id — run_overview → who_wrote('decision') → trace_slice — and the
 * control edge names the rule that let the bad value through.
 *
 * Offline + deterministic: the "cheap debugging model" is a scripted
 * mock provider (the same pattern a real Haiku-priced session follows —
 * that is the point: debug a big-model run at small-model price, reading
 * ~a tenth of the trace, by id).
 *
 * Run:  npx tsx examples/observability/07-trace-debug-agent.ts
 */

import { decide, flowChart, FlowChartExecutor } from 'footprintjs';
import { controlDepRecorder } from 'footprintjs/trace';

import { mock } from '../../src/index.js';
import { traceDebugAgent } from '../../src/observe.js';
import { isCliEntry, type ExampleMeta } from '../helpers/cli.js';

export const meta: ExampleMeta = {
  id: 'observability/07-trace-debug-agent',
  title: 'traceDebugAgent — the dedicated conversational trace debugger',
  group: 'observability',
  description:
    'One call turns a completed run into a debuggable conversation: traceDebugAgent() returns ' +
    'an Agent with the trace toolpack mounted and the proven methodology as its system prompt. ' +
    'A scripted cheap-model session walks the planted-DTI loan bug by id — overview, ' +
    'who_wrote, slice with control edges — and names the culprit stage, citing evidence.',
  defaultInput: null,
  providerSlots: [],
  tags: ['observability', 'debugging', 'trace-toolpack', 'agent', 'rfc-003'],
};

// ─── The buggy loan pipeline (example 01's planted bug) ─────────────────────

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
        decide(
          scope as unknown as LoanState,
          [
            {
              when: { creditScore: { lt: 620 } },
              then: 'decline',
              label: 'Credit below the 620 floor',
            },
            { when: { dti: { gt: 0.4 } }, then: 'decline', label: 'DTI above the 0.40 ceiling' },
            {
              when: { creditScore: { gte: 680 }, dti: { lte: 0.4 } },
              then: 'approve',
              label: 'Prime credit within affordability policy',
            },
          ],
          'decline',
        ),
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

// ─── The demo ────────────────────────────────────────────────────────────────

export interface TraceDebugAgentResult {
  verdict: string;
  toolCallsMade: string[];
  transcript: string;
}

export async function run(_input?: string | null): Promise<TraceDebugAgentResult> {
  const out: string[] = [];

  // 1 — the buggy run completes (this is the thing being debugged)
  const executor = new FlowChartExecutor(buildBuggyLoanChart());
  const ctrl = controlDepRecorder();
  executor.attachCombinedRecorder(ctrl);
  await executor.run({});
  const snapshot = executor.getSnapshot();
  out.push('═══ THE RUN ═══', `letter: ${String((snapshot.sharedState as unknown as LoanState).letter)}`, '');

  // 2 — the dedicated debugger: a scripted "cheap model" walks the evidence.
  //     A real session swaps `provider` for anthropic()/openai() + a small model.
  const toolCallsMade: string[] = [];
  const provider = mock({
    respond: (req) => {
      const lastTool = String(
        [...req.messages].reverse().find((m) => m.role === 'tool')?.content ?? '',
      );
      const ask = (name: string, args: Record<string, unknown>) => {
        toolCallsMade.push(name);
        return { toolCalls: [{ id: `c${toolCallsMade.length}`, name, args }] };
      };
      if (!lastTool) return ask('run_overview', {});
      if (lastTool.includes('TRACE RUN OVERVIEW')) return ask('who_wrote', { key: 'decision' });
      if (lastTool.includes("last wrote 'decision'") || lastTool.includes('approve')) {
        const id = lastTool.match(/([\w/-]+#\d+)/)?.[1] ?? 'approve#3';
        return ask('trace_slice', { runtimeStageId: id, keys: ['decision'] });
      }
      // The slice names the control edge + the normalize hop — verdict time.
      return (
        'VERDICT: the approval traces through the policy decision ' +
        '[control: Prime credit within affordability policy] back to normalize#1, ' +
        'which computed dti against ANNUAL income (0.035; monthly gives ≈ 0.42). ' +
        'Fix the divisor in Normalize and rerun.'
      );
    },
  });

  const debuggerAi = traceDebugAgent({
    artifacts: { snapshot, controlDeps: ctrl.asLookup() },
    provider,
    model: 'mock-cheap',
    instruction: 'This is a lending pipeline; affordability ratios are monthly.',
  });

  const answer = await debuggerAi.run({ message: 'Why was loan APP-7 approved?' });
  const verdict =
    typeof answer === 'object' && answer !== null && 'content' in answer
      ? String((answer as { content: unknown }).content)
      : String(answer);

  out.push('═══ THE DEBUGGING CONVERSATION ═══');
  out.push(`Q: Why was loan APP-7 approved?`);
  out.push(`tools the debugger opened: ${toolCallsMade.join(' → ')}`);
  out.push(`A: ${verdict}`, '');

  if (!verdict.includes('normalize#1') || !toolCallsMade.includes('trace_slice')) {
    throw new Error('expected the debugger to walk the slice and name normalize#1');
  }
  out.push(
    'The dedicated door: same evidence as BacktrackView (the UI door) and .selfExplain() ' +
      '(the in-conversation door) — this one is a separate session on any provider, so a ' +
      'cheap model can debug an expensive run.',
  );

  const transcript = out.join('\n');
  console.log(transcript);
  return { verdict, toolCallsMade, transcript };
}

if (isCliEntry(import.meta.url)) {
  run().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
