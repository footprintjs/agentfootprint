/**
 * The SECOND process.
 *
 * Not a helper and not a mock of one: this file is bundled and run by `node`
 * as its own process, with nothing carried over from the first except the
 * SQLite file on disk. Every in-memory thing the first process had — its
 * Agent, its executor, its commit log, the compaction meter, the folded
 * messages themselves — is gone before this starts.
 *
 * It answers one question the parent cannot answer for itself: after all of
 * that, does the agent still know what week one was about?
 *
 * The "model" here is a mock that can only answer from what it was actually
 * SENT. It scans the incoming messages for the account id and repeats it. So a
 * correct answer is not a lucky guess — it is proof that week one's fact
 * reached the wire, through the summary, across a process boundary.
 *
 * Reads `SESSION_DB` / `SESSION_ID` from the environment; writes one JSON line
 * to stdout for the parent to assert on.
 */

import { Agent, foldedSpanFor, isCompactedSummary } from '../../../src/index.js';
import { readEnvelope, sqliteSessions } from '../../../src/hosting/index.js';
import type { LLMProvider, LLMRequest, LLMResponse } from '../../../src/adapters/types.js';

async function main(): Promise<void> {
  const file = process.env.SESSION_DB;
  const sessionId = process.env.SESSION_ID;
  if (file === undefined || sessionId === undefined) {
    throw new Error('SESSION_DB and SESSION_ID are required');
  }

  // The file is the ONLY thing this process inherits.
  const sessions = sqliteSessions({ file });
  const stored = await sessions.hydrate(sessionId);
  if (stored === undefined) throw new Error(`nothing stored for session '${sessionId}'`);
  const conversation = readEnvelope(stored);

  // What the second process can see about the fold, before it runs anything.
  const summaries = conversation.history.filter(isCompactedSummary);
  const span = summaries[0] === undefined ? undefined : foldedSpanFor(conversation, summaries[0]);

  /** A model that knows nothing and repeats only what it was handed. */
  const sent: string[] = [];
  const provider: LLMProvider = {
    name: 'mock',
    complete: async (req: LLMRequest): Promise<LLMResponse> => {
      const wire = req.messages.map((m) => m.content).join('\n');
      sent.push(wire);
      const found = /ACCT-\d+/.exec(wire);
      return {
        content: found ? `The account is ${found[0]}.` : 'I have no record of that account.',
        toolCalls: [],
        usage: { input: 90, output: 8 },
        stopReason: 'end_turn',
      };
    },
  };

  const agent = Agent.create({ provider, model: 'week-two-model', maxIterations: 3 })
    .compaction({ thresholdTokens: 250, summarizer: provider, keepRecentTurns: 2 })
    .build();

  const question = 'Remind me — which account were we working on in week one?';
  const answer = await agent.resumeOnError({
    ...conversation,
    history: [...conversation.history, { role: 'user', content: question }],
    originalInput: { message: question },
  });

  // What the second process would store in ITS turn. The spans have to still
  // be here: a restart that quietly dropped them would write the loss back to
  // disk permanently, and the third process would have nothing at all.
  const after = agent.checkpoint();

  sessions.close();

  process.stdout.write(
    `${JSON.stringify({
      answer,
      summaryCount: summaries.length,
      // Week one, produced in week two from the stored conversation alone.
      spanMessageCount: span?.messageCount,
      spanRetained: span?.retained,
      spanRunId: span?.runId,
      originals: (span?.messages ?? []).map((m) => m.content),
      // The account id must reach the model ONLY through the summary. If any
      // ordinary message in the restored window still carried it, a correct
      // answer would prove nothing about compaction at all.
      mentionsOutsideSummary: conversation.history
        .filter((m) => !isCompactedSummary(m))
        .some((m) => /ACCT-\d+/.test(m.content)),
      summaryMentionsAccount: summaries.some((m) => /ACCT-\d+/.test(m.content)),
      originalsMentionAccount: (span?.messages ?? []).some((m) => /ACCT-\d+/.test(m.content)),
      foldedAfterTurn: after?.folded?.length ?? 0,
      wireCount: sent.length,
    })}\n`,
  );
}

main().catch((err: unknown) => {
  process.stderr.write(`${err instanceof Error ? err.stack : String(err)}\n`);
  process.exit(1);
});
