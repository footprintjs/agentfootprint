/**
 * Security — every pre-execute callback and event sees ONE frozen copy of a
 * call's arguments, and a callback that writes into it is told why it failed.
 *
 *   - `tool_start` used to carry the live arguments: a listener that set
 *     `amount = 9000` refunded 9000. It now carries the frozen copy.
 *   - One copy is shared by every pre-execute callback and event of a call
 *     (`tool_start`, the permission checker, the `checkIn` predicate): it is
 *     frozen, so sharing is safe, and a large argument is copied once instead
 *     of once per callback.
 *   - A callback that writes into its copy fails (strict code throws): a
 *     permission checker that normalised its `context` in place denied every
 *     call, silently. In dev mode one warning names the cause.
 */

import { disableDevMode, enableDevMode } from 'footprintjs';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { Agent, defineTool } from '../../../src/index.js';
import { mock } from '../../../src/llm-providers.js';
import type { PermissionChecker } from '../../../src/provider-contract/types.js';
import {
  frozenCopyOf,
  frozenProjectionOf,
  frozenView,
  isSealed,
} from '../../../src/lib/frozenCopy.js';

function refundAgent(
  ran: unknown[],
  options: {
    readonly checker?: PermissionChecker;
    readonly checkIn?: (args: Readonly<Record<string, unknown>>) => boolean;
  } = {},
) {
  return Agent.create({
    provider: mock({
      replies: [
        { toolCalls: [{ id: 'r1', name: 'issue_refund', args: { amount: 5, lines: [1, 2] } }] },
        { toolCalls: [{ id: 'r2', name: 'issue_refund', args: { amount: 6, lines: [3] } }] },
        'done',
      ],
    }),
    model: 'm',
    ...(options.checker !== undefined && { permissionChecker: options.checker }),
  })
    .system('You issue refunds.')
    .tool(
      defineTool<{ amount: number }, string>({
        name: 'issue_refund',
        description: 'Issue a refund',
        inputSchema: { type: 'object', properties: { amount: { type: 'number' } } },
        ...(options.checkIn !== undefined && { checkIn: options.checkIn as never }),
        execute: (args) => {
          ran.push(args.amount);
          return 'refunded';
        },
      }),
    )
    .build();
}

afterEach(() => {
  disableDevMode();
  vi.restoreAllMocks();
});

describe('tool_start carries the frozen copy, not the arguments the tool runs with', () => {
  it('a listener that sets amount = 9000 on tool_start does not change the refund', async () => {
    const ran: unknown[] = [];
    const agent = refundAgent(ran);
    agent.on('agentfootprint.stream.tool_start', (event) => {
      try {
        (event.payload.args as { amount: number }).amount = 9000;
      } catch {
        // the copy is frozen
      }
    });
    await agent.run({ message: 'refund me' });
    expect(ran).toEqual([5, 6]);
  });

  it('the payload is frozen, and carries the proposal as it was', async () => {
    const seen: unknown[] = [];
    const agent = refundAgent([]);
    agent.on('agentfootprint.stream.tool_start', (event) => void seen.push(event.payload.args));
    await agent.run({ message: 'refund me' });
    expect(seen[0]).toEqual({ amount: 5, lines: [1, 2] });
    expect(Object.isFrozen(seen[0])).toBe(true);
    expect(Object.isFrozen((seen[0] as { lines: number[] }).lines)).toBe(true);
  });
});

describe('one frozen copy per call, shared by every pre-execute callback and event', () => {
  it('tool_start, the permission checker and the checkIn predicate are handed the same frozen object', async () => {
    const handed: { start: unknown[]; checker: unknown[]; predicate: unknown[] } = {
      start: [],
      checker: [],
      predicate: [],
    };
    const agent = refundAgent([], {
      checker: {
        name: 'reader',
        check: (request) => {
          handed.checker.push(request.context);
          return { result: 'allow' };
        },
      },
      checkIn: (args) => {
        handed.predicate.push(args);
        return false;
      },
    });
    agent.on('agentfootprint.stream.tool_start', (e) => void handed.start.push(e.payload.args));
    await agent.run({ message: 'refund me' });
    expect(handed.start).toHaveLength(2);
    for (let call = 0; call < 2; call++) {
      expect(handed.checker[call]).toBe(handed.start[call]);
      expect(handed.predicate[call]).toBe(handed.start[call]);
      expect(Object.isFrozen(handed.start[call])).toBe(true);
    }
  });
});

