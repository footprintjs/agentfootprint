import { describe, expect, it } from 'vitest';
import {
  assessment,
  fixture,
  pii,
  publicText,
  read,
  textDelta,
  trace,
  usage,
} from './bedrockGuardrailFixtures.js';

const masked = () => trace(assessment(pii('ANONYMIZED')));
const blocked = () => trace(assessment(pii('BLOCKED')));
const earlyShapes = [
  'blocked',
  'masked',
  'unknown policy',
  'router',
  'undefined',
  'accessor',
] as const;

describe('guarded stream trace ordering', () => {
  for (const classDoor of [false, true]) {
    for (const later of ['usage only', 'mask'] as const) {
      for (const shape of earlyShapes) {
        it(`class=${classDoor}, later=${later}: early ${shape} cannot authorize release`, async () => {
          let traceReads = 0;
          const early: Record<string, unknown> = { usage };
          if (shape === 'accessor') {
            Object.defineProperty(early, 'trace', {
              enumerable: true,
              get() {
                traceReads++;
                throw new Error('PRIVATE_EARLY_ASSESSMENT');
              },
            });
          } else {
            early.trace =
              shape === 'blocked'
                ? blocked()
                : shape === 'masked'
                ? masked()
                : shape === 'unknown policy'
                ? trace({ futurePolicy: {} })
                : shape === 'router'
                ? { promptRouter: { invokedModelId: 'PRIVATE_ROUTED_MODEL' } }
                : undefined;
          }
          const fx = fixture({
            classDoor,
            events: [
              textDelta(),
              { contentBlockStop: { contentBlockIndex: 0 } },
              { metadata: early },
              { messageStop: { stopReason: 'end_turn' } },
              { metadata: { usage, ...(later === 'mask' ? { trace: masked() } : {}) } },
            ],
          });
          const { result, chunks } = await read(fx.provider, 'stream');
          expect(result.intervention?.outcome).toBe('unknown');
          expect(result.content).toBe('');
          expect(result.toolCalls).toEqual([]);
          expect(result.usage).toMatchObject({ input: 17, output: 7 });
          expect(chunks.filter((chunk) => !chunk.done)).toEqual([]);
          expect(traceReads).toBe(0);
          expect(JSON.stringify(result)).not.toContain('PRIVATE_');
          expect(fx.send).toHaveBeenCalledTimes(1);
        });
      }
    }

    it(`class=${classDoor}: early assessment withholds tools before parsing`, async () => {
      const fx = fixture({
        classDoor,
        events: [
          {
            contentBlockStart: {
              contentBlockIndex: 0,
              start: { toolUse: { toolUseId: 'call-1', name: 'act' } },
            },
          },
          { contentBlockDelta: { contentBlockIndex: 0, delta: { toolUse: { input: '{' } } } },
          { contentBlockStop: { contentBlockIndex: 0 } },
          { metadata: { usage, trace: blocked() } },
          { messageStop: { stopReason: 'tool_use' } },
          { metadata: { usage } },
        ],
      });
      const { result, chunks } = await read(fx.provider, 'stream');
      expect(result.intervention?.outcome).toBe('unknown');
      expect(result.toolCalls).toEqual([]);
      expect(chunks.filter((chunk) => !chunk.done)).toEqual([]);
      expect(fx.send).toHaveBeenCalledTimes(1);
    });

    for (const outcome of ['ordinary', 'masked', 'blocked', 'unknown'] as const) {
      it(`class=${classDoor}: early usage alone preserves ordered ${outcome}`, async () => {
        const evidence =
          outcome === 'masked' ? masked() : outcome === 'blocked' ? blocked() : undefined;
        const fx = fixture({
          classDoor,
          events: [
            textDelta(),
            { contentBlockStop: { contentBlockIndex: 0 } },
            { metadata: { usage } },
            {
              messageStop: {
                stopReason: outcome === 'ordinary' ? 'end_turn' : 'guardrail_intervened',
              },
            },
            { metadata: { usage, ...(evidence === undefined ? {} : { trace: evidence }) } },
          ],
        });
        const { result, chunks } = await read(fx.provider, 'stream');
        expect(result.intervention?.outcome).toBe(outcome === 'ordinary' ? undefined : outcome);
        const usable = outcome === 'ordinary' || outcome === 'masked';
        expect(result.content).toBe(usable ? publicText : '');
        expect(
          chunks
            .filter((chunk) => !chunk.done)
            .map((chunk) => chunk.content)
            .join(''),
        ).toBe(usable ? publicText : '');
        expect(fx.send).toHaveBeenCalledTimes(1);
      });
    }
  }
});
