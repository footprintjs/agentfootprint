/**
 * 38 — `.act()`: the whole steering wheel in one block.
 *
 * An agent turn has five moments where a rule may speak, and `.act()` has
 * one key for each of them:
 *
 *   input       the user's message, before the run commits it
 *   beforeTool  every tool call, before it is dispatched
 *   afterTool   every tool result, after the tool ran, before the model reads it
 *   window      what the live context window keeps, at each iteration boundary
 *   output      the final answer, before the caller receives it
 *
 * Tools do the work. Act decides about the work. Watch remembers both — and
 * nothing can act without being watched.
 *
 * It is pure sugar: every key is forwarded to the door that already owned it
 * (`.messageMiddleware()`, `.toolMiddleware()`, `.window()`), so the agent
 * below is byte-for-byte the agent those five calls build. What the block buys
 * is that a reviewer can see the whole posture in one place — and that
 * autocomplete on an empty `{}` teaches the loop.
 *
 * The two tool moments are ONE chain, walked in onion order: the
 * first-declared rule gets the first word about the call and the last word
 * about the result.
 *
 * Run:  npm run example examples/features/38-act.ts
 */

import {
  Agent,
  allow,
  defineTool,
  deny,
  slidingWindow,
  type LLMProvider,
  type MessageMiddleware,
  type MiddlewareDecision,
  type ToolMiddleware,
} from '../../src/index.js';
import { mock } from '../../src/doors/providers.js';
import { isCliEntry, printResult, type ExampleMeta } from '../helpers/cli.js';

export const meta: ExampleMeta = {
  id: 'features/38-act',
  title: 'act() — the five moments of the loop',
  group: 'features',
  description:
    'One block that says what an agent does at every moment of its turn: input, ' +
    'beforeTool, afterTool, window, output. Pure sugar over the five doors, with ' +
    'the keys locked to the moments at compile time.',
  defaultInput: 'Look up customer 4021 — my ssn is 123-45-6789 if you need it.',
  providerSlots: ['default'],
  tags: ['features', 'governance', 'middleware', 'pii', 'security', 'trace'],
};

const lookup = defineTool<{ customerId: string }, unknown>({
  name: 'lookup_customer',
  description: 'Look a customer up by id',
  inputSchema: {
    type: 'object',
    properties: { customerId: { type: 'string' } },
    required: ['customerId'],
  },
  // A real record: some of it is for the model, some of it is not.
  execute: ({ customerId }) => ({
    id: customerId,
    name: 'Dana Okoro',
    plan: 'enterprise',
    ssn: '123-45-6789',
    internalNote: 'flagged by PROJECT-BLUEJAY',
  }),
});

// ── One rule per moment ─────────────────────────────────────────────

/** input — the message the whole run will agree was said. */
const scrubSSNs: MessageMiddleware = {
  name: 'scrub-ssns',
  onMessage: (msg) => {
    const clean = msg.content.replace(/\b\d{3}-\d{2}-\d{4}\b/g, '[ssn]');
    return clean === msg.content ? allow() : allow(clean, 'masked a US SSN');
  },
};

/** beforeTool — a hard rule about the call. The reason is written for the model. */
const knownCustomersOnly: ToolMiddleware = {
  name: 'known-customers-only',
  onToolCall: (call) =>
    /^\d{4}$/.test(String(call.args.customerId))
      ? allow()
      : deny('customer ids are four digits — check the id and try again'),
};

/** afterTool — the tool ran; this decides what the model gets to read of it. */
const stripPII: ToolMiddleware = {
  name: 'strip-pii',
  onToolResult: (call) => {
    const record = call.result as Record<string, unknown>;
    if (!('ssn' in record)) return allow();
    const { ssn: _ssn, ...safe } = record;
    // The real record stays in the ledger; the model reads the safe view.
    return allow(safe, 'removed the SSN before the model read it');
  },
};

/** output — the last thing between the model and the caller. */
const noCodenames: MessageMiddleware = {
  name: 'no-codenames',
  onMessage: (msg) => {
    const clean = msg.content.replace(/PROJECT-BLUEJAY/g, 'the internal review');
    return clean === msg.content ? allow() : allow(clean, 'internal codename');
  },
};

function show(rows: readonly MiddlewareDecision[]): void {
  for (const r of rows) {
    const changed = r.changed ? ` ${JSON.stringify(r.before)} → ${JSON.stringify(r.after)}` : '';
    console.log(`  ${r.moment.padEnd(12)} ${r.middleware.padEnd(22)} ${r.outcome}  ${r.why ?? ''}`);
    if (changed) console.log(`  ${' '.repeat(12)} ${' '.repeat(22)}${changed}`);
  }
}

export async function run(input: string, provider?: LLMProvider): Promise<string> {
  const llm =
    provider ??
    mock({
      replies: [
        { toolCalls: [{ id: 'c1', name: 'lookup_customer', args: { customerId: '4021' } }] },
        { content: 'Dana Okoro is on the enterprise plan, flagged by PROJECT-BLUEJAY.' },
      ],
    });

  // #region wheel
  const agent = Agent.create({ provider: llm, model: 'small-model' })
    .system('You look customers up and answer briefly.')
    .tool(lookup)
    .act({
      input: [scrubSSNs], //  the message, before the run commits it
      beforeTool: [knownCustomersOnly], //  every call, before it is dispatched
      afterTool: [stripPII], //  every result, before the model reads it
      window: slidingWindow({ keepRecentTurns: 12 }), //  what the window keeps
      output: [noCodenames], //  the answer, before the caller gets it
    })
    .build();
  // #endregion wheel

  const answer = await agent.run({ message: input });

  const state = agent.getLastSnapshot()?.sharedState as {
    middlewareDecisions?: readonly MiddlewareDecision[];
  };
  console.log('\nWhat each moment decided:');
  show(state?.middlewareDecisions ?? []);

  console.log(
    '\nA rule named for ONE message moment is still a link in the chain at the other,' +
      '\nwhere it passes through — those are the rows above with no reason beside them.' +
      '\nThat is exactly what the hand-written `msg.phase === ...` spelling records too:' +
      '\nthe same five rules written as .messageMiddleware() / .toolMiddleware() /' +
      '\n.window() build the same agent, byte for byte. The block is for the reader.',
  );

  if (typeof answer !== 'string') throw new Error('Agent paused unexpectedly.');
  return answer;
}

if (isCliEntry(import.meta.url)) {
  run(meta.defaultInput ?? '')
    .then(printResult)
    .catch(console.error);
}
