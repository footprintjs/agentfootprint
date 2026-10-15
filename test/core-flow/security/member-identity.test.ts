/**
 * Composition members run for the run that mounted them — never for a shared
 * bucket.
 *
 * Threat model: the other users of a process are untrusted. A member agent's
 * memory, its tools' `ctx.identity` and its run id must come from the run that
 * is executing it — the identity handed to the composition, or that run's own
 * per-run conversation — and never from the member INSTANCE, which every run of
 * the composition shares (it held `'pending'`, or the last direct run's
 * caller). Checked under concurrency and through nesting.
 */

import { flowChart } from 'footprintjs';
import { describe, expect, it } from 'vitest';

import {
  Agent,
  Conditional,
  Loop,
  Parallel,
  Sequence,
  defineTool,
  graph,
  workflow,
} from '../../../src/index.js';
import { mock } from '../../../src/doors/providers.js';
import {
  defineMemory,
  InMemoryStore,
  MEMORY_STRATEGIES,
  MEMORY_TYPES,
} from '../../../src/memory/index.js';
import type { MemoryIdentity } from '../../../src/memory/identity/index.js';

const ALICE: MemoryIdentity = { tenant: 'acme', principal: 'alice', conversationId: 'c-alice' };
const BOB: MemoryIdentity = { tenant: 'acme', principal: 'bob', conversationId: 'c-bob' };

/** Every model request a member saw, keyed by the user its message names. */
type Seen = string[];

/**
 * A member agent with a conversation memory, whose model records every request
 * and whose one tool records the identity it was handed.
 */
function member(id: string, store: InMemoryStore, seen: Seen, toolSaw: unknown[]) {
  const whoAmI = defineTool({
    name: 'who_am_i',
    description: 'Reports who the run is for.',
    inputSchema: { type: 'object', properties: {} },
    execute: async (_args, ctx) => {
      toolSaw.push({ member: id, identity: ctx.identity, runId: ctx.runId } as never);
      return 'noted';
    },
  });
  let calls = 0;
  return Agent.create({
    id,
    provider: mock({
      chunkDelayMs: 1,
      respond: (req) => {
        seen.push(JSON.stringify(req));
        // First call of each run: ask the tool; then answer.
        const hasTool = req.messages.some((m) => m.role === 'tool');
        calls++;
        return hasTool
          ? { content: `ok-${calls}` }
          : { toolCalls: [{ id: `t-${calls}`, name: 'who_am_i', args: {} }] };
      },
    }),
    model: 'mock',
    maxIterations: 3,
  })
    .system('You remember what each person told you.')
    .tools([whoAmI])
    .memory(
      defineMemory({
        id: `${id}-turns`,
        type: MEMORY_TYPES.EPISODIC,
        strategy: { kind: MEMORY_STRATEGIES.WINDOW, size: 20 },
        store,
      }),
    )
    .build();
}

/** Sequence( step → Parallel( branch, branch ) ): a member at the top, two nested. */
function nestedComposition(store: InMemoryStore, seen: Seen, toolSaw: unknown[]) {
  const top = member('top', store, seen, toolSaw);
  const inner = member('inner', store, seen, toolSaw);
  const side = member('side', store, seen, toolSaw);
  const fanOut = Parallel.create({ id: 'fan' })
    .branch('inner', inner)
    .branch('side', side)
    .mergeWithFn((results) => Object.values(results).join(' | '))
    .build();
  return Sequence.create({ id: 'outer' }).step('top', top).step('fan', fanOut).build();
}

