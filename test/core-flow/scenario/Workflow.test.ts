/**
 * workflow() — sequential steps whose hand-offs the compiler checks.
 *
 * The compile-time half is pinned in
 * `test/type-regressions/WorkflowChain.assignability.test.ts` (real tsc,
 * via `npm run test:types`). These are the RUN-TIME laws:
 *
 *   - scenario:    data flows through the steps in order
 *   - integration: LLM runners chain on the house `string → { message }`
 *                  convention, and workflows nest
 *   - property:    a structured hand-off survives untouched (this is the
 *                  gap: Sequence coerces non-strings to '')
 *   - honesty:     a broken hand-off says so, loudly, at the boundary
 *                  where it happened; a throwing step propagates
 *   - limits:      the documented value-flattening limits are real
 *   - lifecycle:   a pausing step surfaces as a pause, and consumer
 *                  recorders see the run
 */

import { describe, it, expect } from 'vitest';
import { flowChart, type FlowChart, type FlowchartCheckpoint, type RunOptions } from 'footprintjs';
import { workflow, Workflow } from '../../../src/core-flow/Workflow.js';
import { Sequence } from '../../../src/core-flow/Sequence.js';
import { LLMCall } from '../../../src/core/LLMCall.js';
import { Agent } from '../../../src/core/Agent.js';
import { RunnerBase } from '../../../src/core/RunnerBase.js';
import { isPaused, pauseHere, type RunnerPauseOutcome } from '../../../src/core/pause.js';
import type { LLMProvider, LLMRequest, LLMResponse } from '../../../src/adapters/types.js';

/**
 * A minimal typed step: one stage, returns whatever `fn` returns. The
 * shape any consumer would write for a non-LLM step.
 */
class Step<TIn extends object, TOut> extends RunnerBase<TIn, TOut> {
  readonly id: string;
  readonly name: string;
  private readonly fn: (input: TIn) => TOut;

