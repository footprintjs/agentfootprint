/**
 * 08 — .selfExplain(): the agent answers "why?" about its OWN previous turn.
 *
 * Most why-questions are FOLLOW-UPS inside the main conversation. Without
 * an API the consumer's only move is pasting logs into a chat — the whole
 * trace rides the context at full price. `.selfExplain()` makes it one
 * builder call:
 *
 *   - ONE skill is mounted. Day to day the catalog carries only the
 *     skill's activation row — the production tools are untouched.
 *   - When the user asks "why did you…", the LLM activates the skill and
 *     THAT iteration alone receives the trace tools, late-bound to the
 *     agent's own PREVIOUS COMPLETED run (never the in-flight one).
 *   - DELEGATE mode switches the model at that point: the skill unlocks a
 *     single `explain_run` tool whose work happens on a separate, cheaper
 *     provider/model via a nested traceDebugAgent.
 *
 * The transcript prints the TOOL CATALOG the model saw at every LLM call —
 * the on-demand proof: the trace tools appear exactly once, on the
 * activated iteration, and the production catalog stays clean before and
 * after.
 *
 * Offline + deterministic: scripted mock providers throughout.
 *
 * Run:  npx tsx examples/observability/08-self-explain.ts
 */

import { Agent, defineTool, mock } from '../../src/index.js';
import { isCliEntry, type ExampleMeta } from '../helpers/cli.js';

export const meta: ExampleMeta = {
  id: 'observability/08-self-explain',
  title: '.selfExplain() — in-conversation why-questions over the agent’s own trace',
  group: 'observability',
  description:
    'One builder call lets the main agent answer follow-up why-questions from its own previous ' +
    'completed run: a mounted skill gates the trace tools (catalog stays clean until the LLM ' +
    'activates it), evidence binds late to the previous turn, and delegate mode answers on a ' +
    'separate cheaper model via one explain_run tool. Transcript prints the per-call catalogs.',
  defaultInput: null,
  providerSlots: [],
  tags: ['observability', 'debugging', 'self-explain', 'skills', 'rfc-003'],
};

const lookupOrder = defineTool<{ orderId: string }, string>({
  name: 'lookup_order',
  description: 'Look up an order by id',
  inputSchema: {
    type: 'object',
    properties: { orderId: { type: 'string' } },
    required: ['orderId'],
  },
  execute: ({ orderId }) => `Order ${orderId}: purchased 12 days ago, price $480.`,
});

interface Req {
  messages: readonly { role: string; content?: unknown }[];
  tools?: readonly { name: string }[];
}
const names = (req: Req): string[] => (req.tools ?? []).map((t) => t.name);
const lastTool = (req: Req): string =>
  String([...req.messages].reverse().find((m) => m.role === 'tool')?.content ?? '');
const userText = (req: Req): string =>
  String(req.messages.find((m) => m.role === 'user')?.content ?? '');

export interface SelfExplainResult {
  inlineAnswer: string;
  delegateAnswer: string;
  inlineCatalogs: string[][];
  transcript: string;
}

