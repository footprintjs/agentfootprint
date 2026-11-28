import { describe, expect, it, vi } from 'vitest';
import {
  Agent,
  allow,
  ask,
  checkInApproved,
  defineTool,
  inMemoryArtifacts,
  isPaused,
  sealToolEffectContent,
} from '../../../src/index.js';
import * as outerCall from '../../../src/core/agent/innerCallOuter.js';
import { bearer } from '../../../src/identity.js';
import { defineInstruction } from '../../../src/injection-engine.js';
import { mock } from '../../../src/providers.js';
import { pausedRequest } from '../../helpers/pausedRequest.js';

type Door = 'batch' | 'ask' | 'check-in' | 'credential';
type Case =
  | 'capture'
  | 'allow'
  | 'refuse'
  | 'ceiling'
  | 'columns'
  | 'unhooked-ceiling'
  | 'over-budget';
const DATASET_KIND = 'dataset/effect-handoff-fixture';

async function inspect(door: Door, scenario: Case) {
  const ceiling = scenario === 'ceiling' || scenario === 'unhooked-ceiling';
  const earlyRefusal = ceiling || scenario === 'columns';
  let credentialReady = false;
  let entered = 0;
  const history: string[] = [];
  const ownerEvents: unknown[] = [];
  const rowChecks: unknown[] = [];
  const order: string[] = [];
  const selectedIds: string[] = [];
  const proposal = {
    kind: 'require-instruction' as const,
    instructionId: 'fixture-note',
    deliveryLease: 'next-call' as const,
  };
  const finishCleanup = () => {
    proposal.instructionId = 'after-cleanup';
    order.push('cleanup');
  };
  const nativeBinding = outerCall.bindOuterCall;
  const captureOrder =
    scenario === 'capture' && door === 'batch'
      ? vi.spyOn(outerCall, 'bindOuterCall').mockImplementation((...args) => {
          const binding = nativeBinding(...args);
          const close = binding.close;
          return Object.assign(binding, {
            async close(signal?: AbortSignal) {
              await close(signal);
              finishCleanup();
            },
          });
        })
      : undefined;
  try {
    const builder = Agent.create({
      model: 'fixture',
      artifacts: inMemoryArtifacts(),
      integrityPosture: scenario === 'columns' ? 'observe' : 'dev',
      checkColumnTypes: 'enforce',
      ...(scenario === 'refuse' && { maxToolResultChars: 300 }),
      ...(door === 'credential' && {
        credentials: {
          id: 'fixture',
          getCredential: async () =>
            credentialReady
              ? { status: 'issued' as const, credential: bearer('inert-fixture') }
              : {
                  status: 'authorization-required' as const,
                  authorizationUrl: 'https://example.invalid/fixture',
                  sessionId: 'fixture',
                },
        },
      }),
      provider: mock({
        respond(request) {
          const last = request.messages.at(-1);
          if (last?.role === 'tool') {
            history.push(last.content);
            return 'Done.';
          }
          return { toolCalls: [{ id: 'handoff-fixture', name: 'source', args: {} }] };
        },
      }),
    })
      .injection(
        defineInstruction({
          id: 'fixture-note',
          prompt: 'Inert fixture marker.',
          activeWhen: () => false,
        }),
      )
      .tool(
        defineTool({
          name: 'source',
          description: 'Return one synthetic value.',
          inputSchema: { type: 'object', properties: {} },
          ...(door === 'check-in' && { checkIn: 'always' as const }),
          ...(door === 'credential' && { needs: { credential: 'fixture' } }),
          ...(ceiling && { resultCeiling: { maxChars: 24 } }),
          ...(scenario === 'columns' && { resultColumns: { amount: 'number' as const } }),
          ...((scenario === 'allow' || scenario === 'refuse') && {
            resultRowsets: [
              {
                key: 'rows',
                columns: { amount: 'number' as const },
                source: {
                  kind: 'published-dataset' as const,
                  refPath: ['dataset'],
                  artifactKind: DATASET_KIND,
                  maxRows: 2,
                  maxBytes: 1024,
                },
              },
            ],
          }),
          async execute(_args, ctx) {
            entered++;
            if (scenario === 'capture') {
              if (door !== 'batch') {
                if (!ctx.onTeardown) throw new Error('Fixture needs a native call cleanup.');
                ctx.onTeardown(
                  async () => {
                    await Promise.resolve();
                    finishCleanup();
                  },
                  { scope: 'call', key: 'effect-fixture' },
                );
              }
              order.push('return');
              return { content: 'original fixture', effects: [proposal] };
            }
            if (scenario === 'over-budget') {
              return {
                content: 'fixture result with separate proposal budget',
                effects: [{ ...proposal, instructionId: 'a'.repeat(65_537) }],
              };
            }
            if (earlyRefusal) {
              return {
                content: sealToolEffectContent(
                  JSON.stringify(
                    ceiling
                      ? { fixture: 'inert ceiling control '.repeat(8) }
                      : [{ amount: 'fixture column is not numeric' }],
                  ),
                ),
                effects: [proposal],
              };
            }
            const dataset = await ctx.artifacts.put({
              kind: DATASET_KIND,
              mediaType: 'application/json',
              digest: 'sha-256',
              data: [{ amount: 0 }],
            });
            return {
              content: sealToolEffectContent(
                JSON.stringify({
                  dataset: dataset.ref,
                  ...(scenario === 'refuse' && { preview: 'inert preview '.repeat(100) }),
                }),
              ),
              effects: [proposal],
            };
          },
        }),
      );
    if (door === 'ask')
      builder.toolMiddleware({
        name: 'fixture approval',
        onToolCall: () => ask({ question: 'Run the fixture?' }),
      });
    if (scenario !== 'unhooked-ceiling')
      builder.toolMiddleware({
        name: 'fixture result',
        onToolResult: () => {
          order.push('hook');
          return scenario === 'capture'
            ? allow('fixture summary', 'Use the fixture summary.')
            : allow();
        },
        ...(scenario === 'capture' && {
          admitToolResultEffects({ proposals }) {
            for (const { effect } of proposals) {
              if (effect.kind === 'require-instruction') selectedIds.push(effect.instructionId);
            }
            // This is an ordering check only. The fixture never authorizes a proposal.
            return [];
          },
        }),
      });
    const agent = builder.build();
    agent.on('agentfootprint.tools.effect', (event) => ownerEvents.push(event.payload));
    agent.on('agentfootprint.tools.rowset_checked', (event) => rowChecks.push(event.payload));

    const initial = await agent.run({
      message: 'Read the fixture.',
      identity: { principal: 'fixture', conversationId: 'effect-handoff' },
    });
    if (door !== 'batch') {
      if (!isPaused(initial)) throw new Error('Native fixture must pause.');
      expect(entered).toBe(0);
      credentialReady = true;
      await agent.resume(
        JSON.parse(JSON.stringify(initial.checkpoint)),
        door === 'credential'
          ? 'Fixture authorized.'
          : checkInApproved({ request: pausedRequest(initial), by: 'fixture' }),
      );
    }
    const rows = agent.getLastSnapshot()?.sharedState.middlewareDecisions ?? [];
    return {
      entered,
      history,
      ownerEvents,
      rowChecks,
      order,
      selectedIds,
      handoffs: rows.flatMap((row) => (row.resultEffects ? [row.resultEffects] : [])),
    };
  } finally {
    captureOrder?.mockRestore();
  }
}

