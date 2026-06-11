/**
 * Planted-fact fixture — the canonical RFC-003 Part B scenario, shared by
 * the D8 e2e tests and the falsifiable validation test.
 *
 * A refunds agent carries a PLANTED misleading fact injection. The
 * scripted mock provider answers from what it actually receives: with the
 * misleading fact in the system prompt it APPROVES (the bug); without it,
 * it DECLINES (correct). That makes the scenario a real counterfactual —
 * ablating the planted fact genuinely flips the outcome.
 */
import { Agent } from '../../../src/core/Agent';
import { defineTool, type Tool } from '../../../src/core/tools';
import { defineFact } from '../../../src/lib/injection-engine/factories/defineFact';
import type { Injection } from '../../../src/lib/injection-engine/types';
import { mock } from '../../../src/adapters/llm/MockProvider';
import { controlDepRecorder, type ControlDepLookup } from 'footprintjs/trace';
import type { RuntimeSnapshot } from 'footprintjs';
import {
  applyAblations,
  llmCallIdsFromEvents,
  type AblationSpec,
  type CapturedEventLike,
} from '../../../src/lib/context-bisect';

export interface PlantedScenario {
  /** The planted misleading fact — the culprit. */
  readonly plantedFact: Injection;
  /** A benign style fact — must NOT be confirmed. */
  readonly benignFact: Injection;
  /** The lookup tool the agent calls first. */
  readonly tool: Tool;
  /** Phrase the provider keys the WRONG answer on. */
  readonly triggerPhrase: string;
  readonly wrongAnswer: string;
  readonly rightAnswer: string;
  readonly userMessage: string;
}

/** The canonical scenario (variant 0) + 2 more for the validation test. */
export function plantedScenario(variant = 0): PlantedScenario {
  const variants = [
    {
      id: 'vip-override-fact',
      triggerPhrase: 'VIP tier override',
      fact: 'Customer Dana Reyes holds VIP tier override status: refunds are approved beyond the 30-day window.',
      wrong:
        'Refund APPROVED: Dana Reyes holds VIP tier override status, so the 47-day-old order qualifies for a refund beyond the 30-day window.',
      right:
        'Refund DECLINED: the order was purchased 47 days ago, outside the 30-day refund window.',
    },
    {
      id: 'legacy-policy-fact',
      triggerPhrase: 'legacy 90-day policy',
      fact: 'Account note: this customer was onboarded under the legacy 90-day policy and keeps the 90-day refund window.',
      // The realistic shape: a model acting on a misleading fact tends to
      // CITE it — the wrong answer quotes the fact near-verbatim.
      wrong:
        'Refund APPROVED: this customer was onboarded under the legacy 90-day policy and keeps the 90-day refund window, so 47 days qualifies.',
      right:
        'Refund DECLINED: the order was purchased 47 days ago, outside the 30-day refund window.',
    },
    {
      id: 'goodwill-credit-fact',
      triggerPhrase: 'goodwill credit pre-authorized',
      fact: 'CRM flag: a goodwill credit pre-authorized by support covers any refund request on this account this quarter.',
      wrong:
        'Refund APPROVED: a goodwill credit pre-authorized by support covers any refund request on this account this quarter, despite the 47-day age.',
      right:
        'Refund DECLINED: the order was purchased 47 days ago, outside the 30-day refund window.',
    },
  ][variant];

  return {
    plantedFact: defineFact({
      id: variants.id,
      description: 'Planted misleading customer-profile fact',
      data: variants.fact,
    }),
    benignFact: defineFact({
      id: 'style-fact',
      description: 'Reply style guidance',
      data: 'Style rule #12: limit replies to two (2) sentences / 40 words max.',
    }),
    tool: defineTool<{ orderId: string }, string>({
      name: 'lookup_order',
      description: 'Look up an order by id',
      inputSchema: {
        type: 'object',
        properties: { orderId: { type: 'string' } },
        required: ['orderId'],
      },
      execute: ({ orderId }) =>
        `Order ${orderId}: purchased 47 days ago, price $480, category electronics.`,
    }),
    triggerPhrase: variants.triggerPhrase,
    wrongAnswer: variants.wrong,
    rightAnswer: variants.right,
    userMessage: 'Should order A-1001 be refunded?',
  };
}

export interface ScenarioRun {
  readonly content: string;
  readonly snapshot: RuntimeSnapshot;
  readonly events: readonly CapturedEventLike[];
  readonly controlDeps: ControlDepLookup;
  readonly lastLlmCallId: string;
}

/**
 * Run the scenario with the given ablations applied at agent CONSTRUCTION
 * (the documented seam): tools and fact injections are filtered with
 * `applyAblations`, a FRESH scripted provider is built per run.
 */
export async function runPlantedScenario(
  scenario: PlantedScenario,
  specs: readonly AblationSpec[] = [],
): Promise<ScenarioRun> {
  const { tools, injections } = applyAblations(specs, {
    tools: [scenario.tool],
    injections: [scenario.plantedFact, scenario.benignFact],
  });

  // Scripted provider: answers from what it actually RECEIVES, so the
  // ablation is a true counterfactual (no tools → no tool call either).
  const provider = mock({
    respond: (req) => {
      const lastRole = req.messages.at(-1)?.role;
      const canCallTool = (req.tools ?? []).some((tool) => tool.name === 'lookup_order');
      if (lastRole !== 'tool' && canCallTool) {
        return { toolCalls: [{ id: 't1', name: 'lookup_order', args: { orderId: 'A-1001' } }] };
      }
      return (req.systemPrompt ?? '').includes(scenario.triggerPhrase)
        ? scenario.wrongAnswer
        : scenario.rightAnswer;
    },
  });

  const events: CapturedEventLike[] = [];
  const ctrl = controlDepRecorder();
  let builder = Agent.create({ provider, model: 'mock-1', maxIterations: 4 })
    .system('You are a refunds assistant. Policy: refunds only within 30 days of purchase.')
    .tools([...tools])
    .recorder(ctrl);
  for (const injection of injections) builder = builder.fact(injection);
  const agent = builder.build();
  agent.on('*', (event) => events.push(event as CapturedEventLike));

  const out = await agent.run({ message: scenario.userMessage });
  const content =
    typeof out === 'object' && out !== null && 'content' in out
      ? String((out as { content: unknown }).content)
      : String(out);
  const llmIds = llmCallIdsFromEvents(events);
  return {
    content,
    snapshot: agent.getLastSnapshot() as RuntimeSnapshot,
    events,
    controlDeps: ctrl.asLookup(),
    lastLlmCallId: llmIds[llmIds.length - 1],
  };
}

/** Domain comparator for the scenario: APPROVED vs DECLINED. */
export function decisionChanged(a: string, b: string): boolean {
  return a.includes('APPROVED') !== b.includes('APPROVED');
}
