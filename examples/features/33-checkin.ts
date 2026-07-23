/**
 * 33 — Check in with the receipts: evidence-carrying human consent.
 *
 * "OpenWorker-class agents check in; agentfootprint checks in WITH THE
 * RECEIPTS." A tool declares `checkIn` — `'always'` or a predicate — to demand
 * a human's OK before a consequential action. When it trips, the run pauses
 * BEFORE the tool executes and hands back a `CheckInRequest` carrying an
 * EVIDENCE PACK: what the tool will do (`willDo`), what context the run
 * consumed (`read`), which context drove the choice (`drivers`), and a compact
 * run-so-far `trail`. A human answers with `checkInApproved` / `checkInDeclined`;
 * on approve the tool runs, on decline the model sees the note and adapts.
 *
 * It rides the SAME pause/checkpoint machinery as `pauseHere` — the checkpoint
 * is JSON, so Process A (ask) and Process B (decide) can be days and servers
 * apart. `isCheckInPause(outcome)` distinguishes a check-in from a plain pause.
 *
 * Two exports model the two phases (build a FRESH agent in each — only the
 * checkpoint crosses the boundary). CLI mode chains them for a quick demo.
 */

import {
  Agent,
  defineTool,
  isCheckInPause,
  isPaused,
  checkInApproved,
  CheckInRecorder,
  type LLMProvider,
} from '../../src/index.js';
import type { FlowchartCheckpoint } from 'footprintjs';
import { isCliEntry, printResult, type ExampleMeta } from '../helpers/cli.js';

export const meta: ExampleMeta = {
  id: 'features/33-checkin',
  title: 'Check in with the receipts',
  group: 'features',
  description:
    'A tool demands human consent for a consequential action; the ask carries an evidence pack (willDo / read / drivers / trail) and the decision lands as a typed record.',
  defaultInput: 'refund order 123 for 5000',
  providerSlots: ['default'],
  tags: ['feature', 'checkin', 'human-in-the-loop', 'consent', 'pause'],
};

/** Deterministic mock: asks for the refund tool, then confirms once it sees a
 *  tool result. Swap for a real provider — no code change. */
function defaultProvider(): LLMProvider {
  return {
    name: 'mock',
    complete: async (req) => {
      const done = req.messages.some((m) => m.role === 'tool');
      return done
        ? { content: 'All done.', toolCalls: [], usage: { input: 10, output: 5 }, stopReason: 'stop' }
        : {
            content: 'This is a large refund — confirming with a human first.',
            toolCalls: [{ id: 't1', name: 'issue_refund', args: { amount: 5000 } }],
            usage: { input: 10, output: 5 },
            stopReason: 'tool_use',
          };
    },
  };
}

/**
 * Build the agent. Pure factory — both phases call this so the chart is one
 * source of truth. They do NOT share an instance.
 */
function buildAgent(provider?: LLMProvider) {
  // #region declare
  return Agent.create({ provider: provider ?? defaultProvider(), model: 'mock' })
    .system('You are a refunds assistant. Refund only verified orders; confirm the amount first.')
    .tool(
      defineTool<{ amount: number }, string>({
        name: 'issue_refund',
        description: 'Issue a refund to the customer',
        inputSchema: {
          type: 'object',
          properties: { amount: { type: 'number' } },
          required: ['amount'],
        },
        // Demand a human check-in ONLY for big refunds (a predicate; use
        // 'always' to gate every call). A refund under the line runs untouched.
        checkIn: (args) => args.amount > 1000,
        execute: ({ amount }) => `refunded ${amount}`,
      }),
    )
    // Configure the evidence pack that rides the ask (optional — 'standard' is
    // the default; 'minimal' ships only `willDo`; or pass your own assembler).
    .checkIn({ evidence: 'standard' })
    .build();
  // #endregion declare
}

/**
 * Process A — kick off the run. Returns the final string, OR a check-in pause
 * whose `checkIn.evidence` you show a human and whose `checkpoint` you persist.
 */
export async function run(input: string, provider?: LLMProvider): Promise<unknown> {
  const agent = buildAgent(provider);
  // #region ask
  const outcome = await agent.run({ message: input });
  if (isCheckInPause(outcome)) {
    // The receipts — render these for the human who decides.
    const { tool, args, intent, evidence } = outcome.checkIn;
    console.log(`Approve "${tool}"?  args=${JSON.stringify(args)}`);
    console.log(`  will do : ${evidence.willDo}`);
    console.log(`  because : ${intent ?? '(no stated reason)'}`);
    console.log(`  drivers : ${(evidence.drivers ?? []).slice(0, 3).map((d) => d.id).join(', ')}`);
    // Persist `outcome.checkpoint` (JSON) until the human answers.
  }
  return outcome;
  // #endregion ask
}

/**
 * Process B — the human answered. Approve → the tool runs; decline → the model
 * sees "declined by human: <note>" and adapts. Build a fresh agent (same chart).
 */
export async function resume(
  checkpoint: FlowchartCheckpoint,
  provider?: LLMProvider,
): Promise<unknown> {
  const agent = buildAgent(provider);
  // #region decide
  // Attach the built-in store to capture the ask + decision as an audit record.
  const audit = new CheckInRecorder();
  agent.attach(audit);
  const final = await agent.resume(checkpoint, checkInApproved({ by: 'alice@ops', note: 'verified' }));
  // audit.getDecisions() → [{ toolName: 'issue_refund', approved: true, by: 'alice@ops', ... }]
  return final;
  // #endregion decide
}

// ── CLI demo: chain ask → checkpoint round-trip → decide ──────────────

if (isCliEntry(import.meta.url)) {
  (async () => {
    const first = await run(meta.defaultInput ?? '');
    if (!isPaused(first)) {
      console.log('Finished without a check-in:', first);
      printResult(first);
      return;
    }
    // Simulate a Redis / Postgres round-trip — the checkpoint is JSON.
    const restored: FlowchartCheckpoint = JSON.parse(JSON.stringify(first.checkpoint));
    const final = await resume(restored);
    console.log('\nFinal:', final);
    printResult(final);
  })().catch(console.error);
}
