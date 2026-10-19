/** Fresh scope-bound admission; all stores, identities and failures are synthetic. */
import { getEventListeners } from 'node:events';
import { setImmediate } from 'node:timers/promises';
import { describe, expect, it, vi } from 'vitest';
import { sessionArtifactAdmission } from '../../src/tools/sessionArtifactAdmission.js';
import { ArtifactDetailError } from '../../src/artifacts/detailError.js';
import { bindArtifacts } from '../../src/artifacts/capability.js';
import { inMemoryArtifacts } from '../../src/artifacts/inMemoryArtifacts.js';
import { measureArtifactBytes } from '../../src/artifacts/payload.js';
import type { ArtifactMeta, ArtifactRecord } from '../../src/artifacts/types.js';
import type { ToolExecutionContext } from '../../src/tools/tools.js';

const REF = `art_${'R'.repeat(22)}`;
const OTHER = `art_${'S'.repeat(22)}`;
const KIND = 'evidence/synthetic-reading';
const LIMIT = 1024 * 1024;
const options = { kinds: [KIND], maxBytes: 4096 };

function fixture(data: unknown = { latency: 20 }, patch: Partial<ArtifactMeta> = {}) {
  const meta: ArtifactMeta = {
    ref: REF,
    kind: KIND,
    mediaType: 'application/json',
    bytes: measureArtifactBytes(data),
    createdAt: Date.now() - 1000,
    ...patch,
  };
  const record: ArtifactRecord = { meta, data };
  const head = vi.fn(async (): Promise<ArtifactMeta | null> => meta);
  const get = vi.fn(async (): Promise<ArtifactRecord | null> => record);
  const ctx = {
    sessionId: 'synthetic-session',
    hasArtifacts: true,
    artifacts: { head, get },
  } as unknown as ToolExecutionContext;
  return { ctx, meta, record, head, get };
}

function unavailable(error: unknown): boolean {
  expect(error).toBeInstanceOf(ArtifactDetailError);
  expect(error).toMatchObject({
    code: 'ERR_ARTIFACT_DETAIL_UNAVAILABLE',
    message: 'Artifact detail is unavailable.',
  });
  expect(error).not.toHaveProperty('cause');
  expect(String(error)).not.toContain('PRIVATE');
  return true;
}

async function refused(pending: Promise<unknown>): Promise<void> {
  await expect(pending).rejects.toSatisfy(unavailable);
}

