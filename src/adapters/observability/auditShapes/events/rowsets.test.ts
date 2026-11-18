import { describe, expect, it } from 'vitest';
import { eventShapeTable, eventShapes } from '../../auditShapes.js';
import type { ToolRowsetCheckReason } from '../../../../events/payloads/toolRowsets.js';

const valid = {
  toolName: 'source',
  toolCallId: 'call-1',
  iteration: 1,
  rowset: 'disks',
  source: 'published-dataset',
  disposition: 'checked-pass',
  reason: 'rows',
  delivery: 'unchanged',
};
const reasons: readonly ToolRowsetCheckReason[] = [
  'rows',
  'empty',
  'declared-absence',
  'unsupported-shape',
  'source-missing',
  'publication-unavailable',
  'publication-changed',
  'wrong-kind',
  'source-over-bound',
  'result-withheld',
  'result-capped',
  'source-aborted',
  'store-unavailable',
];

describe('the native bounded audit owner classifies rowset metadata', () => {
  const shapes = eventShapes(() => false);
  const rowset = shapes['agentfootprint.tools.rowset_checked'];

  it('includes the new event through the actual facade and preserves only declared structure', () => {
    expect(eventShapeTable(() => false).has('agentfootprint.tools.rowset_checked')).toBe(true);
    expect(rowset(valid)).toEqual(valid);
  });

  it.each(reasons)('keeps the declared finite reason %s', (reason) => {
    expect(rowset({ ...valid, reason })).toEqual({ ...valid, reason });
  });

  it.each(['source', 'disposition', 'reason', 'delivery'] as const)(
    'bounds an undeclared %s word instead of treating it as structure',
    (field) => {
      const bounded = rowset({ ...valid, [field]: 'PRIVATE-UNDECLARED-WORD' });
      expect(bounded).toMatchObject({ [field]: '[23 chars]' });
      expect(JSON.stringify(bounded)).not.toContain('PRIVATE-UNDECLARED-WORD');
    },
  );

  it('rejects wrong leaf kinds and never passes result references, counts, samples or values wholesale', () => {
    const bounded = rowset({
      ...valid,
      toolName: { secret: 'PRIVATE' },
      iteration: 'PRIVATE',
      rowset: { ref: 'PRIVATE' },
      sample: 'PRIVATE',
      ref: 'PRIVATE',
      values: [{ secret: 'PRIVATE' }],
      rows: 12,
    });
    expect(bounded).toMatchObject({
      iteration: '[7 chars]',
      sample: '[7 chars]',
      ref: '[7 chars]',
    });
    expect(JSON.stringify(bounded)).not.toContain('PRIVATE');
    expect(bounded).not.toMatchObject({ rows: 12 });
  });

  it('retains the optional static finding rowset while marking private finding text, preserving absent legacy shape', () => {
    const legacy = {
      kind: 'column-type-mismatch',
      seam: 'write',
      predicate: 'amount',
      message: 'PRIVATE',
    };
    const rule = shapes['agentfootprint.integrity.context_error'];
    expect(rule(legacy)).toEqual({ ...legacy, message: '[7 chars]' });
    expect(rule({ ...legacy, rowset: 'disks' })).toEqual({
      ...legacy,
      rowset: 'disks',
      message: '[7 chars]',
    });
    const wrong = rule({ ...legacy, rowset: { sample: 'PRIVATE' } });
    expect(JSON.stringify(wrong)).not.toContain('PRIVATE');
  });
});
