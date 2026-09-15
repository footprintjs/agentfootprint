/** Adapter preservation, not inference or verification of the producer's facts. */
import { describe, expect, it, vi } from 'vitest';
import {
  absent,
  coverage,
  semantic,
  bindArtifacts,
  inMemoryArtifacts,
  withDatasetArtifacts,
} from '../../src/index.js';
import type { Tool, ToolExecutionContext } from '../../src/index.js';
import { checkSemantics, coerceSemanticsCatalog } from '../../src/lib/semantics/index.js';

function boundary(result: unknown, project: () => unknown, describeResult?: (value: any) => void) {
  const artifacts = bindArtifacts(inMemoryArtifacts(), {
    principal: 'alice',
    conversationId: 'projection',
  });
  const ctx = { hasArtifacts: true, artifacts } as ToolExecutionContext;
  const tool: Tool = {
    schema: { name: 'lookup', inputSchema: { type: 'object' } },
    execute: async () => result,
  };
  return {
    artifacts,
    execute: () =>
      withDatasetArtifacts(tool, {
        describe(value) {
          describeResult?.(value);
          return { datasets: [], project };
        },
      }).execute({}, ctx),
  };
}
const empty = () =>
  absent({
    what: 'matching inventory',
    checked: ['snapshot A'],
    notChecked: ['older snapshots'],
    cannotCover: [{ what: 'live state', why: 'snapshot only' }],
    tryInstead: 'Choose another snapshot.',
  });
const bounded = () =>
  coverage(
    { rows: [{ id: 'one', missing: null, count: 0 }] },
    {
      checked: ['snapshot A'],
      notChecked: ['truncated rows'],
      cannotCover: [{ what: 'live state', why: 'snapshot only' }],
    },
  );
const clarification = () =>
  semantic({
    clarify: {
      question: 'Which snapshot?',
      candidates: [
        { id: 'A', count: 0 },
        { id: 'B', count: null },
      ],
    },
  });

