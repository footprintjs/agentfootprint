import { describe, expect, it } from 'vitest';
import {
  assessment,
  eventsFor,
  fixture,
  modes,
  pair,
  pii,
  publicText,
  read,
  response,
  trace,
  type Intervention,
} from './bedrockGuardrailFixtures.js';

interface Case {
  name: string;
  evidence: () => unknown;
  expected: Intervention['outcome'];
  code?: string;
}

const cases: readonly Case[] = [
  {
    name: 'masked-only output assessment',
    evidence: () => trace(undefined, assessment(pii('ANONYMIZED'))),
    expected: 'masked',
  },
  {
    name: 'blocked-only input assessment',
    evidence: () => trace(assessment(pii('BLOCKED'))),
    expected: 'blocked',
  },
  {
    name: 'mask input then block output',
    evidence: () => trace(assessment(pii('ANONYMIZED')), assessment(pii('BLOCKED'))),
    expected: 'blocked',
  },
  {
    name: 'block input then mask output',
    evidence: () => trace(assessment(pii('BLOCKED')), assessment(pii('ANONYMIZED'))),
    expected: 'blocked',
  },
  {
    name: 'mask policy followed by content blocker',
    evidence: () =>
      trace({
        sensitiveInformationPolicy: { piiEntities: [pii('ANONYMIZED')] },
        contentPolicy: { filters: [{ type: 'HATE', action: 'BLOCKED' }] },
      }),
    expected: 'blocked',
  },
  ...(['malformed-first', 'block-first'] as const).map(
    (order): Case => ({
      name: `${order} cannot hide independent block`,
      evidence: () =>
        trace(
          assessment(
            ...(order === 'malformed-first'
              ? [pii('FUTURE_ACTION'), pii('BLOCKED')]
              : [pii('BLOCKED'), pii('FUTURE_ACTION')]),
          ),
        ),
      expected: 'blocked',
    }),
  ),
  {
    name: 'enabled_full mask plus NONE is usable',
    evidence: () => trace(assessment(pii('ANONYMIZED'), pii('NONE', { detected: false }))),
    expected: 'masked',
  },
  {
    name: 'missing trace',
    evidence: () => undefined,
    expected: 'unknown',
  },
  { name: 'empty trace', evidence: () => ({}), expected: 'unknown' },
  { name: 'empty assessment maps', evidence: () => trace(undefined), expected: 'unknown' },
  {
    name: 'mask plus unknown action',
    evidence: () => trace(assessment(pii('ANONYMIZED'), pii('FUTURE_ACTION'))),
    expected: 'unknown',
  },
  {
    name: 'mask plus absent action',
    evidence: () => trace(assessment(pii('ANONYMIZED'), { type: 'EMAIL' })),
    expected: 'unknown',
  },
  {
    name: 'mask plus malformed policy container',
    evidence: () =>
      trace({
        sensitiveInformationPolicy: { piiEntities: [pii('ANONYMIZED')] },
        contentPolicy: { filters: 'not an array' },
      }),
    expected: 'unknown',
  },
  {
    name: 'mask plus future policy family',
    evidence: () =>
      trace({
        sensitiveInformationPolicy: { piiEntities: [pii('ANONYMIZED')] },
        futurePolicy: { filters: [{ action: 'BLOCKED' }] },
      }),
    expected: 'unknown',
  },
  {
    name: 'hole is incomplete evidence',
    evidence: () => {
      const entries = [pii('ANONYMIZED')];
      entries.length = 2;
      return trace({ sensitiveInformationPolicy: { piiEntities: entries } });
    },
    expected: 'unknown',
  },
  {
    name: 'only NONE does not prove masked or blocked',
    evidence: () => trace(assessment(pii('NONE'))),
    expected: 'unknown',
  },
  {
    name: 'intrinsic content_filtered has no separate block proof',
    evidence: () => undefined,
    expected: 'unknown',
    code: 'content_filtered',
  },
  {
    name: 'intrinsic content_filtered with separate valid block proof',
    evidence: () => trace(assessment(pii('BLOCKED'))),
    expected: 'blocked',
    code: 'content_filtered',
  },
  {
    name: 'optional unused policies are absent',
    evidence: () => trace(assessment(pii('ANONYMIZED'))),
    expected: 'masked',
  },
  {
    name: 'late block beyond descriptor cap',
    evidence: () =>
      trace(assessment(...Array.from({ length: 40 }, () => pii('ANONYMIZED')), pii('BLOCKED'))),
    expected: 'blocked',
  },
  {
    name: 'inspection exhaustion after mask cannot certify late block or masking-only',
    evidence: () =>
      trace(
        assessment(pii('ANONYMIZED')),
        assessment(...Array.from({ length: 5_000 }, () => pii('NONE')), pii('BLOCKED')),
      ),
    expected: 'unknown',
  },
  {
    name: 'inspection exhaustion cannot undo a block already proved',
    evidence: () =>
      trace(
        assessment(pii('BLOCKED')),
        assessment(...Array.from({ length: 5_000 }, () => pii('NONE'))),
      ),
    expected: 'blocked',
  },
];