describe('composition members — two users at the same time, nested', () => {
  it('each user’s members read and write only that user’s memory', async () => {
    const store = new InMemoryStore();
    const seen: Seen = [];
    const toolSaw: unknown[] = [];
    const flow = nestedComposition(store, seen, toolSaw);

    // Round 1, interleaved: each user tells their own secret.
    await Promise.all([
      flow.run({ message: 'ALICE-SECRET is 1234', identity: ALICE }),
      flow.run({ message: 'BOB-SECRET is 9876', identity: BOB }),
    ]);
    // Round 2, interleaved: each asks for it back.
    seen.length = 0;
    toolSaw.length = 0;
    await Promise.all([
      flow.run({ message: 'alice asks: what did I tell you?', identity: ALICE }),
      flow.run({ message: 'bob asks: what did I tell you?', identity: BOB }),
    ]);

    const requestsOf = (who: string) => seen.filter((r) => r.includes(`${who} asks`));
    const alice = requestsOf('alice').join('\n');
    const bob = requestsOf('bob').join('\n');
    // The control: each user's own memory WAS recalled, by both members.
    expect(alice).toContain('ALICE-SECRET');
    expect(bob).toContain('BOB-SECRET');
    // ...and never the other user's.
    expect(alice).not.toContain('BOB-SECRET');
    expect(bob).not.toContain('ALICE-SECRET');
    // Nothing was ever filed under a shared placeholder conversation.
    for (const conversationId of ['pending', 'default', 'unknown']) {
      const listed = await store.list({ conversationId });
      expect(listed.entries).toEqual([]);
    }
    // Every tool call saw the identity of the run that made it.
    for (const call of toolSaw as { identity?: MemoryIdentity }[]) {
      expect([ALICE.principal, BOB.principal]).toContain(call.identity?.principal);
    }
  });

  it('two anonymous runs never share: each run is its own conversation', async () => {
    const store = new InMemoryStore();
    const seen: Seen = [];
    const flow = nestedComposition(store, seen, []);
    await Promise.all([
      flow.run({ message: 'ANON-ONE secret' }),
      flow.run({ message: 'ANON-TWO secret' }),
    ]);
    seen.length = 0;
    await flow.run({ message: 'third asks: anything?' });
    expect(seen.join('\n')).not.toContain('ANON-ONE');
    expect(seen.join('\n')).not.toContain('ANON-TWO');
  });

  it('a member’s earlier direct run never leaks its caller into a composition run', async () => {
    const store = new InMemoryStore();
    const seen: Seen = [];
    const toolSaw: unknown[] = [];
    const agent = member('solo', store, seen, toolSaw);
    // Carol uses the agent directly first: the instance now remembers her run.
    await agent.run({
      message: 'CAROL-SECRET is 5555',
      identity: { conversationId: 'c-carol', principal: 'carol' },
    });
    // Dave runs a composition holding the same instance, naming nobody.
    const flow = Sequence.create({ id: 'wrap' }).step('solo', agent).build();
    seen.length = 0;
    toolSaw.length = 0;
    await flow.run({ message: 'dave asks: what do you know?' });
    expect(seen.join('\n')).not.toContain('CAROL-SECRET');
    for (const call of toolSaw as { identity?: MemoryIdentity }[]) {
      expect(call.identity?.principal).not.toBe('carol');
    }
  });

  it('a member mounted where no run identity reaches it is refused by name', async () => {
    const store = new InMemoryStore();
    const agent = member('orphan', store, [], []);
    // A hand-built chart mounting the agent with a mapper that hands it only a message.
    const chart = flowChart<{ msg: string }>(
      'Start',
      (scope) => {
        scope.msg = 'hello';
      },
      'start',
    )
      .addSubFlowChartNext('sf-orphan', agent.getSpec(), 'Orphan', {
        inputMapper: (parent) => ({ message: String(parent.msg) }),
      })
      .build();
    const { FlowChartExecutor } = await import('footprintjs');
    const run = new FlowChartExecutor(chart).run({ input: {} });
    await expect(run).rejects.toThrow(/no identity reached it/);
    expect((await store.list({ conversationId: 'pending' })).entries).toEqual([]);
  });
});