export async function run(_input?: string | null): Promise<SelfExplainResult> {
  const out: string[] = [];

  // ═══ Part 1 — INLINE mode: the trace tools join the agent's own loop ═════
  const inlineCatalogs: string[][] = [];
  const provider = mock({
    respond: (req: Req) => {
      inlineCatalogs.push(names(req));
      const t = lastTool(req);
      if (names(req).includes('run_overview')) {
        // trace tools unlocked → walk the previous run, then answer from it
        if (t.includes('TRACE RUN OVERVIEW')) {
          const steps = t.match(/execution steps: (\d+)/)?.[1] ?? '?';
          return (
            `I approved it because order A-1001 was 12 days old — within the 30-day window. ` +
            `(Evidence: my previous turn ran ${steps} steps; the lookup_order result recorded ` +
            `the purchase age — see tool-calls#? in the trace.)`
          );
        }
        return { toolCalls: [{ id: 'o1', name: 'run_overview', args: {} }] };
      }
      if (/why/i.test(userText(req)) && names(req).includes('read_skill')) {
        return { toolCalls: [{ id: 's1', name: 'read_skill', args: { id: 'self-explain' } }] };
      }
      if (names(req).includes('lookup_order') && !t) {
        return { toolCalls: [{ id: 't1', name: 'lookup_order', args: { orderId: 'A-1001' } }] };
      }
      return 'Refund APPROVED for order A-1001 (purchased 12 days ago, within the 30-day window).';
    },
  });

  // #region inline
  const agent = Agent.create({ provider, model: 'mock-1', maxIterations: 6 })
    .system('You are a refunds assistant. Policy: refunds within 30 days of purchase.')
    .tool(lookupOrder)
    .selfExplain({ instruction: 'Mention the order id in your explanation.' })
    .build();
  // #endregion inline

  out.push('═══ PART 1 — inline mode ═══', '');
  const turn1 = await agent.run({ message: 'Should order A-1001 be refunded?' });
  out.push(`TURN 1 (work): ${String((turn1 as { content?: unknown }).content ?? turn1)}`);

  const turn2 = await agent.run({ message: 'Why did you approve it?' });
  const inlineAnswer = String((turn2 as { content?: unknown }).content ?? turn2);
  out.push(`TURN 2 (why): ${inlineAnswer}`, '');

  out.push('THE CATALOG, per LLM call (the on-demand proof):');
  for (let i = 0; i < inlineCatalogs.length; i++) {
    out.push(`  call ${i + 1}: [${inlineCatalogs[i].join(', ')}]`);
  }
  const activatedCall = inlineCatalogs.find((c) => c.includes('run_overview'));
  const normalCalls = inlineCatalogs.filter((c) => !c.includes('run_overview'));
  if (!activatedCall || !normalCalls.every((c) => !c.includes('trace_node'))) {
    throw new Error('expected the trace tools on exactly the activated iteration');
  }
  out.push(
    '',
    `→ trace tools appeared on exactly ${
      inlineCatalogs.filter((c) => c.includes('run_overview')).length
    } ` +
      `of ${inlineCatalogs.length} calls — the production catalog stayed clean until the skill fired.`,
    '',
  );

  // ═══ Part 2 — DELEGATE mode: the cheap-model switch ══════════════════════
  const delegateProvider = mock({
    respond: (req: Req) => {
      const t = lastTool(req);
      if (t.includes('TRACE RUN OVERVIEW')) {
        return (
          'The previous turn looked the order up (purchased 12 days ago) and approved within ' +
          'policy — evidence: the tool-calls stage result in the recorded trace.'
        );
      }
      return { toolCalls: [{ id: 'd1', name: 'run_overview', args: {} }] };
    },
  });
  const mainProvider = mock({
    respond: (req: Req) => {
      const t = lastTool(req);
      if (names(req).includes('explain_run')) {
        // the activation confirmation is not an answer — now CALL the tool
        if (!t || t.includes('activated for the next iteration')) {
          return {
            toolCalls: [{ id: 'e1', name: 'explain_run', args: { question: 'Why approved?' } }],
          };
        }
        return `(from the delegate debugger) ${t}`;
      }
      if (/why/i.test(userText(req)) && names(req).includes('read_skill')) {
        return { toolCalls: [{ id: 's1', name: 'read_skill', args: { id: 'self-explain' } }] };
      }
      if (names(req).includes('lookup_order') && !t) {
        return { toolCalls: [{ id: 't1', name: 'lookup_order', args: { orderId: 'A-1001' } }] };
      }
      return 'Refund APPROVED for order A-1001.';
    },
  });

  // #region delegate
  const delegatingAgent = Agent.create({
    provider: mainProvider,
    model: 'mock-big',
    maxIterations: 6,
  })
    .system('You are a refunds assistant.')
    .tool(lookupOrder)
    // Answer why-questions on a separate, cheaper model (swap the mocks for
    // anthropic() + a Haiku-class model in production).
    .selfExplain({ delegate: { provider: delegateProvider, model: 'mock-cheap' } })
    .build();
  // #endregion delegate

  out.push('═══ PART 2 — delegate mode (the cheap-model switch) ═══', '');
  await delegatingAgent.run({ message: 'Should order A-1001 be refunded?' });
  const why = await delegatingAgent.run({ message: 'Why did you approve it?' });
  const delegateAnswer = String((why as { content?: unknown }).content ?? why);
  out.push(`TURN 2 (why, via delegate): ${delegateAnswer}`, '');
  if (!delegateAnswer.includes('from the delegate debugger')) {
    throw new Error('expected the nested debugger to produce the answer');
  }
  out.push(
    '→ the main conversation (mock-big) paid for ONE tool call; the trace walking ran on ' +
      'mock-cheap. Swap the mocks for anthropic() + a Haiku-class model and that is the ' +
      'real price split.',
  );

  const transcript = out.join('\n');
  console.log(transcript);
  return { inlineAnswer, delegateAnswer, inlineCatalogs, transcript };
}

if (isCliEntry(import.meta.url)) {
  run().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