  constructor(id: string, fn: (input: TIn) => TOut) {
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
      (scope) => fn(scope.$getArgs<TIn>()) as unknown,
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

interface Ticket {
  readonly orderId: string;
  readonly angry: boolean;
}

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

describe('workflow — data flows through the steps in order', () => {
  it('runs a single step', async () => {
    const only = new Step<{ message: string }, string>('only', (i) => `saw:${i.message}`);

    const out = await workflow(only).run({ message: 'hello' });

    expect(out).toBe('saw:hello');
  });

  it('threads three steps in declaration order', async () => {
    const a = new Step<{ message: string }, string>('a', (i) => `${i.message}|a`);
    const b = new Step<{ message: string }, string>('b', (i) => `${i.message}|b`);
    const c = new Step<{ message: string }, string>('c', (i) => `${i.message}|c`);

    const out = await workflow(a, b, c).run({ message: 'start' });

    expect(out).toBe('start|a|b|c');
  });

  it('hands the workflow’s own input to step 1 unchanged (not re-wrapped)', async () => {
    const seen: unknown[] = [];
    const first = new Step<Ticket, string>('first', (i) => {
      seen.push(i);
      return i.orderId;
    });

    const out = await workflow(first).run({ orderId: 'A-42', angry: true });

    expect(seen).toEqual([{ orderId: 'A-42', angry: true }]);
    expect(out).toBe('A-42');
  });

  it('PROPERTY: a structured hand-off survives — the gap Sequence cannot cover', async () => {
    const parse = new Step<{ message: string }, Ticket>('parse', (i) => ({
      orderId: (i.message.split(' ').at(-1) ?? '').replace('!', ''),
      angry: i.message.includes('!'),
    }));
    const reply = new Step<Ticket, string>(
      'reply',
      (t) => `order ${t.orderId} (${t.angry ? 'angry' : 'calm'})`,
    );

    const out = await workflow(parse, reply).run({ message: 'where is order A-42!' });

    expect(out).toBe('order A-42 (angry)');

    // Same two steps through Sequence: the object hand-off is coerced to
    // '' on the way out of step 1, so step 2 sees nothing. This is the
    // behaviour workflow() exists to replace — pinned so the contrast
    // cannot quietly change.
    const viaSequence = Sequence.create()
      .step('parse', parse as unknown as Parameters<ReturnType<typeof Sequence.create>['step']>[1])
      .step('reply', reply as unknown as Parameters<ReturnType<typeof Sequence.create>['step']>[1])
      .build();
    expect(await viaSequence.run({ message: 'where is order A-42!' })).toBe(
      'order undefined (calm)',
    );
  });

  it('chains LLM runners on the house string → { message } convention', async () => {
    const draft = LLMCall.create({ provider: echoProvider('draft'), model: 'm' })
      .system('')
      .build();
    const edit = LLMCall.create({ provider: echoProvider('edit'), model: 'm' })
      .system('')
      .build();

    const out = await workflow(draft, edit).run({ message: 'refunds' });

    expect(out).toBe('edit(draft(refunds))');
  });

  it('nests: a workflow is a runner, so it is also a step', async () => {
    const a = new Step<{ message: string }, string>('a', (i) => `${i.message}|a`);
    const b = new Step<{ message: string }, string>('b', (i) => `${i.message}|b`);
    const inner = workflow(a, b);
    const c = new Step<{ message: string }, string>('c', (i) => `${i.message}|c`);

    const out = await workflow(inner, c).run({ message: 'start' });

    expect(out).toBe('start|a|b|c');
  });
});

describe('workflow — honesty at the boundary', () => {
  it('names the step whose hand-off cannot be delivered', async () => {
    const counts = new Step<{ message: string }, number>('counts', (i) => i.message.length);
    const next = new Step<{ message: string }, string>('next', (i) => i.message);

    // The chain is bad by construction, so the compiler is bypassed here
    // on purpose — this pins what happens if it ever IS bypassed (a `any`
    // cast, JS consumers, a runner whose declared output type lies).
    const broken = workflow(counts as unknown as Step<{ message: string }, string>, next);

    await expect(broken.run({ message: 'four' })).rejects.toThrow(
      /step 1 handed forward number, but step 2 needs an object/,
    );
  });

  it('lets a throwing step fail the run instead of swallowing it', async () => {
    const boom = new Step<{ message: string }, string>('boom', () => {
      throw new Error('step blew up');
    });
    const after = new Step<{ message: string }, string>('after', (i) => i.message);

    await expect(workflow(boom, after).run({ message: 'x' })).rejects.toThrow(/step blew up/);
  });

  it('refuses to build an empty workflow', () => {
    expect(() => (workflow as () => unknown)()).toThrow(/at least one step/);
    expect(() => new Workflow([])).toThrow(/at least one step/);
  });

  it('LIMIT: only plain data crosses a boundary — a Date arrives as {}', async () => {
    const make = new Step<{ message: string }, { when: Date; note?: string; id: string }>(
      'make',
      () => ({ when: new Date('2026-08-02T00:00:00.000Z'), note: undefined, id: 'A-42' }),
    );
    const read = new Step<{ when: Date; note?: string; id: string }, string>('read', (i) =>
      JSON.stringify({
        isDate: i.when instanceof Date,
        whenKeys: Object.keys(i.when as unknown as object),
        hasNote: 'note' in i,
        id: i.id,
      }),
    );

    const out = await workflow(make, read).run({ message: 'x' });

    // Documented limit, pinned: prototypes do not survive, `undefined`
    // fields drop, plain fields are untouched.
    expect(JSON.parse(out as string)).toEqual({
      isDate: false,
      whenKeys: [],
      hasNote: false,
      id: 'A-42',
    });
  });

  it('LIMIT: the workflow’s own input stays visible to later steps; a produced key wins', async () => {
    const first = new Step<{ message: string; tenant: string }, { message: string }>(
      'first',
      () => ({ message: 'from-step-1' }),
    );
    const second = new Step<{ message: string }, string>('second', (i) =>
      JSON.stringify({
        message: i.message,
        tenant: (i as { tenant?: string }).tenant ?? null,
      }),
    );

    const out = await workflow(first, second).run({ message: 'original', tenant: 'acme' });

    expect(JSON.parse(out as string)).toEqual({
      // Step 1 produced `message`, so step 1's value wins…
      message: 'from-step-1',
      // …but `tenant`, which no step produced, is still readable from the
      // run's own arguments (footprintjs `getArgs()` inheritance).
      tenant: 'acme',
    });
  });
});

describe('workflow — composition surface', () => {
  it('announces itself as a sequential composition with one child per step', async () => {
    const a = new Step<{ message: string }, string>('a', (i) => i.message);
    const b = new Step<{ message: string }, string>('b', (i) => i.message);
    const flow = workflow(a, b);

    const enters: { kind: string; childCount: number; id: string }[] = [];
    const exits: { kind: string; status: string }[] = [];
    flow.on('agentfootprint.composition.enter', (e) =>
      enters.push({
        kind: e.payload.kind,
        childCount: e.payload.childCount,
        id: e.payload.id,
      }),
    );
    flow.on('agentfootprint.composition.exit', (e) =>
      exits.push({ kind: e.payload.kind, status: e.payload.status }),
    );

    await flow.run({ message: 'x' });

    expect(enters).toEqual([{ kind: 'Sequence', childCount: 2, id: 'workflow' }]);
    expect(exits).toEqual([{ kind: 'Sequence', status: 'ok' }]);
  });

  it('builds its chart once — the spec is reference-stable across runs', async () => {
    const a = new Step<{ message: string }, string>('a', (i) => i.message);
    const flow = workflow(a);

    const before = flow.getSpec();
    await flow.run({ message: 'x' });
    await flow.run({ message: 'y' });

    expect(flow.getSpec()).toBe(before);
  });

  it('surfaces a pausing step as a pause, not as a result', async () => {
    const scripted = (...responses: readonly LLMResponse[]): LLMProvider => {
      let i = 0;
      return {
        name: 'mock',
        complete: async () => responses[Math.min(i++, responses.length - 1)]!,
      };
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
    const flow = workflow(asksAHuman, after);
    const paused = await flow.run({ message: 'go' });

    // Not a value, not an error — a checkpoint the caller can resume.
    expect(isPaused(paused)).toBe(true);
    if (!isPaused(paused)) return;

    // …and resuming carries on through the REST of the chain: the agent
    // finishes its turn, and step 2 still gets what it produced.
    const resumed = await flow.resume(paused.checkpoint, { approved: true });

    expect(resumed).toBe('after:approved');
  });

  it('gives consumer-attached recorders the whole run', async () => {
    const a = new Step<{ message: string }, string>('a', (i) => i.message);
    const flow = workflow(a);

    const startedStages: string[] = [];
    flow.attach({
      id: 'test-recorder',
      onStageStart: (stageId: string) => {
        startedStages.push(stageId);
      },
    } as Parameters<typeof flow.attach>[0]);

    await flow.run({ message: 'x' });

    expect(startedStages.length).toBeGreaterThan(0);
  });

  it('takes an id + name for its events', async () => {
    const a = new Step<{ message: string }, string>('a', (i) => i.message);
    const flow = new Workflow<{ message: string }, string>([a], {
      id: 'intake',
      name: 'Ticket intake',
    });

    const ids: string[] = [];
    flow.on('agentfootprint.composition.enter', (e) =>
      ids.push(`${e.payload.id}/${e.payload.name}`),
    );
    await flow.run({ message: 'x' });

    expect(ids).toEqual(['intake/Ticket intake']);
  });
});
