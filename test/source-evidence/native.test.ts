import { describe, expect, it } from 'vitest';
import {
  Agent,
  defineTool,
  inMemoryArtifacts,
  withSourceEvidence,
  isSaidByPerson,
  slidingWindow,
} from '../../src/index.js';
import { mock } from '../../src/providers.js';

describe('retained source evidence', () => {
  const source = () =>
    defineTool({
      name: 'read_inventory',
      description: 'Read an exact authored fixture array.',
      inputSchema: { type: 'object', properties: {} },
      execute: async () => ({ array: '000000000001', applications: 2 }),
    });
  const declared = () =>
    withSourceEvidence(source(), {
      describe: (served: { array: string; applications: number }) => [
        {
          subject: { kind: 'array', value: served.array },
          operation: 'applications',
          scope: {},
          scalars: { applications: served.applications },
        },
      ],
    });

  it('declares capture without wrapping or executing the producer', () => {
    const tool = source();
    let described = 0;
    const marked = withSourceEvidence(tool, {
      describe: () => {
        described++;
        return [];
      },
    });
    expect(marked.execute).toBe(tool.execute);
    expect(described).toBe(0);
  });

  it('keeps the unmounted wire, artifact events and checkpoint shape identical to an ordinary tool', async () => {
    let described = 0;
    const inspect = async (annotated: boolean) => {
      const requests: unknown[] = [],
        artifacts: string[] = [];
      const provider = mock({
        respond: (request) => {
          requests.push(
            JSON.parse(JSON.stringify({ messages: request.messages, tools: request.tools })),
          );
          return request.messages.at(-1)?.role === 'tool'
            ? 'Done.'
            : { toolCalls: [{ id: 'source', name: 'read_inventory', args: {} }] };
        },
      });
      const original = source();
      const tool = annotated
        ? withSourceEvidence(original, {
            describe: () => {
              described++;
              return [];
            },
          })
        : original;
      const agent = Agent.create({ provider, model: 'mock', artifacts: inMemoryArtifacts() })
        .tool(tool)
        .build();
      agent.on('agentfootprint.artifacts.*', (event) => artifacts.push(event.type));
      const result = await agent.run({
        message: 'Read.',
        identity: { conversationId: 'unmounted-parity' },
      });
      return { requests, artifacts, result, keys: Object.keys(agent.checkpoint()!).sort() };
    };
    expect(await inspect(true)).toEqual(await inspect(false));
    expect(described).toBe(0);
  });

  it('refuses a continuity mount without its native artifact store', () => {
    expect(() =>
      Agent.create({ provider: mock({ reply: 'Done.' }), model: 'mock' })
        .tool(declared())
        .sourceEvidence({ admit: (candidate) => candidate })
        .build(),
    ).toThrow(/artifact/i);
  });

  it('captures an executed source and exposes bounded find/read tools only on opt-in', async () => {
    const results: string[] = [];
    const provider = mock({
      respond: (request) => {
        const last = request.messages.at(-1);
        if (last?.role === 'tool') {
          results.push(last.content);
          return 'Read complete.';
        }
        return { toolCalls: [{ id: 'read', name: 'read_inventory', args: {} }] };
      },
    });
    const agent = Agent.create({ provider, model: 'mock', artifacts: inMemoryArtifacts() })
      .tool(declared())
      .sourceEvidence({ admit: (candidate) => candidate })
      .build();
    await agent.run({ message: 'Read the fixture.', identity: { conversationId: 'continuity' } });
    const checkpoint = agent.checkpoint();
    expect(checkpoint?.sourceEvidence?.refs).toHaveLength(1);
    expect(JSON.stringify(checkpoint?.sourceEvidence)).not.toContain('000000000001');
    expect(results).toHaveLength(1);
  });

  it('finds and reads the native admitted observation without dispatching its source again', async () => {
    const served: Record<string, unknown>[] = [];
    let sourceCalls = 0,
      ref = '';
    const original = source();
    const tool = withSourceEvidence(
      {
        ...original,
        execute: async () => {
          sourceCalls++;
          return original.execute({} as never, {} as never);
        },
      },
      {
        describe: (value) => [
          {
            subject: { kind: 'array', value: value.array },
            operation: 'applications',
            scope: {},
            scalars: { applications: value.applications },
          },
        ],
      },
    );
    const provider = mock({
      respond: (request) => {
        const last = request.messages.at(-1);
        if (last?.role === 'tool') {
          const data = JSON.parse(last.content);
          served.push(data);
          if (last.toolName === 'find_source_evidence') ref = data.candidates?.[0]?.ref ?? '';
          return 'Retained inventory inspected.';
        }
        const question = request.messages.filter(isSaidByPerson).at(-1)?.content;
        const name =
          question === 'Find retained.'
            ? 'find_source_evidence'
            : question === 'Read retained.'
            ? 'read_source_evidence'
            : 'read_inventory';
        const args =
          name === 'find_source_evidence'
            ? {
                subject: { kind: 'array', value: '000000000001' },
                operation: 'applications',
                scope: {},
              }
            : name === 'read_source_evidence'
            ? { ref }
            : {};
        return { toolCalls: [{ id: name, name, args }] };
      },
    });
    const agent = Agent.create({ provider, model: 'mock', artifacts: inMemoryArtifacts() })
      .tool(tool)
      .sourceEvidence({ admit: (candidate) => candidate })
      .build();
    const identity = { conversationId: 'reader' };
    await agent.run({ message: 'Read fixture.', identity });
    await agent.run({ message: 'Find retained.', continueFrom: agent.checkpoint()!, identity });
    expect(ref).toMatch(/^art_/);
    await agent.run({ message: 'Read retained.', continueFrom: agent.checkpoint()!, identity });
    expect(sourceCalls).toBe(1);
    expect(served.at(-1)).toMatchObject({
      historical: true,
      receipt: {
        ref,
        subject: { kind: 'array', value: '000000000001' },
        operation: 'applications',
        scope: {},
        scalars: { applications: 2 },
        recordedAt: expect.any(Number),
      },
    });
  });

  it('finds the exact stored subject on a fresh Agent after its source message left the model window', async () => {
    const store = inMemoryArtifacts();
    let calls = 0,
      ref = '',
      actualRead: unknown;
    const build = () => {
      const tool = withSourceEvidence(
        {
          ...source(),
          execute: async () => {
            calls++;
            return { array: '000000000001', applications: 2 };
          },
        },
        {
          describe: (value) => [
            {
              subject: { kind: 'array', value: value.array },
              operation: 'applications',
              scope: {},
              scalars: { applications: value.applications },
            },
          ],
        },
      );
      const provider = mock({
        respond: (request) => {
          const last = request.messages.at(-1);
          if (last?.role === 'tool') {
            const data = JSON.parse(last.content);
            if (last.toolName === 'find_source_evidence') ref = data.candidates?.[0]?.ref ?? '';
            if (last.toolName === 'read_source_evidence') actualRead = data;
            return 'Done.';
          }
          const question = request.messages.filter(isSaidByPerson).at(-1)?.content;
          if (question?.startsWith('Noise')) return 'A later unrelated turn.';
          if (question === 'Find retained.') {
            expect(
              request.messages.some(
                (message) => message.role === 'tool' && message.toolName === 'read_inventory',
              ),
            ).toBe(false);
            return {
              toolCalls: [
                {
                  id: 'find',
                  name: 'find_source_evidence',
                  args: { subject: { kind: 'array', value: '000000000001' } },
                },
              ],
            };
          }
          return {
            toolCalls: [
              {
                id: 'call',
                name: question === 'Read retained.' ? 'read_source_evidence' : 'read_inventory',
                args: question === 'Read retained.' ? { ref } : {},
              },
            ],
          };
        },
      });
      return Agent.create({ provider, model: 'mock', artifacts: store })
        .tool(tool)
        .sourceEvidence({ admit: (candidate) => candidate })
        .window(slidingWindow({ keepRecentTurns: 1 }))
        .build();
    };
    const identity = { conversationId: 'trimmed-continuation' };
    let agent = build();
    await agent.run({ message: 'Collect.', identity });
    for (const message of ['Noise one.', 'Noise two.', 'Find retained.', 'Read retained.']) {
      const checkpoint = JSON.parse(JSON.stringify(agent.checkpoint()));
      agent = build();
      await agent.run({ message, identity, continueFrom: checkpoint });
    }
    expect(ref).toMatch(/^art_/);
    expect(calls).toBe(1);
    expect(actualRead).toMatchObject({
      historical: true,
      receipt: {
        ref,
        subject: { kind: 'array', value: '000000000001' },
        scalars: { applications: 2 },
      },
    });
  });
});
