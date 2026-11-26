import { describe, expect, it } from 'vitest';
import {
  fixture,
  modes,
  read,
  response,
  eventsFor,
  trace,
  assessment,
  pii,
  textDelta,
  publicText,
} from './bedrockGuardrailFixtures.js';

describe('guardrail independent boundary reproductions', () => {
  for (const mode of modes) {
    it(`${mode}: an unconfigured ordinary reply retains optional-stop parity`, async () => {
      const raw = response(undefined, 'end_turn');
      delete raw.stopReason;
      const fx = fixture({ guardrail: null, complete: raw, events: [textDelta()] });
      const { result } = await read(fx.provider, mode);
      expect(result.content).toBe(publicText);
      expect(result.stopReason).toBe('stop');
      expect(result.intervention).toBeUndefined();
      expect(fx.send).toHaveBeenCalledTimes(1);
    });
    for (const blocked of [false, true]) {
      it(`${mode}: custom iteration stays uncalled and cannot hide a valid block (blocked=${blocked})`, async () => {
        let calls = 0;
        const entities = [pii('ANONYMIZED'), ...(blocked ? [pii('BLOCKED')] : [])];
        Object.defineProperty(entities, Symbol.iterator, {
          value: () => {
            calls++;
            throw new Error('must not iterate');
          },
        });
        const evidence = trace({ sensitiveInformationPolicy: { piiEntities: entities } });
        const fx = fixture({ complete: response(evidence), events: eventsFor(evidence) });
        const { result } = await read(fx.provider, mode);
        expect(result.intervention?.outcome).toBe(blocked ? 'blocked' : 'unknown');
        expect(result.content).toBe('');
        expect(calls).toBe(0);
        expect(fx.send).toHaveBeenCalledTimes(1);
      });
    }
  }
  for (const key of [
    'modelStreamErrorException',
    'internalServerException',
    'serviceUnavailableException',
    'throttlingException',
    'validationException',
  ] as const) {
    it(`stream exception member ${key} cannot become a successful masked response`, async () => {
      const native = { message: 'PRIVATE_ERROR_BODY', originalStatusCode: 500 };
      const evidence = trace(assessment(pii('ANONYMIZED')));
      const fx = fixture({ events: [...eventsFor(evidence), { [key]: native }] });
      const chunks: unknown[] = [];
      let error: unknown;
      try {
        for await (const chunk of fx.provider.stream!({ model: 'bedrock', messages: [] }))
          chunks.push(chunk);
      } catch (failure) {
        error = failure;
      }
      expect(error).toBeInstanceOf(Error);
      expect(error).not.toHaveProperty('intervention');
      expect(String(error)).not.toContain('PRIVATE_ERROR_BODY');
      expect(chunks).toEqual([]);
      expect(fx.send).toHaveBeenCalledTimes(1);
    });
  }
});
