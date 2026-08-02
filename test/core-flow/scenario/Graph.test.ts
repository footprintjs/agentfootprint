/**
 * graph() — a fixed DAG of runners, levelized at build time.
 *
 * The laws pinned here:
 *
 *   - scenario:    a diamond runs B and C at the SAME time, and D's join
 *                  receives both their outputs keyed by node id
 *   - honesty:     a broken shape is refused at BUILD time, naming the
 *                  offending edge / node / id (messages pinned to the byte)
 *   - property:    structured data crosses a node boundary untouched
 *                  (the workflow() law, re-pinned for edges)
 *   - scenario:    roots receive the graph's own input; multi-root works
 *   - lifecycle:   a pausing node surfaces as a pause, and resume finishes
 *                  the remaining levels
 *   - integration: consumer recorders see every node's events in ONE run
 *   - integration: two LLM agents as nodes, deterministic on a mock
 *                  provider (the adapter-swap law)
 */

import { describe, it, expect } from 'vitest';
import { flowChart, type FlowChart, type FlowchartCheckpoint, type RunOptions } from 'footprintjs';
import { graph, Graph, levelize, type GraphNode } from '../../../src/core-flow/Graph.js';
import { Agent } from '../../../src/core/Agent.js';
import { LLMCall } from '../../../src/core/LLMCall.js';
import { RunnerBase } from '../../../src/core/RunnerBase.js';
import { isPaused, pauseHere, type RunnerPauseOutcome } from '../../../src/core/pause.js';
import type { LLMProvider, LLMRequest, LLMResponse } from '../../../src/adapters/types.js';

/** A minimal typed node runner: one stage, returns whatever `fn` returns. */
class Step<TIn extends object, TOut> extends RunnerBase<TIn, TOut> {
  readonly id: string;
  readonly name: string;
  private readonly fn: (input: TIn) => TOut | Promise<TOut>;

  constructor(id: string, fn: (input: TIn) => TOut | Promise<TOut>) {
    super();
    this.id = id;
    this.name = id;
    this.fn = fn;
    this.initChart(() => this.buildChart());
  }

  private buildChart(): FlowChart {
    const fn = this.fn;
    return flowChart<Record<string, unknown>>(
      this.name,
      async (scope) => (await fn(scope.$getArgs<TIn>())) as unknown,
      `${this.id}-run`,
    ).build();
  }

  async run(input: TIn): Promise<TOut | RunnerPauseOutcome> {
    const { FlowChartExecutor } = await import('footprintjs');
    const executor = new FlowChartExecutor(this.getSpec());
    this.lastExecutor = executor;
    return (await executor.run({ input: { ...input } })) as TOut;
  }

  async resume(
    _checkpoint: FlowchartCheckpoint,
    _input?: unknown,
    _options?: RunOptions,
  ): Promise<TOut | RunnerPauseOutcome> {
    throw new Error('Step: no pause/resume in this test double');
  }
}

const delay = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

function echoProvider(tag: string): LLMProvider {
  return {
    name: tag,
    complete: async (req: LLMRequest): Promise<LLMResponse> => {
      const last = [...req.messages].reverse().find((m) => m.role === 'user');
      return {
        content: `${tag}(${last?.content ?? ''})`,
        toolCalls: [],
        usage: { input: 1, output: 1 },
        stopReason: 'stop',
      };
    },
  };
}

const scripted = (...responses: readonly LLMResponse[]): LLMProvider => {
  let i = 0;
  return { name: 'mock', complete: async () => responses[Math.min(i++, responses.length - 1)]! };
};

const resp = (
  content: string,
  toolCalls: readonly { id: string; name: string; args: Record<string, unknown> }[] = [],
): LLMResponse => ({
  content,
  toolCalls,
  usage: { input: 0, output: 1 },
  stopReason: toolCalls.length > 0 ? 'tool_use' : 'stop',
});

