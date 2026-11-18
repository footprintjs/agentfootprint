import { describe, expect, it } from 'vitest';
import {
  Agent,
  defineTool,
  inMemoryArtifacts,
  withSourceEvidence,
  isSaidByPerson,
} from '../../src/index.js';
import { mock } from '../../src/providers.js';

const declaration = {
  key: 'applications',
  refPath: ['ref'],
  kind: 'dataset/applications',
  fields: { array: ['array'], app: ['app'] },
  maxRows: 250,
  maxBytes: 65536,
} as const;

describe('native source dataset association', () => {
  it.each([
    { ...declaration, maxRows: 1001 },
    { ...declaration, maxBytes: 1048577 },
    { ...declaration, refPath: [3] },
    { ...declaration, fields: { app: [3] } },
  ])('refuses invalid static capture metadata at definition time %#', (dataset) => {
    const tool = defineTool({
      name: 'read_fixture',
      description: 'Read fixture.',
      execute: async () => ({ ref: '' }),
    });
    expect(() =>
      withSourceEvidence(tool, { datasets: [dataset] as never, describe: () => [] }),
    ).toThrow(TypeError);
  });

  it('retains an exact 250-row native publication and pages values without another source call', async () => {
    const rows = Array.from({ length: 250 }, (_, i) => ({
      array: '000000000001',
      app: `app-${i}`,
      private: 'never-retained',
    }));
    let sourceCalls = 0,
      receipt = '',
      datasetRef = '';
    const messages: { name?: string; data: Record<string, any> }[] = [];
    const tool = withSourceEvidence(
      defineTool({
        name: 'read_fixture',
        description: 'Read fixture.',
        execute: async (_args, ctx) => {
          sourceCalls++;
          const meta = await ctx.artifacts.put({
            kind: declaration.kind,
            mediaType: 'application/json',
            data: rows,
            digest: 'sha-256',
          });
          datasetRef = meta.ref;
          return { ref: meta.ref };
        },
      }),
      {
        datasets: [declaration],
        describe: (_served, sources) => {
          expect(Object.isFrozen(sources.applications.rows)).toBe(true);
          expect(sources.applications.rows).toHaveLength(250);
          expect(JSON.stringify(sources)).not.toContain('never-retained');
          return [
            {
              subject: { kind: 'array', value: String(sources.applications.rows[0].array) },
              operation: 'applications',
              scope: {},
              datasets: [
                {
                  key: declaration.key,
                  ref: sources.applications.ref,
                  kind: declaration.kind,
                  fields: { array: ['array'], app: ['app'] },
                },
              ],
            },
          ];
        },
      },
    );
    const provider = mock({
      respond: (request) => {
        const last = request.messages.at(-1);
        if (last?.role === 'tool') {
          const data = JSON.parse(last.content);
          messages.push({ name: last.toolName, data });
          if (last.toolName === 'find_source_evidence') receipt = data.candidates?.[0]?.ref ?? '';
          return 'Inspected.';
        }
        const question = request.messages.filter(isSaidByPerson).at(-1)?.content;
        const name =
          question === 'Find.'
            ? 'find_source_evidence'
            : question?.startsWith('Page')
            ? 'read_source_evidence'
            : 'read_fixture';
        const args =
          name === 'find_source_evidence'
            ? { subject: { kind: 'array', value: '000000000001' } }
            : name === 'read_source_evidence'
            ? {
                ref: receipt,
                dataset: 'applications',
                offset: question === 'Page last.' ? 240 : 0,
                limit: 20,
              }
            : {};
        return { toolCalls: [{ id: name, name, args }] };
      },
    });
    const agent = Agent.create({ provider, model: 'mock', artifacts: inMemoryArtifacts() })
      .tool({ ...tool, execute: (...args) => tool.execute(...args) })
      .sourceEvidence({ admit: (candidate) => candidate })
      .build();
    const identity = { conversationId: 'dataset-250' };
    await agent.run({ message: 'Collect.', identity });
    expect(agent.checkpoint()?.sourceEvidence?.refs).toHaveLength(1);
    await agent.run({ message: 'Find.', identity, continueFrom: agent.checkpoint()! });
    expect(receipt).toMatch(/^art_/);
    await agent.run({ message: 'Page first.', identity, continueFrom: agent.checkpoint()! });
    expect(messages.at(-1)?.data).toMatchObject({
      historical: true,
      dataset: { ref: datasetRef, key: 'applications' },
      detail: {
        mode: 'value',
        path: '',
        offset: 0,
        total: 250,
        shown: 20,
        complete: false,
        nextOffset: 20,
        value: rows.slice(0, 20).map(({ array, app }) => ({ array, app })),
      },
    });
    await agent.run({ message: 'Page last.', identity, continueFrom: agent.checkpoint()! });
    expect(messages.at(-1)?.data.detail).toMatchObject({
      mode: 'value',
      offset: 240,
      total: 250,
      shown: 10,
      complete: false,
      value: rows.slice(240).map(({ array, app }) => ({ array, app })),
    });
    expect(messages.at(-1)?.data.detail).not.toHaveProperty('nextOffset');
    expect(
      JSON.stringify(messages.filter((message) => message.name === 'read_source_evidence')),
    ).not.toContain('never-retained');
    expect(sourceCalls).toBe(1);
  });
});