describe('a callback that writes into its frozen copy — one dev-mode warning naming the cause', () => {
  const normalises: PermissionChecker = {
    name: 'normaliser',
    check: (request) => {
      // A checker that "normalises" its context in place. Strict code: throws.
      (request.context as { amount: number }).amount = Math.round(
        Number((request.context as { amount: number }).amount),
      );
      return { result: 'allow' };
    },
  };

  it('a permission checker: denied, and the warning says the checker wrote into its frozen context — once', async () => {
    enableDevMode();
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const ran: unknown[] = [];
    await refundAgent(ran, { checker: normalises }).run({ message: 'refund me' });
    expect(ran).toEqual([]);
    const said = warn.mock.calls.map((call) => String(call[0]));
    const named = said.filter((line) => line.includes('permission checker'));
    expect(named).toHaveLength(1);
    expect(named[0]).toMatch(/frozen/);
    expect(named[0]).toMatch(/denied/);
  });

  it('a checkIn predicate: the gate trips, and the warning says the predicate wrote into its frozen arguments', async () => {
    enableDevMode();
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    await refundAgent([], {
      checkIn: (args) => {
        (args as { amount: number }).amount = 1;
        return false;
      },
    }).run({ message: 'refund me' });
    const named = warn.mock.calls
      .map((call) => String(call[0]))
      .filter((line) => line.includes('checkIn predicate'));
    expect(named).toHaveLength(1);
    expect(named[0]).toMatch(/frozen/);
  });

  it('outside dev mode nothing is printed', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    await refundAgent([], { checker: normalises }).run({ message: 'refund me' });
    expect(
      warn.mock.calls.map((call) => String(call[0])).filter((l) => l.includes('frozen')),
    ).toEqual([]);
  });
});

describe('arguments holding a container freezing cannot seal get one copy per callback', () => {
  // A provider (app code) can hand a call a Map, a Set, a Date or a typed
  // array; so can a middleware rewrite. `Object.freeze` leaves their contents
  // writable, so a copy holding one is never shared: each callback gets its
  // own, and none of them reaches the tool's arguments.
  it('a tool_start listener that writes into a Map does not change what the checker and the predicate judge', async () => {
    const usage = { input: 1, output: 1 };
    let calls = 0;
    const provider = {
      name: 'app-provider',
      complete: async () =>
        calls++ === 0
          ? {
              content: '',
              toolCalls: [
                {
                  id: 'r1',
                  name: 'issue_refund',
                  args: { amount: 5, limits: new Map([['cap', 10]]) },
                },
              ],
              usage,
              stopReason: 'tool_use' as const,
            }
          : { content: 'done', toolCalls: [], usage, stopReason: 'stop' as const },
    };
    const seen: { checker?: unknown; predicate?: unknown; tool?: unknown; objects: unknown[] } = {
      objects: [],
    };
    const agent = Agent.create({
      provider: provider as never,
      model: 'm',
      permissionChecker: {
        name: 'reader',
        check: (request) => {
          seen.objects.push(request.context);
          seen.checker = (request.context as { limits: Map<string, number> }).limits.get('cap');
          return { result: 'allow' };
        },
      },
    })
      .system('You issue refunds.')
      .tool(
        defineTool<{ amount: number; limits: Map<string, number> }, string>({
          name: 'issue_refund',
          description: 'Issue a refund',
          inputSchema: { type: 'object', properties: { amount: { type: 'number' } } },
          checkIn: ((args: { limits: Map<string, number> }) => {
            seen.objects.push(args);
            seen.predicate = args.limits.get('cap');
            return false;
          }) as never,
          execute: (args) => {
            seen.tool = args.limits.get('cap');
            return 'refunded';
          },
        }),
      )
      .build();
    agent.on('agentfootprint.stream.tool_start', (event) => {
      seen.objects.push(event.payload.args);
      (event.payload.args as { limits: Map<string, number> }).limits.set('cap', 9000);
    });
    await agent.run({ message: 'refund me' });
    expect(seen.checker).toBe(10);
    expect(seen.predicate).toBe(10);
    expect(seen.tool).toBe(10);
    expect(new Set(seen.objects).size).toBe(3);
  });
});