describe('graph — the diamond', () => {
  it('runs independent nodes in ONE level, at the same time', async () => {
    // A barrier that can only resolve if both nodes are in flight at once.
    // Serialized execution makes the first arrival time out instead.
    let started = 0;
    let release!: () => void;
    const both = new Promise<void>((r) => (release = r));
    const arrive = async (): Promise<'both' | 'timeout'> => {
      started += 1;
      if (started === 2) release();
      return Promise.race([
        both.then(() => 'both' as const),
        delay(400).then(() => 'timeout' as const),
      ]);
    };

    const seen: string[] = [];
    const a = new Step<{ message: string }, { from: string }>('a', () => ({ from: 'a' }));
    const b = new Step<{ from: string }, { who: string; sawBoth: string }>('b', async () => {
      const sawBoth = await arrive();
      seen.push(`b:${sawBoth}`);
      return { who: 'b', sawBoth };
    });
    const c = new Step<{ from: string }, { who: string; sawBoth: string }>('c', async () => {
      const sawBoth = await arrive();
      seen.push(`c:${sawBoth}`);
      return { who: 'c', sawBoth };
    });

    let joinSaw: Record<string, unknown> | undefined;
    const d: GraphNode<{ merged: string }, { merged: string }> = {
      id: 'd',
      runner: new Step<{ merged: string }, { merged: string }>('d', (i) => ({ merged: i.merged })),
      join: (upstream) => {
        joinSaw = { ...upstream };
        const bOut = upstream.b as { who: string };
        const cOut = upstream.c as { who: string };
        return { merged: `${bOut.who}+${cOut.who}` };
      },
    };

    const dag = graph({
      nodes: [{ id: 'a', runner: a }, { id: 'b', runner: b }, { id: 'c', runner: c }, d],
      edges: [
        { from: 'a', to: 'b' },
        { from: 'a', to: 'c' },
        { from: 'b', to: 'd' },
        { from: 'c', to: 'd' },
      ],
    });

    // Levelization is the concurrency contract, stated at build time.
    expect(dag.getLevels()).toEqual([['a'], ['b', 'c'], ['d']]);

    const out = (await dag.run({ message: 'go' })) as Record<string, unknown>;

    // Both nodes were in flight simultaneously — neither timed out.
    expect(seen.sort()).toEqual(['b:both', 'c:both']);

    // D's join received BOTH parents' outputs, keyed by node id.
    expect(joinSaw).toEqual({
      b: { who: 'b', sawBoth: 'both' },
      c: { who: 'c', sawBoth: 'both' },
    });

    // The result keys every node.
    expect(Object.keys(out).sort()).toEqual(['a', 'b', 'c', 'd']);
    expect(out.d).toEqual({ merged: 'b+c' });
  });
});

describe('graph — a broken shape is refused at build time', () => {
  it('names the edge that closes a cycle', () => {
    const mk = (id: string) => new Step<{ message: string }, string>(id, () => id);
    expect(() =>
      graph({
        nodes: [
          { id: 'a', runner: mk('a') },
          { id: 'b', runner: mk('b') },
          { id: 'c', runner: mk('c') },
        ],
        edges: [
          { from: 'a', to: 'b' },
          { from: 'b', to: 'c' },
          { from: 'c', to: 'a' },
        ],
      }),
    ).toThrow("graph: cycle detected — edge 'c' -> 'a' closes a loop. A graph must be acyclic.");
  });

  it('names an edge endpoint that is not a declared node', () => {
    const mk = (id: string) => new Step<{ message: string }, string>(id, () => id);
    expect(() =>
      graph({
        nodes: [{ id: 'a', runner: mk('a') }],
        edges: [{ from: 'a', to: 'ghost' }],
      }),
    ).toThrow("graph: edge 'a' -> 'ghost' references unknown node 'ghost'.");

    expect(() =>
      graph({
        nodes: [{ id: 'a', runner: mk('a') }],
        edges: [{ from: 'ghost', to: 'a' }],
      }),
    ).toThrow("graph: edge 'ghost' -> 'a' references unknown node 'ghost'.");
  });

  it('names a duplicate node id', () => {
    const mk = (id: string) => new Step<{ message: string }, string>(id, () => id);
    expect(() =>
      graph({
        nodes: [
          { id: 'a', runner: mk('a') },
          { id: 'a', runner: mk('a2') },
        ],
        edges: [],
      }),
    ).toThrow(
      "graph: duplicate node id 'a' — every node id must be unique (it is the results key).",
    );
  });

  it('refuses a fan-in of 2+ with no join, naming the node and its parents', () => {
    const mk = (id: string) => new Step<{ message: string }, string>(id, () => id);
    expect(() =>
      graph({
        nodes: [
          { id: 'b', runner: mk('b') },
          { id: 'c', runner: mk('c') },
          { id: 'd', runner: mk('d') },
        ],
        edges: [
          { from: 'b', to: 'd' },
          { from: 'c', to: 'd' },
        ],
      }),
    ).toThrow(
      "graph: node 'd' has 2 parents (b, c) but no join — a silent merge is a wrong merge. " +
        'Give the node a join(upstream) that returns its input; upstream is keyed by parent node id.',
    );
  });

  it('needs at least one node', () => {
    expect(() => graph({ nodes: [], edges: [] })).toThrow('graph: needs at least one node');
  });

  it('levelize() is the same check, usable on its own', () => {
    const mk = (id: string) => new Step<{ message: string }, string>(id, () => id);
    const levels = levelize(
      [
        { id: 'a', runner: mk('a') },
        { id: 'b', runner: mk('b') },
      ],
      [{ from: 'a', to: 'b' }],
    );
    expect(levels.map((l) => l.map((n) => n.id))).toEqual([['a'], ['b']]);
  });
});

