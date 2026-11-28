/**
 * 17 — Per-skill brains + typed tool effects (9.19.0).
 *
 * TWO features, one support desk:
 *
 * MODEL SWITCHING — "the cursor picks the brain". A skill graph already
 * decides WHERE the run is; `defineSkill({ provider, model })` (or
 * `skillGraph(g, { providers })`) lets that same position decide WHO
 * answers: triage runs on the agent's own cheap model, the refund skill on
 * its declared stronger one. One consult at the top of every LLM call, the
 * stated precedence chain (escalation > skill brain > `.configure()` >
 * build default), and `llm_start.brain` records which rung won.
 *
 * TYPED TOOL EFFECTS — a tool steers the run with DATA, never string
 * conventions: return `{ content, effects, status }` and
 *   • `status: 'denied'` lets a declared `onToolStatus` edge route on
 *     MEANING (a denied refund must never route like a success);
 *   • `{ kind: 'require-instruction', instructionId, deliveryLease }`
 *     PUSHES a registered instruction into the next call(s) — the pull
 *     door (`read_skill`) stays; this is the push door, catalog-only.
 * Every judgment is a typed `tools.effect` event; refusals are teaching.
 *
 * The record IS the feature — this example prints the brain that served
 * each call, the status-routed hop, and the effect events.
 */

import { Agent, defineTool, type LLMProvider } from '../../src/index.js';
import { defineInstruction, defineSkill, skillGraph } from '../../src/doors/context.js';
import { mock } from '../../src/doors/providers.js';
import { isCliEntry, printResult, type ExampleMeta } from '../helpers/cli.js';

export const meta: ExampleMeta = {
  id: 'context-engineering/17-brains-and-tool-effects',
  title: 'Per-skill brains + typed tool effects',
  group: 'context-engineering',
  description:
    'The refund skill answers on its own declared model ("the cursor picks ' +
    'the brain"), a denied refund routes by declared status edge — meaning, ' +
    'not prose — and the refund tool pushes a registered denial playbook ' +
    'into the next call. Every move is a typed event.',
  defaultInput: 'Please refund order #7011',
  providerSlots: ['default'],
  tags: ['context-engineering', 'skills', 'brains', 'tool-effects', 'routing', 'showcase'],
};

