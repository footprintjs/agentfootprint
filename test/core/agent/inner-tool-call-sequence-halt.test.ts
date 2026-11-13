/**
 * "The same gates" includes sequence rules and `'halt'`.
 *
 *   - the sequence a checker is handed for an inner call is the run's sequence
 *     so far plus the inner calls of the same outer call that already ran, in
 *     order, each `inner: true`; the model's own next call — in this turn and
 *     in a later one — sees the inner calls that ran before it, because they
 *     ride the outer call's history message (`LLMMessage.calls`), which never
 *     reaches a provider;
 *   - an inner `'halt'` refuses the inner call at once, and ends the run once
 *     the outer call settles, as the model's own halted call would:
 *     `permission.halt` under the inner call's id, naming the inner tool, then
 *     `PolicyHaltError` — on a first pass and on a resumed one.
 */
import { describe, expect, it } from 'vitest';

import {
  Agent,
  checkInApproved,
  isCheckInPause,
  type ToolExecutionContext,
} from '../../../src/index.js';
import { mock } from '../../../src/llm-providers.js';
import { PolicyHaltError } from '../../../src/security/index.js';
import type {
  LLMMessage,
  LLMProvider,
  PermissionRequest,
} from '../../../src/provider-contract/types.js';
import {
  callThen,
  checkerOf,
  composing,
  events,
  rows,
  sequenceOf,
  target,
} from './fixtures/innerCalls.js';

/** The exfiltration rule of `build/sequence-governance.mdx`: no post after a secret was read. */
const exfilRule = (answer: 'deny' | 'halt' = 'deny') =>
  checkerOf((req: PermissionRequest) =>
    req.target === 'http_post' && (req.sequence ?? []).some((e) => e.name === 'read_secret')
      ? { result: answer, reason: 'security:exfiltration', rationale: 'exfil' }
      : { result: 'allow' },
  );

/** A mock provider that also keeps every request it was sent. */
function keeping(replies: Parameters<typeof mock>[0]['replies']) {
  const inner = mock({ replies });
  const requests: string[][][] = [];
  const provider = new Proxy(inner, {
    get(t, key) {
      if (key === 'complete') {
        return (req: LLMRequest, hooks?: unknown) => {
          // The keys each message had when the provider was handed it.
          requests.push(req.messages.map((m) => Object.keys(m)));
          return t.complete(req, hooks as never);
        };
      }
      if (key === 'stream') return undefined;
      const value = Reflect.get(t, key);
      return typeof value === 'function' ? value.bind(t) : value;
    },
  }) as LLMProvider;
  return { provider, requests };
}

