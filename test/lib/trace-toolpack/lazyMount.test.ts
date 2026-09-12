/**
 * The lazy mount (9.94.0) — `.selfExplain()` loads the trace toolpack WHEN
 * the skill is first active, never before, and the loading strategy is
 * invisible to the run.
 *
 * Three laws, each pinned as a test:
 *
 *   1. LOAD-WHEN-ENABLED. The toolpack module is not evaluated by importing
 *      `Agent`, not by `build()`, and not by a turn on which the model never
 *      opened the skill. It is evaluated exactly once, on the first iteration
 *      the skill is active — the `import()` in `selfExplain.ts` ·
 *      `lazilyMountedTraceTools`. Observed through `vi.mock`, whose factory
 *      runs when the module is first imported, which for a dynamic import is
 *      the moment the library reaches for it.
 *   2. STILL WORKS END TO END. The same scripted agent as
 *      selfExplainAgent.test.ts answers a why-question from its own trace —
 *      through the lazy path, in Node (the CJS build turns the `import()` into
 *      a deferred `require`; the browser side is fenced in browserGraph.test.ts).
 *   3. COLD = WARM. A run that mounts the pack cold (first ever load) and a
 *      run on a fresh agent with the pack already loaded see the same event
 *      types in the same order, the same tool catalogs on every LLM call, and
 *      the same answer. What changes with the load is only WHEN the bytes
 *      arrive, never what the run records. (Byte-identity against an agent
 *      WITHOUT `.selfExplain()` is not the claim here — that agent has no
 *      self-explain skill row, so its catalog legitimately differs.)
 */
import { describe, expect, it, vi } from 'vitest';

import { Agent, defineTool } from '../../../src/index';
import type { AgentfootprintEvent } from '../../../src/events.js';
import { mock } from '../../../src/llm-providers.js';
// The light module — NOT the /observe or /debug door, which carry the whole
// pack statically (a consumer who imports the debugger wants it eagerly).
import { NO_COMPLETED_RUN_MESSAGE } from '../../../src/lib/trace-toolpack/traceToolNames.js';
import {
  buildSelfExplainToolProvider,
  SelfExplainBinding,
} from '../../../src/lib/trace-toolpack/selfExplain.js';

// Counted in a hoisted cell so the (hoisted) mock factory can see it.
const loads = vi.hoisted(() => ({ count: 0 }));

vi.mock('../../../src/lib/trace-toolpack/lazyToolpack.js', async (importOriginal) => {
  loads.count += 1;
  return importOriginal();
});

/* ── fixtures (the selfExplainAgent.test.ts script, unchanged) ──────────── */

const lookupOrder = defineTool<{ orderId: string }, string>({
  name: 'lookup_order',
  description: 'Look up an order by id',
  inputSchema: {
    type: 'object',
    properties: { orderId: { type: 'string' } },
    required: ['orderId'],
  },
  execute: ({ orderId }) => `Order ${orderId}: purchased 47 days ago, price $480.`,
});

interface ProviderReq {
  messages: { role: string; content?: unknown }[];
  tools?: { name: string }[];
}

const toolNames = (req: ProviderReq): string[] => (req.tools ?? []).map((t) => t.name);
const lastToolText = (req: ProviderReq): string => {
  const msg = [...req.messages].reverse().find((m) => m.role === 'tool');
  return msg ? String(msg.content) : '';
};

interface Scripted {
  readonly agent: ReturnType<ReturnType<typeof Agent.create>['build']>;
  readonly catalogs: string[][];
  readonly eventTypes: string[];
}

function buildScriptedAgent(selfExplain: boolean): Scripted {
  const catalogs: string[][] = [];
  const provider = mock({
    chunkDelayMs: 0,
    respond: (req: ProviderReq) => {
      const names = toolNames(req);
      catalogs.push(names);
      const lastTool = lastToolText(req);
      if (names.includes('run_overview')) {
        if (lastTool.includes('TRACE RUN OVERVIEW') || lastTool === NO_COMPLETED_RUN_MESSAGE) {
          return `EXPLained: ${lastTool.slice(0, 1500)}`;
        }
        return { toolCalls: [{ id: 'o1', name: 'run_overview', args: {} }] };
      }
      const userText = String(req.messages.find((m) => m.role === 'user')?.content ?? '');
      if (/why/i.test(userText) && names.includes('read_skill')) {
        return { toolCalls: [{ id: 's1', name: 'read_skill', args: { id: 'self-explain' } }] };
      }
      if (/refund/i.test(userText) && names.includes('lookup_order') && !lastTool) {
        return { toolCalls: [{ id: 't1', name: 'lookup_order', args: { orderId: 'A-1001' } }] };
      }
      return 'Refund APPROVED for order A-1001.';
    },
  });
  let builder = Agent.create({ provider, model: 'mock-1', maxIterations: 6 })
    .system('You are a refunds assistant.')
    .tool(lookupOrder);
  if (selfExplain) builder = builder.selfExplain();
  const agent = builder.build();
  const eventTypes: string[] = [];
  agent.on('*', (event: AgentfootprintEvent) => {
    eventTypes.push(event.type);
  });
  return { agent, catalogs, eventTypes };
}