export async function run(input: string, provider?: LLMProvider): Promise<string> {
  // ── The tools ──────────────────────────────────────────────────────────
  const checkAccount = defineTool<Record<string, never>, string>({
    name: 'check_account',
    description: 'Look up the account and its recent orders.',
    inputSchema: { type: 'object', properties: {} },
    execute: () => 'order #7011: $89, purchased 47 days ago',
  });

  // #region tool-effects
  // A tool opts into the typed effects channel by RETURNING the envelope —
  // content for the model, status + effects for the framework. Plain
  // returns stay byte-identical; string conventions never become authority.
  const issueRefund = defineTool<Record<string, never>, unknown>({
    name: 'issue_refund',
    description: 'Issue the refund for the looked-up order.',
    inputSchema: { type: 'object', properties: {} },
    execute: () => ({
      content: 'refund refused: order is outside the 30-day window (policy P-12)',
      // The declared OUTCOME — the `onToolStatus: 'denied'` edge below
      // routes on this, so a denial can never route like a success.
      status: 'denied',
      // Push the registered playbook into the NEXT call — the model reads
      // the denial with the playbook already in front of it.
      effects: [
        {
          kind: 'require-instruction',
          instructionId: 'denial-playbook',
          deliveryLease: 'next-call',
        },
      ],
    }),
  });

  // The pushed instruction must be REGISTERED — an unknown id is a
  // teaching refusal, recorded. It is inert on its own (`activeWhen`
  // false); only a granted lease ever delivers it.
  const denialPlaybook = defineInstruction({
    id: 'denial-playbook',
    prompt:
      'A refund was denied by policy. Explain WHICH policy, offer store credit, ' +
      'and never promise an exception.',
    activeWhen: () => false,
  });
  // #endregion tool-effects

  // ── The graph, with brains ────────────────────────────────────────────
  // #region define-brains
  // The refund skill declares its own brain: while the cursor is on it,
  // every LLM call runs on THIS provider/model instead of the agent's.
  // (Same-name providers may omit `model` and inherit down the chain; a
  // FOREIGN provider must name one — refused at build otherwise.)
  const refundBrain = provider ?? refundBrainScript();
  const refund = defineSkill({
    id: 'refund',
    description: 'Handles refunds: look up the order, then issue or deny.',
    body: 'Check the order with issue_refund after the account lookup routed you here.',
    tools: [issueRefund] as never,
    provider: refundBrain,
    model: 'refund-strong-model',
  });

  const triage = defineSkill({
    id: 'triage',
    description: 'First contact: look up the account.',
    body: 'Start every request with check_account.',
    tools: [checkAccount] as never,
  });

  const escalation = defineSkill({
    id: 'escalation-desk',
    description: 'Handles denied refunds with the playbook.',
    body: 'The refund was denied. Follow the delivered playbook.',
  });

  const graph = skillGraph()
    .entry(triage)
    .route(triage, refund, { onToolReturn: 'check_account' })
    // Route on MEANING: only a DENIED issue_refund moves to the desk.
    .route(refund, escalation, { onToolReturn: 'issue_refund', onToolStatus: 'denied' })
    .build();
  // #endregion define-brains

  const record: string[] = [];
  const agent = Agent.create({
    provider: provider ?? agentScript(),
    model: 'triage-small-model',
    maxIterations: 8,
  })
    .system('You are a support desk.')
    .skillGraph(graph)
    .watch({
      id: 'brains-and-effects-record',
      onEmit: (e) => {
        const p = (e.payload ?? {}) as Record<string, unknown>;
        if (e.name === 'agentfootprint.stream.llm_start') {
          const brain = p.brain as { via?: string; skillId?: string } | undefined;
          record.push(
            `llm_start       model=${String(p.model)}${
              brain ? ` brain=${brain.via}${brain.skillId ? `(${brain.skillId})` : ''}` : ''
            }`,
          );
        }
        if (e.name === 'agentfootprint.stream.tool_end' && p.status !== undefined) {
          record.push(`tool_end        status=${String(p.status)}`);
        }
        if (e.name === 'agentfootprint.tools.effect') {
          record.push(
            `tools.effect    ${String(p.kind)} → ${String(p.outcome)}${
              p.instructionId ? ` (${String(p.instructionId)}, ${String(p.deliveryLease)})` : ''
            }`,
          );
        }
        if (e.name === 'agentfootprint.context.evaluated') {
          const cm = p.cursorMove as { by?: string; to?: string } | undefined;
          if (cm?.to !== undefined) record.push(`cursor          ${cm.by} → ${cm.to}`);
          const active = (p.activeIds as readonly string[] | undefined) ?? [];
          if (active.includes('denial-playbook')) {
            record.push('delivered       denial-playbook (leased for this call)');
          }
        }
      },
    })
    .injection(denialPlaybook)
    .build();

  const answer = await agent.run({ message: input });
  return [`answer: ${answer}`, '', 'the recorded run:', ...record.map((r) => `  ${r}`)].join('\n');
}

/** The agent's own (small) brain: triage + the escalation desk's answer. */
function agentScript(): LLMProvider {
  const script = [
    { name: 'check_account', args: {} }, // iteration 1 — triage
    null, // iteration 3 — escalation desk answers with the playbook delivered
  ];
  let i = 0;
  return mock({
    respond: () => {
      const next = script[i];
      i += 1;
      if (!next) {
        return {
          content:
            'Order #7011 is outside the 30-day window (policy P-12), so I cannot refund it — ' +
            'I can offer store credit instead.',
          toolCalls: [],
          stopReason: 'stop' as const,
        };
      }
      return {
        content: '',
        toolCalls: [{ id: `a${i}`, name: next.name, args: next.args }],
        stopReason: 'tool_use' as const,
      };
    },
  });
}

/** The refund skill's declared brain — it serves exactly the refund tenure. */
function refundBrainScript(): LLMProvider {
  return mock({
    replies: [
      {
        content: '',
        toolCalls: [{ id: 'r1', name: 'issue_refund', args: {} }],
        stopReason: 'tool_use' as const,
      },
    ],
  });
}

if (isCliEntry(import.meta.url)) {
  run(meta.defaultInput ?? '')
    .then(printResult)
    .catch(console.error);
}
