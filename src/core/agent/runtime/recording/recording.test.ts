import { expect, it } from 'vitest';
import { Agent } from '../../../Agent.js';
import { defineTool } from '../../../../tools/tools.js';
import { inMemoryArtifacts } from '../../../../artifacts/inMemoryArtifacts.js';
import { mock } from '../../../../adapters/llm/MockProvider.js';
import type { AgentfootprintEvent } from '../../../../events/registry.js';
import type { TrustBoundarySnapshot } from '../../../../trust-boundaries/types.js';
import { trustBoundaryRecorder } from '../../../../trust-boundaries/capture.js';
import { allow } from '../../middleware/outcomes.js';

it('files the completed recording after joined resource cleanup and before its own mint event', async () => {
  const store = inMemoryArtifacts(),
    scope = { conversationId: 'record-finalization' };
  let closed = 0;
  const agent = Agent.create({
    provider: mock({
      replies: [{ toolCalls: [{ id: 'open', name: 'resource', args: {} }] }, { content: 'done' }],
    }),
    model: 'mock',
    artifacts: { store, recordings: true },
  })
    .tool(
      defineTool({
        name: 'resource',
        description: 'Local recording fixture',
        inputSchema: { type: 'object', properties: {} },
        execute: (_args, context) => {
          context.onTeardown!(
            () => {
              closed++;
            },
            { scope: 'run' },
          );
          return 'opened';
        },
      }),
    )
    .build();
  await expect(agent.run({ message: 'start', identity: scope })).resolves.toBe('done');
  expect(closed).toBe(1);
  const rows = (await store.list(scope)).artifacts.filter((meta) => meta.kind === 'recording/run');
  expect(rows).toHaveLength(1);
  const record = await store.get(scope, rows[0]!.ref);
  const saved = JSON.parse(record!.data as string) as {
    snapshot: { recorders?: { name: string }[] };
    events: { type: string; meta?: { runId?: string } }[];
  };
  expect(saved.snapshot.recorders?.some((entry) => entry.name === 'TrustBoundaries')).not.toBe(
    true,
  );
  const cleanup = saved.events.filter(
    (event) => event.type === 'agentfootprint.tools.session_closed',
  );
  expect(cleanup).toHaveLength(1);
  expect(cleanup[0]?.meta?.runId).toBe(record?.meta.origin?.runId);
  expect(saved.events.some((event) => event.type === 'agentfootprint.artifacts.minted')).toBe(
    false,
  );
});

it('saves one bounded trust bundle for native events of the actual invocation', async () => {
  const store = inMemoryArtifacts();
  const sessionId = 'trust-recording';
  const scope = { conversationId: sessionId };
  const reason = 'private reasoning canary';
  const permission = { capability: 'tool_call', result: 'allow' };
  const agent = Agent.create({
    provider: mock({
      respond() {
        agent.emitAttributed(
          'agentfootprint.permission.check',
          { ...permission, target: 'same-session consumer' },
          { sessionId },
        );
        agent.emitAttributed(
          'agentfootprint.permission.check',
          { ...permission, target: 'other invocation' },
          { sessionId, runId: 'other-run' },
        );
        return { content: 'done' };
      },
    }),
    model: 'mock',
    observerDelivery: 'deferred',
    artifacts: {
      store,
      recordings: {
        trustBoundaries: () => trustBoundaryRecorder({ id: 'host-trust', maxFacts: 1 }),
      },
    },
  })
    .act({
      input: [
        { name: 'first-rule', onMessage: () => allow(undefined, reason) },
        { name: 'last-rule', onMessage: () => allow(undefined, reason) },
      ],
    })
    .build();
  try {
    await expect(agent.run({ message: 'start' }, { sessionId })).resolves.toBe('done');
    const listed = await store.list(scope);
    expect(listed.artifacts).toHaveLength(1);
    const meta = listed.artifacts[0]!;
    const saved = await store.get(scope, meta.ref);
    const recording = JSON.parse(saved!.data as string) as {
      snapshot: { recorders: (TrustBoundarySnapshot & { id: string })[] };
      events: AgentfootprintEvent[];
    };
    const trust = recording.snapshot.recorders.filter((row) => row.name === 'TrustBoundaries');
    expect(trust).toHaveLength(1);
    const decisions = recording.events.filter(
      (event) =>
        event.type === 'agentfootprint.middleware.decision' &&
        event.meta.runId === meta.origin?.runId,
    );
    expect(decisions.length).toBeGreaterThan(1);
    expect(trust[0]).toMatchObject({
      id: 'host-trust',
      data: {
        counters: { observed: decisions.length, retained: 1, evicted: decisions.length - 1 },
        facts: [
          {
            eventType: 'agentfootprint.middleware.decision',
            middleware: 'last-rule',
            runId: meta.origin?.runId,
          },
        ],
      },
    });
    expect(JSON.stringify(trust)).not.toContain(reason);
    const timeline = JSON.stringify(recording.events);
    expect(timeline).toContain('same-session consumer');
    expect(timeline).not.toContain('other invocation');
  } finally {
    await agent.shutdown();
  }
});

it('requires a trust factory and refuses a recorder already used by another invocation', async () => {
  const store = inMemoryArtifacts();
  const recorder = trustBoundaryRecorder();
  const options = { provider: mock({ reply: 'done' }), model: 'mock' };
  expect(() =>
    Agent.create({
      ...options,
      artifacts: { store, recordings: { trustBoundaries: recorder as never } },
    }).build(),
  ).toThrow(/recorder factory/);

  const agent = Agent.create({
    ...options,
    artifacts: { store, recordings: { trustBoundaries: () => recorder } },
  }).build();
  try {
    await expect(agent.run('first')).resolves.toBe('done');
    await expect(agent.run('second')).rejects.toThrow(/fresh recorder/);
  } finally {
    await agent.shutdown();
  }
});

it('refuses a trust recorder populated outside automatic recording', async () => {
  const recorder = trustBoundaryRecorder();
  const options = { provider: mock({ reply: 'done' }), model: 'mock' };
  const earlier = Agent.create(options)
    .act({ input: [{ name: 'prior-rule', onMessage: () => allow() }] })
    .build();
  const detach = recorder.subscribe(earlier);
  try {
    await earlier.run('a different conversation');
  } finally {
    detach();
    await earlier.shutdown();
  }
  expect(recorder.counters.observed).toBeGreaterThan(0);

  const store = inMemoryArtifacts();
  const identity = { conversationId: 'empty-recording' };
  const agent = Agent.create({
    ...options,
    artifacts: { store, recordings: { trustBoundaries: () => recorder } },
  }).build();
  try {
    await expect(agent.run({ message: 'new conversation', identity })).rejects.toThrow(
      /fresh recorder/,
    );
    expect((await store.list(identity)).artifacts).toEqual([]);
  } finally {
    await agent.shutdown();
  }
});
