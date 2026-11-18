import { describe, expect, it } from 'vitest';
import { contextErrorIdentity, type ContextError } from '../../src/integrity/finding/types.js';
import { columnTypesOf, readRowset } from '../../src/integrity/column-types/check.js';

const base: ContextError = {
  kind: 'column-type-mismatch',
  seam: 'write',
  subjects: [{ kind: 'tool', id: 'read_disks' }],
  predicate: 'capacity_gb',
  witnesses: [],
  epoch: 2,
  message: 'Synthetic defect.',
};

describe('named column finding identity', () => {
  it('keeps every absent/undefined legacy byte and adds no field to old findings', () => {
    expect(contextErrorIdentity(base)).toBe(
      'column-type-mismatch @write [tool read_disks] capacity_gb 2',
    );
    expect(contextErrorIdentity({ ...base, rowset: undefined })).toBe(contextErrorIdentity(base));
    const call = {
      toolName: 'read_disks',
      toolCallId: 'c1',
      columns: { capacity_gb: 'number' as const },
      reading: readRowset([{ capacity_gb: 'wrong' }]),
      mode: 'warn' as const,
    };
    const old = columnTypesOf(call, 2);
    expect(columnTypesOf({ ...call, rowset: undefined }, 2)).toEqual(old);
    expect(old.findings[0]).not.toHaveProperty('rowset');
    expect(old.findings[0]!.witnesses[0]!.provenance).toContain('Tool.resultColumns');
  });

  it('propagates the named rowset on both missing-column and mismatch findings', () => {
    const result = columnTypesOf(
      {
        toolName: 'read_disks',
        toolCallId: 'c1',
        columns: { capacity_gb: 'number', is_rdm: 'boolean' },
        rowset: 'disks',
        reading: readRowset([{ capacity_gb: 'wrong' }]),
        mode: 'warn',
      },
      2,
    );
    expect(result.findings.map((row) => row.kind)).toEqual([
      'column-type-mismatch',
      'missing-column',
    ]);
    expect(result.findings.every((row) => row.rowset === 'disks')).toBe(true);
    expect(
      result.findings.every((row) => row.witnesses[0]!.provenance.includes('Tool.resultRowsets')),
    ).toBe(true);
  });

  it('encodes slash/percent/absence-looking and composite boundaries injectively', () => {
    const words = ['a', 'a/b', 'a%2Fb', '_', '%5F', 'a|b', 'a%7Cb'];
    const keys = words.flatMap((id) =>
      words.flatMap((predicate) =>
        words.map((rowset) =>
          contextErrorIdentity({ ...base, subjects: [{ kind: 'tool', id }], predicate, rowset }),
        ),
      ),
    );
    expect(new Set(keys).size).toBe(words.length ** 3);
    const left = { ...base, predicate: 'capacity_gb/left', rowset: 'right' };
    const right = { ...base, predicate: 'capacity_gb', rowset: 'left/right' };
    expect(contextErrorIdentity(left)).not.toBe(contextErrorIdentity(right));
    expect(contextErrorIdentity(left)).not.toBe(
      contextErrorIdentity({ ...left, rowset: undefined }),
    );
  });

  it('keeps subject order immaterial without losing subject tuple boundaries', () => {
    const subjects = [
      { kind: 'tool', id: 'a' },
      { kind: 'tool', id: 'b' },
    ];
    expect(contextErrorIdentity({ ...base, rowset: 'disks', subjects })).toBe(
      contextErrorIdentity({ ...base, rowset: 'disks', subjects: [...subjects].reverse() }),
    );
    expect(contextErrorIdentity({ ...base, rowset: 'disks', subjects })).not.toBe(
      contextErrorIdentity({
        ...base,
        rowset: 'disks',
        subjects: [{ kind: 'tool', id: 'a/tool/b' }],
      }),
    );
  });
});