describe('graph — hand-offs', () => {
  it('passes a single parent through with no join declared', async () => {
    const a = new Step<{ message: string }, string>('a', (i) => `a(${i.message})`);
    const b = new Step<{ message: string }, string>('b', (i) => `b(${i.message})`);

    const dag = graph({
      nodes: [
        { id: 'a', runner: a },
        { id: 'b', runner: b },
      ],
      edges: [{ from: 'a', to: 'b' }],
    });

    const out = (await dag.run({ message: 'x' })) as Record<string, unknown>;
    // A string output feeds the next node's { message } — the house convention.
    expect(out).toEqual({ a: 'a(x)', b: 'b(a(x))' });
  });

  it('carries a STRUCTURED value across an edge untouched', async () => {
    interface Ticket {
      readonly orderId: string;
      readonly angry: boolean;
      readonly tags: readonly string[];
      readonly nested: { readonly deep: number };
    }

    const parse = new Step<{ message: string }, Ticket>('parse', (i) => ({
      orderId: 'A-42',
      angry: i.message.includes('!'),
      tags: ['refund', 'urgent'],
      nested: { deep: 7 },
    }));

    let received: Ticket | undefined;
    const price = new Step<Ticket, { refundUsd: number }>('price', (t) => {
      received = t;
      return { refundUsd: t.angry ? 50 : 10 };
    });

    const dag = graph({
      nodes: [
        { id: 'parse', runner: parse },
        { id: 'price', runner: price },
      ],
      edges: [{ from: 'parse', to: 'price' }],
    });

    const out = (await dag.run({ message: 'where is my refund!' })) as Record<string, unknown>;

    // The object arrived whole — arrays, nested objects and booleans intact.
    expect(received).toEqual({
      orderId: 'A-42',
      angry: true,
      tags: ['refund', 'urgent'],
      nested: { deep: 7 },
    });
    expect(out.price).toEqual({ refundUsd: 50 });
    expect(out.parse).toEqual({
      orderId: 'A-42',
      angry: true,
      tags: ['refund', 'urgent'],
      nested: { deep: 7 },
    });
  });

  it('says so, naming both ends, when a node hands forward something that is not an object', async () => {
    const a = new Step<{ message: string }, number>('a', () => 42);
    const b = new Step<{ message: string }, string>('b', () => 'b');

    const dag = graph({
      nodes: [
        { id: 'a', runner: a },
        { id: 'b', runner: b },
      ],
      edges: [{ from: 'a', to: 'b' }],
    });

    await expect(dag.run({ message: 'x' })).rejects.toThrow(/node 'a' handed node 'b' number/);
  });
});

