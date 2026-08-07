/**
 * 14 — Durable compaction: the summary survives the process, and so does what
 * it stands for.
 *
 * Example 11 folds a long window into a summary and shows the folded turns
 * still sitting in the run's commit log, byte for byte. That is true, and it
 * lasts exactly as long as the process does.
 *
 * A standing agent outlives its process. It runs for a week, gets deployed
 * over on Wednesday, comes back up, and is handed the same conversation. The
 * commit log that held week one is gone — and through 8.1 the summary in that
 * restored conversation still told the model, in the library's own voice, that
 * the originals were "retained verbatim in this run's commit log". That was a
 * false statement inside the model's context, which is the worst place to put
 * one.
 *
 * So compaction now retains what it folds, on the CONVERSATION:
 *
 *   • `retain: 'conversation'` is the DEFAULT — losing the originals takes a
 *     deliberate `retain: 'discard'`, and even then the span is recorded;
 *   • the folded messages ride `checkpoint().folded`, into whatever store you
 *     chose, across restarts and deploys;
 *   • the frame says which of those two happened, and can say nothing else;
 *   • `foldedSpanFor(conversation, message)` is the door back to them.
 *
 * The trade, stated rather than hidden: **compaction shrinks the wire, not the
 * record.** A stored session grows as it folds. That is the right way round —
 * the model's context window is scarce, and a row in a session store is not.
 *
 * This example runs week one, stores the session in a real SQLite file, throws
 * the agent away, and starts a SECOND agent from the file alone — one that has
 * never seen week one and can only answer from what it is handed.
 */

import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  Agent,
  defineTool,
  foldedMessages,
  foldedSpanFor,
  isCompactedSummary,
  type LLMProvider,
  type LLMRequest,
} from '../../src/index.js';
import {
  memorySessions,
  readEnvelope,
  sqliteSessions,
  toEnvelope,
  type SessionLifecycle,
} from '../../src/hosting/index.js';
import { isCliEntry, printResult, type ExampleMeta } from '../helpers/cli.js';

export const meta: ExampleMeta = {
  id: 'context-engineering/14-durable-compaction',
  title: 'Durable compaction — a week-old summary you can still unpack',
  group: 'context-engineering',
  description:
    'Folds a long window into a summary, stores the conversation in a SQLite ' +
    'file, and continues it on a BRAND NEW agent — which answers from week ' +
    'one through the summary, and can still produce week one verbatim.',
  defaultInput: 'Audit account ACCT-8842 and tell me what you find',
  providerSlots: ['default'],
  tags: ['context-engineering', 'compaction', 'durability', 'hosting', 'showcase'],
};

/** The one fact only week one knows. Nothing later in the run repeats it. */
const ACCOUNT = 'ACCT-8842';

