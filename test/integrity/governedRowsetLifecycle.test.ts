import type { AgentfootprintEvent } from '../../src/events.js';
import { describe, expect, it } from 'vitest';
import {
  Agent,
  allow,
  defineTool,
  inMemoryArtifacts,
  type ArtifactStore,
  type ToolExecutionContext,
} from '../../src/index.js';
import { mock } from '../../src/providers.js';

const KIND = 'dataset/rowset-lifecycle';
const rowsets = [
  {
    key: 'rows',
    columns: { amount: 'number' as const },
    source: {
      kind: 'published-dataset' as const,
      refPath: ['dataset'],
      artifactKind: KIND,
      maxRows: 1000,
      maxBytes: 1048576,
    },
  },
];
const checksOf = (events: readonly AgentfootprintEvent[]) =>
  events
    .filter((event) => event.type === 'agentfootprint.tools.rowset_checked')
    .map((event) => event.payload);
const findingsOf = (events: readonly AgentfootprintEvent[]) =>
  events.filter((event) => event.type === 'agentfootprint.integrity.context_error');
const deferred = () => {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
};
const provider = () =>
  mock({
    respond: (request) =>
      request.messages.at(-1)?.role === 'tool'
        ? 'Observed.'
        : { toolCalls: [{ id: 'reused-provider-id', name: 'source', args: {} }] },
  });