describe('graph — roots', () => {
  it('hands the graph input to every root node, and supports several roots', async () => {
    const seenA: unknown[] = [];
    const seenB: unknown[] = [];
    const a = new Step<{ message: string; tenant: string }, string>('a', (i) => {
      seenA.push(i);
      return `a:${i.message}`;
    });
    const b = new Step<{ message: string; tenant: string }, string>('b', (i) => {
      seenB.push(i);
      return `b:${i.tenant}`;
    });
    const c: GraphNode<{ both: string }, string> = {
      id: 'c',
      runner: new Step<{ both: string }, string>('c', (i) => i.both),
      join: (u) => ({ both: `${u.a as string}|${u.b as string}` }),
    };

    const dag = graph({
      nodes: [{ id: 'a', runner: a }, { id: 'b', runner: b }, c],
      edges: [
        { from: 'a', to: 'c' },
        { from: 'b', to: 'c' },
      ],
    });

    // Two roots — both sit in level 0.
    expect(dag.getLevels()).toEqual([['a', 'b'], ['c']]);

    const out = (await dag.run({ message: 'hi', tenant: 'acme' })) as Record<string, unknown>;

    expect(seenA).toEqual([{ message: 'hi', tenant: 'acme' }]);
    expect(seenB).toEqual([{ message: 'hi', tenant: 'acme' }]);
    expect(out.c).toBe('a:hi|b:acme');
  });

  it('runs a single-node graph', async () => {
    const only = new Step<{ message: string }, string>('only', (i) => `only:${i.message}`);
    const dag = graph({ nodes: [{ id: 'only', runner: only }], edges: [] });
    expect(dag.getLevels()).toEqual([['only']]);
    expect(await dag.run({ message: 'x' })).toEqual({ only: 'only:x' });
  });
});

describe('graph — failure', () => {
  it('turns a failed node into a loud error naming the node and its reason', async () => {
    const ok = new Step<{ message: string }, string>('ok', () => 'fine');
    const bad = new Step<{ message: string }, string>('bad', () => {
      throw new Error('upstream is down');
    });

    const dag = graph({
      nodes: [
        { id: 'ok', runner: ok },
        { id: 'bad', runner: bad },
      ],
      edges: [],
    });

    // footprintjs runs fork children under allSettled, so a failed node is
    // ABSENT rather than rejecting. The level join is what makes it loud.
    await expect(dag.run({ message: 'x' })).rejects.toThrow(
      "graph 'graph': node 'bad' failed: upstream is down",
    );
  });

  it('lists every failure when a whole level goes down', async () => {
    const mkBad = (id: string, why: string) =>
      new Step<{ message: string }, string>(id, () => {
        throw new Error(why);
      });

    const dag = graph({
      nodes: [
        { id: 'b', runner: mkBad('b', 'b is down') },
        { id: 'c', runner: mkBad('c', 'c is down') },
      ],
      edges: [],
    });

    await expect(dag.run({ message: 'x' })).rejects.toThrow(
      /graph 'graph': 2 nodes failed in level 0:\n {2}b: b is down\n {2}c: c is down/,
    );
  });

  it('names a failed node in a SEQUENTIAL (single-node) level too', async () => {
    // Single-node levels mount sequentially rather than as a fork-of-one,
    // so this exercises the other of the two mount paths.
    const first = new Step<{ message: string }, string>('first', () => 'ok');
    const bad = new Step<{ message: string }, string>('bad', () => {
      throw new Error('nope');
    });

    const dag = graph({
      nodes: [
        { id: 'first', runner: first },
        { id: 'bad', runner: bad },
      ],
      edges: [{ from: 'first', to: 'bad' }],
    });

    // Same sentence as the fork path, though footprintjs surfaces this one
    // as a raw rejection — the consumer should not have to know which mount
    // the level used.
    await expect(dag.run({ message: 'x' })).rejects.toThrow(
      "graph 'graph': node 'bad' failed: nope",
    );
  });
});