describe('UNIT — frozenCopyOf / isSealed / frozenView', () => {
  it('JSON arguments are sealed: one copy, handed on as it is', () => {
    const copy = frozenCopyOf({ amount: 5, lines: [{ sku: 'a' }] })!;
    expect(isSealed(copy)).toBe(true);
    expect(isSealed(copy.lines)).toBe(true);
    expect(frozenView(copy)).toBe(copy);
  });

  it.each([
    ['a Map', { m: new Map([['k', 1]]) }],
    ['a Set', { s: new Set([1]) }],
    ['a Date', { d: new Date(0) }],
    ['a typed array', { t: new Uint8Array([1, 2]) }],
    ['an ArrayBuffer', { b: new ArrayBuffer(4) }],
  ])('a copy holding %s is not sealed: every view of it is a new copy', (_label, value) => {
    const copy = frozenCopyOf(value)!;
    expect(isSealed(copy)).toBe(false);
    const view = frozenView(copy);
    expect(view).not.toBe(copy);
    expect(view).toEqual(copy);
  });
});

describe('no callback shares memory with another, or with the tool', () => {
  it('a SharedArrayBuffer is copied into a plain buffer for each callback — its bytes are nobody else’s', () => {
    const shared = new SharedArrayBuffer(4);
    const original = { bytes: new Uint8Array(shared), raw: shared };
    const one = frozenCopyOf(original)!;
    const two = frozenCopyOf(original)!;
    expect(one.raw).toBeInstanceOf(ArrayBuffer);
    expect(one.bytes.buffer).toBeInstanceOf(ArrayBuffer);
    one.bytes[0] = 7;
    new Uint8Array(one.raw)[1] = 9;
    expect([...two.bytes]).toEqual([0, 0, 0, 0]);
    expect([...new Uint8Array(shared)]).toEqual([0, 0, 0, 0]);
    expect(isSealed(one)).toBe(false);
  });

  it('a tool_start listener that writes into a SharedArrayBuffer-backed argument changes nothing the checker, the predicate or the tool sees', async () => {
    const usage = { input: 1, output: 1 };
    const shared = new SharedArrayBuffer(1);
    new Uint8Array(shared)[0] = 5;
    let calls = 0;
    const provider = {
      name: 'app-provider',
      complete: async () =>
        calls++ === 0
          ? {
              content: '',
              toolCalls: [
                { id: 'r1', name: 'issue_refund', args: { amount: new Uint8Array(shared) } },
              ],
              usage,
              stopReason: 'tool_use' as const,
            }
          : { content: 'done', toolCalls: [], usage, stopReason: 'stop' as const },
    };
    const seen: Record<string, number | undefined> = {};
    const agent = Agent.create({
      provider: provider as never,
      model: 'm',
      permissionChecker: {
        name: 'reader',
        check: (request) => {
          seen.checker = (request.context as { amount: Uint8Array }).amount[0];
          return { result: 'allow' };
        },
      },
    })
      .system('You issue refunds.')
      .tool(
        defineTool<{ amount: Uint8Array }, string>({
          name: 'issue_refund',
          description: 'Issue a refund',
          inputSchema: { type: 'object', properties: {} },
          checkIn: ((args: { amount: Uint8Array }) => {
            seen.predicate = args.amount[0];
            return false;
          }) as never,
          execute: (args) => {
            seen.tool = args.amount[0];
            return 'refunded';
          },
        }),
      )
      .build();
    agent.on('agentfootprint.stream.tool_start', (event) => {
      (event.payload.args as { amount: Uint8Array }).amount[0] = 90;
    });
    await agent.run({ message: 'refund me' });
    expect(seen).toEqual({ checker: 5, predicate: 5, tool: 5 });
  });

  it('arguments no copy can be made of: the event fallback is a frozen, detached projection, never their live objects', () => {
    // Unreachable through a provider — a run's state must survive
    // structuredClone, so a function in a call fails at commit before dispatch —
    // but the fallback itself must never hand a listener a live object.
    const live = { amount: 5 };
    const args = { order: live, notify: () => 'x' };
    expect(frozenCopyOf(args)).toBeUndefined();
    const projected = frozenProjectionOf(args) as unknown as { order: { amount: number } };
    expect(projected).toEqual({ order: { amount: 5 } });
    expect(projected.order).not.toBe(live);
    expect(Object.isFrozen(projected.order)).toBe(true);
    const cyclic: Record<string, unknown> = {};
    cyclic.self = cyclic;
    expect(frozenProjectionOf(cyclic)).toEqual({});
  });
});
