/**
 * 49 — "Why did you skip the refund?" — answered from the record, not from memory.
 *
 * An agent that did real work in turn 1 is asked, in turn 2, to justify a
 * decision it made in turn 1. The interesting part is what does NOT happen:
 * nothing re-runs. No order is looked up again, no inventory is checked
 * again, and the refund that was skipped stays skipped. The answer is
 * assembled by reading the recorded evidence of turn 1 — the commit log,
 * the narrative, and the event tail — through tools the model calls itself.
 *
 * WHY THAT MATTERS
 * ────────────────
 * The usual way to answer "why did you do that?" is to ask the model, which
 * asks the model to remember. It does not remember; it reconstructs, and a
 * reconstruction that sounds right is the most expensive kind of wrong in a
 * support flow. The other usual way is to re-run with logging on, which
 * costs a second execution and — with a tool like `issue_refund` in the
 * catalog — can cost a second side effect.
 *
 * `.selfExplain()` is neither. One builder call mounts a skill; when a
 * why-question arrives the model activates it, and THAT iteration alone
 * gains a set of read-only tools over the previous completed turn:
 *
 *   find_in_trace('refund')        the user's words → step ids and keys
 *   inspect_tool_call('c2')        one tool call end to end, with its result
 *   run_overview()                 the shape of the turn, and what it cost
 *   trace_node / who_wrote / backtrack / get_value / read_narrative
 *
 * WHAT THIS EXAMPLE PROVES, LINE BY LINE
 * ──────────────────────────────────────
 *   • a per-tool execution counter is printed before and after turn 2 —
 *     unchanged, so no business tool ran twice;
 *   • every `stream.tool_start` is printed with its turn — turn 2 shows
 *     only trace tools;
 *   • `issue_refund` stays at zero executions across both turns;
 *   • the total spend across both turns is printed against the budget.
 *
 * Every tool here is synthetic — no network, no web content. Trace tools
 * re-expose a run's own text to a model, so a run that swallowed a hostile
 * web page would re-serve it (bounded) on the way back out. Keep the
 * demonstration clean and read docs/guides/prompt-injection.md before
 * pointing this at fetched content.
 *
 * Run:
 *   npm run example examples/features/49-self-explain-live.ts      # mock, $0, deterministic
 *   ANTHROPIC_API_KEY=… npm run example examples/features/49-self-explain-live.ts
 *   DEMO_MODEL=claude-sonnet-4-6 ANTHROPIC_API_KEY=… npm run example …
 *   AGENTFOOTPRINT_DEMO_OFFLINE=1 …                                # force the mock
 *
 * The live model is a SMALL one on purpose (`claude-haiku-4-5` by default).
 * A small model investigating its own record is the whole claim: the
 * evidence does the work, so the investigator does not have to be clever.
 */

import {
  Agent,
  defineTool,
  type LLMProvider,
  type LLMRequest,
  type PricingTable,
} from '../../src/index.js';
import { mock } from '../../src/doors/providers.js';
import { isCliEntry, printResult, type ExampleMeta } from '../helpers/cli.js';

export const meta: ExampleMeta = {
  id: 'features/49-self-explain-live',
  title: 'Self-explaining agent — "why did you skip the refund?" answered from the record',
  group: 'features',
  // One literal, deliberately: the examples README generator captures the
  // first string of a concatenation, so a `+`-joined description renders
  // truncated in the table.
  description: 'One .selfExplain() call lets an agent answer a why-question about its OWN previous turn by walking the recorded evidence of that turn with trace tools (find_in_trace → inspect_tool_call → run_overview). Nothing re-executes: the per-tool run counters are printed either side of the explanation and are unchanged, and the refund it decided against is never issued.',
  defaultInput: 'Order 7712 arrived damaged — replace or refund it.',
  providerSlots: ['default'],
  tags: ['feature', 'trace', 'self-explain', 'observability', 'tools', 'cost'],
};

// ─── The business tools. Synthetic, and they count their own executions. ───

/** Every real execution of a business tool, by name. The proof lives here. */
const toolRuns: Record<string, number> = {
  lookup_order: 0,
  check_inventory: 0,
  issue_refund: 0,
};

