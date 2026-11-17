import type { AgentfootprintEvent } from '../../src/events.js';
import { describe, expect, it } from 'vitest';
import { Agent, defineTool, inMemoryArtifacts, type ArtifactStore } from '../../src/index.js';
import { mock } from '../../src/providers.js';

const KIND = 'dataset/availability-fixture';
const deferred = () => {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
};

async function inspect(
  options: {
    maxBytes?: number;
    maxRows?: number;
    rows?: number;
    cap?: boolean;
    tamper?: 'metadata' | 'withdraw-after-get' | 'store-error';
    mode?: 'warn' | 'enforce';
  } = {},
) {
  const backend = inMemoryArtifacts();
  const events: AgentfootprintEvent[] = [];
  let reads = 0,
    calls = 0,
    served = '';
  const store: ArtifactStore = {
    ...backend,
    async get(scope, ref) {
      reads++;
      const record = await backend.get(scope, ref);
      if (!record) return record;
      if (options.tamper === 'metadata')
        return { ...record, meta: { ...record.meta, digest: 'tampered' } };
      if (options.tamper === 'withdraw-after-get') await backend.delete(scope, ref);
      if (options.tamper === 'store-error') throw new Error('synthetic store failure');
      return record;
    },
  };
  const tool = defineTool({
    name: 'source',
    description: 'Read synthetic rows.',
    resultRowsets: [
      {
        key: 'rows',
        columns: { amount: 'number' },
        source: {
          kind: 'published-dataset',
          refPath: ['dataset'],
          artifactKind: KIND,
          maxRows: options.maxRows ?? 1000,
          maxBytes: options.maxBytes ?? 1048576,
        },
      },
    ],
    async execute(_args, context) {
      calls++;
      const dataset = await context.artifacts.put({
        kind: KIND,
        mediaType: 'application/json',
        digest: 'sha-256',
        data: Array.from({ length: options.rows ?? 1 }, () => ({ amount: 0 })),
      });
      return {
        dataset: dataset.ref,
        ...(options.cap && { preview: 'PRIVATE-PREVIEW-'.repeat(100) }),
      };
    },
  });
  const agent = Agent.create({
    model: 'mock',
    artifacts: store,
    checkColumnTypes: options.mode ?? 'enforce',
    integrityPosture: 'dev',
    ...(options.cap && { maxToolResultChars: 300 }),
    provider: mock({
      respond(request) {
        const last = request.messages.at(-1);
        if (last?.role === 'tool') {
          served = last.content;
          return 'Observed.';
        }
        return { toolCalls: [{ id: 'source', name: 'source', args: {} }] };
      },
    }),
  })
    .tool(tool)
    .build();
  agent.on('*', (event) => events.push(event));
  await agent.run({
    message: 'Read.',
    identity: { principal: 'owner', conversationId: 'availability-fixture' },
  });
  return {
    calls,
    reads,
    served,
    checks: events
      .filter((event) => event.type === 'agentfootprint.tools.rowset_checked')
      .map((event) => event.payload),
    findings: events.filter((event) => event.type === 'agentfootprint.integrity.context_error'),
    ends: events
      .filter((event) => event.type === 'agentfootprint.stream.tool_end')
      .map((event) => event.payload),
  };
}

