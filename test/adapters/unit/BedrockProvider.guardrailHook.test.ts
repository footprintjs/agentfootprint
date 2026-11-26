import { describe, expect, it, vi } from 'vitest';
import {
  fixture,
  response,
  eventsFor,
  trace,
  assessment,
  pii,
  guardrail,
  modes,
  read,
} from './bedrockGuardrailFixtures.js';

describe('guardrail presentation cannot authorize response delivery', () => {
  for (const mode of modes) {
    for (const outcome of ['blocked', 'unknown', 'masked'] as const) {
      it(`${mode}: ${outcome} retains its disposition under a detached message hook`, async () => {
        const evidence =
          outcome === 'unknown'
            ? undefined
            : trace(assessment(pii(outcome === 'masked' ? 'ANONYMIZED' : 'BLOCKED')));
        const cleanMessage = vi.fn((value: unknown) => {
          expect(Object.isFrozen(value)).toBe(true);
          expect(Object.isFrozen((value as { filters: unknown }).filters)).toBe(true);
          expect(Reflect.set(value as object, 'outcome', 'masked')).toBe(false);
          return 'The application explains this outcome.';
        });
        const config = { ...guardrail, cleanMessage };
        const fx = fixture({
          guardrail: config,
          complete: response(evidence),
          events: eventsFor(evidence),
        });
        const { result } = await read(fx.provider, mode);
        expect(result.intervention?.outcome).toBe(outcome);
        expect(cleanMessage).toHaveBeenCalledTimes(outcome === 'masked' ? 0 : 1);
        if (outcome !== 'masked') {
          expect(result.intervention?.message).toBe('The application explains this outcome.');
          expect(result.content).toBe('');
          expect(result.toolCalls).toEqual([]);
        }
        expect(fx.send).toHaveBeenCalledTimes(1);
      });
    }
    it(`${mode}: a thrown hook retains original cause and typed outcome`, async () => {
      const cause = new Error('private application hook failure');
      const evidence = trace(assessment(pii('BLOCKED')));
      const config = {
        ...guardrail,
        cleanMessage: () => {
          throw cause;
        },
      };
      const fx = fixture({
        guardrail: config,
        complete: response(evidence),
        events: eventsFor(evidence),
      });
      await expect(read(fx.provider, mode)).rejects.toMatchObject({
        code: 'ERR_PROVIDER_BLOCKED',
        cause,
        intervention: { outcome: 'blocked' },
      });
      expect(fx.send).toHaveBeenCalledTimes(1);
    });
    for (const value of [Promise.resolve('async'), {}, 'x'.repeat(1025)]) {
      it(`${mode}: invalid asynchronous/non-string/oversized hook result stays unknown`, async () => {
        const config = { ...guardrail, cleanMessage: () => value };
        const fx = fixture({ guardrail: config, complete: response(), events: eventsFor() });
        await expect(read(fx.provider, mode)).rejects.toMatchObject({
          code: 'ERR_PROVIDER_INTERVENTION_UNKNOWN',
          intervention: { outcome: 'unknown' },
        });
        expect(fx.send).toHaveBeenCalledTimes(1);
      });
    }
  }
});
