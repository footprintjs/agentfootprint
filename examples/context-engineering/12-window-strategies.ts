/**
 * 12 — Window strategies: three ways to shrink a window, one ledger.
 *
 * Example 11 shows compaction: fold the oldest turns into a summary. That is
 * one policy, and it costs an LLM call. This example runs the SAME
 * conversation under the other two, side by side:
 *
 *   slidingWindow({ keepRecentTurns })  keep the last N turns, drop the rest.
 *                                       No summarizer, no LLM call, no usage
 *                                       requirement — it triggers on turn
 *                                       COUNT, so it runs on any provider,
 *                                       including one that reports no tokens.
 *   tokenBudget({ thresholdTokens })    compaction's trigger discipline —
 *                                       COUNTED tokens, never estimated —
 *                                       but it drops instead of summarizing.
 *
 * What makes them the same family, and what this example prints:
 *
 *   1. **One refusal engine.** All three share the turn segmentation and the
 *      refusal rules, so none of them will ever split a `tool_use` from its
 *      `tool_result`, drop an unanswered tool call, or touch the turn a
 *      paused run is waiting on. Every refusal is NAMED in the record.
 *   2. **One ledger.** Whatever leaves the window is still in the commit log,
 *      byte for byte. Each strategy files a record naming the
 *      `runtimeStageId`s whose messages left — the family's one-line
 *      differentiator: *every strategy here records what it removed, by id.*
 *   3. **One honest absence.** A drop puts an authored notice at the head of
 *      the window (the window must open on a user turn) and nothing else. No
 *      model wrote a word of it.
 */

import {
  Agent,
  defineTool,
  DROP_NOTICE_PREFIX,
  slidingWindow,
  tokenBudget,
  type LLMProvider,
  type WindowRecord,
} from '../../src/index.js';
import { commitValueAt } from 'footprintjs/trace';
import { isCliEntry, printResult, type ExampleMeta } from '../helpers/cli.js';

export const meta: ExampleMeta = {
  id: 'context-engineering/12-window-strategies',
  title: 'Window strategies — slidingWindow and tokenBudget',
  group: 'context-engineering',
  description:
    'Runs one conversation under slidingWindow and tokenBudget, showing that ' +
    'both refuse to drop anything unresolved, both name what they removed by ' +
    'stage id, and both leave the commit log whole.',
  defaultInput: 'Audit the last four deployments and tell me what changed',
  providerSlots: ['default'],
  tags: ['context-engineering', 'compaction', 'context-window', 'showcase'],
};

/** A tool with a genuinely bulky result — the kind that fills a window. */
const readLog = defineTool({
  name: 'read_deploy_log',
  description: 'Read the full deploy log for one deployment.',
  inputSchema: {
    type: 'object',
    properties: { id: { type: 'string' } },
    required: ['id'],
  },
  execute: (args: { id: string }) => `DEPLOY ${args.id}\n` + `line of log output\n`.repeat(60),
});

/**
 * Four tool rounds, then an answer.
 *
 * `usage` is what the "vendor" reports it counted. `tokenBudget` reads that
 * number and nothing else; `slidingWindow` never looks at it at all, which is
 * why `reportsUsage: false` below is fine for one strategy and fatal for the
 * other.
 */
function scriptedProvider(reportsUsage: boolean): LLMProvider {
  let call = 0;
  return {
    name: 'mock',
    complete: async () => {
      call++;
      const usage = reportsUsage
        ? { input: 800 * Math.min(call, 5), output: 12 }
        : { input: 0, output: 0 };
      if (call <= 4) {
        return {
          content: '',
          toolCalls: [{ id: `c${call}`, name: 'read_deploy_log', args: { id: `d${call}` } }],
          usage,
          stopReason: 'tool_use',
        };
      }
      return {
        content:
          'Across the four deployments: two config bumps, one dependency ' +
          'upgrade, and one rollback. Nothing touched the payment path.',
        toolCalls: [],
        usage,
        stopReason: 'stop',
      };
    },
  };
}

function reportRecords(label: string, records: readonly WindowRecord[]): void {
  console.log(`\n── ${label}: what the strategy did ─────────────────`);
  if (records.length === 0) {
    console.log('  never engaged — the window never got big enough');
    return;
  }
  for (const record of records) {
    const head = `iteration ${record.iteration} [${record.strategy}]`;
    if (record.removedMessageCount > 0) {
      console.log(
        `${head}: removed ${record.removedMessageCount} message(s) written by ` +
          `${record.removedStageIds.join(', ')}`,
      );
      console.log(`  window ${record.windowCharsBefore} → ${record.windowCharsAfter} chars`);
    } else {
      console.log(`${head}: removed nothing`);
    }
    for (const refusal of record.refusals) {
      console.log(`  refused (turn ${refusal.turnIndex}): ${refusal.reason}`);
    }
  }
}

