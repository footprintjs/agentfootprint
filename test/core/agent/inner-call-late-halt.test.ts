/**
 * A checker's halt on an inner call ends the run even when the composing tool
 * did not wait for that call, and a halt wins over a pause the same tool raises.
 *
 * Every other halt test awaits its inner call, so the halt is already kept when
 * the outer tool returns. Here the tool returns FIRST and the checker answers
 * LATER: the outer call must not settle while a gate is still deciding about
 * one of its inner calls (`innerCallOuter.ts` · `close`).
 *
 * Each of the first two cases asserts the order itself (`tool returned`, then
 * `checker answered`), so the case cannot pass on a different trajectory.
 *
 *   compose (c1)  ── fires read_secret, does not await, returns ──┐
 *   checker       ── answers 'halt' a moment later ───────────────┤
 *   run           ── ends with PolicyHaltError under c1#inner-1 ──┘
 */
import { describe, expect, it } from 'vitest';

import {
  Agent,
  checkInApproved,
  defineTool,
  isCheckInPause,
  isPaused,
  pauseHere,
  type ToolExecutionContext,
} from '../../../src/index.js';
import { mock } from '../../../src/llm-providers.js';
import { PolicyHaltError } from '../../../src/security/index.js';
import type {
  LLMProvider,
  LLMRequest,
  PermissionChecker,
  PermissionRequest,
} from '../../../src/provider-contract/types.js';
import { callThen, events, rows, target } from './fixtures/innerCalls.js';

/** A mock provider that counts the requests it was sent. */
function counting(replies: Parameters<typeof mock>[0]['replies']) {
  const inner = mock({ replies });
  let requests = 0;
  const provider = new Proxy(inner, {
    get(t, key) {
      if (key === 'complete') {
        return (req: LLMRequest, hooks?: unknown) => {
          requests += 1;
          return t.complete(req, hooks as never);
        };
      }
      if (key === 'stream') return undefined;
      const value = Reflect.get(t, key);
      return typeof value === 'function' ? value.bind(t) : value;
    },
  }) as LLMProvider;
  return { provider, requests: () => requests };
}

/**
 * Halts `read_secret`, but only after the caller had time to return. `order`
 * receives `'checker answered'` at the moment the halt is given, so a case can
 * assert which came first.
 */
function lateHalt(order: string[] = []): PermissionChecker {
  return {
    name: 'policy',
    check: async (req: PermissionRequest) => {
      if (req.target !== 'read_secret') return { result: 'allow' } as never;
      await new Promise((resolve) => setTimeout(resolve, 20));
      order.push('checker answered');
      return { result: 'halt', reason: 'stop' } as never;
    },
  };
}

/** Starts the inner call and returns without waiting for it; says so in `order`. */
const fireAndReturn =
  (order: string[]) => async (_args: Record<string, unknown>, ctx: ToolExecutionContext) => {
    void ctx.tools!.call('read_secret', { account: 'A1' }).catch(() => undefined);
    order.push('tool returned');
    return 'returned at once';
  };

/** Waits for the inner call the checker halts, then raises a pause of its own. */
const haltThenPause = async (_args: Record<string, unknown>, ctx: ToolExecutionContext) => {
  await ctx.tools!.call('read_secret', { account: 'A1' }).catch(() => undefined);
  return pauseHere({ question: 'may I go on?' });
};

