import { describe, expect, it } from 'vitest';
import { defineTool, type ToolResultRowset } from '../../src/index.js';
import { readResultRowsets, resultRowsetsOf } from '../../src/tools/resultRowsets.js';

const inline = (): ToolResultRowset => ({
  key: 'disks',
  columns: { capacity_gb: 'number', is_rdm: 'boolean' },
  source: { kind: 'inline', path: ['result', 'disks'] },
});
const published = (): ToolResultRowset => ({
  ...inline(),
  source: {
    kind: 'published-dataset',
    refPath: ['result', 'dataset', 'ref'],
    artifactKind: 'dataset/rows',
    maxRows: 1000,
    maxBytes: 1048576,
  },
});
const define = (resultRowsets?: readonly ToolResultRowset[]) =>
  defineTool({
    name: 'read_disks',
    description: 'Synthetic disks.',
    ...(resultRowsets !== undefined && { resultRowsets }),
    execute: () => [],
  });

describe('explicit rowset metadata', () => {
  it('absent stays absent; definition detaches and freezes every declared field', () => {
    expect(Object.hasOwn(define(), 'resultRowsets')).toBe(false);
    const original = inline();
    const tool = define([original]);
    expect(tool.resultRowsets).toEqual([original]);
    expect(tool.resultRowsets![0]).not.toBe(original);
    expect(Object.isFrozen(tool.resultRowsets)).toBe(true);
    expect(Object.isFrozen(tool.resultRowsets![0]!.columns)).toBe(true);
    expect(Object.isFrozen(tool.resultRowsets![0]!.source)).toBe(true);
    (original as { key: string }).key = 'changed';
    expect(tool.resultRowsets![0]!.key).toBe('disks');
  });

  it('accepts explicit root and exact native count/path/dataset bounds', () => {
    const row = { ...inline(), source: { kind: 'inline' as const, path: [] } };
    expect(define([row]).resultRowsets).toEqual([row]);
    expect(define([published()]).resultRowsets).toEqual([published()]);
    const path = Array.from({ length: 16 }, () => 'part');
    expect(
      readResultRowsets('read_disks', [{ ...row, source: { kind: 'inline', path } }]),
    ).toBeDefined();
    expect(
      define(Array.from({ length: 8 }, (_, index) => ({ ...row, key: `set-${index}` })))
        .resultRowsets,
    ).toHaveLength(8);
  });

  it.each(
    [
      [],
      Array.from({ length: 9 }, (_, index) => ({ ...inline(), key: `set-${index}` })),
      [inline(), inline()],
      [{ ...inline(), key: '' }],
      [{ ...inline(), key: '  ' }],
      [{ ...inline(), columns: {} }],
      [{ ...inline(), columns: { x: 'unknown' } }],
      [{ ...inline(), columns: { x: { type: 'number', nullable: 'true' } } }],
      [{ ...inline(), columns: { x: { type: 'number', extra: true } } }],
      [{ ...inline(), extra: true }],
      [{ ...inline(), source: { kind: 'guess', path: [] } }],
      [{ ...inline(), source: { kind: 'inline', path: [''] } }],
      [{ ...inline(), source: { kind: 'inline', path: Array(17).fill('x') } }],
      [{ ...inline(), source: { kind: 'inline', path: [], refPath: [] } }],
      ...[0, 1001, 1.5].map((maxRows) => [
        { ...published(), source: { ...published().source, maxRows } },
      ]),
      ...[0, 1048577, Infinity].map((maxBytes) => [
        { ...published(), source: { ...published().source, maxBytes } },
      ]),
    ].map((value) => ({ value })),
  )('rejects a declaration it cannot honor (%j)', ({ value }) => {
    expect(() => readResultRowsets('read_disks', value)).toThrow(/resultRowsets/);
  });

  it('bounds serialized bytes independently of otherwise legal column names', () => {
    const row = {
      ...inline(),
      columns: Object.fromEntries(
        Array.from({ length: 100 }, (_, i) => [`column-${i}-${'x'.repeat(80)}`, 'number']),
      ),
    };
    expect(Buffer.byteLength(JSON.stringify([row]))).toBeGreaterThan(8192);
    expect(() => readResultRowsets('read_disks', [row])).toThrow(/resultRowsets/);
  });

  it('rejects functions, decorated arrays, prototypes and accessors without calling getters', () => {
    let reads = 0;
    const row = inline();
    Object.defineProperty(row, 'columns', {
      enumerable: true,
      get() {
        reads++;
        return {};
      },
    });
    expect(() => readResultRowsets('read_disks', [row])).toThrow();
    const options = { name: 'read_disks', description: 'Synthetic.', execute: () => [] };
    Object.defineProperty(options, 'resultRowsets', {
      enumerable: true,
      get() {
        reads++;
        return [];
      },
    });
    expect(() => defineTool(options)).toThrow(/resultRowsets/);
    const inherited = Object.create({ resultRowsets: [inline()] }) as object;
    expect(() => resultRowsetsOf('read_disks', inherited)).toThrow();
    expect(() => readResultRowsets('read_disks', [Object.create(inline())])).toThrow();
    expect(() =>
      readResultRowsets('read_disks', [
        {
          ...inline(),
          toJSON() {
            reads++;
            return {};
          },
        },
      ]),
    ).toThrow();
    const list = [inline()];
    Object.defineProperty(list, 'extra', { value: true });
    expect(() => readResultRowsets('read_disks', list)).toThrow();
    expect(reads).toBe(0);
  });

  it('rejects simultaneous contracts locally while leaving old columns untouched', () => {
    expect(() =>
      defineTool({
        name: 'read_disks',
        description: 'Synthetic.',
        resultColumns: { capacity_gb: 'number' },
        resultRowsets: [inline()],
        execute: () => [],
      }),
    ).toThrow(/resultColumns.*resultRowsets/);
    const columns = { capacity_gb: 'number' as const };
    expect(
      defineTool({
        name: 'read_disks',
        description: 'Synthetic.',
        resultColumns: columns,
        execute: () => [],
      }).resultColumns,
    ).toBe(columns);
  });
});