export async function run(input: string, provider?: LLMProvider): Promise<string> {
  // #region strategies
  // The general door. `.compaction({...})` is `.window(summarizeOldest({...}))`
  // spelled shorter; these are its two siblings.
  const trimmed = Agent.create({
    provider: provider ?? scriptedProvider(false), // reports NO usage — fine here
    model: 'mock',
    maxIterations: 8,
  })
    .system('You audit deployments. Read the logs before answering.')
    .tool(readLog)
    // keepRecentTurns is required and has no default: how much past your
    // agent needs is a fact about your agent, not about this library.
    .window(slidingWindow({ keepRecentTurns: 3 }))
    .build();

  const capped = Agent.create({
    provider: provider ?? scriptedProvider(true), // MUST report usage
    model: 'mock',
    maxIterations: 8,
  })
    .system('You audit deployments. Read the logs before answering.')
    .tool(readLog)
    .window(tokenBudget({ thresholdTokens: 1_500, keepRecentTurns: 3 }))
    .build();
  // #endregion strategies

  // #region observe
  // Drops ride the vocabulary you already subscribe to — no new event types.
  // A strategy with no token budget stays quiet on `budget_pressure` rather
  // than report a cap nobody configured.
  let evicted = 0;
  trimmed.on('agentfootprint.context.evicted', () => {
    evicted++;
  });
  trimmed.on('agentfootprint.context.budget_pressure', () => {
    console.log('[slidingWindow] this never fires — it has no budget to report');
  });
  capped.on('agentfootprint.context.budget_pressure', (e) => {
    // `unit` says what the numbers count — 'tokens' from a window strategy,
    // 'chars' from a context slot. Same event name, same slot, two units.
    console.log(
      `[tokenBudget] measured ${e.payload.projected} ${e.payload.unit} vs a budget of ` +
        `${e.payload.cap} ${e.payload.unit} → ${e.payload.planAction}`,
    );
  });
  // #endregion observe

  const answer = await trimmed.run({ message: input });
  if (typeof answer !== 'string') throw new Error('Agent paused unexpectedly.');
  await capped.run({ message: input });

  const stateOf = (agent: Agent) =>
    (agent.getLastSnapshot()?.sharedState ?? {}) as {
      compactions?: readonly WindowRecord[];
      history?: ReadonlyArray<{ role: string; content: string }>;
    };

  reportRecords('slidingWindow', stateOf(trimmed).compactions ?? []);
  console.log(`  evictions reported: ${evicted}`);
  reportRecords('tokenBudget', stateOf(capped).compactions ?? []);

  // ── The authored notice ────────────────────────────────────────
  // #region notice
  const window = stateOf(trimmed).history ?? [];
  console.log('\n── the live window after trimming ─────────────────');
  console.log(window.map((m) => `${m.role}: ${m.content.slice(0, 72)}…`).join('\n'));
  console.log(
    `\nopens on a user turn (the provider contract): ${window[0]?.role === 'user'}\n` +
      `and that turn is the library's own notice:    ` +
      `${window[0]?.content.startsWith(DROP_NOTICE_PREFIX) === true}`,
  );
  // #endregion notice

  // ── The record the drop did not touch ──────────────────────────
  // #region recover
  const snapshot = trimmed.getLastSnapshot();
  const log = snapshot?.commitLog ?? [];
  const firstToolCalls = log.findIndex((b) => (b.runtimeStageId ?? '').startsWith('tool-calls#'));
  const ledgerWindow = commitValueAt(log, firstToolCalls, 'history') as
    | ReadonlyArray<{ role: string; content: string }>
    | undefined;
  const originalLog = ledgerWindow?.find((m) => m.content.startsWith('DEPLOY d1'));

  console.log('\n── the dropped turn, from the ledger ──────────────');
  console.log(`in the live window?  ${window.some((m) => m.content.startsWith('DEPLOY d1'))}`);
  console.log(`in the commit log?   ${originalLog !== undefined}`);
  console.log(`recovered ${originalLog?.content.length ?? 0} characters, verbatim`);
  console.log('nothing was summarized, and nothing was lost — only un-sent.');
  // #endregion recover

  return answer;
}

if (isCliEntry(import.meta.url)) {
  run(meta.defaultInput ?? '')
    .then(printResult)
    .catch(console.error);
}