const lookupOrder = defineTool<{ orderId: string }, string>({
  name: 'lookup_order',
  description: 'Look up an order by id: what was bought, when, and its warranty state.',
  inputSchema: {
    type: 'object',
    properties: { orderId: { type: 'string', description: 'The order id, e.g. 7712' } },
    required: ['orderId'],
    additionalProperties: false,
  },
  execute: ({ orderId }) => {
    toolRuns.lookup_order += 1;
    return (
      `Order ${orderId}: 1 × "Aurora Mechanical Keyboard" (sku KB-88), $189.00, ` +
      `delivered 6 days ago, warranty ACTIVE (90 days).`
    );
  },
});

const checkInventory = defineTool<{ sku: string }, string>({
  name: 'check_inventory',
  description: 'Check warehouse stock for a sku before promising a replacement.',
  inputSchema: {
    type: 'object',
    properties: { sku: { type: 'string', description: 'The stock keeping unit, e.g. KB-88' } },
    required: ['sku'],
    additionalProperties: false,
  },
  execute: ({ sku }) => {
    toolRuns.check_inventory += 1;
    return `Stock for ${sku}: 12 units available, ships same day from WH-2.`;
  },
});

const issueRefund = defineTool<{ orderId: string; amount: number }, string>({
  name: 'issue_refund',
  description: 'Refund an order. Irreversible — money leaves the account.',
  inputSchema: {
    type: 'object',
    properties: {
      orderId: { type: 'string' },
      amount: { type: 'number' },
    },
    required: ['orderId', 'amount'],
    additionalProperties: false,
  },
  execute: ({ orderId, amount }) => {
    toolRuns.issue_refund += 1;
    return `Refunded $${amount.toFixed(2)} on order ${orderId}. This cannot be undone.`;
  },
});

const POLICY =
  'You are an order-support agent for a hardware store.\n' +
  'Policy: for a damaged item under an ACTIVE warranty, check inventory first. ' +
  'If the item is in stock, offer a REPLACEMENT and do NOT issue a refund — a refund is ' +
  'only for out-of-stock or out-of-warranty items. Say which rule you applied.';

// ─── The scripted model, for the $0 deterministic run ─────────────────────

interface Req {
  readonly messages: readonly { role: string; content?: unknown }[];
  readonly tools?: readonly { readonly name: string }[];
}

const catalogOf = (req: Req): string[] => (req.tools ?? []).map((t) => t.name);
const userText = (req: Req): string =>
  String(req.messages.find((m) => m.role === 'user')?.content ?? '');
const lastToolResult = (req: Req): string => {
  const message = [...req.messages].reverse().find((m) => m.role === 'tool');
  return message ? String(message.content ?? '') : '';
};

/**
 * The turn-2 investigation, scripted so the example is reproducible.
 *
 * The sequence is the one the skill teaches and the one a real model
 * follows: locate the subject in the record, open the single call that
 * decided it, then take in the shape of the run before answering.
 */
