import { describe, expect, it } from 'vitest';
import { Agent, defineTool, inMemoryArtifacts, placedResultKind } from '../../src/index.js';
import { mock } from '../../src/llm-providers.js';

const payload = 'large private report'.repeat(100);
const kind = placedResultKind('report');

describe('what a later tool actually read from a placed result', () => {
  it.each([
    ['head', true],
    ['wrong-ref', true],
    ['wrong-kind', true],
    ['partial-wants', true],
    ['credential-refused', true],
    ['late-get', true],
    ['in-flight-get', true],
    ['get', false],
    ['wants', false],
  ] as const)('%s leaves an unread warning: %s', async (mode, unread) => {
    let consumed: unknown;
    let placedRef = '';
    let iteration = 0;
    let lateRead: (() => Promise<unknown>) | undefined;
    let laterResult: unknown;
    let releaseGet: (() => void) | undefined;
    const backing = inMemoryArtifacts();
    const store = {
      ...backing,
      get: async (...args: Parameters<typeof backing.get>) => {
        if (mode === 'in-flight-get')
          await new Promise<void>((resolve) => {
            releaseGet = resolve;
          });
        return backing.get(...args);
      },
    };
    const provider = mock({
      respond: (req) => {
        iteration++;
        if (iteration === 1) return { toolCalls: [{ id: 'p', name: 'report', args: {} }] };
        if (iteration === 2) {
          const result = req.messages.find((m) => m.role === 'tool' && m.toolCallId === 'p');
          placedRef = JSON.parse(result!.content as string).ref;
          return {
            toolCalls: [
              {
                id: 'c',
                name: 'consume',
                args: {
                  input: placedRef,
                  ...(mode === 'partial-wants' && { other: 'art_missing' }),
                },
              },
            ],
          };
        }
        if (iteration === 3 && (mode === 'late-get' || mode === 'in-flight-get')) {
          return { toolCalls: [{ id: 'l', name: 'later', args: {} }] };
        }
        return 'done';
      },
    });
    const consumer = defineTool<{ input: string; other?: string }, string>({
      name: 'consume',
      description: 'read the report',
      inputSchema: {
        type: 'object',
        properties: {
          input: { type: 'string' },
          ...(mode === 'partial-wants' && { other: { type: 'string' } }),
        },
        required: ['input'],
      },
      ...((mode === 'wants' || mode === 'wrong-kind' || mode === 'credential-refused') && {
        wants: { input: mode === 'wrong-kind' ? 'dataset/unrelated' : kind },
      }),
      ...(mode === 'partial-wants' && { wants: { input: kind, other: kind } }),
      ...(mode === 'credential-refused' && { needs: { credential: 'fixture' } }),
      execute: async ({ input }, ctx) => {
        if (mode === 'head') await ctx.artifacts.head(input);
        if (mode === 'wrong-ref') await ctx.artifacts.get('art_other');
        if (mode === 'get') consumed = (await ctx.artifacts.get(input))?.data;
        if (mode === 'wants' || mode === 'credential-refused' || mode === 'partial-wants')
          consumed = input;
        if (mode === 'late-get') lateRead = async () => (await ctx.artifacts.get(input))?.data;
        if (mode === 'in-flight-get') {
          const pending = ctx.artifacts.get(input);
          lateRead = async () => (await pending)?.data;
        }
        return 'finished';
      },
    });
    const agent = Agent.create({
      provider,
      model: 'mock',
      ...(mode === 'credential-refused' && {
        credentials: {
          id: 'refuse',
          getCredential: async () => {
            throw new Error('refused');
          },
        },
      }),
      artifacts: { store, placement: { maxInlineChars: 1000 } },
    })
      .tool(defineTool({ name: 'report', description: 'get report', execute: () => payload }))
      .tool(consumer)
      .tool(
        defineTool({
          name: 'later',
          description: 'try the retained binding',
          execute: async () => {
            releaseGet?.();
            laterResult = await lateRead?.();
            return 'finished';
          },
        }),
      )
      .build();
    await agent.run({ message: 'Get and inspect the report.' });
    expect(placedRef).toMatch(/^art_/);
    const limits = agent.getSnapshot()?.sharedState.libraryResultLimits;
    expect(limits).toEqual(
      unread
        ? [
            expect.objectContaining({
              kind: 'placed-unread',
              toolCallId: 'p',
              toolName: 'report',
              ref: placedRef,
            }),
          ]
        : [],
    );
    expect(consumed).toBe(unread ? undefined : payload);
    if (mode === 'late-get' || mode === 'in-flight-get') expect(laterResult).toBe(payload);
  });
});
