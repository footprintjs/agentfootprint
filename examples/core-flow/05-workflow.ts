/**
 * 05 — workflow(): sequential steps whose hand-offs the compiler checks.
 *
 * `Sequence` chains steps through one channel: text in, text out. The
 * moment a step wants to hand the next one something structured, that
 * channel loses it (Sequence coerces a non-string step output to '').
 * `workflow()` keeps the value AND proves the chain lines up before you
 * run it: step N's output type must be what step N+1 accepts, and a
 * `string` output feeds the next step's `{ message }` as always.
 *
 * This example chains four steps of both kinds:
 *
 *   classify (LLM: text → text)
 *     → extract (typed: text → Ticket)
 *       → brief (typed: Ticket → text)
 *         → reply (LLM: text → text)
 *
 * Run:  npx tsx examples/core-flow/05-workflow.ts
 */

import { FlowChartExecutor, flowChart, type FlowChart, type TypedScope } from 'footprintjs';
import { workflow, LLMCall, RunnerBase } from '../../src/index.js';
import { isCliEntry, printResult, type ExampleMeta } from '../helpers/cli.js';
import { exampleProvider } from '../helpers/provider.js';

export const meta: ExampleMeta = {
  id: 'core-flow/05-workflow',
  title: 'workflow — typed steps, compile-checked hand-offs',
  group: 'core-flow',
  description:
    'Chain 1–8 runners where step N’s output type must be step N+1’s input type. Structured values survive the hand-off; a broken chain is a compile error.',
  defaultInput: 'where is the refund for order A-42!',
  providerSlots: ['default'],
  tags: ['composition', 'workflow', 'types'],
};

/** What the middle of this pipeline passes around. Plain data — see the
 *  workflow guide for why prototypes (Date, Map) do not survive a step
 *  boundary. */
interface Ticket {
  readonly orderId: string;
  readonly angry: boolean;
}

/**
 * A plain typed step: any `(input) => output` function, as a Runner.
 * This is all it takes to put non-LLM work in a chain — one stage, and
 * the stage's return value is what the next step receives.
 */
class Step<TIn extends object, TOut> extends RunnerBase<TIn, TOut> {
  readonly id: string;
  readonly name: string;
  private readonly fn: (input: TIn) => TOut;

  constructor(id: string, fn: (input: TIn) => TOut) {
    super();
    this.id = id;
    this.name = id;
    this.fn = fn;
    this.initChart(() => this.buildChart());
  }

  private buildChart(): FlowChart {
    const fn = this.fn;
    // The `<TOut, TScope>` overload — the stage RETURNS the step's value,
    // which is what the next step (or the caller) receives.
    return flowChart<TOut, TypedScope<Record<string, unknown>>>(
      this.name,
      (scope) => fn(scope.$getArgs<TIn>()),
      `${this.id}-run`,
    ).build();
  }

  async run(input: TIn): Promise<TOut> {
    const executor = new FlowChartExecutor(this.getSpec());
    this.lastExecutor = executor;
    return (await executor.run({ input: { ...input } })) as TOut;
  }

  async resume(): Promise<TOut> {
    throw new Error(`${this.id}: this step has nothing to pause on`);
  }
}

export async function run(
  input: string,
  provider?: import('../../src/index.js').LLMProvider,
): Promise<unknown> {
  const classify = LLMCall.create({
    provider: provider ?? exampleProvider('core-flow', { reply: 'refund request for order A-42!' }),
    model: 'mock',
  })
    .system('Restate the request in one line, keeping any order id.')
    .build();

  const reply = LLMCall.create({
    provider:
      provider ??
      exampleProvider('core-flow', {
        // `reply: undefined` clears the folder preset's fixed reply so the
        // mock actually reads what the previous step handed it.
        reply: undefined,
        respond: (req) => {
          const last = [...req.messages].reverse().find((m) => m.role === 'user');
          return `Thanks for your patience — ${last?.content ?? ''}`;
        },
      }),
    model: 'mock',
  })
    .system('Write a short, warm acknowledgement.')
    .build();

  // #region workflow-chain
  // text → Ticket: the hand-off Sequence cannot carry.
  const extract = new Step<{ message: string }, Ticket>('extract', ({ message }) => ({
    orderId: /([A-Z]-\d+)/.exec(message)?.[1] ?? 'unknown',
    angry: message.includes('!'),
  }));

  // Ticket → text: back onto the channel the LLM steps speak.
  const brief = new Step<Ticket, string>(
    'brief',
    (t) => `order ${t.orderId}, customer is ${t.angry ? 'upset' : 'calm'}`,
  );

  const intake = workflow(classify, extract, brief, reply);
  //    ^? Workflow<{ message: string }, string>

  // workflow(classify, brief) would not compile: `brief` needs a Ticket
  // and `classify` hands over a string.
  // #endregion workflow-chain

  intake.on('agentfootprint.composition.enter', (e) =>
    console.log(`[enter] ${e.payload.name} with ${e.payload.childCount} steps`),
  );

  const out = await intake.run({ message: input });
  console.log('\nOutput:', out);
  return out;
}

if (isCliEntry(import.meta.url)) {
  run(meta.defaultInput ?? '').then(printResult).catch(console.error);
}
