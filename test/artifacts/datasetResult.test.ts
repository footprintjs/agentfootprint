import { describe, expect, it, vi } from 'vitest';
import { bindArtifacts, inMemoryArtifacts, withDatasetArtifacts } from '../../src/artifacts';
import type { DatasetResultPlan, ToolArtifactPutInput } from '../../src/artifacts';
import type { Tool, ToolExecutionContext } from '../../src/core/tools';

const input = (data: unknown) => ({ kind: 'dataset/rows', mediaType: 'application/json', data });
function setup(maxArtifacts = 100) {
  const store = inMemoryArtifacts({ retention: { maxCountPerScope: maxArtifacts } });
  const artifacts = bindArtifacts(
    store,
    { conversationId: 'one' },
    { origin: { runId: 'run', toolCallId: 'lookup' } },
  );
  const ctx = { hasArtifacts: true, artifacts } as ToolExecutionContext;
  const value = { rows: [{ id: 1 }], coverage: { checked: 'one source' } };
  const tool: Tool = {
    schema: { name: 'lookup', description: 'fixture', inputSchema: { type: 'object' } },
    source: 'fixture',
    resultKind: 'dataset/rows',
    execute: async () => value,
  };
  return { store, artifacts, ctx, value, tool };
}

describe('declared dataset result publication', () => {
  it('stores separate complete datasets with source lineage and preserves the tool contract', async () => {
    const { tool, ctx, artifacts } = setup();
    const plan: DatasetResultPlan<unknown> = {
      datasets: [
        {
          key: 'first',
          artifact: input([{ id: 1 }, { id: 2 }]),
          source: input({ source: 'fixture', version: 4 }),
        },
        { key: 'second', artifact: input([{ id: 9 }]) },
      ],
      project(publications) {
        return publications;
      },
    };
    const adapted = withDatasetArtifacts(tool, { describe: () => plan });
    expect(adapted.schema).toBe(tool.schema);
    expect(adapted.source).toBe(tool.source);
    expect(adapted.resultKind).toBe(tool.resultKind);
    const receipts = (await adapted.execute({}, ctx)) as any[];
    expect(receipts.map((x) => x.key)).toEqual(['first', 'second']);
    const a = receipts[0].artifact.meta,
      b = receipts[1].artifact.meta;
    expect(a.ref).not.toBe(b.ref);
    expect(a.parentRefs).toEqual([receipts[0].source.meta.ref]);
    expect(a.origin).toEqual({ runId: 'run', toolCallId: 'lookup' });
    expect((await artifacts.get(a.ref))?.data).toEqual([{ id: 1 }, { id: 2 }]);
  });

  it('passes through absent declarations and a storeless execution without inspecting data', async () => {
    const { tool, ctx, value } = setup();
    const describe = vi.fn(() => undefined);
    expect(
      await withDatasetArtifacts(tool, { describe }).execute({}, { ...ctx, hasArtifacts: false }),
    ).toBe(value);
    expect(describe).not.toHaveBeenCalled();
    expect(await withDatasetArtifacts(tool, { describe }).execute({}, ctx)).toBe(value);
  });

  it('preserves original execute receiver, arguments, context and adapter method receivers', async () => {
    const { tool, ctx } = setup();
    const args = { id: 4 };
    tool.execute = function (seen, context) {
      expect(this).toBe(tool);
      expect(seen).toBe(args);
      expect(context).toBe(ctx);
      return 'result';
    };
    const plan: DatasetResultPlan<string> = {
      datasets: [],
      project() {
        expect(this).toBe(plan);
        return 'projected';
      },
    };
    const adapter = {
      describe(result: unknown, seen: unknown) {
        expect(this).toBe(adapter);
        expect(result).toBe('result');
        expect(seen).toBe(args);
        return plan;
      },
    };
    expect(await withDatasetArtifacts(tool, adapter).execute(args, ctx)).toBe('projected');
  });

  it.each(['duplicate', 'empty', 'bad-input'])(
    'rejects a %s declaration before writing any artifact',
    async (failure) => {
      const { tool, ctx } = setup();
      const put = vi.spyOn(ctx.artifacts, 'put');
      const second =
        failure === 'duplicate'
          ? { key: 'a', artifact: input([]) }
          : failure === 'empty'
          ? { key: '', artifact: input([]) }
          : { key: 'b', artifact: { ...input([]), kind: '' } };
      const adapted = withDatasetArtifacts(tool, {
        describe: () => ({
          datasets: [{ key: 'a', artifact: input([]) }, second],
          project: (x) => x,
        }),
      });
      await expect(adapted.execute({}, ctx)).rejects.toThrow(/dataset/i);
      expect(put).not.toHaveBeenCalled();
    },
  );

  it('isolates a later write failure and never advertises an unminted ticket', async () => {
    const { tool, ctx, artifacts } = setup();
    const put = artifacts.put.bind(artifacts);
    vi.spyOn(artifacts, 'put').mockImplementation((x) =>
      x.label === 'fails' ? Promise.reject(new Error('private backend detail')) : put(x),
    );
    const receipts = (await withDatasetArtifacts(tool, {
      describe: () => ({
        datasets: [
          { key: 'good', artifact: input([1, 2]) },
          { key: 'bad', artifact: { ...input([3]), label: 'fails' } },
        ],
        project: (x) => x,
      }),
    }).execute({}, ctx)) as any[];
    expect(receipts[0].artifact.status).toBe('stored');
    expect(receipts[1]).toEqual({
      key: 'bad',
      artifact: { status: 'unavailable', reason: 'store-unavailable' },
    });
    expect(JSON.stringify(receipts)).not.toContain('private backend');
    expect(await artifacts.get(receipts[0].artifact.meta.ref)).not.toBeNull();
  });

  describe.each(['artifact', 'source'] as const)('%s parentRefs preflight', (target) => {
    it.each([
      { label: 'number', value: 7 },
      { label: 'string', value: 'art_not_an_array' },
      { label: 'null', value: null },
      { label: 'object', value: { ref: 'art_not_an_array' } },
      { label: 'non-string member', value: ['art_string', 7] },
      { label: 'sparse member', value: new Array(1) },
    ])('rejects $label before any dataset or source write', async ({ value }) => {
      const { tool, ctx } = setup();
      const put = vi.spyOn(ctx.artifacts, 'put');
      const project = vi.fn((publications) => publications);
      const malformed = { ...input([]), parentRefs: value } as unknown as ToolArtifactPutInput;
      const adapted = withDatasetArtifacts(tool, {
        describe: () => ({
          datasets: [
            { key: 'earlier', artifact: input([1]), source: input({ origin: 'fixture' }) },
            {
              key: 'later',
              artifact: input([2]),
              source: input({ origin: 'fixture' }),
              [target]: malformed,
            },
          ],
          project,
        }),
      });
      await expect(adapted.execute({}, ctx)).rejects.toThrow(/parentRefs.*array of strings/);
      expect(put).not.toHaveBeenCalled();
      expect(project).not.toHaveBeenCalled();
    });
  });

  it('keeps rows when source storage fails and does not invent the missing parent', async () => {
    const { tool, ctx, artifacts } = setup();
    const put = artifacts.put.bind(artifacts);
    vi.spyOn(artifacts, 'put').mockImplementation((x) =>
      x.label === 'source' ? Promise.reject(new Error('offline')) : put(x),
    );
    const receipts = (await withDatasetArtifacts(tool, {
      describe: () => ({
        datasets: [
          {
            key: 'rows',
            artifact: input([1]),
            source: { ...input({ covered: true }), label: 'source' },
          },
        ],
        project: (x) => x,
      }),
    }).execute({}, ctx)) as any[];
    expect(receipts[0].artifact.status).toBe('stored');
    expect(receipts[0].artifact.meta.parentRefs).toBeUndefined();
    expect(receipts[0].source).toEqual({ status: 'unavailable', reason: 'store-unavailable' });
  });

  it('does not discard existing parents when adding a source parent', async () => {
    const { tool, ctx, artifacts } = setup();
    const parent = await artifacts.put(input('upstream'));
    const receipts = (await withDatasetArtifacts(tool, {
      describe: () => ({
        datasets: [
          {
            key: 'rows',
            artifact: { ...input([1]), parentRefs: [parent.ref] },
            source: input({ source: true }),
          },
        ],
        project: (x) => x,
      }),
    }).execute({}, ctx)) as any[];
    expect(receipts[0].artifact.meta.parentRefs).toEqual([parent.ref, receipts[0].source.meta.ref]);
  });

  it('reports tickets evicted during a batch as unavailable before projection', async () => {
    const { tool, ctx } = setup(1);
    const receipts = (await withDatasetArtifacts(tool, {
      describe: () => ({
        datasets: [
          { key: 'a', artifact: input([1]) },
          { key: 'b', artifact: input([2]) },
        ],
        project: (x) => x,
      }),
    }).execute({}, ctx)) as any[];
    expect(receipts[0].artifact).toEqual({ status: 'unavailable', reason: 'missing-or-expired' });
    expect(receipts[1].artifact.status).toBe('stored');
  });

  it('does not replace a thrown tool error with a dataset success', async () => {
    const { tool, ctx } = setup();
    const error = new Error('tool refused');
    tool.execute = async () => {
      throw error;
    };
    const describe = vi.fn();
    await expect(withDatasetArtifacts(tool, { describe }).execute({}, ctx)).rejects.toBe(error);
    expect(describe).not.toHaveBeenCalled();
  });
});
