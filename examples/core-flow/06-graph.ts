/**
 * 06 — graph(): a fixed DAG of runners, run level by level.
 *
 * `Sequence` and `workflow()` run steps in a line; `Parallel` fans out
 * once and merges. A real pipeline is usually neither: one step feeds two
 * independent lookups, and a final step waits for both. `graph()` states
 * that shape as nodes and edges, works out what can run at the same time
 * (Kahn levelization, at BUILD time), and hands each node exactly what its
 * parents produced.
 *
 * This example is a diamond:
 *
 *              ┌──> orders ──┐
 *   classify ──┤             ├──> reply
 *              └──> billing ─┘
 *
 * `orders` and `billing` are independent, so they sit in one level and run
 * concurrently. `reply` has TWO parents, so it MUST declare a `join` —
 * a silent merge would be a wrong merge, and the build refuses without one.
 *
 * Run:  npx tsx examples/core-flow/06-graph.ts
 */

import { FlowChartExecutor, flowChart, type FlowChart, type TypedScope } from 'footprintjs';
import { graph, LLMCall, RunnerBase } from '../../src/index.js';
import { isCliEntry, printResult, type ExampleMeta } from '../helpers/cli.js';
import { exampleProvider } from '../helpers/provider.js';

export const meta: ExampleMeta = {
  id: 'core-flow/06-graph',
  title: 'graph — a fixed DAG, with the concurrency worked out for you',
  group: 'core-flow',
  description:
    'Declare nodes and edges; independent nodes run concurrently. Cycles, unknown edge endpoints and un-joined fan-in are refused at build time.',
  defaultInput: 'where is the refund for order A-42?',
  providerSlots: ['default'],
  tags: ['composition', 'graph', 'dag', 'concurrency'],
};

/** What the lookups hand to the reply step. Plain data — see the graph
 *  guide for why prototypes (Date, Map) do not survive a node boundary. */
interface OrderInfo {
  readonly orderId: string;
  readonly status: string;
}
interface BillingInfo {
  readonly refundUsd: number;
}

/**
 * A plain typed node: any `(input) => output` function, as a Runner. One
 * stage, and the stage's return value is what its children receive.
 */
class Step<TIn extends object, TOut> extends RunnerBase<TIn, TOut> {
  readonly id: string;
  readonly name: string;
  private readonly fn: (input: TIn) => TOut | Promise<TOut>;

  constructor(id: string, fn: (input: TIn) => TOut | Promise<TOut>) {
    super();
    this.id = id;
    this.name = id;
    this.fn = fn;
    this.initChart(() => this.buildChart());
  }

  private buildChart(): FlowChart {
    const fn = this.fn;
    return flowChart<TOut, TypedScope<Record<string, unknown>>>(
      this.name,
      async (scope) => fn(scope.$getArgs<TIn>()),
      `${this.id}-run`,
    ).build();
  }

  async run(input: TIn): Promise<TOut> {
    const executor = new FlowChartExecutor(this.getSpec());
    this.lastExecutor = executor;
    return (await executor.run({ input: { ...input } })) as TOut;
  }

  async resume(): Promise<TOut> {
    throw new Error(`${this.id}: this node has nothing to pause on`);
  }
}

const delay = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

export async function run(
  input: string,
  provider?: import('../../src/index.js').LLMProvider,
): Promise<unknown> {
  const classify = LLMCall.create({
    provider:
      provider ?? exampleProvider('core-flow', { reply: 'refund request for order A-42' }),
    model: 'mock',
  })
    .system('Restate the request in one line, keeping any order id.')
    .build();

  const reply = LLMCall.create({
    provider:
      provider ??
      exampleProvider('core-flow', {
        // `reply: undefined` clears the folder preset's fixed reply so the
        // mock actually reads what the join handed it.
        reply: undefined,
        respond: (req) => {
          const last = [...req.messages].reverse().find((m) => m.role === 'user');
          return `Thanks for waiting — ${last?.content ?? ''}`;
        },
      }),
    model: 'mock',
  })
    .system('Write a short, warm acknowledgement.')
    .build();

  // Each lookup records when it ran, so the overlap below is measured
  // rather than asserted.
  const ran: { node: string; startedMs: number; endedMs: number }[] = [];
  const timed = async <T>(node: string, work: () => Promise<T>): Promise<T> => {
    const startedMs = Date.now();
    const value = await work();
    ran.push({ node, startedMs, endedMs: Date.now() });
    return value;
  };

  // #region graph-dag
  // Two INDEPENDENT lookups. Nothing here schedules them — they share a
  // level, so the graph runs them at the same time.
  const orders = new Step<{ message: string }, OrderInfo>('orders', ({ message }) =>
    timed('orders', async () => {
      await delay(150);
      return { orderId: /([A-Z]-\d+)/.exec(message)?.[1] ?? 'unknown', status: 'shipped' };
    }),
  );

  const billing = new Step<{ message: string }, BillingInfo>('billing', () =>
    timed('billing', async () => {
      await delay(150);
      return { refundUsd: 42 };
    }),
  );

  const pipeline = graph({
    nodes: [
      { id: 'classify', runner: classify },
      { id: 'orders', runner: orders },
      { id: 'billing', runner: billing },
      {
        id: 'reply',
        runner: reply,
        // TWO parents ⇒ a join is REQUIRED. `upstream` is keyed by parent
        // node id, and each value is that node's output, unchanged.
        join: (upstream) => {
          const order = upstream.orders as OrderInfo;
          const bill = upstream.billing as BillingInfo;
          return {
            message: `order ${order.orderId} is ${order.status}; refund $${bill.refundUsd}`,
          };
        },
      },
    ],
    edges: [
      { from: 'classify', to: 'orders' },
      { from: 'classify', to: 'billing' },
      { from: 'orders', to: 'reply' },
      { from: 'billing', to: 'reply' },
    ],
    id: 'support',
  });

  // The levels are decided at BUILD time — this is the concurrency contract.
  console.log('levels:', JSON.stringify(pipeline.getLevels()));
  // #endregion graph-dag

  const out = (await pipeline.run({ message: input })) as Record<string, unknown>;

  // The two lookups sat in one level, so their run intervals OVERLAP.
  // Run them in a Sequence instead and this reads "back to back".
  const [first, second] = [...ran].sort((a, b) => a.startedMs - b.startedMs);
  if (first !== undefined && second !== undefined) {
    const overlapped = second.startedMs < first.endedMs;
    console.log(
      `\n${first.node} and ${second.node} ${overlapped ? 'OVERLAPPED' : 'ran back to back'} ` +
        `— second started ${second.startedMs - first.startedMs}ms after the first, ` +
        `which took ${first.endedMs - first.startedMs}ms`,
    );
  }
  console.log('orders :', JSON.stringify(out.orders));
  console.log('billing:', JSON.stringify(out.billing));
  console.log('\nOutput:', out.reply);
  return out;
}

if (isCliEntry(import.meta.url)) {
  run(meta.defaultInput ?? '').then(printResult).catch(console.error);
}