describe('a halt that arrives after the composing tool returned', () => {
  it('still ends the run, under the inner call’s id, and the provider is not asked again', async () => {
    const order: string[] = [];
    const secret = target('read_secret');
    const compose = defineTool<Record<string, unknown>, string>({
      name: 'compose',
      description: 'composes other tools',
      inputSchema: { type: 'object', properties: {} },
      execute: fireAndReturn(order),
    });
    const { provider, requests } = counting([
      { toolCalls: [{ id: 'c1', name: 'compose', args: {} }] },
      { content: 'never read' },
    ]);
    const agent = Agent.create({ provider, model: 'm', permissionChecker: lateHalt(order) })
      .tools([secret.tool, compose])
      .build();
    const seen = events(agent);
    const failure = await agent.run({ message: 'go' }).then(
      () => undefined,
      (err: unknown) => err,
    );

    // The trajectory this case is about: the tool had returned before the checker answered.
    expect(order).toEqual(['tool returned', 'checker answered']);
    expect(failure).toBeInstanceOf(PolicyHaltError);
    expect((failure as PolicyHaltError).proposed.name).toBe('read_secret');
    expect(seen.of('permission.halt').map((e) => [e.payload.toolCallId, e.payload.target])).toEqual(
      [['c1#inner-1', 'read_secret']],
    );
    expect(secret.entered).toEqual([]);
    expect(requests()).toBe(1);
    expect(rows(agent).map((r) => [r.toolName, r.ended, r.refusedBy, r.halted])).toEqual([
      ['read_secret', 'refused', 'permission', true],
    ]);
  });

  it('ends a resumed run too, when the approved tool did not wait for its inner call', async () => {
    const order: string[] = [];
    const secret = target('read_secret');
    const approved = {
      ...target('compose').tool,
      checkIn: 'always' as const,
      execute: fireAndReturn(order),
    };
    const { provider, requests } = counting(callThen());
    const agent = Agent.create({ provider, model: 'm', permissionChecker: lateHalt(order) })
      .tools([secret.tool, approved as never])
      .build();
    const seen = events(agent);
    const paused = await agent.run({ message: 'go' });
    if (!isCheckInPause(paused)) throw new Error('expected a check-in pause');
    const failure = await agent
      .resume(paused.checkpoint, checkInApproved({ request: paused.checkIn, by: 'ops' }))
      .then(
        () => undefined,
        (err: unknown) => err,
      );

    expect(order).toEqual(['tool returned', 'checker answered']);
    expect(failure).toBeInstanceOf(PolicyHaltError);
    expect((failure as PolicyHaltError).proposed.name).toBe('read_secret');
    expect(seen.of('permission.halt').map((e) => [e.payload.toolCallId, e.payload.target])).toEqual(
      [['c1#inner-1', 'read_secret']],
    );
    expect(secret.entered).toEqual([]);
    expect(requests()).toBe(1);
  });
});

describe('a halt, then a pause raised by the same tool', () => {
  it('ends the run with the halt; no pause is handed to the caller', async () => {
    const secret = target('read_secret');
    const compose = defineTool<Record<string, unknown>, string>({
      name: 'compose',
      description: 'composes other tools',
      inputSchema: { type: 'object', properties: {} },
      execute: haltThenPause,
    });
    const { provider, requests } = counting(callThen());
    const agent = Agent.create({ provider, model: 'm', permissionChecker: lateHalt() })
      .tools([secret.tool, compose])
      .build();
    const seen = events(agent);
    const outcome = await agent.run({ message: 'go' }).then(
      (value: unknown) => ({ value }),
      (error: unknown) => ({ error }),
    );

    expect('error' in outcome ? outcome.error : undefined).toBeInstanceOf(PolicyHaltError);
    if ('value' in outcome) expect(isPaused(outcome.value as never)).toBe(false);
    expect(seen.of('permission.halt').map((e) => [e.payload.toolCallId, e.payload.target])).toEqual(
      [['c1#inner-1', 'read_secret']],
    );
    expect(secret.entered).toEqual([]);
    expect(requests()).toBe(1);
  });

  it('ends a resumed run with the halt too; the approved tool’s pause is not handed on', async () => {
    const secret = target('read_secret');
    const approved = {
      ...target('compose').tool,
      checkIn: 'always' as const,
      execute: haltThenPause,
    };
    const { provider, requests } = counting(callThen());
    const agent = Agent.create({ provider, model: 'm', permissionChecker: lateHalt() })
      .tools([secret.tool, approved as never])
      .build();
    const seen = events(agent);
    const paused = await agent.run({ message: 'go' });
    if (!isCheckInPause(paused)) throw new Error('expected a check-in pause');
    const outcome = await agent
      .resume(paused.checkpoint, checkInApproved({ request: paused.checkIn, by: 'ops' }))
      .then(
        (value: unknown) => ({ value }),
        (error: unknown) => ({ error }),
      );

    expect('error' in outcome ? outcome.error : undefined).toBeInstanceOf(PolicyHaltError);
    if ('value' in outcome) expect(isPaused(outcome.value as never)).toBe(false);
    expect(seen.of('permission.halt').map((e) => [e.payload.toolCallId, e.payload.target])).toEqual(
      [['c1#inner-1', 'read_secret']],
    );
    expect(secret.entered).toEqual([]);
    expect(requests()).toBe(1);
  });
});
