/**
 * 11 — Compaction: keep the window inside budget, keep the record whole.
 *
 * A long tool-using conversation grows its context window every iteration.
 * Eventually the model's window — or your bill — says no. The usual answer is
 * to summarize the old turns and throw them away.
 *
 * This library will summarize them. It will not throw them away.
 *
 *   • the WINDOW is `scope.history` — what actually goes on the wire;
 *   • the LEDGER is the run's commit log — append-only, so the folded turns
 *     stay in it byte-identical whatever the window does.
 *
 * Compaction edits the window and files the summary as its own recorded step,
 * naming every runtimeStageId it folded. At the end of this example we print
 * both: the small window the model now sees, AND the original tool output
 * pulled back out of the ledger, in full.
 *
 * Two other things this example demonstrates, because they are the difference
 * between a compactor you can trust and one you cannot:
 *
 *   • the trigger is COUNTED from the provider's own reported usage, never
 *     estimated from characters;
 *   • a turn holding something unresolved refuses to fold, BY NAME.
 */

import { Agent, defineTool, COMPACTED_FRAME_PREFIX, type LLMProvider } from '../../src/index.js';
import { commitValueAt } from 'footprintjs/trace';
import { isCliEntry, printResult, type ExampleMeta } from '../helpers/cli.js';

export const meta: ExampleMeta = {
  id: 'context-engineering/11-compaction',
  title: 'Compaction — a smaller window, the same record',
  group: 'context-engineering',
  description:
    'Folds the oldest turns into one summary when the measured window ' +
    'exceeds a token budget — and proves the folded turns are still in the ' +
    'commit log, byte for byte.',
  defaultInput: 'Audit the last four deployments and tell me what changed',
  providerSlots: ['default'],
  tags: ['context-engineering', 'compaction', 'context-window', 'showcase'],
};

