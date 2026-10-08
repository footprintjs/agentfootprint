/**
 * Where an agent's `redact` REACHES — the way footprintjs hands a run's policy
 * to the runtimes nested in it.
 *
 *   - COMPOSED: Sequence / Parallel / Conditional / Loop / Graph / Workflow run
 *     their members as subflows of ONE executor. A member's declaration is
 *     adopted by the composition at construction (`src/redaction/declared.ts`),
 *     so the composition's one run applies it — to every member, its own keys
 *     included. Nested compositions adopt in turn.
 *   - NESTED THROUGH A TOOL: a run a tool starts gets `ctx.redact`, the policy
 *     the calling run is covered by. `flowchartAsTool` / `runbookAsTool` join it
 *     with their own; a tool that runs another agent hands it on, the way it
 *     hands `ctx.signal`. `ctx.tools.call` inner calls carry it too.
 *
 * A composition relays its members' words under ITS OWN keys (`current`,
 * `branchResults`, `results`, `graphInput`) — names no member declares. The
 * library's vocabulary names them too (`conversationRedaction`, its
 * `compositions` group), and the name-wise claim (what a member's policy
 * selects is selected in the composition's run) is asserted on its own.
 */
import { flowChart } from 'footprintjs';
import { describe, expect, it } from 'vitest';
import type { RedactionPolicy } from 'footprintjs';

import {
  Agent,
  Conditional,
  defineTool,
  flowchartAsTool,
  graph,
  Loop,
  Parallel,
  Sequence,
  type ToolExecutionContext,
} from '../../src/index.js';
import { mock } from '../../src/doors/providers.js';
import { conversationRedaction } from '../../src/doors/security.js';
import type { AgentfootprintEvent } from '../../src/events/registry.js';
import { innerRunsOf, recordRun } from '../../src/doors/observe.js';
import { redactionDeclaredBy } from '../../src/redaction/declared.js';
import { servedUnderPolicy } from '../../src/redaction/marker.js';
import type { Runner } from '../../src/core/runner.js';
import {
  ALL_SECRETS,
  MESSAGE,
  SECRET,
  conversationPolicy,
  fixtureAgent,
  leaksIn,
} from './fixture.js';

/** The content-free posture: the library's vocabulary (compositions included) and the tool's fields. */
function contentFree(): RedactionPolicy {
  return conversationPolicy();
}

/** Run a runner with a recording and an event tap; return what it served. */
async function servedBy(
  runner: Runner & { on: Agent['on'] },
  input: unknown = { message: MESSAGE },
) {
  const recorder = recordRun(runner as never);
  const events: AgentfootprintEvent[] = [];
  runner.on('*', (e) => events.push(e));
  await (runner as { run(i: unknown): Promise<unknown> }).run(input);
  return { recording: recorder.toRecording(), events };
}