const contentOf = (out: unknown): string =>
  typeof out === 'object' && out !== null && 'content' in out
    ? String((out as { content: unknown }).content)
    : String(out);

/* ── the laws ───────────────────────────────────────────────────────────── */

interface RunRecord {
  readonly events: string[];
  readonly catalogs: string[][];
  readonly answers: string[];
}

/** The two-turn conversation every law below runs: work, then a why-question. */
async function converse(scripted: Scripted): Promise<RunRecord> {
  const answers = [
    contentOf(await scripted.agent.run({ message: 'Refund order A-1001?' })),
    contentOf(await scripted.agent.run({ message: 'Why did you approve it?' })),
  ];
  return { events: scripted.eventTypes, catalogs: scripted.catalogs, answers };
}

/** LAW 1 records the one genuinely COLD conversation for LAW 3 to compare against. */
let coldRecord: RunRecord | undefined;

describe('.selfExplain() mounts the trace toolpack lazily', () => {
  it('LAW 1: the pack loads when the skill is first ACTIVE — not on import, build, or an idle turn', async () => {
    // Importing `Agent` did not load it.
    expect(loads.count).toBe(0);

    // An agent WITHOUT the family never touches it — build or run.
    const plain = buildScriptedAgent(false);
    await plain.agent.run({ message: 'Refund order A-1001?' });
    expect(loads.count).toBe(0);

    // An agent WITH the family: not at build() …
    const explaining = buildScriptedAgent(true);
    expect(loads.count).toBe(0);
    // … not on a turn where the model never opened the skill …
    const turn1 = contentOf(await explaining.agent.run({ message: 'Refund order A-1001?' }));
    expect(turn1).toContain('APPROVED');
    expect(loads.count).toBe(0);
    // … and exactly once on the turn the skill becomes active.
    const turn2 = contentOf(await explaining.agent.run({ message: 'Why did you approve it?' }));
    expect(turn2).toContain('TRACE RUN OVERVIEW');
    expect(loads.count).toBe(1);
    coldRecord = {
      events: explaining.eventTypes,
      catalogs: explaining.catalogs,
      answers: [turn1, turn2],
    };

    // A second explaining agent reuses the loaded module: still one load.
    await converse(buildScriptedAgent(true));
    expect(loads.count).toBe(1);
  });

  it('LAW 2: still answers end to end from its own previous turn, catalog gated until activation', async () => {
    const { agent, catalogs } = buildScriptedAgent(true);
    await agent.run({ message: 'Refund order A-1001?' });
    const turn2Start = catalogs.length;
    const why = contentOf(await agent.run({ message: 'Why did you approve it?' }));
    expect(why).toContain('TRACE RUN OVERVIEW');
    expect(why).toContain('tool-calls ×1'); // turn 1's shape, not the in-flight turn
    const turn2Calls = catalogs.slice(turn2Start);
    expect(turn2Calls[0]).toContain('read_skill');
    expect(turn2Calls[0]).not.toContain('run_overview');
    const withTrace = turn2Calls.find((names) => names.includes('run_overview'));
    expect(withTrace).toBeDefined();
    expect(withTrace).toContain('lookup_order');
  });

  it('LAW 3: cold mount and warm mount record the same run — event order, catalogs, answer', async () => {
    // LAW 1 ran the only conversation that could load the pack cold and kept
    // its record; this is the same script on a fresh agent with the pack
    // already in memory. The comparison is the one a reader of the recording
    // can make: the same event types in the same order, the same tools offered
    // on every LLM call, the same words back. Only WHEN the bytes arrived
    // differs, and a recording does not carry that.
    expect(coldRecord).toBeDefined();
    const warm = await converse(buildScriptedAgent(true));
    expect(warm.events).toEqual(coldRecord!.events);
    expect(warm.catalogs).toEqual(coldRecord!.catalogs);
    expect(warm.answers).toEqual(coldRecord!.answers);
    // …and the family really acted in both: the pack's tool answered.
    expect(warm.answers[1]).toContain('TRACE RUN OVERVIEW');
  });

  it('an idle turn keeps the sync fast path: list() answers [] without a Promise', async () => {
    // The tools slot skips the await for a sync provider; the inactive path of
    // the lazy provider must stay on it. Built through the same function the
    // builder calls, so the provider under test is the one the agent mounts.
    const provider = buildSelfExplainToolProvider(new SelfExplainBinding(), {});
    const idle = provider.list({ iteration: 1, activeSkillId: undefined });
    expect(Array.isArray(idle)).toBe(true);
    expect(idle).toEqual([]);
    const active = provider.list({ iteration: 2, activeSkillId: 'self-explain' });
    expect(active).toBeInstanceOf(Promise);
    const tools = await active;
    expect(tools.map((t) => t.schema.name)).toContain('run_overview');
  });
});
