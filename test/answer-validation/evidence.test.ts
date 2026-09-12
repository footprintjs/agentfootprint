import { describe, expect, it, vi } from 'vitest';
import { createAnswerEvidenceResolver } from '../../src/answer-validation/evidence.js';
import { inMemoryArtifacts } from '../../src/artifacts/inMemoryArtifacts.js';
import { ArtifactIntegrityError, type ArtifactStore } from '../../src/artifacts/types.js';

const scope = { tenant: 'synthetic-shop', principal: 'reader', conversationId: 'turns' };
const limits = { maxReads: 4, maxBytes: 1024 };
const signal = () => new AbortController().signal;
const put = (store: ArtifactStore, data: unknown = { total: 42 }) =>
  store.put(scope, {
    kind: 'dataset/rows',
    mediaType: 'application/json',
    data,
    digest: 'sha-256',
  });

describe('unit: bounded scope-bound validation evidence', () => {
  it('resolves exact kinds, caches duplicate calls, and returns detached records', async () => {
    const store = inMemoryArtifacts();
    const { meta } = await put(store);
    const head = vi.spyOn(store, 'head');
    const get = vi.spyOn(store, 'get');
    const session = createAnswerEvidenceResolver(store, scope, limits, signal());
    const first = await session.resolver.resolve(meta.ref, { kind: 'dataset/rows' });
    const second = await session.resolver.resolve(meta.ref, { kind: 'dataset/rows' });
    expect(first.ok && first.record.data).toEqual({ total: 42 });
    expect(second.ok && second.record.meta.digest).toMatch(/^sha-256:/);
    expect(head).toHaveBeenCalledTimes(1);
    expect(get).toHaveBeenCalledTimes(1);
    expect(session.resolvedRefs()).toEqual([meta.ref]);
    if (first.ok && second.ok) {
      expect(first.record).not.toBe(second.record);
      (first.record.data as { total: number }).total = 99;
      expect(second.record.data).toEqual({ total: 42 });
      expect((await store.get(scope, meta.ref))?.data).toEqual({ total: 42 });
    }
  });

  it('refuses foreign scopes and wrong kinds without loading bytes or listing alternatives', async () => {
    const store = inMemoryArtifacts();
    const { meta } = await put(store);
    const get = vi.spyOn(store, 'get');
    const list = vi.spyOn(store, 'list');
    for (const other of [
      { ...scope, tenant: 'other' },
      { ...scope, principal: 'other' },
      { ...scope, conversationId: 'other' },
    ]) {
      const session = createAnswerEvidenceResolver(store, other, limits, signal());
      expect(await session.resolver.resolve(meta.ref, { kind: 'dataset/rows' })).toEqual({
        ok: false,
        reason: 'missing-or-expired',
      });
    }
    const session = createAnswerEvidenceResolver(store, scope, limits, signal());
    expect(await session.resolver.resolve(meta.ref, { kind: 'dataset/*' })).toEqual({
      ok: false,
      reason: 'kind-mismatch',
    });
    expect(get).not.toHaveBeenCalled();
    expect(list).not.toHaveBeenCalled();
  });

  it('refuses over-budget payloads before get and reserves aggregate bytes across parallel reads', async () => {
    const store = inMemoryArtifacts();
    const a = await put(store, '123456');
    const b = await put(store, 'abcdef');
    const get = vi.spyOn(store, 'get');
    const small = createAnswerEvidenceResolver(
      store,
      scope,
      { maxReads: 4, maxBytes: 5 },
      signal(),
    );
    expect(await small.resolver.resolve(a.meta.ref, { kind: 'dataset/rows' })).toEqual({
      ok: false,
      reason: 'max-bytes',
    });
    expect(get).not.toHaveBeenCalled();
    const session = createAnswerEvidenceResolver(
      store,
      scope,
      { maxReads: 4, maxBytes: 10 },
      signal(),
    );
    const outcomes = await Promise.all(
      [a, b].map(({ meta }) => session.resolver.resolve(meta.ref, { kind: 'dataset/rows' })),
    );
    expect(outcomes.map((outcome) => outcome.ok).sort()).toEqual([false, true]);
    expect(get).toHaveBeenCalledTimes(1);
  });

  it('limits distinct lookup attempts, including missing refs, and does not widen scope after binding', async () => {
    const store = inMemoryArtifacts();
    const { meta } = await put(store);
    const callerScope = { ...scope };
    const session = createAnswerEvidenceResolver(
      store,
      callerScope,
      { ...limits, maxReads: 1 },
      signal(),
    );
    callerScope.tenant = 'other';
    expect((await session.resolver.resolve(meta.ref, { kind: 'dataset/rows' })).ok).toBe(true);
    expect(
      await session.resolver.resolve('art_aaaaaaaaaaaaaaaaaaaaaa', { kind: 'dataset/rows' }),
    ).toEqual({ ok: false, reason: 'max-reads' });
  });

  it('a get that expires or fails integrity never delivers a record', async () => {
    const store = inMemoryArtifacts();
    const { meta } = await put(store);
    const get = vi
      .spyOn(store, 'get')
      .mockResolvedValueOnce(null)
      .mockRejectedValueOnce(new ArtifactIntegrityError(meta.ref, 'expected', 'actual'));
    for (const reason of ['missing-or-expired', 'digest-mismatch']) {
      const session = createAnswerEvidenceResolver(store, scope, limits, signal());
      expect(await session.resolver.resolve(meta.ref, { kind: 'dataset/rows' })).toEqual({
        ok: false,
        reason,
      });
      expect(session.resolvedRefs()).toEqual([]);
    }
    expect(get).toHaveBeenCalledTimes(2);
  });

  it('rechecks returned metadata and actual bytes rather than trusting head blindly', async () => {
    const store = inMemoryArtifacts();
    const { meta } = await put(store);
    for (const record of [
      { meta: { ...meta, kind: 'other' }, data: { total: 42 } },
      { meta: { ...meta, ref: 'art_aaaaaaaaaaaaaaaaaaaaaa' }, data: { total: 42 } },
      { meta, data: 'much larger than the advertised record'.repeat(50) },
    ]) {
      const wrapped = { ...store, get: vi.fn(async () => record) };
      const session = createAnswerEvidenceResolver(wrapped, scope, limits, signal());
      expect((await session.resolver.resolve(meta.ref, { kind: 'dataset/rows' })).ok).toBe(false);
      expect(session.resolvedRefs()).toEqual([]);
    }
  });

  it('no store, invalid inputs and closed capability are explicit absences', async () => {
    const session = createAnswerEvidenceResolver(undefined, scope, limits, signal());
    expect(
      await session.resolver.resolve('art_aaaaaaaaaaaaaaaaaaaaaa', { kind: 'dataset/rows' }),
    ).toEqual({ ok: false, reason: 'no-store' });
    expect(await session.resolver.resolve('../secret', { kind: 'dataset/rows' })).toEqual({
      ok: false,
      reason: 'invalid-input',
    });
    session.close();
    expect(
      await session.resolver.resolve('art_aaaaaaaaaaaaaaaaaaaaaa', { kind: 'dataset/rows' }),
    ).toEqual({ ok: false, reason: 'closed' });
  });
});
