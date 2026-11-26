import { describe, expect, it } from 'vitest';
import {
  assessment,
  eventsFor,
  fixture,
  modes,
  pii,
  publicText,
  read,
  response,
  trace,
} from './bedrockGuardrailFixtures.js';

type Outcome = 'ordinary' | 'masked' | 'blocked' | 'unknown';
interface Case {
  name: string;
  stop: string;
  evidence: () => Record<string, unknown> | undefined;
  expected: Outcome;
}
const masked = () => trace(assessment(pii('ANONYMIZED'))) as Record<string, unknown>;
const blocked = () => trace(assessment(pii('BLOCKED'))) as Record<string, unknown>;
const router = { invokedModelId: 'PRIVATE_ROUTED_MODEL_ID' };
const cases: readonly Case[] = [
  {
    name: 'ordinary completion',
    stop: 'end_turn',
    evidence: () => undefined,
    expected: 'ordinary',
  },
  { name: 'usable mask', stop: 'guardrail_intervened', evidence: masked, expected: 'masked' },
  { name: 'proved block', stop: 'guardrail_intervened', evidence: blocked, expected: 'blocked' },
  {
    name: 'explicit intervention without assessment',
    stop: 'guardrail_intervened',
    evidence: () => undefined,
    expected: 'unknown',
  },
  {
    name: 'mask plus unknown action',
    stop: 'guardrail_intervened',
    evidence: () =>
      trace(assessment(pii('ANONYMIZED'), pii('FUTURE_ACTION'))) as Record<string, unknown>,
    expected: 'unknown',
  },
  {
    name: 'mask plus unknown guardrail policy',
    stop: 'guardrail_intervened',
    evidence: () =>
      trace({
        sensitiveInformationPolicy: { piiEntities: [pii('ANONYMIZED')] },
        futurePolicy: {},
      }) as Record<string, unknown>,
    expected: 'unknown',
  },
  {
    name: 'mask plus unknown trace sibling',
    stop: 'guardrail_intervened',
    evidence: () => ({ ...masked(), futureTrace: {} }),
    expected: 'unknown',
  },
  {
    name: 'unknown trace sibling without assessment',
    stop: 'end_turn',
    evidence: () => ({ futureTrace: {} }),
    expected: 'unknown',
  },
  {
    name: 'independent block dominates unknown trace sibling',
    stop: 'guardrail_intervened',
    evidence: () => ({ ...blocked(), futureTrace: {} }),
    expected: 'blocked',
  },
  {
    name: 'present undefined guardrail is malformed',
    stop: 'end_turn',
    evidence: () => ({ guardrail: undefined }),
    expected: 'unknown',
  },
  { name: 'ordinary empty trace', stop: 'end_turn', evidence: () => ({}), expected: 'ordinary' },
  {
    name: 'router spelling inside guardrail is not an allowed root sibling',
    stop: 'guardrail_intervened',
    evidence: () => ({
      guardrail: { ...(masked().guardrail as object), promptRouter: router },
    }),
    expected: 'unknown',
  },
];

describe('documented prompt-router trace is separate from guardrail assessment', () => {
  for (const classDoor of [false, true]) {
    for (const mode of modes) {
      for (const withRouter of [false, true]) {
        for (const row of cases) {
          it(`${mode}, class=${classDoor}, router=${withRouter}: ${row.name}`, async () => {
            const original = row.evidence();
            const evidence = withRouter ? { ...original, promptRouter: router } : original;
            const fx = fixture({
              classDoor,
              complete: response(evidence, row.stop),
              events: eventsFor(evidence, row.stop),
            });
            const { result, chunks } = await read(fx.provider, mode);
            expect(result.intervention?.outcome).toBe(
              row.expected === 'ordinary' ? undefined : row.expected,
            );
            const usable = row.expected === 'ordinary' || row.expected === 'masked';
            expect(result.content).toBe(usable ? publicText : '');
            expect(result.usage).toMatchObject({ input: 17, output: 7 });
            expect(result.toolCalls).toEqual([]);
            if (mode === 'stream')
              expect(
                chunks
                  .filter((chunk) => !chunk.done)
                  .map((chunk) => chunk.content)
                  .join(''),
              ).toBe(usable ? publicText : '');
            expect(JSON.stringify(result)).not.toContain('PRIVATE_ROUTED_MODEL_ID');
            expect(fx.send).toHaveBeenCalledTimes(1);
          });
        }
      }

      for (const outcome of ['ordinary', 'masked'] as const) {
        for (const shape of ['accessor', 'opaque value', 'root descriptor trap'] as const) {
          it(`${mode}, class=${classDoor}: ${outcome} never inspects router ${shape}`, async () => {
            let reads = 0;
            const rejectRead = () => {
              reads++;
              throw new Error('PRIVATE_ROUTER_READ');
            };
            let evidence: Record<string, unknown> = outcome === 'masked' ? masked() : {};
            if (shape === 'accessor')
              Object.defineProperty(evidence, 'promptRouter', {
                get: rejectRead,
                enumerable: true,
              });
            else {
              evidence.promptRouter = new Proxy(
                {},
                {
                  get: rejectRead,
                  ownKeys: rejectRead,
                  getOwnPropertyDescriptor: rejectRead,
                },
              );
              if (shape === 'root descriptor trap') {
                evidence = new Proxy(evidence, {
                  getOwnPropertyDescriptor(target, key) {
                    if (key === 'promptRouter' || (outcome === 'ordinary' && key === 'guardrail'))
                      return rejectRead();
                    return Reflect.getOwnPropertyDescriptor(target, key);
                  },
                });
              }
            }
            const stop = outcome === 'masked' ? 'guardrail_intervened' : 'end_turn';
            const fx = fixture({
              classDoor,
              complete: response(evidence, stop),
              events: eventsFor(evidence, stop),
            });
            const { result } = await read(fx.provider, mode);
            expect(reads).toBe(0);
            expect(result.intervention?.outcome).toBe(outcome === 'masked' ? 'masked' : undefined);
            expect(result.content).toBe(publicText);
            expect(JSON.stringify(result)).not.toContain('PRIVATE_ROUTER_READ');
            expect(fx.send).toHaveBeenCalledTimes(1);
          });
        }
      }

      for (const withRouter of [false, true]) {
        it(`${mode}, class=${classDoor}, router=${withRouter}: ordinary tool proposal survives`, async () => {
          const evidence = withRouter ? { promptRouter: router } : undefined;
          const fx = fixture({
            classDoor,
            complete: response(evidence, 'tool_use', [
              { toolUse: { toolUseId: 'call-1', name: 'lookup', input: { term: 'hello' } } },
            ]),
            events: eventsFor(evidence, 'tool_use', [
              {
                contentBlockStart: {
                  contentBlockIndex: 0,
                  start: { toolUse: { toolUseId: 'call-1', name: 'lookup' } },
                },
              },
              {
                contentBlockDelta: {
                  contentBlockIndex: 0,
                  delta: { toolUse: { input: '{"term":"hello"}' } },
                },
              },
              { contentBlockStop: { contentBlockIndex: 0 } },
            ]),
          });
          const { result } = await read(fx.provider, mode);
          expect(result.intervention).toBeUndefined();
          expect(result.toolCalls).toEqual([
            { id: 'call-1', name: 'lookup', args: { term: 'hello' } },
          ]);
          expect(fx.send).toHaveBeenCalledTimes(1);
        });
      }
    }
  }
});
