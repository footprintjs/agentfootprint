/**
 * Why: a masked threshold reads `[REDACTED]`, and that can also be a real threshold. The marker is what tells them
 * apart, so the audit chain has to keep it rather than turn it into a size marker.
 */
import { describe, expect, it } from 'vitest';
import { routeEvidence } from '../../src/adapters/observability/auditKeptByContract.js';

const evidenceWith = (condition: Record<string, unknown>) => ({
  chosen: 'yes',
  default: 'no',
  rules: [
    {
      type: 'filter',
      ruleIndex: 0,
      branch: 'yes',
      matched: true,
      conditions: [{ key: 'amount', op: 'eq', actualSummary: '10', result: true, ...condition }],
    },
  ],
});

const conditionOf = (bounded: unknown) =>
  (bounded as { rules: { conditions: Record<string, unknown>[] }[] }).rules[0]!.conditions[0]!;

describe('the audit chain and a masked threshold', () => {
  it('keeps the marker beside the masked value', () => {
    const condition = conditionOf(
      routeEvidence(evidenceWith({ threshold: '[REDACTED]', thresholdRedacted: true })),
    );
    expect(condition.threshold).toBe('[REDACTED]');
    expect(condition.thresholdRedacted).toBe(true);
  });

  it('adds no marker to a real threshold', () => {
    const condition = conditionOf(routeEvidence(evidenceWith({ threshold: 10 })));
    expect(condition.threshold).toBe(10);
    expect(Object.hasOwn(condition, 'thresholdRedacted')).toBe(false);
  });

  it('does not keep a marker that is not the declared value', () => {
    const condition = conditionOf(
      routeEvidence(evidenceWith({ threshold: 10, thresholdRedacted: 'secret-text' })),
    );
    expect(condition.thresholdRedacted).not.toBe('secret-text');
  });
});
