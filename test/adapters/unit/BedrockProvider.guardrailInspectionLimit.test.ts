import { describe, expect, it } from 'vitest';
import {
  eventsFor,
  fixture,
  modes,
  pii,
  read,
  response,
  trace,
} from './bedrockGuardrailFixtures.js';

describe('one classification inspection budget includes its root response fields', () => {
  for (const mode of modes) {
    for (const padding of [4063, 4064, 4065, 4066]) {
      it(`${mode}: ${padding} sibling keys cannot move the admitted read ceiling`, async () => {
        // These unknown keys have no values relevant to classification. Their
        // admitted key count still consumes work before the supported carrier.
        // The path to its final detected-field read costs 33 more admissions,
        // including stopReason and trace on the root response. Exactly 4,096
        // fits; a carrier whose final read falls beyond it cannot prove block.
        const assessment: Record<string, unknown> = Object.fromEntries(
          Array.from({ length: padding }, (_, index) => [`unrecognized-${index}`, null]),
        );
        assessment.sensitiveInformationPolicy = { piiEntities: [pii('BLOCKED')] };
        const evidence = trace(undefined, assessment);
        const fx = fixture({ complete: response(evidence), events: eventsFor(evidence) });
        const { result } = await read(fx.provider, mode);
        expect(result.intervention?.outcome).toBe(padding === 4063 ? 'blocked' : 'unknown');
        expect(result.content).toBe('');
        expect(result.toolCalls).toEqual([]);
        expect(fx.send).toHaveBeenCalledTimes(1);
      });
    }
  }
});
