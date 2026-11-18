import { describe, expect, it } from 'vitest';
import {
  Agent,
  allow,
  deny,
  coverage,
  defineTool,
  inMemoryArtifacts,
  withSourceEvidence,
  pauseHere,
  isPaused,
  isSaidByPerson,
} from '../../src/index.js';
import { mock } from '../../src/providers.js';
import type { SourceEvidenceDescriptor } from '../../src/tools/sourceEvidence.js';

const identity = { conversationId: 'capture-boundary' };
const declaration = (value: string) => [
  { subject: { kind: 'array', value }, operation: 'inventory', scope: {} },
];
function fixture(
  value: unknown,
  describe: SourceEvidenceDescriptor['describe'],
  maxToolResultChars?: number,
) {
  const results: string[] = [];
  const readRef = { value: '' };
  const provider = mock({
    respond: (request) => {
      const last = request.messages.at(-1);
      if (last?.role === 'tool') {
        results.push(last.content);
        return 'Done.';
      }
      if (request.messages.filter(isSaidByPerson).at(-1)?.content === 'Read retained.')
        return {
          toolCalls: [
            { id: 'retained', name: 'read_source_evidence', args: { ref: readRef.value } },
          ],
        };
      return { toolCalls: [{ id: 'source', name: 'source', args: {} }] };
    },
  });
  const tool = withSourceEvidence(
    defineTool({ name: 'source', description: 'Read fixture.', execute: async () => value }),
    { describe },
  );
  const builder = Agent.create({
    provider,
    model: 'mock',
    artifacts: inMemoryArtifacts(),
    ...(maxToolResultChars !== undefined && { maxToolResultChars }),
  }).tool(tool);
  return { builder, results, readRef };
}

