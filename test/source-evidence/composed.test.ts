import { describe, expect, it } from 'vitest';
import { flowChart } from 'footprintjs';
import {
  Agent,
  defineTool,
  inMemoryArtifacts,
  isSaidByPerson,
  runbookAsTool,
  withSourceEvidence,
} from '../../src/index.js';
import { mock } from '../../src/providers.js';

describe('read-only retained evidence inside a native runbook', () => {
  it('uses current native find/read ports while inner tools still cannot mint artifacts', async () => {
    let sourceCalls = 0,
      admitted = 0,
      observed: unknown,
      innerChecked = false;
    const rows = [{ application: 'billing' }, { application: 'reporting' }];
    const source = withSourceEvidence(
      defineTool({
        name: 'source',
        description: 'Read fixture.',
        execute: async (_args, ctx) => {
          sourceCalls++;
          const meta = await ctx.artifacts.put({
            kind: 'dataset/apps',
            mediaType: 'application/json',
            data: rows,
            digest: 'sha-256',
          });
          return { array: 'fixture-array', ref: meta.ref };
        },
      }),
      {
        datasets: [
          {
            key: 'apps',
            refPath: ['ref'],
            kind: 'dataset/apps',
            fields: { application: ['application'] },
          },
        ],
        describe: (served, sources) => [
          {
            subject: { kind: 'array', value: served.array },
            operation: 'applications',
            scope: {},
            datasets: [
              {
                key: 'apps',
                ref: sources.apps.ref,
                kind: 'dataset/apps',
                fields: { application: ['application'] },
              },
            ],
          },
        ],
      },
    );
    const checkInner = defineTool({
      name: 'check_inner',
      description: 'Check inner artifact boundary.',
      execute: async (_args, ctx) => {
        expect(ctx.hasArtifacts).toBe(false);
        await expect(
          ctx.artifacts.put({ kind: 'forbidden', mediaType: 'application/json', data: {} }),
        ).rejects.toThrow();
        innerChecked = true;
        return { checked: true };
      },
    });
    const book = runbookAsTool({
      name: 'inspect_retained',
      description: 'Inspect an exact historical fixture through a native chart.',
      composedOf: ['check_inner', 'find_source_evidence', 'read_source_evidence'],
      resultKind: 'inspection/historical',
      procedure: (tools) => {
        let ref = '';
        const signal = new AbortController().signal;
        return flowChart<{ report?: Record<string, unknown> }>(
          'retained-evidence-procedure',
          async () => {
            await tools.call('check_inner', {});
          },
          'check-inner-boundary',
        )
          .addFunction(
            'Find exact retained subject',
            async () => {
              const found = (await tools.call(
                'find_source_evidence',
                {
                  subject: { kind: 'array', value: 'fixture-array' },
                  operation: 'applications',
                  scope: {},
                },
                { signal },
              )) as { candidates: { ref: string }[] };
              ref = found.candidates[0].ref;
            },
            'find-retained',
          )
          .addFunction(
            'Read permitted historical rows',
            async (scope) => {
              observed = await tools.call(
                'read_source_evidence',
                { ref, dataset: 'apps' },
                { signal },
              );
              scope.report = { retained: observed };
            },
            'read-retained',
          )
          .build();
      },
    });
    const provider = mock({
      respond: (request) => {
        if (request.messages.at(-1)?.role === 'tool') return 'Historical fixture inspected.';
        const question = request.messages.filter(isSaidByPerson).at(-1)?.content;
        return {
          toolCalls: [
            {
              id: 'outer',
              name: question === 'Collect.' ? 'source' : 'inspect_retained',
              args: {},
            },
          ],
        };
      },
    });
    const agent = Agent.create({ provider, model: 'mock', artifacts: inMemoryArtifacts() })
      .tools([source, checkInner, book])
      .sourceEvidence({
        admit: (candidate, ctx) => {
          admitted++;
          expect(ctx.hasArtifacts).toBe(false);
          expect(ctx.signal).toBeDefined();
          expect(ctx.identity?.principal).toBe('reader');
          return candidate;
        },
      })
      .build();
    const identity = { principal: 'reader', conversationId: 'composed-source' };
    await agent.run({ message: 'Collect.', identity });
    await agent.run({ message: 'Read older.', identity, continueFrom: agent.checkpoint()! });
    expect(sourceCalls).toBe(1);
    expect(innerChecked).toBe(true);
    expect(admitted).toBe(2);
    expect(observed).toMatchObject({
      historical: true,
      receipt: { subject: { kind: 'array', value: 'fixture-array' } },
      detail: { mode: 'value', path: '', value: rows, complete: true },
    });
  });
});