describe('graph — lifecycle', () => {
  it('surfaces a pausing node as a pause, and resume finishes the remaining levels', async () => {
    const asksAHuman = Agent.create({
      provider: scripted(resp('', [{ id: 't1', name: 'approve', args: {} }]), resp('approved')),
      model: 'mock',
    })
      .system('')
      .tool({
        schema: { name: 'approve', description: '', inputSchema: { type: 'object' } },
        execute: () => {
          pauseHere({ question: 'Approve?' });
          return '';
        },
      })
      .build();

    const after = new Step<{ message: string }, string>('after', (i) => `after:${i.message}`);

    const dag = graph({
      nodes: [
        { id: 'gate', runner: asksAHuman },
        { id: 'after', runner: after },
      ],
      edges: [{ from: 'gate', to: 'after' }],
    });

    const paused = await dag.run({ message: 'go' });

    // Not a value, not an error — a checkpoint the caller can store.
    expect(isPaused(paused)).toBe(true);
    if (!isPaused(paused)) return;
    expect(paused.pauseData).toMatchObject({ question: 'Approve?' });

    // Resuming carries on through the REST of the graph.
    const resumed = (await dag.resume(paused.checkpoint, { approved: true })) as Record<
      string,
      unknown
    >;

    expect(resumed.gate).toBe('approved');
    expect(resumed.after).toBe('after:approved');
  });

  it('pins the LIMIT: a pause inside a CONCURRENT level resumes only that node', async () => {
    // Honest limit, inherited from footprintjs: resuming into a FORK child
    // completes that child and stops — the parent's fork/join continuation
    // does not carry on. A single-node level avoids this by mounting
    // sequentially; a genuinely concurrent level cannot.
    const asksAHuman = Agent.create({
      provider: scripted(resp('', [{ id: 't1', name: 'approve', args: {} }]), resp('approved')),
      model: 'mock',
    })
      .system('')
      .tool({
        schema: { name: 'approve', description: '', inputSchema: { type: 'object' } },
        execute: () => {
          pauseHere({ question: 'Approve?' });
          return '';
        },
      })
      .build();

    const sibling = new Step<{ message: string }, string>('sibling', (i) => `sib:${i.message}`);
    const later = new Step<{ message: string }, string>('later', (i) => `later:${i.message}`);

    const dag = graph({
      nodes: [
        { id: 'gate', runner: asksAHuman },
        { id: 'sibling', runner: sibling },
        { id: 'later', runner: later },
      ],
      edges: [{ from: 'sibling', to: 'later' }],
    });

    // gate and sibling share level 0 — a real fork.
    expect(dag.getLevels()).toEqual([['gate', 'sibling'], ['later']]);

    const paused = await dag.run({ message: 'go' });
    expect(isPaused(paused)).toBe(true);
    if (!isPaused(paused)) return;

    // What IS true on resume: the paused node finishes and its output is
    // recorded, but the remaining levels do NOT run.
    const resumed = await dag.resume(paused.checkpoint, { approved: true });
    expect(resumed).toBe('approved');
    expect(dag.getLastSnapshot()?.sharedState).toMatchObject({
      results: { gate: 'approved' },
    });
  });

  it('builds its chart once — the spec is reference-stable across runs', async () => {
    const a = new Step<{ message: string }, string>('a', (i) => i.message);
    const dag = graph({ nodes: [{ id: 'a', runner: a }], edges: [] });

    const before = dag.getSpec();
    await dag.run({ message: 'x' });
    await dag.run({ message: 'y' });

    expect(dag.getSpec()).toBe(before);
  });

  it('announces itself as a composition with one child per node', async () => {
    const a = new Step<{ message: string }, string>('a', (i) => i.message);
    const b = new Step<{ message: string }, string>('b', (i) => i.message);
    const dag = new Graph({
      nodes: [
        { id: 'a', runner: a },
        { id: 'b', runner: b },
      ],
      edges: [{ from: 'a', to: 'b' }],
      id: 'intake',
      name: 'Ticket intake',
    });

    const enters: { kind: string; childCount: number; id: string; name: string }[] = [];
    const exits: { kind: string; status: string }[] = [];
    dag.on('agentfootprint.composition.enter', (e) =>
      enters.push({
        kind: e.payload.kind,
        childCount: e.payload.childCount,
        id: e.payload.id,
        name: e.payload.name,
      }),
    );
    dag.on('agentfootprint.composition.exit', (e) =>
      exits.push({ kind: e.payload.kind, status: e.payload.status }),
    );

    await dag.run({ message: 'x' });

    // `kind` stays inside the CLOSED public CompositionKind union — a
    // graph's levels are a sequence. See Graph.ts, "Why kind 'Sequence'".
    expect(enters).toEqual([
      { kind: 'Sequence', childCount: 2, id: 'intake', name: 'Ticket intake' },
    ]);
    expect(exits).toEqual([{ kind: 'Sequence', status: 'ok' }]);
  });
});