describe('native final-delivery source capture', () => {
  it('uses only the governed model projection, never the producer raw result', async () => {
    let observed: unknown;
    const { builder, results } = fixture(
      { array: 'private-original', secret: 'do-not-retain' },
      (served) => {
        observed = served;
        return declaration((served as { array: string }).array);
      },
    );
    const agent = builder
      .sourceEvidence({ admit: (candidate) => candidate })
      .toolMiddleware({
        name: 'project',
        onToolResult: () => allow({ array: 'permitted-array' }, 'Permit public projection.'),
      })
      .build();
    await agent.run({ message: 'Read.', identity });
    expect(observed).toEqual({ array: 'permitted-array' });
    expect(Object.isFrozen(observed)).toBe(true);
    expect(results[0]).not.toContain('do-not-retain');
    expect(agent.checkpoint()?.sourceEvidence?.refs).toHaveLength(1);
  });

  it.each(['denied', 'capped', 'pending', 'failed'] as const)(
    'does not retain a %s result as accepted evidence',
    async (mode) => {
      let described = 0;
      const result =
        mode === 'pending' || mode === 'failed'
          ? {
              content: { array: 'fixture-array' },
              effects: [],
              status: mode === 'pending' ? 'pending' : 'failure',
            }
          : { array: 'fixture-array', padding: 'x'.repeat(2000) };
      const { builder } = fixture(
        result,
        () => {
          described++;
          return declaration('fixture-array');
        },
        mode === 'capped' ? 100 : undefined,
      );
      if (mode === 'denied')
        builder.toolMiddleware({
          name: 'deny',
          onToolResult: () => deny('fixture-array is unavailable.'),
        });
      const agent = builder.sourceEvidence({ admit: (candidate) => candidate }).build();
      await agent.run({ message: 'Read.', identity });
      expect(agent.checkpoint()?.sourceEvidence?.refs).toEqual([]);
      expect(described).toBe(0);
    },
  );

  it('keeps partial status and only model-facing governed coverage on a later receipt', async () => {
    const result = {
      content: coverage(
        { array: 'fixture-array' },
        {
          checked: [{ what: 'permitted rows', short: 'rows' }],
          notChecked: [{ what: 'other arrays', short: 'others', kind: 'scope' }],
          cannotCover: [],
        },
      ),
      effects: [],
      status: 'partial',
    };
    const { builder, results, readRef } = fixture(result, () => declaration('fixture-array'));
    const agent = builder.sourceEvidence({ admit: (candidate) => candidate }).build();
    await agent.run({ message: 'Read.', identity });
    const ref = agent.checkpoint()?.sourceEvidence?.refs[0];
    expect(ref).toMatch(/^art_/);
    readRef.value = ref!;
    await agent.run({ message: 'Read retained.', identity, continueFrom: agent.checkpoint()! });
    const receipt = JSON.parse(results.at(-1)!).receipt;
    expect(receipt.status).toBe('partial');
    expect(receipt.coverage.checked).toEqual([{ what: 'permitted rows' }]);
    expect(receipt.coverage.notChecked).toEqual([{ what: 'other arrays' }]);
    expect(JSON.stringify(receipt)).not.toContain('short');
    expect(receipt.coverage.notChecked[0]).not.toHaveProperty('kind');
  });

  it('does not resurrect coverage removed by a final governed replacement', async () => {
    let observed: unknown;
    const { builder, results, readRef } = fixture(
      coverage(
        { array: 'fixture-array' },
        { checked: ['private-source'], notChecked: [], cannotCover: [] },
      ),
      (served) => {
        observed = served;
        return declaration('fixture-array');
      },
    );
    const agent = builder
      .sourceEvidence({ admit: (candidate) => candidate })
      .toolMiddleware({
        name: 'omit-metadata',
        onToolResult: (call) =>
          call.toolName === 'source'
            ? allow({ array: 'fixture-array' }, 'Permit data without coverage metadata.')
            : allow(),
      })
      .build();
    await agent.run({ message: 'Read.', identity });
    expect(observed).toEqual({ array: 'fixture-array' });
    expect(agent.checkpoint()?.sourceEvidence?.refs).toHaveLength(1);
    readRef.value = agent.checkpoint()!.sourceEvidence!.refs[0];
    await agent.run({ message: 'Read retained.', identity, continueFrom: agent.checkpoint()! });
    expect(JSON.parse(results.at(-1)!).receipt).not.toHaveProperty('coverage');
  });

  it('abandons a hung producer mapper at the deadline and cannot append after it resolves', async () => {
    let release!: (value: ReturnType<typeof declaration>) => void;
    const mapping = new Promise<ReturnType<typeof declaration>>((resolve) => {
      release = resolve;
    });
    const { builder } = fixture({ array: 'fixture-array' }, () => mapping);
    const agent = builder
      .sourceEvidence({ admit: (candidate) => candidate, limits: { timeoutMs: 10 } })
      .build();
    await agent.run({ message: 'Read.', identity });
    expect(agent.checkpoint()?.sourceEvidence?.refs).toEqual([]);
    release(declaration('fixture-array'));
    await Promise.resolve();
    await Promise.resolve();
    expect(agent.checkpoint()?.sourceEvidence?.refs).toEqual([]);
  });

  it('keeps direct execution and an unmounted Agent outside native receipt authority', async () => {
    let described = 0;
    const tool = withSourceEvidence(
      defineTool({
        name: 'source',
        description: 'Read.',
        execute: async () => ({ array: 'fixture-array' }),
      }),
      {
        describe: () => {
          described++;
          return declaration('fixture-array');
        },
      },
    );
    await tool.execute({}, {} as never);
    const agent = Agent.create({
      provider: mock({
        replies: [{ toolCalls: [{ id: 'a', name: 'source', args: {} }] }, 'Done.'],
      }),
      model: 'mock',
      artifacts: inMemoryArtifacts(),
    })
      .tool(tool)
      .build();
    await agent.run({ message: 'Read.', identity });
    expect(described).toBe(0);
    expect(agent.checkpoint()).not.toHaveProperty('sourceEvidence');
  });

  it('does not treat a human-supplied pause answer as an executed native source', async () => {
    let described = 0;
    const tool = withSourceEvidence(
      defineTool({
        name: 'source',
        description: 'Ask.',
        execute: () => {
          pauseHere({ question: 'What is the source?' });
          return { array: 'fixture-array' };
        },
      }),
      {
        describe: () => {
          described++;
          return declaration('fixture-array');
        },
      },
    );
    const agent = Agent.create({
      provider: mock({
        replies: [{ toolCalls: [{ id: 'a', name: 'source', args: {} }] }, 'Done.'],
      }),
      model: 'mock',
      artifacts: inMemoryArtifacts(),
    })
      .tool(tool)
      .sourceEvidence({ admit: (candidate) => candidate })
      .build();
    const paused = await agent.run({ message: 'Read.', identity });
    if (!isPaused(paused)) return expect.fail('Expected native pause.');
    await agent.resume(paused.checkpoint, { array: 'fixture-array' });
    expect(described).toBe(0);
    expect(agent.checkpoint()?.sourceEvidence?.refs).toEqual([]);
  });
});