describe('composed: a member’s policy covers the composition’s one run', () => {
  const cases: Record<string, (member: Agent) => Runner & { on: Agent['on'] }> = {
    Sequence: (member) => Sequence.create().step('a', member).build(),
    Parallel: (member) =>
      Parallel.create()
        .branch('a', member)
        .branch('b', fixtureAgent())
        // The merge relays the members' words — the content a composition carries.
        .mergeWithFn((results) => Object.values(results).join(' | '))
        .build(),
    Conditional: (member) =>
      Conditional.create()
        .when('a', () => true, member)
        .otherwise('b', fixtureAgent())
        .build(),
    Loop: (member) => Loop.create().repeat(member).times(1).build(),
    Graph: (member) => graph({ id: 'g', nodes: [{ id: 'a', runner: member }], edges: [] }) as never,
  };

  for (const [name, compose] of Object.entries(cases)) {
    it(`${name}: CONTROL — without a policy the composition's record carries the secrets`, async () => {
      const { recording, events } = await servedBy(compose(fixtureAgent()), { message: MESSAGE });
      expect(leaksIn(recording).length).toBeGreaterThan(0);
      expect(leaksIn(events).length).toBeGreaterThan(0);
    });

    it(`${name}: no secret in the composition's recording or events (content-free policy)`, async () => {
      const composed = compose(fixtureAgent({ redact: contentFree() }));
      expect(redactionDeclaredBy(composed)).toBeDefined();
      const input = name === 'Graph' ? { message: MESSAGE } : { message: MESSAGE };
      const { recording, events } = await servedBy(composed, input);
      expect(leaksIn(recording)).toEqual([]);
      expect(leaksIn(events)).toEqual([]);
    });
  }

  it('name-wise: what the member selects is selected in the composition’s events', async () => {
    // The member names only its tool's field. Its policy must still reach the
    // composition's run: the argument is masked in the composition's events.
    const composed = Sequence.create()
      .step('a', fixtureAgent({ redact: { patterns: [/ssn/i] } }))
      .build();
    const { events } = await servedBy(composed);
    const toolStart = events.find((e) => e.type === 'agentfootprint.stream.tool_start');
    expect(toolStart).toBeDefined();
    expect((toolStart?.payload as { args?: { ssn?: unknown } }).args?.ssn).toBe('[REDACTED]');
    expect(leaksIn(events, [SECRET.ssn])).toEqual([]);
  });

  it('the union only adds: a second member’s plain run is covered too', async () => {
    const composed = Parallel.create()
      .branch('a', fixtureAgent({ redact: contentFree() }))
      .branch('b', fixtureAgent()) // declares nothing — still inside the one run
      .mergeWithFn((results) => Object.keys(results).join(','))
      .build();
    const { recording } = await servedBy(composed);
    expect(leaksIn(recording)).toEqual([]);
  });

  it('nested compositions adopt in turn: Sequence(Parallel(agent))', async () => {
    const inner = Parallel.create()
      .branch('a', fixtureAgent({ redact: contentFree() }))
      .branch('b', fixtureAgent())
      .mergeWithFn((results) => Object.keys(results).join(','))
      .build();
    const outer = Sequence.create().step('p', inner).build();
    expect(redactionDeclaredBy(outer)).toBeDefined();
    const { recording, events } = await servedBy(outer);
    expect(leaksIn(recording)).toEqual([]);
    expect(leaksIn(events)).toEqual([]);
  });

  it('a composition no member declared for has no policy — byte-identical path', async () => {
    const composed = Sequence.create().step('a', fixtureAgent()).build();
    expect(redactionDeclaredBy(composed)).toBeUndefined();
    const { recording } = await servedBy(composed);
    expect(JSON.stringify(recording)).toContain(SECRET.user);
    expect(JSON.stringify(recording)).not.toContain('REDACTED');
  });
});