describe('the sequence an inner call’s checker sees', () => {
  it('is the run’s sequence plus the inner calls of the same outer call that already ran', async () => {
    const secret = target('read_secret');
    const post = target('http_post');
    const compose = composing(async (call) => {
      await call('read_secret', { account: 'A1' });
      await call('http_post', { account: 'A1' });
    });
    const checker = exfilRule();
    const agent = Agent.create({
      provider: mock({
        replies: [
          { toolCalls: [{ id: 'c0', name: 'read_secret', args: {} }] },
          { toolCalls: [{ id: 'c1', name: 'compose', args: {} }] },
          { content: 'done' },
        ],
      }),
      model: 'm',
      permissionChecker: checker,
    })
      .tools([secret.tool, post.tool, compose.tool])
      .build();
    await agent.run({ message: 'go' });

    // The model's read ran; then compose's own read ran; its post was refused.
    expect(secret.entered).toHaveLength(2);
    expect(post.entered).toEqual([]);
    expect(compose.told[1]).toMatch(/^refused: .*permission check.*\[permission denied: exfil\]/);
    // What each check was handed — the in-flight outer call is not listed yet.
    expect(checker.requests.map((r) => [r.target, sequenceOf(r)])).toEqual([
      ['read_secret', []],
      ['compose', ['read_secret']],
      ['read_secret', ['read_secret']],
      ['http_post', ['read_secret', 'read_secret*']],
    ]);
  });

  it('refuses the second step of a chain both of whose steps are inner calls (the flagship rule)', async () => {
    const secret = target('read_secret');
    const post = target('http_post');
    const compose = composing(async (call) => {
      await call('read_secret', { account: 'A1' });
      await call('http_post', { account: 'A1' });
    });
    const checker = exfilRule();
    const agent = Agent.create({
      provider: mock({ replies: callThen() }),
      model: 'm',
      permissionChecker: checker,
    })
      .tools([secret.tool, post.tool, compose.tool])
      .build();
    await agent.run({ message: 'go' });

    expect(secret.entered).toHaveLength(1);
    expect(post.entered).toEqual([]);
    expect(checker.requests.map((r) => [r.target, sequenceOf(r)])).toEqual([
      ['compose', []],
      ['read_secret', []],
      ['http_post', ['read_secret*']],
    ]);
    expect(rows(agent).map((r) => [r.toolName, r.ended, r.refusedBy])).toEqual([
      ['read_secret', 'returned', undefined],
      ['http_post', 'refused', 'permission'],
    ]);
  });

  it('the model’s own next call sees the inner calls that ran before it, and the provider never sees them', async () => {
    const secret = target('read_secret');
    const post = target('http_post');
    const compose = composing(async (call) => call('read_secret', { account: 'A1' }));
    const checker = exfilRule();
    const { provider, requests } = keeping([
      { toolCalls: [{ id: 'c1', name: 'compose', args: {} }] },
      { toolCalls: [{ id: 'c2', name: 'http_post', args: { account: 'A1' } }] },
      { content: 'done' },
    ]);
    const agent = Agent.create({ provider, model: 'm', permissionChecker: checker })
      .tools([secret.tool, post.tool, compose.tool])
      .build();
    await agent.run({ message: 'go' });

    expect(post.entered).toEqual([]);
    expect(checker.requests.map((r) => [r.target, sequenceOf(r)])).toEqual([
      ['compose', []],
      ['read_secret', []],
      ['http_post', ['compose', 'read_secret*']],
    ]);
    // The outer call's history message carries the inner call that ran …
    const history = (agent.getLastSnapshot()?.sharedState as { history: LLMMessage[] }).history;
    const composed = history.find((m) => m.role === 'tool' && m.toolCallId === 'c1');
    expect(composed?.calls).toEqual([
      { toolCallId: 'c1#inner-1', toolName: 'read_secret', args: { account: 'A1' } },
    ]);
    // … and no request a provider was sent carries the field.
    expect(requests.length).toBeGreaterThan(1);
    for (const keys of requests.flat()) expect(keys).not.toContain('calls');
  });

  it('a later turn of the same conversation still sees an earlier turn’s inner calls', async () => {
    const secret = target('read_secret');
    const post = target('http_post');
    const compose = composing(async (call) => call('read_secret', { account: 'A1' }));
    const checker = exfilRule();
    const agent = Agent.create({
      provider: mock({
        replies: [
          { toolCalls: [{ id: 'c1', name: 'compose', args: {} }] },
          { content: 'read it' },
          { toolCalls: [{ id: 'c2', name: 'http_post', args: { account: 'A1' } }] },
          { content: 'done' },
        ],
      }),
      model: 'm',
      permissionChecker: checker,
    })
      .tools([secret.tool, post.tool, compose.tool])
      .build();
    await agent.run({ message: 'read' });
    await agent.followUp('now post it');

    expect(post.entered).toEqual([]);
    const last = checker.requests[checker.requests.length - 1]!;
    expect([last.target, sequenceOf(last)]).toEqual(['http_post', ['compose', 'read_secret*']]);
  });

  it('a refused inner call is not in the sequence, as a denied model call is not', async () => {
    const secret = target('read_secret');
    const post = target('http_post');
    const compose = composing(async (call) => call('read_secret', { account: 'A1' }));
    const checker = checkerOf((req) =>
      req.target === 'read_secret' ? { result: 'deny' } : { result: 'allow' },
    );
    const agent = Agent.create({
      provider: mock({
        replies: [
          { toolCalls: [{ id: 'c1', name: 'compose', args: {} }] },
          { toolCalls: [{ id: 'c2', name: 'http_post', args: {} }] },
          { content: 'done' },
        ],
      }),
      model: 'm',
      permissionChecker: checker,
    })
      .tools([secret.tool, post.tool, compose.tool])
      .build();
    await agent.run({ message: 'go' });

    const last = checker.requests[checker.requests.length - 1]!;
    expect([last.target, sequenceOf(last)]).toEqual(['http_post', ['compose']]);
    const history = (agent.getLastSnapshot()?.sharedState as { history: LLMMessage[] }).history;
    expect(history.some((m) => m.calls !== undefined)).toBe(false);
  });
});

