/**
 * 39 — Session trust: ask once, remember the answer.
 *
 * The rule people actually want around a consequential tool is not "ask every
 * time" and not "never ask" — it is **ask once, then remember**. A person
 * approves a $250 refund for order 118; the agent retries the same call after
 * a timeout, or a second turn asks for it again, and waking the same person to
 * answer the same question is how an approval flow gets switched off.
 *
 * The whole rule is a `ToolMiddleware` with a Map. What makes it honest is the
 * `why`: a call that sails through on a remembered decision files a ledger row
 * saying WHOSE decision it sailed through on, so "why did this run without
 * asking?" has an answer in the record rather than in somebody's memory.
 *
 * **The key is the safe default: tool + source + args.** An approval is an
 * approval of a THING — this refund, this amount, this order. Keying on the
 * tool alone would mean one approval of `issue_refund` covers every refund for
 * the rest of the session, including the ones nobody has seen yet. The
 * loosening is one line and it is shown below, named for what it costs.
 *
 * Run:  npm run example examples/features/39-approve-once.ts
 */

import {
  Agent,
  allow,
  ask,
  checkInApproved,
  defineTool,
  isAskPause,
  type LLMProvider,
  type MiddlewareAsk,
  type MiddlewareDecision,
  type ToolMiddleware,
} from '../../src/index.js';
import { mock } from '../../src/doors/providers.js';
import { isCliEntry, printResult, type ExampleMeta } from '../helpers/cli.js';

export const meta: ExampleMeta = {
  id: 'features/39-approve-once',
  title: 'Approve once — session trust that says whose trust it is',
  group: 'features',
  description:
    'A ~10-line tool middleware: the first matching call asks a person, the decision ' +
    'is remembered, and later matching calls allow with that decision in the ledger ' +
    'row. Keyed by tool + source + args, because an approval is an approval of a thing.',
  defaultInput: 'Refund order 118 for $250.',
  providerSlots: ['default'],
  tags: ['features', 'governance', 'human-in-the-loop', 'middleware', 'trace'],
};

const refund = defineTool<{ orderId: string; amount: number }, string>({
  name: 'issue_refund',
  description: 'Refund an order',
  inputSchema: {
    type: 'object',
    properties: { orderId: { type: 'string' }, amount: { type: 'number' } },
    required: ['orderId', 'amount'],
  },
  execute: ({ orderId, amount }) => `refunded $${amount} on order ${orderId}`,
});

// #region approve-once
/** What a remembered approval is keyed on: the tool, its source, its args. */
const keyOf = (call: { toolName: string; toolSource?: string; args: unknown }): string =>
  `${call.toolSource ?? 'own'}::${call.toolName}::${JSON.stringify(call.args)}`;

/** Ask a person once per distinct call; remember the answer for the session. */
function approveOnce(): {
  middleware: ToolMiddleware;
  remember: (question: MiddlewareAsk, by: string) => void;
} {
  const approved = new Map<string, string>();
  return {
    middleware: {
      name: 'approve-once',
      onToolCall: (call) => {
        const decided = approved.get(keyOf(call));
        // A pass-through that says why it was comfortable. The row reads
        // `changed: false` — nothing moved — and carries the decision.
        if (decided) return allow(undefined, `approved earlier this session by ${decided}`);
        return ask({
          question: `Approve ${call.toolName}(${JSON.stringify(call.args)})?`,
          // The key rides the question, so whoever answers it can hand the
          // same key back — no second copy of the keying rule anywhere.
          detail: { key: keyOf(call) },
        });
      },
    },
    remember: (question, by) => {
      const key = (question.detail as { key?: string } | undefined)?.key;
      if (key) approved.set(key, by);
    },
  };
}
// #endregion approve-once

function show(rows: readonly MiddlewareDecision[]): void {
  for (const r of rows) {
    console.log(`  ${r.moment.padEnd(12)} ${r.middleware.padEnd(14)} ${r.outcome.padEnd(6)} ${r.why ?? ''}`);
  }
}

export async function run(input: string, provider?: LLMProvider): Promise<string> {
  const scripted = () => [
    { toolCalls: [{ id: 'c1', name: 'issue_refund', args: { orderId: '118', amount: 250 } }] },
    { content: 'Done — the refund is on its way.' },
  ];
  const llm = provider ?? mock({ replies: scripted() });

  const trust = approveOnce();
  const agent = Agent.create({ provider: llm, model: 'small-model' })
    .system('You handle refunds.')
    .tool(refund)
    .act({ beforeTool: [trust.middleware] })
    .build();

  // ── Turn one: nobody has decided this yet, so a person is asked. ──
  const first = await agent.run({ message: input });
  if (!isAskPause(first)) {
    console.log('No question was raised.');
    return typeof first === 'string' ? first : '';
  }
  console.log(`PAUSED — ${first.ask.middleware} asks: ${first.ask.question}`);

  const by = 'dana@ops';
  trust.remember(first.ask, by);
  const answer = await agent.resume(first.checkpoint, checkInApproved({ by }));

  // ── Turn two: the SAME call. No question — and the record says why. ──
  const second = Agent.create({ provider: mock({ replies: scripted() }), model: 'small-model' })
    .system('You handle refunds.')
    .tool(refund)
    .act({ beforeTool: [trust.middleware] })
    .build();
  const repeat = await second.run({ message: input });

  const rows = (
    second.getLastSnapshot()?.sharedState as { middlewareDecisions?: readonly MiddlewareDecision[] }
  )?.middlewareDecisions;
  console.log('\nThe repeat call, unasked — and the ledger says whose decision carried it:');
  show(rows ?? []);
  console.log(`\nSecond turn answered without a pause: ${String(repeat)}`);

  // ── The loosening, and what it costs ──────────────────────────────
  console.log(
    '\nKeying on `tool + source` alone (dropping the args) would make ONE approval\n' +
      'of issue_refund cover every refund for the rest of the session — including\n' +
      'amounts and orders nobody has seen. That is a real choice for a read-only\n' +
      'tool and a bad one for a destructive tool; the default here is the args.',
  );

  if (typeof answer !== 'string') throw new Error('Agent paused unexpectedly.');
  return answer;
}

if (isCliEntry(import.meta.url)) {
  run(meta.defaultInput ?? '')
    .then(printResult)
    .catch(console.error);
}
