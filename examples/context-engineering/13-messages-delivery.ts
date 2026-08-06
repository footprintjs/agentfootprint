/**
 * 13 — Messages delivery: putting a declaration INTO the conversation.
 *
 * `slot: 'messages'` appends the content to `scope.history` itself — the
 * same window the window strategies govern and the request is built from.
 * It requires a `role`, and there is no default: who appears to speak is a
 * meaning your app owns, not one the library picks for you.
 *
 * Two rules can say no, and both say so out loud:
 *
 *   • ROLE — a provider declares what it carries inside `messages`
 *     (`carriesInMessages`). Anthropic-family wires drop `role: 'system'`
 *     there because system is a separate top-level field; OpenAI-family
 *     wires carry it. A role your provider cannot carry is refused when the
 *     run starts, naming the provider — never silently re-roled.
 *
 *   • POSITION — a delivered message goes at the END of the window, and
 *     providers reject two turns of the same role in a row. A collision
 *     DEFERS to the next boundary and records why on
 *     `messagesDelivery.deferred`. Nothing is reordered, and nothing is ever
 *     placed between a tool call and its result.
 *
 * This example shows both halves on one run: a `user` note that waits, and an
 * `assistant` note that lands. Which one is which is not about the flavor —
 * it is about what the window already ends with. In a tool-using loop the
 * window ends on the user's turn or on tool results (which count as a user
 * turn on the strictest wire), so a `user` role will typically never get a
 * slot. Use `assistant`, use `system` on a provider that carries it, or
 * return the words from the tool whose result they are about.
 */

import { Agent, type LLMProvider } from '../../src/index.js';
import { defineFact, defineInstruction } from '../../src/doors/context.js';
import { mock } from '../../src/doors/providers.js';
import { isCliEntry, printResult, type ExampleMeta } from '../helpers/cli.js';

export const meta: ExampleMeta = {
  id: 'context-engineering/13-messages-delivery',
  title: 'Messages delivery — declared content, delivered into the window',
  group: 'context-engineering',
  description:
    "slot:'messages' appends to scope.history with a role you name. Roles a " +
    'provider cannot carry are refused at run start; roles that collide with ' +
    'the end of the window are deferred with a recorded reason.',
  defaultInput: 'where is my refund?',
  providerSlots: ['default'],
  tags: ['context-engineering', 'messages-slot', 'delivery', 'provider-capability'],
};

export async function run(input: string, provider?: LLMProvider): Promise<string> {
  // #region declare
  // WAITS. The window at this point is `[user: "where is my refund?"]`, and a
  // user turn cannot follow a user turn — so this is deferred to the next
  // boundary with a sentence saying why. It is not dropped, and the one behind
  // it is NOT moved in front of it to fill the gap: order inside a declaration
  // list is part of what was declared.
  const nudge = defineInstruction({
    id: 'nudge',
    prompt: 'PS: please be quick, I am between meetings.',
    slot: 'messages',
    role: 'user',
  });

  // LANDS. An assistant turn does fit after the user's, so this one goes in —
  // a deferral stops its own injection, not the whole stage.
  const tier = defineFact({
    id: 'tier',
    description: 'the customer tier the desk should assume',
    data: 'Account tier: gold (refunds under $200 are pre-approved).',
    slot: 'messages',
    role: 'assistant',
  });
  // #endregion declare

  // #region attach
  const agent = Agent.create({
    provider: provider ?? mock({ reply: 'Your refund is approved and on its way.' }),
    model: 'mock',
    maxIterations: 1,
  })
    .system('You are a customer support assistant.')
    // Declaration order is delivery order.
    .instruction(nudge)
    .fact(tier)
    .build();
  // #endregion attach

  const result = await agent.run({ message: input });
  if (typeof result !== 'string') throw new Error('Agent paused unexpectedly.');

  // #region inspect
  // The delivery record is committed state — it is in the commit log and in
  // the snapshot, and it is the answer to "why is my declaration not on the
  // wire?". No new event to subscribe to.
  const delivery = (
    agent.getSnapshot()?.sharedState as {
      messagesDelivery?: {
        delivered: readonly { injectionId: string; role: string; wireIndex: number }[];
        deferred: readonly { injectionId: string; reason: string; note: string }[];
      };
    }
  )?.messagesDelivery;

  const landed = (delivery?.delivered ?? [])
    .map((d) => `  ✓ ${d.injectionId} as ${d.role} at message ${d.wireIndex}`)
    .join('\n');
  const waiting = (delivery?.deferred ?? [])
    .map((d) => `  … ${d.injectionId} deferred (${d.reason})\n     ${d.note}`)
    .join('\n');
  // #endregion inspect

  return [result, '', 'Delivered:', landed || '  (none)', 'Deferred:', waiting || '  (none)'].join(
    '\n',
  );
}

if (isCliEntry(import.meta.url)) {
  run(meta.defaultInput ?? '')
    .then(printResult)
    .catch(console.error);
}