describe('graph — observability', () => {
  it('gives a consumer-attached recorder every node’s events in ONE run', async () => {
    const a = new Step<{ message: string }, string>('a', (i) => i.message);
    const b = new Step<{ message: string }, string>('b', (i) => i.message);
    const c = new Step<{ message: string }, string>('c', (i) => i.message);

    const dag = graph({
      nodes: [
        { id: 'a', runner: a },
        { id: 'b', runner: b },
        { id: 'c', runner: c },
      ],
      edges: [
        { from: 'a', to: 'b' },
        { from: 'a', to: 'c' },
      ],
    });

    const startedStages: string[] = [];
    dag.attach({
      id: 'test-recorder',
      onStageStart: (event: { stageId: string }) => {
        startedStages.push(event.stageId);
      },
    } as Parameters<typeof dag.attach>[0]);

    await dag.run({ message: 'x' });

    // Every node's own stage ran under the graph's single executor —
    // engine-prefixed by node id, so the causal log composes.
    expect(startedStages.some((s) => s.startsWith('a/'))).toBe(true);
    expect(startedStages.some((s) => s.startsWith('b/'))).toBe(true);
    expect(startedStages.some((s) => s.startsWith('c/'))).toBe(true);
    // …alongside the graph's own scaffolding.
    expect(startedStages).toContain('seed');
    expect(startedStages).toContain('finalize');
  });
});

describe('graph — integration', () => {
  it('runs LLM agents as nodes, deterministically, on a mock provider', async () => {
    const classify = LLMCall.create({ provider: echoProvider('classify'), model: 'mock' })
      .system('Classify.')
      .build();
    const reply = LLMCall.create({ provider: echoProvider('reply'), model: 'mock' })
      .system('Reply.')
      .build();

    const dag = graph({
      nodes: [
        { id: 'classify', runner: classify },
        { id: 'reply', runner: reply },
      ],
      edges: [{ from: 'classify', to: 'reply' }],
      id: 'support',
    });

    const first = (await dag.run({ message: 'help' })) as Record<string, unknown>;
    const second = (await dag.run({ message: 'help' })) as Record<string, unknown>;

    expect(first.classify).toBe('classify(help)');
    expect(first.reply).toBe('reply(classify(help))');
    // Same input, same provider, same answer — the adapter-swap law.
    expect(second).toEqual(first);
  });

  it('nests: a graph is a Runner, so it can be a node in another graph', async () => {
    const inner = graph({
      nodes: [
        { id: 'x', runner: new Step<{ message: string }, string>('x', (i) => `x(${i.message})`) },
      ],
      edges: [],
      id: 'inner',
    });

    const outer = graph({
      nodes: [
        {
          id: 'lead',
          runner: new Step<{ message: string }, string>('lead', (i) => `lead(${i.message})`),
        },
        // The inner graph returns a Record keyed by node id, so the
        // consumer picks what it needs out of it.
        { id: 'sub', runner: inner },
      ],
      edges: [{ from: 'lead', to: 'sub' }],
      id: 'outer',
    });

    const out = (await outer.run({ message: 'go' })) as Record<string, unknown>;
    expect(out.lead).toBe('lead(go)');
    expect(out.sub).toEqual({ x: 'x(lead(go))' });
  });
});