describe('native typed effect handoff', () => {
  it.each(['batch', 'ask'] as const)('captures proposals before %s cleanup waits', async (door) => {
    const result = await inspect(door, 'capture');
    expect(result.entered).toBe(1);
    expect(result.order).toEqual(['return', 'cleanup', 'hook']);
    expect(result.selectedIds).toEqual(['fixture-note']);
    expect(result.history).toEqual(['fixture summary']);
    expect(result.ownerEvents).toEqual([]);
    expect(result.handoffs).toEqual([{ disposition: 'suppressed' }]);
  });

  it.each(['batch', 'ask'] as const)(
    'keeps %s delivery with unsupported proposal authority',
    async (door) => {
      const result = await inspect(door, 'over-budget');
      expect(result.entered).toBe(1);
      expect(result.history).toEqual(['fixture result with separate proposal budget']);
      expect(result.handoffs).toEqual([{ disposition: 'suppressed' }]);
      expect(result.ownerEvents).toEqual([]);
    },
  );

  it('preserves native unhooked handling at the early ceiling', async () => {
    const result = await inspect('batch', 'unhooked-ceiling');
    expect(result.entered).toBe(1);
    expect(result.order).toEqual([]);
    expect(result.ownerEvents).toHaveLength(1);
    expect(result.history[0]).toMatch(/^Result too large:/);
    expect(result.handoffs).toEqual([]);
  });

  describe.each(['batch', 'ask', 'check-in', 'credential'] as const)(
    '%s final delivery',
    (door) => {
      it('records an ordinary eligible handoff once', async () => {
        const result = await inspect(door, 'allow');
        expect(result.entered).toBe(1);
        expect(result.ownerEvents).toHaveLength(1);
        expect(result.handoffs).toEqual([{ disposition: 'admitted', proposalOrdinals: [0] }]);
      });

      it.each(['ceiling', 'columns'] as const)(
        'suppresses effects after early %s refusal',
        async (refusal) => {
          const result = await inspect(door, refusal);
          expect(result.entered).toBe(1);
          expect(result.order).toEqual(['hook']);
          expect(result.ownerEvents).toEqual([]);
          expect(result.history).toHaveLength(1);
          expect(result.history[0]).toMatch(
            refusal === 'ceiling' ? /^Result too large:/ : /^Result rejected:/,
          );
          expect(result.history[0]).toContain('No data was returned.');
          expect(result.handoffs).toEqual([{ disposition: 'suppressed' }]);
        },
      );

      it('records suppression when the rowset refuses the final delivered result', async () => {
        const result = await inspect(door, 'refuse');
        expect(result.entered).toBe(1);
        expect(result.ownerEvents).toEqual([]);
        expect(result.rowChecks).toMatchObject([
          { disposition: 'unavailable', reason: 'result-capped', delivery: 'refused' },
        ]);
        expect(result.history).toHaveLength(1);
        expect(result.history[0]).not.toContain('inert preview');
        expect(result.handoffs).toEqual([{ disposition: 'suppressed' }]);
      });
    },
  );
});
