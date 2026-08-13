/**
 * 58 — Typed HITL: the ask carries a COMPONENT, the big props ride the store.
 *
 * The pause fires exactly as example 01 — but the question now carries the
 * typed half: `component: { componentId, props?, propsRef? }`. `componentId`
 * names a component REGISTERED in your frontend (ids and props only, never
 * markup — the screen's registry decides what renders, the model never
 * authors UI). Small props ride inline; the 200-option picker payload is an
 * ARTIFACT the tool mints via `ctx.artifacts` BEFORE raising the ask, so the
 * checkpoint and every stored session envelope stay lean — the ask carries a
 * ~26-char ticket, and the screen redeems it through the same artifact wire
 * every other ref rides.
 *
 * A `propsRef` that cannot be honored refuses AT THE SOURCE (no store
 * attached, or a ref that does not resolve in the run's scope) — teachingly,
 * never discovered by the person answering.
 *
 * The decision RETURNS exactly as it always did — a structured value on
 * `resume()`, never parsed from prose. The screen may render the decision as
 * words ("You picked: Duplicate charge"); the words are display, the
 * structured fact is the record — which now also says WHICH surface collected
 * it (`componentId` on `pause.resume` / `checkin.decision` / ledger rows).
 */

import {
  Agent,
  askHuman,
  defineTool,
  inMemoryArtifacts,
  isPaused,
  type LLMProvider,
  type LLMRequest,
  type LLMResponse,
  type RunnerPauseOutcome,
} from '../../src/index.js';
import { isCliEntry, printResult, type ExampleMeta } from '../helpers/cli.js';
import { exampleProvider } from '../helpers/provider.js';

export const meta: ExampleMeta = {
  id: 'features/58-typed-hitl-component',
  title: 'Typed HITL — component asks',
  group: 'features',
  description:
    'askHuman({ question, component }): the ask names a registered screen component; a 200-option payload rides the artifact store as propsRef, not the checkpoint; the decision returns structured and the record says which surface collected it.',
  defaultInput: 'refund order 512',
  providerSlots: ['default'],
  tags: ['feature', 'pause', 'HITL', 'artifacts', 'component'],
};

/** The store is shared by the run (which mints) and "the screen" (which redeems). */
const artifacts = inMemoryArtifacts();

function buildAgent(provider?: LLMProvider): Agent {
  // #region ask-with-component
  const pickReason = defineTool({
    name: 'pick_refund_reason',
    description: 'Ask the operator to pick the refund reason from the full catalog.',
    execute: async (_args, ctx) => {
      // 1. Mint the big half FIRST — 200 options are store freight.
      const options = Array.from({ length: 200 }, (_, i) => ({
        id: `reason-${i}`,
        label: `Refund reason #${i}`,
      }));
      const meta = await ctx.artifacts.put({
        kind: 'options/list',
        mediaType: 'application/json',
        data: options,
        label: 'refund reason catalog',
      });
      // 2. The ask CARRIES the ref (validated to resolve, here, at raise).
      return askHuman({
        question: 'Which refund reason applies?',
        component: {
          componentId: 'option-picker', // your frontend's registry id
          props: { title: 'Pick the refund reason' }, // small half, inline
          propsRef: meta.ref, // big half, by ticket
        },
      });
    },
  });
  // #endregion ask-with-component

  return Agent.create({
    provider: provider ?? exampleProvider('feature', { respond: scripted }),
    model: 'mock',
    maxIterations: 3,
    artifacts,
  })
    .system('You process refunds. Ask the operator for the reason, then confirm.')
    .tool(pickReason)
    .build();
}

export async function run(input: string, provider?: LLMProvider): Promise<string> {
  const agent = buildAgent(provider);

  // The record says which surface collected each answer.
  agent.on('agentfootprint.pause.resume', (e) => {
    const p = e.payload as { componentId?: string };
    console.log(`  📋 pause.resume — collected via component: ${p.componentId ?? '(prose)'}`);
  });

  const outcome = await agent.run({ message: input });
  if (!isPaused(outcome)) return outcome as string;

  // #region screen-side
  // ── What the SCREEN does with the typed ask ─────────────────────────
  const paused = outcome as RunnerPauseOutcome;
  const ask = paused.pauseData as {
    question: string;
    component?: { componentId: string; props?: { title?: string }; propsRef?: string };
  };
  console.log(`  ❓ ${ask.question}`);
  console.log(`  🧩 component: ${ask.component?.componentId} (registry decides the renderer)`);

  // The checkpoint stayed lean — the options are in the store, not in it.
  const checkpointBytes = JSON.stringify(paused.checkpoint).length;
  const scope = {
    conversationId: (JSON.parse(JSON.stringify(paused.checkpoint)) as {
      sharedState: { runIdentity: { conversationId: string } };
    }).sharedState.runIdentity.conversationId,
  };
  const redeemed = await artifacts.get(scope, ask.component?.propsRef ?? '');
  const optionCount = (redeemed?.data as unknown[] | undefined)?.length ?? 0;
  console.log(
    `  🎟  propsRef redeemed: ${optionCount} options from the store; ` +
      `checkpoint is ${checkpointBytes} bytes and carries none of them`,
  );

  // The person clicks. The answer posts back STRUCTURED — the same field it
  // always was. "Interact-to-NL" is the screen rendering this decision as
  // words afterwards; the words are display, this value is the record.
  const decision = 'reason-42';
  // #endregion screen-side

  const final = await agent.resume(paused.checkpoint, decision);
  return typeof final === 'string' ? final : '(paused again?)';
}

/** Scripted turns: call the picker, then confirm with the picked reason. */
function scripted(req: LLMRequest): Partial<LLMResponse> {
  const picked = [...req.messages].reverse().find((m) => m.role === 'tool');
  return picked
    ? {
        content: `Refund filed under '${String(picked.content ?? '')}' — confirmed with the operator.`,
      }
    : { content: '', toolCalls: [{ id: 'c1', name: 'pick_refund_reason', args: {} }] };
}

if (isCliEntry(import.meta.url)) {
  run(meta.defaultInput ?? '').then(printResult).catch(console.error);
}