function scriptedModel(): LLMProvider {
  return mock({
    chunkDelayMs: 0,
    respond: (req: LLMRequest) => {
      const names = catalogOf(req as Req);
      const asked = userText(req as Req);
      const back = lastToolResult(req as Req);

      // ── TURN 2 — the why-question ─────────────────────────────────
      if (/^why/i.test(asked.trim())) {
        // The trace tools are on the catalog: walk the evidence.
        if (names.includes('find_in_trace')) {
          if (back.startsWith('FOUND') || back.startsWith('find_in_trace:')) {
            return { toolCalls: [{ id: 'w2', name: 'inspect_tool_call', args: { toolCallId: 'c2' } }] };
          }
          if (back.startsWith('TOOL CALL')) {
            return { toolCalls: [{ id: 'w3', name: 'run_overview', args: {} }] };
          }
          if (back.includes('TRACE RUN OVERVIEW')) {
            // Everything needed is now in the conversation as tool results.
            return {
              content:
                'I did not refund it because the record says a replacement was available.\n' +
                'Evidence from the recorded turn:\n' +
                `  • ${firstLineOf(back, 'execution steps')}\n` +
                '  • inspect_tool_call(c2) → check_inventory ran with { sku: "KB-88" } and came ' +
                'back "12 units available, ships same day from WH-2".\n' +
                '  • The warranty was ACTIVE (lookup_order, call c1), and the policy says an ' +
                'in-stock item under warranty is replaced, not refunded.\n' +
                'So issue_refund was never called — the trace shows no execution of it.',
            };
          }
          return { toolCalls: [{ id: 'w1', name: 'find_in_trace', args: { query: 'refund' } }] };
        }
        // Not yet: activate the skill so the next iteration carries them.
        if (names.includes('read_skill')) {
          return { toolCalls: [{ id: 'sk', name: 'read_skill', args: { id: 'self-explain' } }] };
        }
        return { content: 'I have no trace tools available to answer that from.' };
      }

      // ── TURN 1 — the work ─────────────────────────────────────────
      if (!back && names.includes('lookup_order')) {
        return { toolCalls: [{ id: 'c1', name: 'lookup_order', args: { orderId: '7712' } }] };
      }
      if (back.includes('sku KB-88')) {
        return { toolCalls: [{ id: 'c2', name: 'check_inventory', args: { sku: 'KB-88' } }] };
      }
      if (back.includes('units available')) {
        return {
          content:
            'Your keyboard is under an active warranty and we have 12 in stock, so I am sending ' +
            'a replacement (sku KB-88, ships today from WH-2) rather than refunding. Policy ' +
            'applied: damaged + in warranty + in stock → replacement, not refund.',
        };
      }
      return { content: 'Could you tell me the order number?' };
    },
  });
}

/** Pull the line containing `needle` out of a tool result, for quoting. */
function firstLineOf(text: string, needle: string): string {
  return text.split('\n').find((line) => line.includes(needle))?.trim() ?? needle;
}

// ─── Pricing: a demo table, so the cost line has something true to say ────

const pricing: PricingTable = {
  name: 'demo-pricing',
  pricePerToken: (_model, kind) => {
    if (kind === 'input') return 0.000_000_8; // $0.80 / 1M in
    if (kind === 'output') return 0.000_004; // $4.00 / 1M out
    return 0;
  },
};

/** Live only when a key is present, the caller injected nothing, and not forced offline. */
async function resolveProvider(
  injected?: LLMProvider,
): Promise<{ provider: LLMProvider; model: string; live: boolean }> {
  if (injected) return { provider: injected, model: 'injected', live: false };
  const offline = process.env.AGENTFOOTPRINT_DEMO_OFFLINE === '1';
  if (offline || !process.env.ANTHROPIC_API_KEY) {
    return { provider: scriptedModel(), model: 'mock-1', live: false };
  }
  // Lazy import so the default path never loads the vendor SDK.
  const { anthropic } = await import('../../src/doors/providers.js');
  const model = process.env.DEMO_MODEL ?? 'claude-haiku-4-5';
  return { provider: anthropic({ defaultModel: model }), model, live: true };
}

