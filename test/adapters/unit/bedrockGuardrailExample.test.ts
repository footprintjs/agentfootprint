import { describe, expect, it } from 'vitest';
import { meta, run } from '../../../examples/features/131-bedrock-guardrails.js';

describe('published Bedrock guardrail example', () => {
  it('runs both public doors and transports without live provider slots', async () => {
    expect(meta.providerSlots).toEqual([]);
    const result = await run();
    expect(result.mode).toBe('scripted-sdk');
    expect(result.liveAwsCalls).toBe(0);
    expect(result.rows).toHaveLength(6);
    for (const door of ['class', 'factory']) {
      expect(result.rows.filter((row) => row.door === door)).toEqual([
        {
          door,
          outcome: 'masked',
          transports: 'Converse + ConverseStream',
          native: 'masked answer',
          sends: 3,
        },
        {
          door,
          outcome: 'blocked',
          transports: 'Converse + ConverseStream',
          native: 'ERR_PROVIDER_BLOCKED',
          sends: 3,
        },
        {
          door,
          outcome: 'unknown',
          transports: 'Converse + ConverseStream',
          native: 'ERR_PROVIDER_INTERVENTION_UNKNOWN',
          sends: 3,
        },
      ]);
    }
  });
});