describe('actual native publication lifecycle', () => {
  it('does not authorize a write that completes after execute returned, even before governance finishes', async () => {
    const backend = inMemoryArtifacts();
    const written = deferred(),
      release = deferred();
    let ref = '',
      reads = 0,
      pending: Promise<unknown> | undefined;
    const events: AgentfootprintEvent[] = [];
    const store: ArtifactStore = {
      ...backend,
      async put(scope, input) {
        const record = await backend.put(scope, input);
        ref = record.meta.ref;
        written.resolve();
        await release.promise;
        return record;
      },
      async get(scope, key) {
        reads++;
        return backend.get(scope, key);
      },
    };
    const tool = defineTool({
      name: 'source',
      description: 'Read synthetic rows.',
      resultRowsets: rowsets,
      async execute(_args: Record<string, unknown>, context: ToolExecutionContext) {
        pending = context.artifacts.put({
          kind: KIND,
          mediaType: 'application/json',
          data: [{ amount: 'late-bad' }],
          digest: 'sha-256',
        });
        await written.promise;
        return { dataset: ref };
      },
    });
    const agent = Agent.create({
      model: 'mock',
      provider: provider(),
      artifacts: store,
      checkColumnTypes: 'enforce',
      integrityPosture: 'dev',
    })
      .tool(tool)
      .toolMiddleware({
        name: 'release-late-write',
        async onToolResult() {
          release.resolve();
          await pending;
          return allow();
        },
      })
      .build();
    agent.on('*', (event) => events.push(event));
    await agent.run({
      message: 'Read.',
      identity: { principal: 'owner', conversationId: 'late-publication' },
    });
    expect(reads).toBe(0);
    expect(findingsOf(events)).toEqual([]);
    expect(checksOf(events)).toMatchObject([
      { reason: 'publication-unavailable', disposition: 'unavailable', delivery: 'refused' },
    ]);
  });

  it('cannot reuse a prior invocation publication by reusing the exact provider call ID', async () => {
    const backend = inMemoryArtifacts();
    const events: AgentfootprintEvent[] = [];
    let ref = '',
      executions = 0,
      reads = 0;
    const store: ArtifactStore = {
      ...backend,
      async get(scope, key) {
        reads++;
        return backend.get(scope, key);
      },
    };
    const tool = defineTool({
      name: 'source',
      description: 'Read synthetic rows.',
      resultRowsets: rowsets,
      async execute(_args: Record<string, unknown>, context: ToolExecutionContext) {
        executions++;
        if (!ref)
          ref = (
            await context.artifacts.put({
              kind: KIND,
              mediaType: 'application/json',
              data: [{ amount: 0 }],
              digest: 'sha-256',
            })
          ).ref;
        return { dataset: ref };
      },
    });
    const agent = Agent.create({
      model: 'mock',
      provider: provider(),
      artifacts: store,
      checkColumnTypes: 'enforce',
      integrityPosture: 'dev',
    })
      .tool(tool)
      .build();
    agent.on('*', (event) => events.push(event));
    const identity = { principal: 'owner', conversationId: 'reused-id' };
    await agent.run({ message: 'Read first.', identity });
    await agent.run({ message: 'Read again.', identity });
    expect(executions).toBe(2);
    expect(reads).toBe(1);
    expect(checksOf(events)).toMatchObject([
      { toolCallId: 'reused-provider-id', disposition: 'checked-pass' },
      {
        toolCallId: 'reused-provider-id',
        disposition: 'unavailable',
        reason: 'publication-unavailable',
      },
    ]);
  });

  it('keeps concurrent Agents with one shared Tool and repeated call IDs in their actual scopes', async () => {
    const backend = inMemoryArtifacts();
    const both = deferred();
    let entered = 0;
    const readOwners: string[] = [];
    const store: ArtifactStore = {
      ...backend,
      async get(scope, key) {
        readOwners.push(String(scope.principal));
        return backend.get(scope, key);
      },
    };
    const tool = defineTool({
      name: 'source',
      description: 'Read scoped synthetic rows.',
      resultRowsets: rowsets,
      async execute(args: Record<string, unknown>, context: ToolExecutionContext) {
        const meta = await context.artifacts.put({
          kind: KIND,
          mediaType: 'application/json',
          digest: 'sha-256',
          data: [{ amount: args.owner === 'a' ? 'scope-a-bad' : 0 }],
        });
        if (++entered === 2) both.resolve();
        await both.promise;
        return { dataset: meta.ref };
      },
    });
    const build = (owner: string) => {
      const events: AgentfootprintEvent[] = [];
      const agent = Agent.create({
        model: 'mock',
        artifacts: store,
        checkColumnTypes: 'enforce',
        integrityPosture: 'dev',
        provider: mock({
          respond: (request) =>
            request.messages.at(-1)?.role === 'tool'
              ? 'Observed.'
              : { toolCalls: [{ id: 'reused-provider-id', name: 'source', args: { owner } }] },
        }),
      })
        .tool(tool)
        .build();
      agent.on('*', (event) => events.push(event));
      return { agent, events };
    };
    const a = build('a'),
      b = build('b');
    await Promise.all([
      a.agent.run({ message: 'Read A.', identity: { principal: 'a', conversationId: 'same' } }),
      b.agent.run({ message: 'Read B.', identity: { principal: 'b', conversationId: 'same' } }),
    ]);
    expect(readOwners.sort()).toEqual(['a', 'b']);
    expect(checksOf(a.events)).toMatchObject([
      { disposition: 'checked-fail', delivery: 'refused' },
    ]);
    expect(checksOf(b.events)).toMatchObject([
      { disposition: 'checked-pass', delivery: 'unchanged' },
    ]);
    expect(findingsOf(a.events)).toHaveLength(1);
    expect(findingsOf(b.events)).toEqual([]);
  });

  it('closes publication membership when a producer throws after minting', async () => {
    const backend = inMemoryArtifacts();
    const events: AgentfootprintEvent[] = [];
    let reads = 0,
      calls = 0,
      ref = '';
    const store: ArtifactStore = {
      ...backend,
      async get(scope, key) {
        reads++;
        return backend.get(scope, key);
      },
    };
    const tool = defineTool({
      name: 'source',
      description: 'Read fixture.',
      resultRowsets: rowsets,
      async execute(_args: Record<string, unknown>, context: ToolExecutionContext) {
        if (++calls === 1) {
          ref = (
            await context.artifacts.put({
              kind: KIND,
              mediaType: 'application/json',
              data: [{ amount: 'bad' }],
            })
          ).ref;
          throw new Error('Synthetic failure.');
        }
        return { dataset: ref };
      },
    });
    const agent = Agent.create({
      model: 'mock',
      provider: provider(),
      artifacts: store,
      checkColumnTypes: 'enforce',
      integrityPosture: 'dev',
    })
      .tool(tool)
      .build();
    agent.on('*', (event) => events.push(event));
    await agent.run({ message: 'Read first.' });
    await agent.run({ message: 'Read second.' });
    expect(reads).toBe(0);
    expect(findingsOf(events)).toEqual([]);
    expect(checksOf(events)).toMatchObject([
      { reason: 'result-withheld' },
      { reason: 'publication-unavailable' },
    ]);
  });
});