export async function run(input: string, provider?: LLMProvider): Promise<string> {
  toolRuns.lookup_order = 0;
  toolRuns.check_inventory = 0;
  toolRuns.issue_refund = 0;

  const { provider: llm, model, live } = await resolveProvider(provider);
  console.log(
    live
      ? `model: ${model} (live — a SMALL model reading its own record is the claim)`
      : `model: ${model} (scripted mock — $0, deterministic; set ANTHROPIC_API_KEY for live)\n`,
  );

  // #region self-explain
  const agent = Agent.create({
    provider: llm,
    model,
    maxIterations: 8,
    pricingTable: pricing,
    costBudget: 2, // dollars; a warn-only ceiling for a demo turn
    // The trace tools are 9 extra definitions, and they land on the tools
    // slot for exactly ONE iteration — the one after activation. That is
    // still a real bulge past the 2000-char default, and the default is a
    // SIGNAL, not a limit (nothing is ever truncated). Raising it here is
    // the honest answer for an agent that opted into `.selfExplain()`;
    // leaving it would print an over-budget warning every why-question.
    contextBudget: { tools: 6000 },
  })
    .system(POLICY)
    .tool(lookupOrder)
    .tool(checkInventory)
    .tool(issueRefund)
    .selfExplain() // ← the whole feature
    .build();
  // #endregion self-explain

  // Every tool dispatch, stamped with the turn it happened in. This is the
  // ledger the closing proof reads: turn 2 must contain no business tool.
  let turn = 1;
  const dispatches: { turn: number; tool: string }[] = [];
  agent.on('agentfootprint.stream.tool_start', (event) => {
    dispatches.push({ turn, tool: event.payload.toolName });
    console.log(`  [turn ${turn}] → ${event.payload.toolName}(${JSON.stringify(event.payload.args)})`);
  });
  let spendUsd = 0;
  agent.on('agentfootprint.cost.tick', (event) => {
    spendUsd += event.payload.estimatedUsd;
  });

  // ── TURN 1 — do the work ────────────────────────────────────────────
  console.log('── turn 1 ──────────────────────────────────────────────');
  console.log(`user: ${input}`);
  const first = await agent.run({ message: input });
  const answer1 = typeof first === 'string' ? first : '(paused — unexpected here)';
  console.log(`\nagent: ${answer1}\n`);
  const afterTurn1 = { ...toolRuns };
  console.log(`tool executions after turn 1: ${format(afterTurn1)}`);

  // ── TURN 2 — the why-question, answered from turn 1's record ────────
  turn = 2;
  const whyQuestion = 'Why did you skip the refund?';
  console.log('\n── turn 2 ──────────────────────────────────────────────');
  console.log(`user: ${whyQuestion}`);
  const second = await agent.run({ message: whyQuestion });
  const answer2 = typeof second === 'string' ? second : '(paused — unexpected here)';
  console.log(`\nagent: ${answer2}\n`);

  // ── THE PROOF ───────────────────────────────────────────────────────
  const afterTurn2 = { ...toolRuns };
  const unchanged = (Object.keys(afterTurn1) as (keyof typeof afterTurn1)[]).every(
    (name) => afterTurn1[name] === afterTurn2[name],
  );
  const turn2Tools = dispatches.filter((d) => d.turn === 2).map((d) => d.tool);
  const businessNames = Object.keys(toolRuns);
  const businessInTurn2 = turn2Tools.filter((name) => businessNames.includes(name));

  console.log('── the proof ───────────────────────────────────────────');
  console.log(`tool executions after turn 2: ${format(afterTurn2)}`);
  console.log(
    `nothing re-executed: ${unchanged ? 'YES' : 'NO'} — the counters are ${
      unchanged ? 'identical' : 'DIFFERENT'
    } either side of the explanation.`,
  );
  console.log(`turn 2 called: ${turn2Tools.join(', ') || '(no tools)'}`);
  console.log(
    `business tools in turn 2: ${
      businessInTurn2.length === 0 ? 'none — every call was a read-only trace tool' : businessInTurn2.join(', ')
    }`,
  );
  console.log(
    `issue_refund executions, both turns: ${toolRuns.issue_refund} — the refund it decided ` +
      'against was never issued, and explaining the decision did not issue one.',
  );
  console.log(`total spend across both turns: ~$${spendUsd.toFixed(6)} (budget $2.00)`);

  console.log(
    '\nWhat this shows, and what it does not:\n' +
      '  The turn-2 answer is assembled from RECORDED evidence of turn 1 — the commit log, the\n' +
      '  narrative and the event tail — fetched by tools the model called. It is not the model\n' +
      '  introspecting its own reasoning, and it is not a second run of the work.\n' +
      '  What the record cannot show, the tools mark with ⚠: run input (args), env, state seeded\n' +
      '  before the run, values carried in closures, and anything that happened INSIDE a tool.\n' +
      '  A redacted value reads as its placeholder here exactly as it does everywhere else.',
  );

  return answer2;
}

/** "lookup_order 1 · check_inventory 1 · issue_refund 0" */
function format(counts: Record<string, number>): string {
  return Object.entries(counts)
    .map(([name, n]) => `${name} ${n}`)
    .join(' · ');
}

if (isCliEntry(import.meta.url)) {
  run(meta.defaultInput ?? '')
    .then(printResult)
    .catch(console.error);
}
