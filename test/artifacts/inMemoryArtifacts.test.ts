import { describe, expect, it } from 'vitest';
import { inMemoryArtifacts } from '../../src/artifacts/inMemoryArtifacts.js';

describe('unit: put detaches from the caller (the checked-in parcel law)', () => {
  it('mutating the object after put does not change what get returns', async () => {
    const store = inMemoryArtifacts();
    const scope = { conversationId: 'c1' };
    const data: Record<string, unknown> = { rows: [1, 2, 3] };
    const { meta } = await store.put(scope, {
      kind: 'dataset/rows',
      mediaType: 'application/json',
      data,
    });
    data.rows = ['MUTATED'];
    const back = await store.get(scope, meta.ref);
    expect(back?.data).toEqual({ rows: [1, 2, 3] });
  });

  it('mutating one get result does not corrupt a later get', async () => {
    const store = inMemoryArtifacts();
    const scope = { conversationId: 'c1' };
    const { meta } = await store.put(scope, {
      kind: 'dataset/rows',
      mediaType: 'application/json',
      data: { a: 1 },
    });
    const first = (await store.get(scope, meta.ref)) as { data: Record<string, unknown> };
    first.data.a = 999;
    const second = await store.get(scope, meta.ref);
    expect(second?.data).toEqual({ a: 1 });
  });
});
