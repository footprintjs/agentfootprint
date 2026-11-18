import { describe, expect, it } from 'vitest';
import { Agent, defineTool, inMemoryArtifacts, type ArtifactStore } from '../../src/index.js';
import type { AgentfootprintEvent } from '../../src/events.js';
import { mock } from '../../src/providers.js';

async function inspect(rows: readonly unknown[], rootRef = false) {
  const backend = inMemoryArtifacts();
  let reads = 0,
    executions = 0;
  const events: AgentfootprintEvent[] = [];
  const store: ArtifactStore = {
    ...backend,
    async get(scope, ref) {
      reads++;
      return backend.get(scope, ref);
    },
  };
  const tool = defineTool({
    name: 'source',
    description: 'Read exact-bound synthetic rows.',
    resultRowsets: [
      {
        key: 'rows',
        columns: { amount: 'number' },
        source: {
          kind: 'published-dataset',
          refPath: rootRef ? [] : ['dataset'],
          artifactKind: 'dataset/exact-bound',
          maxRows: 1000,
          maxBytes: 1048576,
        },
      },
    ],
    async execute(_args, context) {
      executions++;
      const meta = await context.artifacts.put({
        kind: 'dataset/exact-bound',
        mediaType: 'application/json',
        data: rows,
        digest: 'sha-256',
      });
      return rootRef ? meta.ref : { dataset: meta.ref };
    },
  });
  const agent = Agent.create({
    model: 'mock',
    artifacts: store,
    checkColumnTypes: 'enforce',
    integrityPosture: 'dev',
    provider: mock({
      replies: [{ toolCalls: [{ id: 'source', name: 'source', args: {} }] }, 'Observed.'],
    }),
  })
    .tool(tool)
    .build();
  agent.on('*', (event) => events.push(event));
  await agent.run({
    message: 'Read exact-bound fixture.',
    identity: { principal: 'owner', conversationId: 'published-bounds' },
  });
  return {
    reads,
    executions,
    checks: events
      .filter((event) => event.type === 'agentfootprint.tools.rowset_checked')
      .map((event) => event.payload),
    findings: events.filter((event) => event.type === 'agentfootprint.integrity.context_error'),
  };
}

describe('legal published boundaries use the actual complete materialized dataset', () => {
  it('accepts an explicit root reference string without guessing a wrapper or historical ref', async () => {
    const result = await inspect([{ amount: 0 }], true);
    expect(result).toMatchObject({ reads: 1, executions: 1, findings: [] });
    expect(result.checks).toMatchObject([{ reason: 'rows', disposition: 'checked-pass' }]);
  });

  it('checks exactly1000 actual published rows', async () => {
    const result = await inspect(Array.from({ length: 1000 }, () => ({ amount: 0 })));
    expect(result).toMatchObject({ reads: 1, executions: 1, findings: [] });
    expect(result.checks).toMatchObject([{ reason: 'rows', disposition: 'checked-pass' }]);
  });

  it('accepts exactly1MiB without widening the declared byte limit', async () => {
    const base = new TextEncoder().encode(JSON.stringify([{ amount: 0, padding: '' }])).length;
    const rows = [{ amount: 0, padding: 'x'.repeat(1048576 - base) }];
    expect(new TextEncoder().encode(JSON.stringify(rows)).length).toBe(1048576);
    const result = await inspect(rows);
    expect(result).toMatchObject({ reads: 1, executions: 1, findings: [] });
    expect(result.checks).toMatchObject([{ reason: 'rows', disposition: 'checked-pass' }]);
  });
});
