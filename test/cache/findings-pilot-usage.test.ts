import { describe, expect, it } from 'vitest';
import { measuredUsage, pilotBudget, MODEL } from '../../bench/cache/pilot/budget.mjs';
import { usageEvidence } from '../../bench/cache/pilot/usageEvidence.mjs';
const base = {
  input_tokens: 9,
  output_tokens: 1,
  cache_creation_input_tokens: 0,
  cache_read_input_tokens: 0,
};
describe('pilot usage contract, no live calls', () => {
  it.each(['global', 'not_available'])(
    'accepts documented standard labels, preserving %s verbatim',
    (geo) => {
      const raw = { ...base, speed: 'standard', service_tier: 'standard', inference_geo: geo };
      expect(measuredUsage(raw)).toEqual({ raw, nanoUsd: 14000, microUsd: 14 });
    },
  );
  it.each([
    { speed: 'fast' },
    { speed: 'new' },
    { service_tier: 'priority' },
    { inference_geo: 'us' },
    { new_charge_tokens: 1 },
    { cache_creation_input_tokens: null },
    { cache_read_input_tokens: undefined },
  ])('refuses unapproved charges, labels, missing and null counts: %j', (extra) => {
    expect(() => measuredUsage({ ...base, ...extra })).toThrow();
  });
  it('saves bounded field names, types and numeric evidence BEFORE unknown outcome, no secrets', async () => {
    const events: any[] = [];
    const budget = pilotBudget({
      journal(e) {
        events.push(e);
      },
    });
    const raw = {
      ...base,
      new_charge_tokens: 7,
      speed: 'standard',
      note: 'PRIVATE_RESPONSE',
      'sk-ant-private-key': 'PRIVATE_KEY',
    };
    await expect(
      budget.call(
        { model: MODEL, max_tokens: 1, messages: [{ role: 'user', content: 'test' }] },
        async () => ({ usage: raw }),
        { arm: 'baseline', run: 'lookup' },
      ),
    ).rejects.toThrow(/usage/);
    expect(events.map((e) => e.kind)).toEqual(['reserved', 'usage-refused', 'unknown']);
    const evidence = events[1].evidence;
    expect(evidence.fields).toContainEqual({
      path: ['new_charge_tokens'],
      type: 'number',
      value: 7,
    });
    expect(evidence.fields).toContainEqual({ path: ['speed'], type: 'string', label: 'standard' });
    expect(evidence.fields).toContainEqual({
      path: ['note'],
      type: 'string',
      gap: 'STRING_VALUE_WITHHELD',
    });
    expect(evidence.withheldNames).toBe(1);
    expect(evidence.complete).toBe(false);
    expect(JSON.stringify(events)).not.toMatch(/PRIVATE_RESPONSE|PRIVATE_KEY|sk-ant-private-key/);
    expect(budget.snapshot()).toMatchObject({
      halted: true,
      unknownCalls: 1,
      reservedMicroUsd: 405120,
    });
  });
  it('evidence failure to persist stops without a retry or successful settlement', async () => {
    let calls = 0;
    const budget = pilotBudget({
      journal(e) {
        if (e.kind === 'usage-refused') throw new Error('disk');
      },
    });
    await expect(
      budget.call(
        { model: MODEL, max_tokens: 1, messages: [{ role: 'user', content: 'test' }] },
        async () => {
          calls++;
          return { usage: { ...base, unpriced_charge: 1 } };
        },
        { arm: 'baseline', run: 'lookup' },
      ),
    ).rejects.toThrow();
    expect(calls).toBe(1);
    expect(budget.snapshot().halted).toBe(true);
  });
  it('does not run getters or toJSON and discloses evidence limits', () => {
    let reads = 0;
    const accessor = Object.defineProperty({}, 'input_tokens', {
      enumerable: true,
      get() {
        reads++;
        return 1;
      },
    });
    expect(usageEvidence(accessor)).toMatchObject({
      complete: false,
      gap: 'NON_JSON_OR_SIZE_LIMIT',
    });
    expect(reads).toBe(0);
    const wide = Object.fromEntries(Array.from({ length: 100 }, (_, i) => [`field_${i}`, i]));
    const evidence = usageEvidence(wide);
    expect(evidence.fields.length).toBeLessThanOrEqual(64);
    expect(evidence.complete).toBe(false);
    expect(evidence.truncated).toBe(true);
    expect(JSON.stringify(evidence).length).toBeLessThanOrEqual(8192);
  });
  it('withheld strings, array contents and out-of-bound numbers are explicit gaps', () => {
    const evidence = usageEvidence({ speed: 'new', future: [{ charge: 7 }], invalid_count: -1 });
    expect(evidence.complete).toBe(false);
    expect(evidence.fields).toContainEqual({
      path: ['speed'],
      type: 'string',
      gap: 'STRING_VALUE_WITHHELD',
    });
    expect(evidence.fields).toContainEqual({
      path: ['future'],
      type: 'array',
      gap: 'ARRAY_CONTENTS_WITHHELD',
    });
    expect(evidence.fields).toContainEqual({
      path: ['invalid_count'],
      type: 'number',
      gap: 'NUMBER_VALUE_WITHHELD',
    });
  });
});