describe('a checker’s halt on an inner call', () => {
  it('refuses the inner call, then ends the run after the outer call settles, naming the inner call', async () => {
    const secret = target('read_secret');
    const post = target('http_post');
    const after = target('after');
    const compose = composing(async (call) => {
      await call('read_secret', { account: 'A1' });
      await call('http_post', { account: 'A1' });
    });
    const checker = exfilRule('halt');
    const agent = Agent.create({
      provider: mock({
        replies: [
          // `after` is a sibling in the same turn: a halt skips it.
          {
            toolCalls: [
              { id: 'c1', name: 'compose', args: {} },
              { id: 'c2', name: 'after', args: {} },
            ],
          },
          { content: 'never read' },
        ],
      }),
      model: 'm',
      permissionChecker: checker,
    })
      .tools([secret.tool, post.tool, after.tool, compose.tool])
      .build();
    const seen = events(agent);
    const failure = await agent.run({ message: 'go' }).then(
      () => undefined,
      (err: unknown) => err,
    );

    expect(failure).toBeInstanceOf(PolicyHaltError);
    const halt = failure as PolicyHaltError;
    expect(halt.reason).toBe('security:exfiltration');
    expect(halt.proposed).toEqual({ name: 'http_post', args: { account: 'A1' } });
    expect(halt.sequence.map((e) => (e.inner === true ? `${e.name}*` : e.name))).toEqual([
      'compose',
      'read_secret*',
      'http_post*',
    ]);
    // The composing tool read the generic refusal, never the telemetry reason …
    expect(compose.told[1]).toContain("Tool 'http_post' is not available in this context.");
    expect(compose.told[1]).not.toContain('exfiltration');
    // … its own result landed (every call is answered), and nothing after it ran.
    expect(post.entered).toEqual([]);
    expect(after.entered).toEqual([]);
    const outerResult = halt.history.find((m) => m.role === 'tool' && m.toolCallId === 'c1');
    expect(outerResult?.content).toContain('ran: read_secret-done');
    expect(seen.of('permission.halt').map((e) => [e.payload.toolCallId, e.payload.target])).toEqual(
      [['c1#inner-2', 'http_post']],
    );
    expect(rows(agent).map((r) => [r.toolName, r.ended, r.refusedBy, r.halted])).toEqual([
      ['read_secret', 'returned', undefined, undefined],
      ['http_post', 'refused', 'permission', true],
    ]);
  });

  it('ends a resumed run too, once the approved outer call settles', async () => {
    const secret = target('read_secret');
    const told: string[] = [];
    const approved = {
      ...target('compose').tool,
      checkIn: 'always' as const,
      execute: async (_args: Record<string, unknown>, ctx: ToolExecutionContext) => {
        try {
          return String(await ctx.tools!.call('read_secret', { account: 'A1' }));
        } catch (err) {
          told.push((err as Error).message);
          return 'refused';
        }
      },
    };
    const checker = checkerOf((req) =>
      req.target === 'read_secret' ? { result: 'halt', reason: 'stop' } : { result: 'allow' },
    );
    const agent = Agent.create({
      provider: mock({ replies: callThen() }),
      model: 'm',
      permissionChecker: checker,
    })
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

    expect(failure).toBeInstanceOf(PolicyHaltError);
    expect((failure as PolicyHaltError).proposed.name).toBe('read_secret');
    expect(told[0]).toContain('permission check');
    expect(secret.entered).toEqual([]);
    expect(seen.of('permission.halt').map((e) => [e.payload.toolCallId, e.payload.target])).toEqual(
      [['c1#inner-1', 'read_secret']],
    );
  });
});