export async function run(input: string, provider?: LLMProvider): Promise<string> {
  // ── Week one ────────────────────────────────────────────────────
  let calls = 0;
  const readLedger = defineTool({
    name: 'read_ledger',
    description: 'Read the full ledger for one account.',
    inputSchema: { type: 'object', properties: { id: { type: 'string' } }, required: ['id'] },
    // Only the FIRST result carries the account id, so once it is folded the
    // id lives in the summary and in the retained originals — nowhere else.
    execute: () =>
      ++calls === 1
        ? `LEDGER ${ACCOUNT}\n${'opening balance line\n'.repeat(50)}`
        : `ROUTINE ENTRY ${calls}\n${'ordinary line\n'.repeat(50)}`,
  });

  let call = 0;
  const scriptedProvider: LLMProvider = {
    name: 'mock',
    complete: async () => {
      call++;
      if (call <= 4) {
        return {
          content: '',
          toolCalls: [{ id: `c${call}`, name: 'read_ledger', args: { id: ACCOUNT } }],
          usage: { input: 800 * call, output: 12 },
          stopReason: 'tool_use' as const,
        };
      }
      return {
        content: 'The ledger opens clean and the four entries reconcile.',
        toolCalls: [],
        usage: { input: 900, output: 24 },
        stopReason: 'stop' as const,
      };
    },
  };

  /** The cheap model that writes summaries — explicit, never assumed. */
  const summarizer: LLMProvider = {
    name: 'mock-summarizer',
    complete: async () => ({
      content:
        `The user asked for an audit of account ${ACCOUNT}. The opening ledger ` +
        `was read and reconciled; no exceptions were found in the first entries.`,
      toolCalls: [],
      usage: { input: 640, output: 40 },
      stopReason: 'stop' as const,
    }),
  };

  // #region configure
  const weekOne = Agent.create({
    provider: provider ?? scriptedProvider,
    model: 'mock',
    maxIterations: 8,
  })
    .system('You audit accounts. Read the ledger before answering.')
    .tool(readLedger)
    .compaction({
      thresholdTokens: 1_500,
      summarizer,
      model: 'mock-cheap',   // required with `summarizer` since 8.14.0
      keepRecentTurns: 2,
      // The default, spelled out. Omit it and you get exactly this: the
      // folded messages ride the conversation and survive the process.
      // 'discard' is the only way to lose them, and it still files the span.
      retain: 'conversation',
    })
    .build();
  // #endregion configure

  const firstAnswer = await weekOne.run({ message: input });
  if (typeof firstAnswer !== 'string') throw new Error('Agent paused unexpectedly.');

  // ── What the conversation now carries ───────────────────────────
  // #region carry
  const conversation = weekOne.checkpoint();
  if (!conversation) throw new Error('no conversation to store.');

  const summaries = conversation.history.filter(isCompactedSummary);
  console.log('\n── what week one leaves behind ────────────────────');
  console.log(`window messages:   ${conversation.history.length}`);
  console.log(`summaries in it:   ${summaries.length}`);
  console.log(`folded spans kept: ${conversation.folded?.length ?? 0}`);
  for (const span of conversation.folded ?? []) {
    console.log(
      `  fold at iteration ${span.iteration}: ${span.messageCount} message(s), ` +
        `${span.retained}, written by ${span.model}`,
    );
    console.log(`  the run whose commit log HELD them: ${span.runId}`);
  }
  // #endregion carry

  // ── Into a real file, then throw everything else away ───────────
  const dir = mkdtempSync(join(tmpdir(), 'af-durable-compaction-'));
  const file = join(dir, 'sessions.db');
  const sessionId = 'audit-8842';

  // #region store
  let sessions: SessionLifecycle & { close?: () => void };
  try {
    sessions = sqliteSessions({ file });
  } catch (err) {
    // node:sqlite ships with Node 22.5+. On an older Node the durable point
    // still holds — the conversation is what carries the fold, and any store
    // that speaks JSON will do — so the example continues and says so rather
    // than pretending it proved something it did not.
    const why = (err as Error).message.split('.')[0] ?? 'no node:sqlite here';
    console.log(`\n[note] ${why}. Using memorySessions().`);
    sessions = memorySessions();
  }
  await sessions.persist(sessionId, toEnvelope(conversation));
  // #endregion store

  // ── Week two: a brand-new agent, from the bytes alone ───────────
  // #region continue
  // Nothing carries over: new Agent, new executor, new commit log. In
  // production this is a different process on a different machine.
  const restored = readEnvelope(await sessions.hydrate(sessionId));

  /** A model that knows nothing and can only repeat what it was handed. */
  const wire: string[] = [];
  const weekTwoProvider: LLMProvider = {
    name: 'mock',
    complete: async (req: LLMRequest) => {
      const seen = req.messages.map((m) => m.content).join('\n');
      wire.push(seen);
      const found = /ACCT-\d+/.exec(seen);
      return {
        content: found
          ? `We were working on ${found[0]}.`
          : 'I have no record of which account that was.',
        toolCalls: [],
        usage: { input: 900, output: 12 },
        stopReason: 'stop' as const,
      };
    },
  };

  const weekTwo = Agent.create({ provider: weekTwoProvider, model: 'mock', maxIterations: 3 })
    .compaction({ thresholdTokens: 1_500, summarizer, model: 'mock-cheap' })
    .build();

  const question = 'Remind me — which account were we working on?';
  const secondAnswer = await weekTwo.resumeOnError({
    ...restored,
    history: [...restored.history, { role: 'user', content: question }],
    originalInput: { message: question },
  });
  // #endregion continue

  const outsideTheSummary = restored.history
    .filter((m) => !isCompactedSummary(m))
    .some((m) => m.content.includes(ACCOUNT));

  console.log('\n── week two, from the file alone ──────────────────');
  console.log(`account in an ordinary message? ${outsideTheSummary}`);
  console.log(
    `account inside the summary?     ${summaries.some((m) => m.content.includes(ACCOUNT))}`,
  );
  console.log(`the new agent answered:         ${String(secondAnswer)}`);

  // ── And the originals are still producible ──────────────────────
  // #region recover
  const summary = restored.history.find(isCompactedSummary);
  const span = summary ? foldedSpanFor(restored, summary) : undefined;
  const originals = foldedMessages(restored);

  console.log('\n── week one, verbatim, in week two ────────────────');
  console.log(`span found for the summary:  ${span !== undefined}`);
  console.log(`originals recovered:         ${originals.length} message(s)`);
  console.log(
    `characters recovered:        ` + `${originals.reduce((n, m) => n + m.content.length, 0)}`,
  );
  console.log(
    `the opening ledger is here:  ` +
      `${originals.some((m) => m.content.includes(`LEDGER ${ACCOUNT}`))}`,
  );
  console.log(
    `\nthe wire the new agent sent was ` +
      `${wire[0]?.length ?? 0} characters; the record behind it is ` +
      `${originals.reduce((n, m) => n + m.content.length, 0)}. ` +
      `That is the trade: the window shrank, the record did not.`,
  );
  // #endregion recover

  sessions.close?.();
  rmSync(dir, { recursive: true, force: true });

  return String(secondAnswer);
}

if (isCliEntry(import.meta.url)) {
  run(meta.defaultInput ?? '')
    .then(printResult)
    .catch(console.error);
}