describe('sessionArtifactAdmission', () => {
  it('reads head then get afresh, retains the full record and freezes its detached JSON', async () => {
    const f = fixture(
      { nested: { latency: 20 } },
      { origin: { runId: 'a-different-run' }, parentRefs: [OTHER] },
    );
    const order: string[] = [];
    f.head.mockImplementation(async () => {
      order.push('head');
      return f.meta;
    });
    f.get.mockImplementation(async () => {
      order.push('get');
      return f.record;
    });
    const admit = sessionArtifactAdmission(options);
    const first = await admit(REF, f.ctx),
      second = await admit(REF, f.ctx);
    expect(order).toEqual(['head', 'get', 'head', 'get']);
    expect(first).toEqual(f.record);
    expect(first).not.toBe(f.record);
    expect(first.meta).not.toBe(f.meta);
    expect(first.data).not.toBe(f.record.data);
    expect(second).not.toBe(first);
    expect(Object.isFrozen(first)).toBe(true);
    expect(Object.isFrozen(first.meta)).toBe(true);
    expect(Object.isFrozen(first.meta.origin)).toBe(true);
    expect(Object.isFrozen(first.meta.parentRefs)).toBe(true);
    expect(Object.isFrozen(first.data)).toBe(true);
    expect(Object.isFrozen((first.data as { nested: unknown }).nested)).toBe(true);
    expect(Object.isFrozen(f.meta)).toBe(false);
  });

  it('measures text as raw UTF-8 rather than quoted JSON and preserves structured scalar values', async () => {
    for (const data of ['"\\\n界', '', null, false, 0, [1, 'two']]) {
      const f = fixture(data);
      const maxBytes = Math.max(1, measureArtifactBytes(data));
      expect(
        (await sessionArtifactAdmission({ kinds: [KIND], maxBytes })(REF, f.ctx)).data,
      ).toEqual(data);
    }
  });

  it('copies configuration and gives the check only the immutable admitted record and original context', async () => {
    const kinds = [KIND];
    const f = fixture();
    const check = vi.fn(async (record: ArtifactRecord, ctx: ToolExecutionContext) => {
      expect(ctx).toBe(f.ctx);
      expect(Object.isFrozen(record)).toBe(true);
      expect(Object.isFrozen(record.meta)).toBe(true);
      expect(Object.isFrozen(record.data)).toBe(true);
      return true;
    });
    const admit = sessionArtifactAdmission({ kinds, maxBytes: 100, check });
    kinds[0] = 'different/kind';
    await admit(REF, f.ctx);
    expect(check).toHaveBeenCalledOnce();
  });

  it('treats allowlist kinds as exact strings rather than wildcard patterns', async () => {
    const f = fixture();
    await refused(sessionArtifactAdmission({ kinds: ['evidence/*'], maxBytes: 4096 })(REF, f.ctx));
    expect(f.get).not.toHaveBeenCalled();
  });

  it.each([undefined, '', '   '])(
    'requires a nonempty actual session (%s), without a store read',
    async (sessionId) => {
      const f = fixture();
      await refused(sessionArtifactAdmission(options)(REF, { ...f.ctx, sessionId }));
      expect(f.head).not.toHaveBeenCalled();
      expect(f.get).not.toHaveBeenCalled();
    },
  );

  it('requires a real artifact capability and validates minted refs before reading', async () => {
    for (const ref of [
      REF,
      '',
      'art_missing',
      'https://PRIVATE.invalid',
      `art_${'_'.repeat(22)}`,
    ]) {
      const f = fixture();
      const ctx = ref === REF ? { ...f.ctx, hasArtifacts: false } : f.ctx;
      await refused(sessionArtifactAdmission(options)(ref, ctx));
      expect(f.head).not.toHaveBeenCalled();
      expect(f.get).not.toHaveBeenCalled();
    }
  });

  it('distinguishes no scope identities: foreign, missing, expired and deleted all refuse identically', async () => {
    const store = inMemoryArtifacts();
    const identity = { tenant: 'a', principal: 'reader', conversationId: 'owned' };
    const saved = await store.put(identity, {
      kind: KIND,
      mediaType: 'application/json',
      data: { n: 1 },
    });
    const admit = sessionArtifactAdmission(options);
    for (const scope of [
      { ...identity, tenant: 'b' },
      { ...identity, principal: 'other' },
      { ...identity, conversationId: 'other' },
    ]) {
      const f = fixture();
      await refused(admit(saved.meta.ref, { ...f.ctx, artifacts: bindArtifacts(store, scope) }));
    }
    await store.delete(identity, saved.meta.ref);
    const f = fixture();
    await refused(admit(saved.meta.ref, { ...f.ctx, artifacts: bindArtifacts(store, identity) }));
    f.head.mockResolvedValue(null);
    await refused(admit(REF, f.ctx));
    const expired = fixture({}, { expiresAt: Date.now() - 1 });
    await refused(admit(REF, expired.ctx));
    expect(expired.get).not.toHaveBeenCalled();
  });

  it.each([
    { ref: OTHER },
    { kind: 'not-allowed' },
    { mediaType: '' },
    { bytes: -1 },
    { bytes: 1.5 },
    { bytes: 4097 },
    { bytes: Number.NaN },
    { createdAt: Number.NaN },
    { digest: 'PRIVATE' },
    { parentRefs: ['PRIVATE'] },
    { origin: { runId: 3 } },
    { timeAxis: { column: 'at', unit: 'PRIVATE' } },
  ])('refuses malformed or disallowed metadata before get: %j', async (patch) => {
    const f = fixture();
    f.head.mockResolvedValue({ ...f.meta, ...patch } as ArtifactMeta);
    await refused(sessionArtifactAdmission(options)(REF, f.ctx));
    expect(f.get).not.toHaveBeenCalled();
  });

  it('rejects metadata accessors, unrecognized fields and excessive metadata without invoking getters', async () => {
    const getter = vi.fn(() => 'PRIVATE');
    for (const meta of [
      Object.defineProperty({}, 'ref', { enumerable: true, get: getter }),
      { ...fixture().meta, private: 'PRIVATE' },
      { ...fixture().meta, label: 'x'.repeat(20000) },
    ]) {
      const f = fixture();
      f.head.mockResolvedValue(meta as ArtifactMeta);
      await refused(sessionArtifactAdmission(options)(REF, f.ctx));
      expect(f.get).not.toHaveBeenCalled();
    }
    expect(getter).not.toHaveBeenCalled();
  });

  it('requires head/get metadata and actual canonical payload bytes to agree', async () => {
    for (const changed of [
      { meta: { ...fixture().meta, label: 'changed' }, data: { latency: 20 } },
      { meta: { ...fixture().meta, ref: OTHER }, data: { latency: 20 } },
      { meta: fixture().meta, data: { latency: 20000 } },
      null,
    ]) {
      const f = fixture();
      f.get.mockResolvedValue(changed);
      await refused(sessionArtifactAdmission(options)(REF, f.ctx));
    }
    const f = fixture();
    f.get.mockResolvedValue({
      meta: {
        createdAt: f.meta.createdAt,
        bytes: f.meta.bytes,
        mediaType: f.meta.mediaType,
        kind: KIND,
        ref: REF,
      },
      data: f.record.data,
    });
    expect(await sessionArtifactAdmission(options)(REF, f.ctx)).toEqual(f.record);
  });

  it('refuses lying sizes, binary, non-ordinary JSON, getters, cycles and oversized actual data', async () => {
    const getter = vi.fn(() => 'PRIVATE');
    const cyclic: Record<string, unknown> = {};
    cyclic.self = cyclic;
    for (const data of [
      new Uint8Array([1]),
      new Date(),
      { n: undefined },
      { n: Number.NaN },
      { n: -0 },
      cyclic,
      Object.defineProperty({}, 'secret', { enumerable: true, get: getter }),
      '界'.repeat(100),
      { text: 'x'.repeat(100) },
    ]) {
      const f = fixture();
      f.get.mockResolvedValue({ meta: f.meta, data });
      await refused(sessionArtifactAdmission({ kinds: [KIND], maxBytes: 64 })(REF, f.ctx));
    }
    expect(getter).not.toHaveBeenCalled();
  });

  it('allows an optional digest but leaves its actual verification to the store get owner', async () => {
    const f = fixture({}, { digest: `sha-256:${'a'.repeat(64)}` });
    expect((await sessionArtifactAdmission(options)(REF, f.ctx)).meta.digest).toBe(f.meta.digest);
    f.get.mockRejectedValue(new Error('PRIVATE_DIGEST_FAILURE'));
    await refused(sessionArtifactAdmission(options)(REF, f.ctx));
  });

  it.each([false, undefined, null, 1, 'true', {}])(
    'accepts only explicit true from the narrowing check (%j)',
    async (verdict) => {
      const f = fixture();
      const check = vi.fn(async () => verdict) as unknown as (
        record: ArtifactRecord,
        ctx: ToolExecutionContext,
      ) => Promise<boolean>;
      await refused(sessionArtifactAdmission({ ...options, check })(REF, f.ctx));
    },
  );

  it('cannot authorize replacement or mutation through check and rechecks permission on every call', async () => {
    const f = fixture();
    const mutate = sessionArtifactAdmission({
      ...options,
      check: async (record) => {
        (record.data as { latency: number }).latency = 99;
        return true;
      },
    });
    await refused(mutate(REF, f.ctx));
    expect(f.record.data).toEqual({ latency: 20 });
    let allowed = true;
    const admit = sessionArtifactAdmission({ ...options, check: async () => allowed });
    await admit(REF, f.ctx);
    allowed = false;
    await refused(admit(REF, f.ctx));
    expect(f.head).toHaveBeenCalledTimes(3);
    expect(f.get).toHaveBeenCalledTimes(3);
  });

  it('sanitizes all store/check failures, including a forged typed viewer error', async () => {
    for (const phase of ['head', 'get', 'check'] as const) {
      const f = fixture();
      const error = new ArtifactDetailError('ERR_ARTIFACT_DETAIL_INVALID');
      error.message = 'PRIVATE_FAILURE';
      error.cause = 'PRIVATE_FAILURE';
      const check =
        phase === 'check'
          ? async () => {
              throw error;
            }
          : undefined;
      if (phase !== 'check') f[phase].mockRejectedValue(error);
      await refused(sessionArtifactAdmission({ ...options, check })(REF, f.ctx));
    }
  });

  it('checks expiry again after a host check has waited', async () => {
    const until = Date.now() + 10000,
      f = fixture({}, { expiresAt: until });
    const now = vi.spyOn(Date, 'now').mockReturnValue(until - 1);
    try {
      await refused(
        sessionArtifactAdmission({
          ...options,
          check: async () => {
            now.mockReturnValue(until);
            return true;
          },
        })(REF, f.ctx),
      );
    } finally {
      now.mockRestore();
    }
  });

  it.each(['head', 'get', 'check'] as const)(
    'cancels a non-cooperative %s, removes listeners and discards late rejection',
    async (phase) => {
      const f = fixture(),
        controller = new AbortController();
      let began!: () => void, reject!: (error: unknown) => void;
      const started = new Promise<void>((resolve) => {
        began = resolve;
      });
      const pending = new Promise<never>((_resolve, fail) => {
        reject = fail;
      });
      const wait = () => {
        began();
        return pending;
      };
      const check = phase === 'check' ? wait : undefined;
      if (phase !== 'check') f[phase].mockImplementation(wait);
      const reading = sessionArtifactAdmission({ ...options, check })(REF, {
        ...f.ctx,
        signal: controller.signal,
      });
      await started;
      controller.abort(new Error('PRIVATE_CANCEL_REASON'));
      await expect(reading).rejects.toMatchObject({
        code: 'ERR_ARTIFACT_DETAIL_CANCELLED',
        message: 'Artifact detail request was cancelled.',
      });
      expect(getEventListeners(controller.signal, 'abort')).toHaveLength(0);
      reject(new Error('PRIVATE_LATE_FAILURE'));
      await setImmediate();
      if (phase === 'head') expect(f.get).not.toHaveBeenCalled();
    },
  );

  it('pre-cancelled admission starts nothing and exposes no private abort reason', async () => {
    const f = fixture();
    await expect(
      sessionArtifactAdmission(options)(REF, {
        ...f.ctx,
        signal: AbortSignal.abort('PRIVATE_REASON'),
      }),
    ).rejects.toMatchObject({
      code: 'ERR_ARTIFACT_DETAIL_CANCELLED',
      message: 'Artifact detail request was cancelled.',
    });
    expect(f.head).not.toHaveBeenCalled();
    expect(f.get).not.toHaveBeenCalled();
  });

  it('does not check or deliver a successful get result that arrives after cancellation', async () => {
    const f = fixture(),
      controller = new AbortController(),
      check = vi.fn(async () => true);
    let began!: () => void, resolve!: (record: ArtifactRecord) => void;
    const started = new Promise<void>((yes) => {
      began = yes;
    });
    const late = new Promise<ArtifactRecord>((yes) => {
      resolve = yes;
    });
    f.get.mockImplementation(() => {
      began();
      return late;
    });
    const reading = sessionArtifactAdmission({ ...options, check })(REF, {
      ...f.ctx,
      signal: controller.signal,
    });
    await started;
    controller.abort(new Error('PRIVATE_CANCEL_REASON'));
    await expect(reading).rejects.toMatchObject({ code: 'ERR_ARTIFACT_DETAIL_CANCELLED' });
    resolve(f.record);
    await setImmediate();
    expect(check).not.toHaveBeenCalled();
    expect(getEventListeners(controller.signal, 'abort')).toHaveLength(0);
  });

  it('refuses configuration accessors without calling them or leaking their text', () => {
    const getter = vi.fn(() => {
      throw new Error('PRIVATE_CONFIG');
    });
    const config = Object.defineProperty({}, 'kinds', { enumerable: true, get: getter });
    expect(() => sessionArtifactAdmission(config as never)).toThrow(
      'Invalid session artifact admission configuration.',
    );
    expect(getter).not.toHaveBeenCalled();
  });

  it.each([
    {},
    { kinds: [], maxBytes: 1 },
    { kinds: [''], maxBytes: 1 },
    { kinds: ['   '], maxBytes: 1 },
    { kinds: [KIND, KIND], maxBytes: 1 },
    { kinds: [KIND], maxBytes: 0 },
    { kinds: [KIND], maxBytes: -1 },
    { kinds: [KIND], maxBytes: 1.5 },
    { kinds: [KIND], maxBytes: LIMIT + 1 },
    { kinds: [KIND], maxBytes: Number.NaN },
    { kinds: [KIND], maxBytes: 1, check: 'PRIVATE' },
    { ...options, private: 'PRIVATE' },
  ])('rejects invalid configuration with fixed wording (%j)', (value) => {
    expect(() => sessionArtifactAdmission(value as never)).toThrow(
      'Invalid session artifact admission configuration.',
    );
  });
});
