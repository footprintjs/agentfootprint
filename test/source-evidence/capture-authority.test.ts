import { describe, expect, it } from 'vitest';
import { Agent, defineTool, inMemoryArtifacts, withSourceEvidence } from '../../src/index.js';
import { mock } from '../../src/providers.js';
import type {
  SourceEvidenceDataset,
  SourceEvidenceDatasetDeclaration,
} from '../../src/artifacts/sourceEvidence/types.js';

interface Parcel {
  subject: string;
  datasetRef: string;
  otherRef: string;
}
const identity = { principal: 'native-capture-owner', conversationId: 'native-capture-ceiling' };
const declaration: SourceEvidenceDatasetDeclaration = {
  key: 'applications',
  refPath: ['datasetRef'],
  kind: 'dataset/rows',
  fields: { application: ['application'] },
  maxBytes: 4096,
  maxRows: 5,
};

async function capture(
  settings: {
    static?: Partial<SourceEvidenceDatasetDeclaration>;
    returned?: (parcel: Parcel) => Partial<SourceEvidenceDataset>;
    omitFields?: boolean;
  } = {},
) {
  const store = inMemoryArtifacts();
  const seen: unknown[] = [];
  const tool = withSourceEvidence(
    defineTool<Record<string, never>, Parcel>({
      name: 'read_inventory',
      description: 'Read native source fixture',
      inputSchema: { type: 'object' },
      async execute(_args, context) {
        const data = [
          { application: 'app-01', secret: 'PRIVATE-CELL-01' },
          { application: 'app-02', secret: 'PRIVATE-CELL-02' },
        ];
        const first = await context.artifacts.put({
          kind: 'dataset/rows',
          mediaType: 'application/json',
          data,
          digest: 'sha-256',
        });
        const other = await context.artifacts.put({
          kind: 'dataset/rows',
          mediaType: 'application/json',
          data,
          digest: 'sha-256',
        });
        return { subject: 'array-01', datasetRef: first.ref, otherRef: other.ref };
      },
    }),
    {
      datasets: [{ ...declaration, ...settings.static }],
      describe(served, sources) {
        seen.push(sources);
        const dataset: SourceEvidenceDataset = {
          key: 'applications',
          ref: served.datasetRef,
          kind: 'dataset/rows',
          fields: { application: ['application'] },
          ...settings.returned?.(served),
        };
        if (settings.omitFields) delete (dataset as { fields?: unknown }).fields;
        return [
          {
            subject: { kind: 'array', value: served.subject },
            operation: 'inventory',
            scope: {},
            datasets: [dataset],
          },
        ];
      },
    },
  );
  const agent = Agent.create({
    model: 'mock',
    artifacts: store,
    provider: mock({
      replies: [{ toolCalls: [{ id: 'native-source', name: 'read_inventory', args: {} }] }, 'done'],
    }),
  })
    .tool(tool)
    .sourceEvidence({ admit: (candidate) => candidate })
    .build();
  try {
    await agent.run({ message: 'Read source fixture.', identity });
    return { refs: [...(agent.checkpoint()?.sourceEvidence?.refs ?? [])], seen, store };
  } finally {
    await agent.shutdown();
  }
}

describe('native capture dataset authorization ceiling', () => {
  it('retains a dataset only after the static bounded publication and its permitted fields succeeded', async () => {
    const result = await capture();
    expect(result.refs).toHaveLength(1);
    expect(result.seen).toHaveLength(1);
    expect(JSON.stringify(result.seen)).not.toContain('PRIVATE-CELL');
    const receipt = await result.store.get(identity, result.refs[0]);
    expect(receipt?.data).toMatchObject({
      datasets: [{ key: 'applications', fields: { application: ['application'] } }],
    });
  });

  it.each([
    [
      'an extra raw field',
      () => ({ fields: { application: ['application'], secret: ['secret'] } }),
    ],
    ['a different raw path', () => ({ fields: { application: ['secret'] } })],
    ['an undeclared dataset key', () => ({ key: 'other' })],
    ['a different call-minted visible reference', (served: Parcel) => ({ ref: served.otherRef })],
  ] as const)('refuses %s returned by describe', async (_label, returned) => {
    const result = await capture({ returned });
    expect(result.refs).toEqual([]);
  });

  it('refuses removed field restrictions instead of promoting the whole stored row', async () => {
    const result = await capture({ omitFields: true });
    expect(result.refs).toEqual([]);
  });

  it.each([
    ['row bound', { maxRows: 1 }],
    ['byte bound', { maxBytes: 16 }],
  ] as const)('cannot retain a dataset after its static %s failed', async (_label, restriction) => {
    const result = await capture({ static: restriction });
    expect(result.refs).toEqual([]);
    expect(result.seen).toEqual([{}]);
  });
});