for (const mode of modes) {
  describe(`Bedrock guardrails classification — ${mode}`, () => {
    for (const row of cases) {
      it(row.name, async () => {
        const fx = pair(row.evidence(), row.code);
        const { result, chunks } = await read(fx.provider, mode);
        expect(result.intervention?.outcome).toBe(row.expected);
        expect(result.intervention?.code).toBe(row.code ?? 'guardrail_intervened');
        expect(result.intervention?.filters.length).toBeLessThanOrEqual(32);
        if (row.expected === 'masked') {
          expect(result.content).toBe(publicText);
          expect(result.usage).toMatchObject({ input: 17, output: 7 });
          if (mode === 'stream') {
            expect(
              chunks
                .filter((chunk) => !chunk.done)
                .map((chunk) => chunk.content)
                .join(''),
            ).toBe(publicText);
          }
        } else {
          expect(result.content).toBe('');
          expect(result.toolCalls).toEqual([]);
          expect(
            chunks
              .filter((chunk) => !chunk.done)
              .map((chunk) => chunk.content)
              .join(''),
          ).toBe('');
        }
        expect(fx.send).toHaveBeenCalledTimes(1);
      });
    }

    it('normal response with no guardrail preserves content, usage and no intervention', async () => {
      const fx = fixture({
        guardrail: null,
        complete: response(undefined, 'end_turn'),
        events: eventsFor(undefined, 'end_turn'),
      });
      const { result } = await read(fx.provider, mode);
      expect(result.content).toBe(publicText);
      expect(result.usage).toMatchObject({ input: 17, output: 7 });
      expect(result.stopReason).toBe('stop');
      expect(result.intervention).toBeUndefined();
      expect(fx.send).toHaveBeenCalledTimes(1);
      const command = fx.send.mock.calls[0]?.[0] as { input: Record<string, unknown> };
      expect(command.input).not.toHaveProperty('guardrailConfig');
    });

    it('configured normal response remains usable after complete terminal framing', async () => {
      const fx = pair(undefined, 'end_turn');
      const { result } = await read(fx.provider, mode);
      expect(result.content).toBe(publicText);
      expect(result.intervention).toBeUndefined();
      expect(fx.send).toHaveBeenCalledTimes(1);
    });

    it('SDK failure before response admission keeps its category/cause and sends once', async () => {
      const sdkError = Object.assign(new Error('connection unavailable'), {
        name: 'NetworkingError',
      });
      const fx = fixture({ sendError: sdkError });
      await expect(read(fx.provider, mode)).rejects.toMatchObject({
        name: 'BedrockProviderError',
        cause: sdkError,
      });
      expect(fx.send).toHaveBeenCalledTimes(1);
    });
  });
}
