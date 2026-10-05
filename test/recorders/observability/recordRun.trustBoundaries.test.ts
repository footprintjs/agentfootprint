/**
 * Trust capture is opt-in typed observation, not another engine recorder.
 * Its bundle belongs to this capture window; stopping must not later pair it
 * with a reused runner's new log. Raw recordings remain raw — only the trust
 * facts are a content-minimized projection captured at dispatch time.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  Agent,
  allow,
  ask,
  deny,
  defineTool,
  isPaused,
  checkInApproved,
  type ToolMiddleware,
} from '../../../src/index.js';
import { mock } from '../../../src/providers.js';
import { bearer, type CredentialProvider } from '../../../src/identity.js';
import type { AgentfootprintEvent } from '../../../src/events/registry.js';
import type { PermissionChecker } from '../../../src/adapters/types.js';
import { PolicyHaltError } from '../../../src/security/index.js';
import {
  trustBoundaryRecorder,
  type TrustBoundaryFact,
} from '../../../src/lib/trust-boundaries/index.js';
import {
  recordRun,
  recordRunWhere,
  type RunRecorder,
} from '../../../src/recorders/observability/recordRun.js';

afterEach(() => vi.restoreAllMocks());

const CONTENT = 'synthetic-private-content-canary';
const REASON = 'synthetic-private-reason-canary';

function plainAgent(deferred = false) {
  return Agent.create({
    provider: mock({ reply: CONTENT }),
    model: 'mock',
    ...(deferred ? { observerDelivery: 'deferred' as const } : {}),
  })
    .act({ input: [{ name: 'input-rule', onMessage: () => allow(undefined, REASON) }] })
    .build();
}

function trustHandle(recorder: RunRecorder) {
  const handle = recorder.trustBoundaries;
  expect(handle).toBeDefined();
  if (!handle) throw new Error('Expected opt-in trust capture');
  return handle;
}

function bundles(recorder: RunRecorder) {
  const snapshot = recorder.toRecording().snapshot as
    | { recorders?: readonly { id?: string; name?: string; data?: unknown }[] }
    | undefined;
  return snapshot?.recorders?.filter((row) => row.name === 'TrustBoundaries') ?? [];
}

function middlewareFacts(recorder: RunRecorder) {
  return trustHandle(recorder)
    .toSnapshot()
    .data.facts.filter(
      (
        fact,
      ): fact is Extract<TrustBoundaryFact, { eventType: 'agentfootprint.middleware.decision' }> =>
        fact.eventType === 'agentfootprint.middleware.decision',
    );
}

function toolAgent(
  options: {
    middleware?: ToolMiddleware;
    credentials?: CredentialProvider;
    permissionChecker?: PermissionChecker;
    twice?: boolean;
  } = {},
) {
  const execute = vi.fn(() => CONTENT);
  const tool = defineTool({
    name: 'read_invoice',
    description: 'Read a synthetic invoice',
    inputSchema: { type: 'object', properties: {} },
    ...(options.credentials ? { needs: { credential: 'invoice-service' } } : {}),
    execute,
  });
  const builder = Agent.create({
    provider: mock({
      replies: [
        {
          toolCalls: [
            { id: 'invoice-one', name: 'read_invoice', args: { note: CONTENT } },
            ...(options.twice ? [{ id: 'invoice-two', name: 'read_invoice', args: {} }] : []),
          ],
        },
        { content: 'done' },
      ],
    }),
    model: 'mock',
    ...(options.credentials ? { credentials: options.credentials } : {}),
    ...(options.permissionChecker ? { permissionChecker: options.permissionChecker } : {}),
  }).tool(tool);
  if (options.middleware) builder.toolMiddleware(options.middleware);
  return { agent: builder.build(), execute };
}

describe('recordRun trust capture lifecycle', () => {
  it('keeps the old opt-out shape and live getter behavior', async () => {
    const agent = plainAgent();
    const recorder = recordRun(agent);
    const getSnapshot = vi.spyOn(agent, 'getLastSnapshot');
    expect(recorder).not.toHaveProperty('trustBoundaries');
    await agent.run(CONTENT);
    expect(bundles(recorder)).toEqual([]);
    getSnapshot.mockClear();
    recorder.stop();
    expect(getSnapshot).not.toHaveBeenCalled();
    recorder.toRecording();
    expect(getSnapshot).toHaveBeenCalledOnce();
  });

  it('false is the same opt-out, with no extra typed listener', () => {
    const agent = plainAgent();
    const ordinary = recordRun(agent);
    const ordinaryListeners = agent.listenerCount();
    ordinary.stop();
    const disabled = recordRun(agent, { trustBoundaries: false });
    expect(agent.listenerCount()).toBe(ordinaryListeners);
    expect(disabled).not.toHaveProperty('trustBoundaries');
    disabled.stop();
  });

  it('does not attach a fake CombinedRecorder or invent a pre-run snapshot', () => {
    const agent = plainAgent();
    const attach = vi.spyOn(agent, 'attach');
    const recorder = recordRun(agent, { trustBoundaries: true });
    expect(trustHandle(recorder).toSnapshot().data.facts).toEqual([]);
    expect(attach).toHaveBeenCalledOnce(); // the existing BoundaryRecorder only
    expect(recorder.toRecording().snapshot).toBeUndefined();
    recorder.stop();
    expect(recorder.toRecording().snapshot).toBeUndefined();
  });

  it('overlays exactly one fresh bundle without changing the source snapshot', async () => {
    const agent = plainAgent();
    const recorder = recordRun(agent, { trustBoundaries: true });
    await agent.run(CONTENT);
    const source = agent.getLastSnapshot();
    expect(source).toBeDefined();
    if (!source) throw new Error('Expected executed snapshot');
    const sourceJson = JSON.stringify(source);
    vi.spyOn(agent, 'getLastSnapshot').mockReturnValue(source);
    const first = recorder.toRecording();
    const second = recorder.toRecording();
    expect(first.snapshot).not.toBe(source);
    expect(second.snapshot).not.toBe(first.snapshot);
    expect(bundles(recorder)).toHaveLength(1);
    expect(bundles(recorder)[0]).toMatchObject({
      id: trustHandle(recorder).id,
      data: trustHandle(recorder).toSnapshot().data,
    });
    expect(JSON.stringify(source)).toBe(sourceJson);
    expect(JSON.stringify(first)).toContain(CONTENT); // not a whole-recording privacy claim
    expect(JSON.stringify(bundles(recorder))).not.toContain(CONTENT);
    expect(JSON.stringify(bundles(recorder))).not.toContain(REASON);
    recorder.stop();
  });

  it('pins the old log at stop while retaining detached facts after runner reuse', async () => {
    const agent = plainAgent();
    const recorder = recordRun(agent, { trustBoundaries: true });
    await agent.run('first turn');
    const first = recorder.toRecording().snapshot as { runId: string };
    const facts = trustHandle(recorder).toSnapshot();
    recorder.stop();
    recorder.stop();
    expect(agent.listenerCount()).toBe(0);
    await agent.run('second turn');
    expect(agent.getLastSnapshot()?.runId).not.toBe(first.runId);
    expect(recorder.toRecording().snapshot).toMatchObject({ runId: first.runId });
    expect(trustHandle(recorder).toSnapshot()).toEqual(facts);
    expect(bundles(recorder)).toHaveLength(1);
  });

  it('pins undefined when stopped before a run rather than exporting a later log', async () => {
    const agent = plainAgent();
    const recorder = recordRun(agent, { trustBoundaries: true });
    recorder.stop();
    await agent.run(CONTENT);
    expect(recorder.toRecording().snapshot).toBeUndefined();
    expect(trustHandle(recorder).toSnapshot().data.facts).toEqual([]);
  });

  it('still cleans up every listener when pinning the snapshot throws', async () => {
    const agent = plainAgent();
    const recorder = recordRun(agent, { trustBoundaries: true });
    await agent.run(CONTENT);
    const retained = trustHandle(recorder).toSnapshot();
    const failure = new Error('synthetic snapshot failure');
    const getSnapshot = vi.spyOn(agent, 'getLastSnapshot').mockImplementation(() => {
      throw failure;
    });
    expect(() => recorder.stop()).toThrow(failure);
    expect(agent.listenerCount()).toBe(0);
    expect(() => recorder.stop()).not.toThrow();
    getSnapshot.mockRestore();
    await agent.run('later turn');
    expect(recorder.toRecording().snapshot).toBeUndefined();
    expect(trustHandle(recorder).toSnapshot()).toEqual(retained);
  });

  it('rolls back the timeline subscription when attaching the boundary recorder fails', () => {
    const agent = plainAgent();
    const failure = new Error('synthetic attach failure');
    vi.spyOn(agent, 'attach').mockImplementation(() => {
      throw failure;
    });
    expect(() => recordRun(agent, { trustBoundaries: true })).toThrow(failure);
    expect(agent.listenerCount()).toBe(0);
  });

  it('rolls back both earlier resources when the boundary subscription fails', () => {
    const agent = plainAgent();
    const originalOn = agent.on.bind(agent);
    const failure = new Error('synthetic subscribe failure');
    const detached = vi.fn();
    vi.spyOn(agent, 'attach').mockReturnValue(detached);
    vi.spyOn(agent, 'on')
      .mockImplementationOnce(originalOn)
      .mockImplementationOnce(() => {
        throw failure;
      });
    expect(() => recordRun(agent, { trustBoundaries: true })).toThrow(failure);
    expect(agent.listenerCount()).toBe(0);
    expect(detached).toHaveBeenCalledOnce();
  });

  it.each([false, true])(
    'attempts all cleanup and preserves the %s snapshot failure',
    (snapshotFails) => {
      const agent = plainAgent();
      const originalOn = agent.on.bind(agent);
      const originalAttach = agent.attach.bind(agent);
      const firstCleanupFailure = new Error('synthetic unsubscribe failure');
      const nextCleanupFailure = new Error('synthetic detach failure');
      const snapshotFailure = new Error('synthetic snapshot failure');
      const detached = vi.fn();
      vi.spyOn(agent, 'on').mockImplementationOnce((type, listener, options) => {
        const off = originalOn(type, listener, options);
        return () => {
          off();
          throw firstCleanupFailure;
        };
      });
      vi.spyOn(agent, 'attach').mockImplementation((observer) => {
        const off = originalAttach(observer);
        return () => {
          off();
          detached();
          throw nextCleanupFailure;
        };
      });
      const recorder = recordRun(agent, { trustBoundaries: true });
      if (snapshotFails)
        vi.spyOn(agent, 'getLastSnapshot').mockImplementation(() => {
          throw snapshotFailure;
        });
      expect(() => recorder.stop()).toThrow(snapshotFails ? snapshotFailure : firstCleanupFailure);
      expect(detached).toHaveBeenCalledOnce();
      expect(agent.listenerCount()).toBe(0);
      expect(() => recorder.stop()).not.toThrow();
    },
  );

  it('setup failure is not replaced by a rollback failure', () => {
    const agent = plainAgent();
    const originalOn = agent.on.bind(agent);
    const setupFailure = new Error('synthetic attach failure');
    vi.spyOn(agent, 'on').mockImplementationOnce((type, listener, options) => {
      const off = originalOn(type, listener, options);
      return () => {
        off();
        throw new Error('synthetic rollback failure');
      };
    });
    vi.spyOn(agent, 'attach').mockImplementation(() => {
      throw setupFailure;
    });
    expect(() => recordRun(agent, { trustBoundaries: true })).toThrow(setupFailure);
    expect(agent.listenerCount()).toBe(0);
  });

  it('filters membership before facts or their counters observe an event', async () => {
    const agent = plainAgent();
    const recorder = recordRunWhere(agent, () => false, {}, trustBoundaryRecorder());
    await agent.run(CONTENT);
    expect(recorder.toRecording().events).toEqual([]);
    expect(trustHandle(recorder).toSnapshot().data.facts).toEqual([]);
    expect(trustHandle(recorder).counters).toMatchObject({ observed: 0, pending: 0 });
    recorder.stop();
  });

  it('evaluates a stateful membership filter exactly once for each dispatched event', async () => {
    const agent = plainAgent();
    const counts = new Map<AgentfootprintEvent, number>();
    const recorder = recordRunWhere(
      agent,
      (event) => {
        const count = (counts.get(event) ?? 0) + 1;
        counts.set(event, count);
        return count === 1;
      },
      {},
      trustBoundaryRecorder(),
    );
    await agent.run(CONTENT);
    expect([...counts.values()].every((count) => count === 1)).toBe(true);
    expect(trustHandle(recorder).toSnapshot().data.facts.length).toBeGreaterThan(0);
    recorder.stop();
  });

  it('validates trust options before adding listeners or attached recorders', () => {
    const agent = plainAgent();
    const attach = vi.spyOn(agent, 'attach');
    expect(() => recordRun(agent, { trustBoundaries: { maxFacts: -1 } })).toThrow();
    expect(agent.listenerCount()).toBe(0);
    expect(attach).not.toHaveBeenCalled();
  });

  it('refuses an id collision at export without deleting another recorder row', async () => {
    const agent = plainAgent();
    const recorder = recordRun(agent, { trustBoundaries: { id: 'owned-elsewhere' } });
    await agent.run(CONTENT);
    const base = agent.getLastSnapshot();
    if (!base) throw new Error('Expected executed snapshot');
    const other = { id: 'owned-elsewhere', name: 'UserRecorder', data: { kept: true } };
    const source = { ...base, recorders: [...(base.recorders ?? []), other] };
    const before = JSON.stringify(source);
    vi.spyOn(agent, 'getLastSnapshot').mockReturnValue(source);
    expect(() => recorder.toRecording()).toThrow(/conflicts with an existing recorder/);
    expect(JSON.stringify(source)).toBe(before);
    expect(source.recorders.at(-1)).toBe(other);
    expect(() => recorder.stop()).not.toThrow();
  });

  it('captures deferred final decisions after await without replaying the event tail', async () => {
    const agent = Agent.create({
      provider: mock({ reply: CONTENT }),
      model: 'mock',
      observerDelivery: 'deferred',
    })
      .act({ output: [{ name: 'final-rule', onMessage: () => allow() }] })
      .build();
    const recorder = recordRun(agent, { trustBoundaries: true, maxEvents: 1 });
    await agent.run(CONTENT);
    expect(recorder.droppedEvents).toBeGreaterThan(0);
    const facts = trustHandle(recorder).toSnapshot().data.facts;
    expect(facts.length).toBeGreaterThan(0);
    expect(JSON.stringify(facts)).toContain('final-rule');
    recorder.stop();
    expect(bundles(recorder)[0]?.data).toEqual(trustHandle(recorder).toSnapshot().data);
  });

  it('late subscription does not reconstruct prior decisions from state or events', async () => {
    const agent = plainAgent();
    await agent.run(CONTENT);
    const recorder = recordRun(agent, { trustBoundaries: true });
    expect(trustHandle(recorder).toSnapshot().data.facts).toEqual([]);
    expect(recorder.toRecording().events).toEqual([]);
    recorder.stop();
  });

  it('an early stop records only what arrived, without claiming a completed run', async () => {
    const agent = Agent.create({
      provider: mock({
        respond: () => {
          recorder.stop();
          return { content: CONTENT };
        },
      }),
      model: 'mock',
    })
      .messageMiddleware({ name: 'both-phases', onMessage: () => allow() })
      .build();
    const recorder = recordRun(agent, { trustBoundaries: true });
    await agent.run(CONTENT);
    expect(middlewareFacts(recorder).map((fact) => fact.moment)).toEqual(['input']);
    expect(trustHandle(recorder).toSnapshot()).not.toHaveProperty('complete');
    expect(
      recorder.toRecording().events.some((event) => event.type === 'agentfootprint.agent.turn_end'),
    ).toBe(false);
  });
});

describe('recordRun observes reported policy facts without upgrading their meaning', () => {
  it.each(['allow', 'deny', 'ask', 'throw'] as const)(
    'records a real before-tool %s verdict, without content',
    async (verdict) => {
      const { agent, execute } = toolAgent({
        middleware: {
          name: 'invoice-rule',
          onToolCall: () => {
            if (verdict === 'throw') throw new Error(REASON);
            if (verdict === 'deny') return deny(REASON);
            if (verdict === 'ask') return ask({ question: REASON });
            return allow();
          },
        },
      });
      const recorder = recordRun(agent, { trustBoundaries: true });
      const result = await agent.run(CONTENT);
      expect(middlewareFacts(recorder)).toEqual([
        expect.objectContaining({
          eventType: 'agentfootprint.middleware.decision',
          middleware: 'invoice-rule',
          moment: 'before-tool',
          outcome: verdict === 'throw' ? 'deny' : verdict,
          changed: false,
          toolCallId: 'invoice-one',
          iteration: 1,
        }),
      ]);
      expect(execute).toHaveBeenCalledTimes(verdict === 'allow' ? 1 : 0);
      expect(JSON.stringify(trustHandle(recorder).toSnapshot())).not.toContain(CONTENT);
      expect(JSON.stringify(trustHandle(recorder).toSnapshot())).not.toContain(REASON);
      if (verdict === 'ask') {
        expect(isPaused(result)).toBe(true);
        if (!isPaused(result)) throw new Error('Expected middleware pause');
        const before = trustHandle(recorder).toSnapshot();
        expect(await agent.resume(result.checkpoint, checkInApproved({ by: 'reviewer' }))).toBe(
          'done',
        );
        expect(execute).toHaveBeenCalledOnce();
        expect(trustHandle(recorder).toSnapshot().data.captureId).toBe(before.data.captureId);
        expect(middlewareFacts(recorder)[0]).toEqual(before.data.facts[0]);
      }
      recorder.stop();
    },
  );

  it('keeps an opposite-phase wrapper allow as a report, not proof its callback ran', async () => {
    const callback = vi.fn(() => allow());
    const agent = Agent.create({ provider: mock({ reply: CONTENT }), model: 'mock' })
      .act({ input: [{ name: 'input-only', onMessage: callback }] })
      .build();
    const recorder = recordRun(agent, { trustBoundaries: true });
    await agent.run(CONTENT);
    expect(callback).toHaveBeenCalledOnce();
    expect(
      middlewareFacts(recorder).map(({ moment, outcome, changed }) => ({
        moment,
        outcome,
        changed,
      })),
    ).toEqual([
      { moment: 'input', outcome: 'allow', changed: false },
      { moment: 'output', outcome: 'allow', changed: false },
    ]);
    for (const fact of middlewareFacts(recorder)) {
      expect(fact).not.toHaveProperty('policyEvaluated');
      expect(fact).not.toHaveProperty('role');
    }
    recorder.stop();
  });

  it('an identical replacement reports changed, without calling it redaction', async () => {
    const { agent } = toolAgent({
      middleware: {
        name: 'identity-transform',
        onToolCall: (call) => allow(call.args, REASON),
      },
    });
    const recorder = recordRun(agent, { trustBoundaries: true });
    await agent.run(CONTENT);
    expect(middlewareFacts(recorder)).toEqual([
      expect.objectContaining({
        outcome: 'allow',
        changed: true,
        moment: 'before-tool',
      }),
    ]);
    expect(middlewareFacts(recorder)[0]).not.toHaveProperty('redacted');
    recorder.stop();
  });

  it('after-tool refusal does not invent a pre-tool check or undo execution', async () => {
    const { agent, execute } = toolAgent({
      middleware: {
        name: 'hide-result',
        onToolResult: () => deny(REASON),
      },
    });
    const recorder = recordRun(agent, { trustBoundaries: true });
    await agent.run(CONTENT);
    expect(execute).toHaveBeenCalledOnce();
    expect(middlewareFacts(recorder)).toEqual([
      expect.objectContaining({
        middleware: 'hide-result',
        moment: 'after-tool',
        outcome: 'deny',
        changed: true,
      }),
    ]);
    expect(middlewareFacts(recorder)[0]).not.toHaveProperty('executionPrevented');
    expect(JSON.stringify(bundles(recorder))).not.toContain(CONTENT);
    recorder.stop();
  });

  it('no middleware or permission checker means no invented allow facts', async () => {
    const { agent, execute } = toolAgent();
    const recorder = recordRun(agent, { trustBoundaries: true });
    await agent.run(CONTENT);
    expect(execute).toHaveBeenCalledOnce();
    expect(trustHandle(recorder).toSnapshot().data.facts).toEqual([]);
    recorder.stop();
  });

  it('keeps actual permission and push-credential identities for same-name calls', async () => {
    const { agent, execute } = toolAgent({
      twice: true,
      permissionChecker: { name: 'permission-test', check: () => ({ result: 'allow' }) },
      credentials: {
        id: 'credential-test',
        getCredential: async () => ({ status: 'issued', credential: bearer(CONTENT) }),
      },
    });
    const recorder = recordRun(agent, { trustBoundaries: true });
    await agent.run(CONTENT);
    const facts = trustHandle(recorder).toSnapshot().data.facts;
    for (const eventType of [
      'agentfootprint.permission.check',
      'agentfootprint.credential.requested',
      'agentfootprint.credential.acquired',
    ]) {
      expect(
        facts
          .filter((fact) => fact.eventType === eventType)
          .map(({ toolCallId, iteration }) => ({ toolCallId, iteration })),
      ).toEqual([
        { toolCallId: 'invoice-one', iteration: 1 },
        { toolCallId: 'invoice-two', iteration: 1 },
      ]);
    }
    expect(execute).toHaveBeenCalledTimes(2);
    expect(JSON.stringify(facts)).not.toContain(CONTENT);
    recorder.stop();
  });

  it('records permission halt separately from its check, without reason content', async () => {
    const { agent, execute } = toolAgent({
      permissionChecker: { name: 'halt-test', check: () => ({ result: 'halt', reason: REASON }) },
    });
    const recorder = recordRun(agent, { trustBoundaries: true });
    await expect(agent.run(CONTENT)).rejects.toBeInstanceOf(PolicyHaltError);
    const facts = trustHandle(recorder).toSnapshot().data.facts;
    expect(facts.map((fact) => fact.eventType)).toEqual([
      'agentfootprint.permission.check',
      'agentfootprint.permission.halt',
    ]);
    expect(facts.every((fact) => fact.toolCallId === 'invoice-one' && fact.iteration === 1)).toBe(
      true,
    );
    expect(execute).not.toHaveBeenCalled();
    expect(JSON.stringify(facts)).not.toContain(REASON);
    recorder.stop();
  });

  it.each(['authorization-required', 'failed'] as const)(
    'records credential %s without provider prose or consent handles',
    async (mode) => {
      const { agent, execute } = toolAgent({
        credentials: {
          id: 'credential-test',
          getCredential: async () => {
            if (mode === 'failed') throw new Error(REASON);
            return {
              status: 'authorization-required',
              authorizationUrl: `https://example.test/${CONTENT}`,
              sessionId: CONTENT,
            };
          },
        },
      });
      const recorder = recordRun(agent, { trustBoundaries: true });
      const result = await agent.run(CONTENT);
      expect(isPaused(result)).toBe(mode === 'authorization-required');
      expect(
        trustHandle(recorder)
          .toSnapshot()
          .data.facts.map((fact) => fact.eventType),
      ).toEqual([
        'agentfootprint.credential.requested',
        mode === 'failed'
          ? 'agentfootprint.credential.failed'
          : 'agentfootprint.credential.authorization_required',
      ]);
      expect(execute).not.toHaveBeenCalled();
      expect(JSON.stringify(bundles(recorder))).not.toContain(CONTENT);
      expect(JSON.stringify(bundles(recorder))).not.toContain(REASON);
      recorder.stop();
    },
  );
});