describe('nested through a tool: ctx.redact is the calling run’s policy', () => {
  it('ctx.redact is present under a policy, absent without one', async () => {
    const seen: (RedactionPolicy | undefined)[] = [];
    const probe = defineTool<Record<string, never>, string>({
      name: 'probe',
      description: 'look at the context',
      inputSchema: { type: 'object', properties: {} },
      execute: (_args, ctx: ToolExecutionContext) => {
        seen.push(ctx.redact);
        return 'ok';
      },
    });
    const replies = [{ toolCalls: [{ id: 'p1', name: 'probe', args: {} }] }, { content: 'done' }];
    const policy = conversationPolicy();
    await Agent.create({ provider: mock({ replies }), model: 'm', redact: policy })
      .tool(probe)
      .build()
      .run({ message: 'go' });
    await Agent.create({ provider: mock({ replies }), model: 'm' })
      .tool(probe)
      .build()
      .run({ message: 'go' });
    expect(seen[0]).toBe(policy);
    expect(seen[1]).toBeUndefined();
  });

  it('an agent run by a tool, handed ctx.redact, serves its own record under it', async () => {
    const specialist = fixtureAgent(); // declares nothing of its own
    const specialistRecording = recordRun(specialist);
    const ask = defineTool<{ question: string }, string>({
      name: 'ask_specialist',
      description: 'ask the specialist',
      inputSchema: { type: 'object', properties: { question: { type: 'string' } } },
      execute: async ({ question }, ctx) => {
        const out = await specialist.run(
          { message: question },
          { ...(ctx.redact && { redact: ctx.redact }) },
        );
        return typeof out === 'string' ? out : 'paused';
      },
    });
    const outer = Agent.create({
      provider: mock({
        replies: [
          { toolCalls: [{ id: 'a1', name: 'ask_specialist', args: { question: MESSAGE } }] },
          { content: 'relayed' },
        ],
      }),
      model: 'm',
      redact: contentFree(),
    })
      .tool(ask)
      .build();
    await outer.run({ message: 'please ask' });
    // The specialist's own record — snapshot, events, recorder rows.
    expect(leaksIn(specialistRecording.toRecording())).toEqual([]);
    expect(leaksIn(specialist.getLastSnapshot())).toEqual([]);
  });

  it('…and a tool that does NOT hand ctx.redact on leaves the specialist’s record plain (control)', async () => {
    const specialist = fixtureAgent();
    const specialistRecording = recordRun(specialist);
    const ask = defineTool<{ question: string }, string>({
      name: 'ask_specialist',
      description: 'ask the specialist',
      inputSchema: { type: 'object', properties: { question: { type: 'string' } } },
      execute: async ({ question }) => String(await specialist.run({ message: question })),
    });
    await Agent.create({
      provider: mock({
        replies: [
          { toolCalls: [{ id: 'a1', name: 'ask_specialist', args: { question: MESSAGE } }] },
          { content: 'relayed' },
        ],
      }),
      model: 'm',
      redact: contentFree(),
    })
      .tool(ask)
      .build()
      .run({ message: 'please ask' });
    // A nested run the library does not start cannot inherit by itself — the
    // tool's author hands it on, exactly as `ctx.signal` (README, "Where a
    // policy reaches"). Without it, the specialist's record is its own, plain.
    expect(JSON.stringify(specialistRecording.toRecording())).toContain(SECRET.ssn);
  });

  /** An agent that calls `tool` once and keeps what the model read back. */
  const callOnce = (tool: ReturnType<typeof flowchartAsTool>, redact: RedactionPolicy) => {
    const answers: string[] = [];
    const agent = Agent.create({
      provider: mock({
        respond: (req) => {
          const last = [...req.messages].reverse().find((m) => m.role === 'tool');
          if (last !== undefined) {
            answers.push(String(last.content));
            return 'done';
          }
          return { toolCalls: [{ id: 't1', name: 'inner_chart', args: {} }] };
        },
      }),
      model: 'm',
      redact,
    })
      .tool(tool)
      .build();
    return { agent, answers };
  };

  it('flowchartAsTool: the model reads the result the TOOL serves; the kept record keeps the agent’s names out', async () => {
    const chart = flowChart<{ apiKey: string; note: string }>(
      'Use the key',
      (scope) => {
        scope.apiKey = 'sk-INNER-SECRET-1';
        scope.note = 'used';
      },
      'use-key',
    ).build();
    const tool = flowchartAsTool({
      name: 'inner_chart',
      description: 'runs the inner chart',
      flowchart: chart,
      keepRecord: true,
    });
    // A calling run that keeps its whole conversation out of its records: the
    // tool's result string is the MODEL's input, and the agent's policy does
    // not reach it — the tool declared no `redact` of its own. (A narrower
    // calling policy hands the model the record's view instead —
    // `agent-redaction.tool-boundary.test.ts`.)
    const { agent, answers } = callOnce(tool, conversationRedaction({ keys: ['apiKey'] }));
    await agent.run({ message: 'go' });
    expect(answers[0]).toContain('sk-INNER-SECRET-1');
    // The kept inner record is a RECORD: the agent's policy covers it.
    const kept = innerRunsOf(tool)?.get('t1');
    expect(kept).toBeDefined();
    expect(JSON.stringify(kept)).not.toContain('sk-INNER-SECRET-1');
    expect(JSON.stringify(kept)).toContain('REDACTED');
    // …and it says so: its readers read the placeholder as a value kept out.
    expect(servedUnderPolicy(kept?.recording?.snapshot)).toBe(true);
  });

  it('flowchartAsTool: the tool’s own `redact` and the chart’s own marks still keep values from the model', async () => {
    const chart = flowChart<{ apiKey: string; pin: string; note: string }>(
      'Use the key',
      (scope) => {
        scope.apiKey = 'sk-INNER-SECRET-2';
        // A per-call mark: the chart author keeps this one write out run-wide.
        scope.$setValue('pin', 'PIN-4242', true);
        scope.note = 'used';
      },
      'use-key',
    ).build();
    const tool = flowchartAsTool({
      name: 'inner_chart',
      description: 'runs the inner chart',
      flowchart: chart,
      keepRecord: true,
      redact: { keys: ['apiKey'] },
    });
    const { agent, answers } = callOnce(tool, conversationRedaction({ keys: ['note'] }));
    await agent.run({ message: 'go' });
    // The model's view: the tool's own policy and the chart's mark — not the agent's.
    expect(answers[0]).not.toContain('sk-INNER-SECRET-2');
    expect(answers[0]).not.toContain('PIN-4242');
    expect(answers[0]).toContain('used');
    // The record: all three kept out.
    const kept = JSON.stringify(innerRunsOf(tool)?.get('t1'));
    expect(kept).not.toContain('sk-INNER-SECRET-2');
    expect(kept).not.toContain('PIN-4242');
    expect(kept).not.toContain('"used"');
  });

  it('ctx.tools.call: an inner call runs under the same policy', async () => {
    const seen: (RedactionPolicy | undefined)[] = [];
    const inner = defineTool<Record<string, never>, string>({
      name: 'inner',
      description: 'inner',
      inputSchema: { type: 'object', properties: {} },
      execute: (_args, ctx) => {
        seen.push(ctx.redact);
        return 'inner ok';
      },
    });
    const outerTool = defineTool<Record<string, never>, string>({
      name: 'outer',
      description: 'calls inner',
      inputSchema: { type: 'object', properties: {} },
      execute: async (_args, ctx) => String(await ctx.tools?.call('inner', {})),
    });
    const policy = conversationPolicy();
    await Agent.create({
      provider: mock({
        replies: [{ toolCalls: [{ id: 'o1', name: 'outer', args: {} }] }, { content: 'done' }],
      }),
      model: 'm',
      redact: policy,
    })
      .tools([outerTool, inner])
      .build()
      .run({ message: 'go' });
    expect(seen).toEqual([policy]);
  });
});

describe('the door refuses what it cannot apply', () => {
  const site = (redact: unknown) => () =>
    Agent.create({ provider: mock({ reply: 'x' }), model: 'm', redact: redact as never }).build();

  it('an unknown field, a non-RegExp pattern, a policy that names nothing', () => {
    expect(site({ key: ['ssn'] })).toThrow(/`redact\.key` is not a RedactionPolicy field/);
    expect(site({ patterns: ['ssn'] })).toThrow(/must be a list of RegExp/);
    expect(site({})).toThrow(/names nothing/);
    expect(site([/ssn/])).toThrow(/must be a footprintjs RedactionPolicy object/);
  });

  it('a frozen global RegExp (footprintjs would throw at the first event)', () => {
    expect(site({ patterns: [Object.freeze(/ssn/g)] })).toThrow(/frozen global RegExp/);
  });

  it('a per-run policy is refused at run() by the same check', async () => {
    const agent = Agent.create({ provider: mock({ reply: 'x' }), model: 'm' }).build();
    await expect(agent.run({ message: 'go' }, { redact: {} })).rejects.toThrow(/names nothing/);
  });
});