describe('bounded native availability is separate from type violations', () => {
  it('rejects a metadata byte overflow before a payload get', async () => {
    const result = await inspect({ maxBytes: 1 });
    expect(result.calls).toBe(1);
    expect(result.reads).toBe(0);
    expect(result.findings).toEqual([]);
    expect(result.checks).toMatchObject([
      { disposition: 'unavailable', reason: 'source-over-bound', delivery: 'refused' },
    ]);
    expect(result.ends).toMatchObject([{ status: 'invalid' }]);
  });

  it('rejects a row overflow after one bounded get without judging its head', async () => {
    const result = await inspect({ maxRows: 2, rows: 3 });
    expect(result.calls).toBe(1);
    expect(result.reads).toBe(1);
    expect(result.findings).toEqual([]);
    expect(result.checks).toMatchObject([
      { disposition: 'unavailable', reason: 'source-over-bound' },
    ]);
  });

  it.each(['metadata', 'withdraw-after-get', 'store-error'] as const)(
    'does not type-check a %s publication',
    async (tamper) => {
      const result = await inspect({ tamper });
      expect(result.calls).toBe(1);
      expect(result.reads).toBe(1);
      expect(result.findings).toEqual([]);
      expect(result.checks).toMatchObject([{ disposition: 'unavailable', delivery: 'refused' }]);
      expect(result.served).toBe(
        'Result rejected: a declared rowset was unavailable for its column check. No data was returned.',
      );
      expect(result.ends).toMatchObject([{ status: 'invalid' }]);
    },
  );

  it('warn preserves the actual unavailable reference without a pass or invented type finding', async () => {
    const result = await inspect({ maxBytes: 1, mode: 'warn' });
    expect(result.reads).toBe(0);
    expect(result.findings).toEqual([]);
    expect(result.served).toContain('dataset');
    expect(result.checks).toMatchObject([{ disposition: 'unavailable', delivery: 'unchanged' }]);
  });

  it('does not redeem a reference from a capped result or leak its private preview', async () => {
    const result = await inspect({ cap: true });
    expect(result.calls).toBe(1);
    expect(result.reads).toBe(0);
    expect(result.findings).toEqual([]);
    expect(result.served).not.toContain('PRIVATE-PREVIEW-');
    expect(result.checks).toMatchObject([
      { disposition: 'unavailable', reason: 'result-capped', delivery: 'refused' },
    ]);
    expect(result.ends).toMatchObject([{ status: 'invalid' }]);
  });
});

describe('cancelled native readers cannot settle a later invocation', () => {
  it('aborts waiting, closes the old owner, and ignores the old payload after a new run', async () => {
    const backend = inMemoryArtifacts(),
      started = deferred(),
      release = deferred();
    const abort = new AbortController();
    const events: AgentfootprintEvent[] = [];
    let gets = 0,
      executions = 0;
    const store: ArtifactStore = {
      ...backend,
      async get(scope, ref) {
        const record = await backend.get(scope, ref);
        if (++gets === 1) {
          started.resolve();
          await release.promise;
        }
        return record;
      },
    };
    const tool = defineTool({
      name: 'source',
      description: 'Read synthetic rows.',
      resultRowsets: [
        {
          key: 'rows',
          columns: { amount: 'number' },
          source: {
            kind: 'published-dataset',
            refPath: ['dataset'],
            artifactKind: KIND,
            maxRows: 1000,
            maxBytes: 1048576,
          },
        },
      ],
      async execute(_args, context) {
        const data = [{ amount: ++executions === 1 ? 'OLD-ABORTED-CANARY' : 0 }];
        const publication = await context.artifacts.put({
          kind: KIND,
          mediaType: 'application/json',
          data,
          digest: 'sha-256',
        });
        return { dataset: publication.ref };
      },
    });
    const agent = Agent.create({
      model: 'mock',
      artifacts: store,
      checkColumnTypes: 'enforce',
      integrityPosture: 'dev',
      provider: mock({
        respond: (request) =>
          request.messages.at(-1)?.role === 'tool'
            ? 'Observed.'
            : { toolCalls: [{ id: 'same-id', name: 'source', args: {} }] },
      }),
    })
      .tool(tool)
      .build();
    agent.on('*', (event) => events.push(event));
    const identity = { principal: 'owner', conversationId: 'cancelled-reader' };
    const first = agent.run(
      { message: 'Read first.', identity },
      { env: { signal: abort.signal } },
    );
    try {
      await started.promise;
      abort.abort();
      await expect(first).rejects.toThrow();
      await agent.run({ message: 'Read second.', identity });
    } finally {
      release.resolve();
      await first.catch(() => undefined);
    }
    await Promise.resolve();
    expect(gets).toBe(2);
    expect(executions).toBe(2);
    expect(
      events
        .filter((event) => event.type === 'agentfootprint.tools.rowset_checked')
        .map((event) => event.payload),
    ).toMatchObject([{ toolCallId: 'same-id', disposition: 'checked-pass' }]);
    expect(
      events.filter((event) => event.type === 'agentfootprint.integrity.context_error'),
    ).toEqual([]);
  });
});