export async function run(input: string, provider?: LLMProvider): Promise<string> {
  // A tool with a genuinely bulky result — the kind that fills a window.
  const readLog = defineTool({
    name: 'read_deploy_log',
    description: 'Read the full deploy log for one deployment.',
    inputSchema: {
      type: 'object',
      properties: { id: { type: 'string' } },
      required: ['id'],
    },
    execute: (args: { id: string }) =>
      `DEPLOY ${args.id}\n` + `line of log output\n`.repeat(60),
  });

  /**
   * The main model. Four tool rounds, then an answer — and each response
   * reports the input tokens the "vendor" counted. That reported number is
   * the ONLY thing compaction reads to decide. Nothing here estimates.
   */
  let call = 0;
  const scriptedProvider: LLMProvider = {
    name: 'mock',
    complete: async () => {
      call++;
      if (call <= 4) {
        return {
          content: '',
          toolCalls: [{ id: `c${call}`, name: 'read_deploy_log', args: { id: `d${call}` } }],
          usage: { input: 800 * call, output: 12 },
          stopReason: 'tool_use',
        };
      }
      return {
        content:
          'Across the four deployments: two config bumps, one dependency ' +
          'upgrade, and one rollback. Nothing touched the payment path.',
        toolCalls: [],
        usage: { input: 900, output: 28 },
        stopReason: 'stop',
      };
    },
  };

  /** The cheap model that writes summaries. Explicit — never assumed. */
  const summarizer: LLMProvider = {
    name: 'mock-summarizer',
    complete: async () => ({
      content:
        'The user asked for an audit of the last four deployments. Logs for ' +
        'd1 and d2 were read: d1 was a config bump, d2 a dependency upgrade. ' +
        'Nothing in either touched the payment path.',
      toolCalls: [],
      usage: { input: 640, output: 44 },
      stopReason: 'stop',
    }),
  };

  // #region configure
  const agent = Agent.create({
    provider: provider ?? scriptedProvider,
    model: 'mock',
    maxIterations: 8,
  })
    .system('You audit deployments. Read the logs before answering.')
    .tool(readLog)
    .compaction({
      // No default exists on purpose: the right budget depends on your model
      // and your bill, and a number the library invented would be inherited
      // silently by every run.
      thresholdTokens: 1_500,
      summarizer,
      // REQUIRED alongside `summarizer` since 8.14.0. It used to default to
      // the agent's own model, which meant compaction quietly billed the
      // expensive one — the exact thing the summarizer option exists to
      // avoid. Name the cheap model here.
      model: 'mock-cheap',
      keepRecentTurns: 2,
    })
    .build();
  // #endregion configure

  // #region observe
  // The fold speaks the context vocabulary you already subscribe to — no new
  // event types were added for it.
  const evictions: string[] = [];
  agent.on('agentfootprint.context.evicted', (e) => {
    evictions.push(`${e.payload.contentHash} (lived ${e.payload.survivalMs}ms)`);
  });
  agent.on('agentfootprint.context.budget_pressure', (e) => {
    // Read `unit` before you read the numbers. The three CONTEXT SLOTS emit
    // this same event, under this same `slot: 'messages'`, counting CHARS —
    // and `contextBudget` is on by default, so one subscriber gets both. This
    // one comes from the window strategy and counts TOKENS.
    console.log(
      `[pressure] measured ${e.payload.projected} ${e.payload.unit} vs a budget of ` +
        `${e.payload.cap} ${e.payload.unit} → ${e.payload.planAction}`,
    );
  });

  // #endregion observe

  const result = await agent.run({ message: input });
  if (typeof result !== 'string') throw new Error('Agent paused unexpectedly.');

  // ── What the fold recorded ─────────────────────────────────────
  const snapshot = agent.getLastSnapshot();
  const state = snapshot?.sharedState as {
    compactions?: ReadonlyArray<{
      iteration: number;
      measuredTokens: number;
      thresholdTokens: number;
      removedStageIds: readonly string[];
      removedMessageCount: number;
      windowCharsBefore: number;
      windowCharsAfter: number;
      refusals: ReadonlyArray<{ reason: string }>;
    }>;
    history?: ReadonlyArray<{ role: string; content: string }>;
  };

  console.log('\n── what compaction did ────────────────────────────');
  for (const record of state?.compactions ?? []) {
    console.log(
      `iteration ${record.iteration}: measured ${record.measuredTokens} tokens ` +
        `(budget ${record.thresholdTokens})`,
    );
    if (record.removedMessageCount > 0) {
      console.log(
        `  folded ${record.removedMessageCount} message(s) written by ` +
          `${record.removedStageIds.join(', ')}`,
      );
      console.log(`  window ${record.windowCharsBefore} → ${record.windowCharsAfter} chars`);
    } else {
      console.log('  folded nothing');
    }
    for (const refusal of record.refusals) {
      console.log(`  refused: ${refusal.reason}`);
    }
  }
  console.log(`evictions reported: ${evictions.length}`);

  // ── The window the model sees now ──────────────────────────────
  const window = state?.history ?? [];
  console.log('\n── the live window ────────────────────────────────');
  console.log(window.map((m) => `${m.role}: ${m.content.slice(0, 72)}…`).join('\n'));

  // ── The record the fold did not touch ──────────────────────────
  // The oldest deploy log is gone from the window. It is NOT gone: the
  // tool-calls stage committed it, and commits are append-only.
  // #region recover
  const log = snapshot?.commitLog ?? [];
  const firstToolCalls = log.findIndex((b) => (b.runtimeStageId ?? '').startsWith('tool-calls#'));
  const ledgerWindow = commitValueAt(log, firstToolCalls, 'history') as
    | ReadonlyArray<{ role: string; content: string }>
    | undefined;
  const originalLog = ledgerWindow?.find((m) => m.content.startsWith('DEPLOY d1'));

  console.log('\n── the same turn, from the ledger ─────────────────');
  console.log(`in the live window?  ${window.some((m) => m.content.startsWith('DEPLOY d1'))}`);
  console.log(`in the commit log?   ${originalLog !== undefined}`);
  console.log(`recovered ${originalLog?.content.length ?? 0} characters, verbatim`);
  console.log(
    `the window now opens with the summary frame: ` +
      `${window[0]?.content.startsWith(COMPACTED_FRAME_PREFIX) === true}`,
  );
  // #endregion recover

  return result;
}

if (isCliEntry(import.meta.url)) {
  run(meta.defaultInput ?? '')
    .then(printResult)
    .catch(console.error);
}
