/**
 * 37 — The middleware family: `.toolMiddleware()` and `.messageMiddleware()`.
 *
 * A typed chain around every tool dispatch, and around the message
 * boundary — the input before the model sees it, the output before the
 * caller receives it. Each link answers with one of three verbs:
 *
 *   allow()               let it through
 *   allow(value, why)     let it through, changed, and say what changed
 *   deny(reason)          refuse; the reason reaches the model as data
 *   ask({ question })     suspend for a person
 *
 * There is no fourth verb, and in particular there is no way to return a
 * RESULT. That is not a convention — the union has no arm for one. So
 * whatever a chain decides, the answer the model finally reads is the
 * real tool's output or a refusal. A rule cannot quietly become the tool.
 *
 * The same law explains what `ask` resumes with. The human's answer is a
 * DECISION, not a result: approve and the chain continues and the REAL
 * tool runs; decline and it becomes a denial the model can adapt to.
 * Nobody — not the middleware, not the person — gets to write the tool's
 * answer.
 *
 * The scrub below is a plain regular expression on purpose. The seam is
 * the product; the classifier is yours. Put a commercial content filter
 * (AWS Bedrock Guardrails, an in-house model, a DLP service) behind the
 * same `onMessage` and nothing else changes.
 *
 * Run:  npm run example examples/features/37-middleware.ts
 */

import {
  Agent,
  allow,
  ask,
  checkInApproved,
  defineTool,
  deny,
  isAskPause,
  type LLMProvider,
  type MessageMiddleware,
  type MiddlewareDecision,
  type ToolMiddleware,
} from '../../src/index.js';
import { mock } from '../../src/llm-providers.js';
import { isCliEntry, printResult, type ExampleMeta } from '../helpers/cli.js';

export const meta: ExampleMeta = {
  id: 'features/37-middleware',
  title: 'Middleware — allow, deny, ask',
  group: 'features',
  description:
    'A typed chain around every tool dispatch and around the message boundary. ' +
    'Transforms commit both versions; denials reach the model as data; an ask ' +
    'suspends on the shipped pause machinery and resumes with a decision.',
  defaultInput: 'Refund order 118 to the card ending 4242, my SSN is 123-45-6789.',
  providerSlots: ['default'],
  tags: ['features', 'governance', 'pii', 'human-in-the-loop', 'security', 'trace'],
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

// #region pii-scrub
/**
 * A PII scrub, as a message middleware. One plain regex — the seam is the
 * product, the classifier is yours.
 *
 * Placed at `'input'`, it runs BEFORE the message is committed, so the
 * window strategies, the injections, the request bytes and every slice
 * taken later all agree about what the user said. Transform any later and
 * the trace would show one message while the model answered another.
 */
const scrubSSNs: MessageMiddleware = {
  name: 'scrub-ssns',
  onMessage: (msg) => {
    const clean = msg.content.replace(/\b\d{3}-\d{2}-\d{4}\b/g, '[ssn]');
    return clean === msg.content ? allow() : allow(clean, 'masked a US SSN');
  },
};
// #endregion pii-scrub

// #region tool-rules
/** A hard rule. The reason is written FOR THE MODEL — it is what it reads. */
const refundCeiling: ToolMiddleware = {
  name: 'refund-ceiling',
  onToolCall: (call) =>
    Number(call.args.amount) > 10_000
      ? deny('refunds over $10,000 must go through the finance desk, not this agent')
      : allow(),
};

/** A soft rule: above $100, a person decides. */
const fourEyes: ToolMiddleware = {
  name: 'four-eyes',
  onToolCall: (call) =>
    Number(call.args.amount) > 100
      ? ask({ question: `Approve a $${String(call.args.amount)} refund?`, detail: call.args })
      : allow(),
};
// #endregion tool-rules

function show(rows: readonly MiddlewareDecision[]): void {
  for (const r of rows) {
    const where = r.at === 'message' ? `message:${r.phase ?? ''}` : `tool:${r.toolName ?? ''}`;
    const what = r.changed ? `${JSON.stringify(r.before)} → ${JSON.stringify(r.after)}` : '';
    console.log(`  ${r.middleware.padEnd(16)} ${r.outcome.padEnd(6)} ${where}  ${r.why ?? ''}`);
    if (what) console.log(`  ${' '.repeat(16)}        ${what}`);
  }
}

function ledgerOf(agent: Agent): readonly MiddlewareDecision[] {
  const state = agent.getLastSnapshot()?.sharedState as {
    middlewareDecisions?: readonly MiddlewareDecision[];
  };
  return state?.middlewareDecisions ?? [];
}

export async function run(input: string, provider?: LLMProvider): Promise<string> {
  const llm =
    provider ??
    mock({
      replies: [
        { toolCalls: [{ id: 'c1', name: 'issue_refund', args: { orderId: '118', amount: 250 } }] },
        { content: 'Done — the refund is on its way.' },
      ],
    });

  // #region wire
  const agent = Agent.create({ provider: llm, model: 'small-model' })
    .system('You handle refunds.')
    .tool(refund)
    // Order is call order, and each link sees the previous one's output.
    .toolMiddleware(refundCeiling, fourEyes)
    .messageMiddleware(scrubSSNs)
    .build();
  // #endregion wire

  const first = await agent.run({ message: input });

  // ── The ask suspended the run. ──────────────────────────────────
  if (!isAskPause(first)) {
    console.log('No question was raised; the answer came straight back.');
    return typeof first === 'string' ? first : '';
  }

  console.log(`PAUSED — '${first.ask.middleware}' asks: ${first.ask.question}`);
  console.log('\nWhat the run had recorded by the time it paused:');
  show(ledgerOf(agent));

  // The checkpoint is JSON. Persist it anywhere; resume in another process,
  // on another day, on another server.
  const parked = JSON.parse(JSON.stringify(first.checkpoint)) as typeof first.checkpoint;

  // ── A person approves. The chain resumes; the REAL tool runs. ────
  const answer = await agent.resume(parked, checkInApproved({ by: 'dana@ops' }));

  console.log('\nAfter the approval:');
  show(ledgerOf(agent));
  console.log(
    '\nThe answer came from the tool, not from the middleware and not from the ' +
      'person who approved it. That is the one thing the outcome union makes ' +
      'impossible to get wrong.',
  );

  if (typeof answer !== 'string') throw new Error('Agent paused unexpectedly.');
  return answer;
}

if (isCliEntry(import.meta.url)) {
  run(meta.defaultInput ?? '')
    .then(printResult)
    .catch(console.error);
}