describe('composition members — every composition, deeper nesting, refusals by name', () => {
  it('Parallel on its own: two users at once, each branch in its own user’s memory', async () => {
    const store = new InMemoryStore();
    const seen: Seen = [];
    const flow = Parallel.create({ id: 'p' })
      .branch('a', member('a', store, seen, []))
      .branch('b', member('b', store, seen, []))
      .mergeWithFn((r) => Object.values(r).join(' | '))
      .build();
    await Promise.all([
      flow.run({ message: 'ALICE-P-SECRET', identity: ALICE }),
      flow.run({ message: 'BOB-P-SECRET', identity: BOB }),
    ]);
    seen.length = 0;
    await Promise.all([
      flow.run({ message: 'alice asks again', identity: ALICE }),
      flow.run({ message: 'bob asks again', identity: BOB }),
    ]);
    const alice = seen.filter((r) => r.includes('alice asks')).join('\n');
    const bob = seen.filter((r) => r.includes('bob asks')).join('\n');
    expect(alice).toContain('ALICE-P-SECRET');
    expect(alice).not.toContain('BOB-P-SECRET');
    expect(bob).toContain('BOB-P-SECRET');
    expect(bob).not.toContain('ALICE-P-SECRET');
  });

  it('three levels deep — Sequence → Parallel → Loop / Conditional → Agent — the run reaches every member', async () => {
    const store = new InMemoryStore();
    const toolSaw: { member: string; identity?: MemoryIdentity; runId?: string }[] = [];
    const looped = Loop.create({ id: 'loop' })
      .repeat(member('looped', store, [], toolSaw))
      .times(1)
      .build();
    const routed = Conditional.create({ id: 'cond' })
      .when('always', () => true, member('routed', store, [], toolSaw))
      .otherwise('never', member('never', store, [], toolSaw))
      .build();
    const flow = Sequence.create({ id: 'outer' })
      .step(
        'fan',
        Parallel.create({ id: 'fan' })
          .branch('loop', looped)
          .branch('cond', routed)
          .mergeWithFn((r) => Object.values(r).join(' | '))
          .build(),
      )
      .build();
    await flow.run({ message: 'deep', identity: ALICE });
    const members = new Set(toolSaw.map((c) => c.member));
    expect(members).toEqual(new Set(['looped', 'routed']));
    for (const call of toolSaw) expect(call.identity).toEqual(ALICE);
    // One run, one run id handed to every member.
    expect(new Set(toolSaw.map((c) => c.runId)).size).toBe(1);
  });

  it('Workflow and graph: an `identity` in the input reaches every step and node', async () => {
    const store = new InMemoryStore();
    const toolSaw: { member: string; identity?: MemoryIdentity }[] = [];
    const wf = workflow(member('w1', store, [], toolSaw), member('w2', store, [], toolSaw));
    await wf.run({ message: 'go', identity: BOB });
    const g = graph({
      nodes: [
        { id: 'g1', runner: member('g1', store, [], toolSaw) },
        { id: 'g2', runner: member('g2', store, [], toolSaw) },
      ],
      edges: [{ from: 'g1', to: 'g2' }],
    });
    await g.run({ message: 'go', identity: BOB });
    expect(new Set(toolSaw.map((c) => c.member))).toEqual(new Set(['w1', 'w2', 'g1', 'g2']));
    for (const call of toolSaw) expect(call.identity).toEqual(BOB);
  });

  it('a malformed identity is refused at the composition’s run, by name', async () => {
    const flow = Sequence.create().step('m', member('m', new InMemoryStore(), [], [])).build();
    await expect(
      flow.run({ message: 'x', identity: { conversationId: 7 } as unknown as MemoryIdentity }),
    ).rejects.toThrow(/Sequence\.run: identity\.conversationId must be a string/);
  });

  it('a malformed `parentRun` handed by a hand-built chart is refused, never half-used', async () => {
    const agent = member('m', new InMemoryStore(), [], []);
    const chart = flowChart<{ msg: string }>(
      'Start',
      (scope) => {
        scope.msg = 'hello';
      },
      'start',
    )
      .addSubFlowChartNext('sf-m', agent.getSpec(), 'M', {
        inputMapper: () => ({ message: 'hi', parentRun: { identity: ALICE } }),
      })
      .build();
    const { FlowChartExecutor } = await import('footprintjs');
    await expect(new FlowChartExecutor(chart).run({ input: {} })).rejects.toThrow(
      /`parentRun\.runId` must be a non-empty string/,
    );
  });
});

describe('composition members — across a pause and resume', () => {
  it('a resumed composition still hands every member the run’s identity — never the instance’s', async () => {
    const store = new InMemoryStore();
    const toolSaw: { member: string; identity?: MemoryIdentity }[] = [];
    const { pauseHere, isPaused } = await import('../../../src/core/pause.js');
    let asked = 0;
    const asker = Agent.create({
      id: 'asker',
      provider: mock({
        chunkDelayMs: 0,
        respond: (req) =>
          req.messages.some((m) => m.role === 'tool')
            ? { content: 'approved' }
            : { toolCalls: [{ id: `a-${++asked}`, name: 'approve', args: {} }] },
      }),
      model: 'mock',
      maxIterations: 3,
    })
      .system('s')
      .tool(
        defineTool({
          name: 'approve',
          description: 'Asks a person.',
          inputSchema: { type: 'object', properties: {} },
          execute: async (_args, ctx) => {
            toolSaw.push({ member: 'asker', identity: ctx.identity });
            pauseHere({ question: 'Approve?' });
            return '';
          },
        }),
      )
      .build();
    const after = member('after', store, [], toolSaw);
    const flow = Sequence.create({ id: 'outer' }).step('ask', asker).step('after', after).build();

    // Another user runs the `after` agent on its own first — its instance now
    // remembers that caller.
    await after.run({
      message: 'CAROL-OWN',
      identity: { conversationId: 'c-carol', principal: 'carol' },
    });
    toolSaw.length = 0;

    const paused = await flow.run({ message: 'please approve', identity: ALICE });
    expect(isPaused(paused)).toBe(true);
    if (!isPaused(paused)) return;
    await flow.resume(paused.checkpoint, { approved: true });

    expect(toolSaw.some((c) => c.member === 'after')).toBe(true);
    for (const call of toolSaw) expect(call.identity).toEqual(ALICE);
    // The resumed member wrote under Alice's conversation, not Carol's.
    const alice = await store.list(ALICE);
    expect(alice.entries.length).toBeGreaterThan(0);
  });
});