describe('declared semantics survive dataset projection', () => {
  it.each([
    ['absence', empty],
    ['bounded absence', () => coverage(empty(), { checked: ['one source'] })],
    ['coverage', bounded],
    ['clarify', clarification],
  ] as const)('refuses erased %s declarations', async (_, source) => {
    await expect(
      boundary(source(), () => ({ dataset: { ref: 'not-a-real-ref' } })).execute(),
    ).rejects.toThrow(/projection.*declaration/i);
  });

  it('preserves the original baseline even when describe mutates the producer result', async () => {
    const source = bounded();
    await expect(
      boundary(
        source,
        () => source,
        (value) => {
          delete value.af_coverage.not_checked;
        },
      ).execute(),
    ).rejects.toThrow(/not_checked/);
  });

  it('checks a mutating describe even when it declares pass-through', async () => {
    const result = bounded();
    const tool: Tool = {
      schema: { name: 'lookup', inputSchema: { type: 'object' } },
      execute: async () => result,
    };
    const ctx = {
      hasArtifacts: true,
      artifacts: bindArtifacts(inMemoryArtifacts(), { conversationId: 'mutated-pass-through' }),
    } as ToolExecutionContext;
    await expect(
      withDatasetArtifacts(tool, {
        describe() {
          delete (result.af_coverage as any).not_checked;
          return undefined;
        },
      }).execute({}, ctx),
    ).rejects.toThrow(/not_checked/);
  });

  it('preserves equivalent metadata reconstructed in a different object-key order', async () => {
    const source = semantic({
      facts: [{ entity: 'one' }],
      provenance: { measured_at: 'snapshot', source: 'fixture' },
      grain: { aggregation: 'average', is_counter: false },
    });
    const after = {
      ...source,
      provenance: { source: 'fixture', measured_at: 'snapshot' },
      grain: { is_counter: false, aggregation: 'average' },
    };
    expect(await boundary(source, () => after).execute()).toBe(after);
  });

  it('allows ticket projection with exact coverage and unrelated additional metadata', async () => {
    const source = bounded();
    const result = { ...source, result: { dataset: { ref: 'ticket' } }, added: 'new metadata' };
    expect(await boundary(source, () => result).execute()).toBe(result);
  });

  it('preserves known absence, semantic provenance/grain/clarification and recognized effect wrappers', async () => {
    const sem = semantic({
      facts: [{ entity: 'one', value: 0 }],
      provenance: { measured_at: 'snapshot', source: 'fixture' },
      grain: { aggregation: 'average', is_counter: false },
      clarify: { question: 'Which?', candidates: [null, 0] },
    });
    for (const source of [
      empty(),
      coverage(empty(), { checked: ['source'] }),
      clarification(),
      sem,
      { content: bounded(), effects: [], status: 'partial' },
    ]) {
      expect(await boundary(source, () => structuredClone(source)).execute()).toEqual(source);
    }
    await expect(
      boundary(sem, () => ({ ...sem, grain: { aggregation: 'sum', is_counter: false } })).execute(),
    ).rejects.toThrow(/grain/);
  });

  it('protects native effect declarations with non-enumerable or symbol bookkeeping', async () => {
    const hidden = Object.defineProperty(
      { content: {}, effects: [], status: 'failure' },
      'bookkeeping',
      { value: 'internal' },
    );
    const symbol = {
      content: {},
      effects: [],
      status: 'failure',
      [Symbol('bookkeeping')]: 'internal',
    };
    for (const source of [hidden, symbol]) {
      await expect(
        boundary(source, () => ({ dataset: 'FALSE_SUCCESS' })).execute(),
      ).rejects.toThrow(/declaration/);
      expect(
        await boundary(source, () => ({
          content: 'ticket',
          effects: [],
          status: 'failure',
        })).execute(),
      ).toEqual({ content: 'ticket', effects: [], status: 'failure' });
    }
  });

  it('does not read source rows or infer declarations from legacy empty/null values', async () => {
    const rows = vi.fn(() => {
      throw new Error('ROWS_MUST_NOT_BE_SCANNED');
    });
    const source = bounded();
    Object.defineProperty(source.result, 'rows', { get: rows });
    await boundary(source, () => ({ ...source, result: { dataset: 'ticket' } })).execute();
    expect(rows).not.toHaveBeenCalled();
    for (const legacy of [
      null,
      [],
      { rows: [], missing: null },
      { coverage: { missed: 'ordinary application field' } },
    ]) {
      expect(await boundary(legacy, () => 'legacy projection').execute()).toBe('legacy projection');
    }
  });

  it('does not enumerate an ordinary payload to discover declarations', async () => {
    const enumerate = vi.fn(() => {
      throw new Error('ordinary payload keys must not be enumerated');
    });
    const source = new Proxy({ rows: [] }, { ownKeys: enumerate });
    expect(await boundary(source, () => 'legacy projection').execute()).toBe('legacy projection');
    expect(enumerate).not.toHaveBeenCalled();
  });

  it('refuses inherited native declarations and wrapper fields without executing accessors', async () => {
    const absence = empty();
    const wrapped = bounded();
    const getter = vi.fn(() => {
      throw new Error('PRIVATE_INHERITED_VALUE');
    });
    const inheritedGetter = Object.create(Object.defineProperty({}, 'af_absent', { get: getter }));
    const inheritedCoverageField = Object.create({ not_checked: ['older snapshots'] });
    inheritedCoverageField.checked = ['snapshot A'];
    const values = [
      Object.create(absence),
      Object.assign(Object.create({ checked: absence.checked }), { af_absent: true }),
      Object.create(wrapped),
      Object.assign(Object.create({ result: [] }), { af_coverage: wrapped.af_coverage }),
      { result: [], af_coverage: inheritedCoverageField },
      Object.create(clarification()),
      Object.assign(Object.create({ clarify: clarification().clarify }), { af_semantics: true }),
      Object.assign(Object.create({ content: {} }), { effects: [], status: 'failure' }),
      Object.assign(Object.create({ effects: [], status: 'failure' }), { content: {} }),
      inheritedGetter,
    ];
    for (const value of values) {
      const error = await boundary(value, () => ({ dataset: 'FALSE_SUCCESS' }))
        .execute()
        .catch((error) => error);
      expect(error).toBeInstanceOf(Error);
      expect(error.message).toMatch(/projection.*declaration/i);
      expect(error.message).not.toContain('PRIVATE_INHERITED_VALUE');
    }
    expect(getter).not.toHaveBeenCalled();
  });

  it('refuses unreadable recognized metadata without invoking getters or echoing values', async () => {
    const source = bounded();
    const getter = vi.fn(() => {
      throw new Error('PRIVATE_VALUE');
    });
    Object.defineProperty(source.af_coverage, 'not_checked', { get: getter });
    const error = await boundary(source, () => ({}))
      .execute()
      .catch((error) => error);
    expect(error).toBeInstanceOf(Error);
    expect(error.message).toMatch(/projection.*declaration/i);
    expect(error.message).not.toContain('PRIVATE_VALUE');
    expect(getter).not.toHaveBeenCalled();
    const cyclic: any = { what: 'PRIVATE_VALUE' };
    cyclic.self = cyclic;
    await expect(
      boundary({ af_coverage: { not_checked: [cyclic] }, result: [] }, () => ({})).execute(),
    ).rejects.toThrow(/declaration/);
  });

  it('rejects bounded metadata overflow instead of dropping its limits', async () => {
    const source = coverage([], { notChecked: ['x'.repeat(70_000)] });
    await expect(boundary(source, () => ({})).execute()).rejects.toThrow(/declaration/);
  });

  it('reuses the same paired comparison in the optional build-time semantics catalog', () => {
    const source = bounded();
    const entries = coerceSemanticsCatalog([
      {
        name: 'lookup',
        results: [source],
        projections: [{ before: source, after: { result: { dataset: 'ticket' } } }],
      },
    ]);
    const report = checkSemantics(entries);
    expect(report.ok).toBe(false);
    expect(report.findings).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          tool: 'lookup',
          severity: 'error',
          code: 'projection-declaration-changed',
          field: expect.stringContaining('af_coverage'),
        }),
      ]),
    );
    expect(checkSemantics([{ name: 'lookup', results: [source] }]).ok).toBe(true);
  });
});
