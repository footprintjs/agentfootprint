/**
 * The `ctx.artifacts` capability in isolation: scope pre-bound (a tool can
 * never widen it), origin stamped by the framework (never caller-supplied),
 * facts reported to the sink AS THEY HAPPEN, and the fail-closed teacher when
 * no store is attached.
 */

import { describe, it, expect } from 'vitest';
import {
  bindArtifacts,
  inMemoryArtifacts,
  mintArtifactRef,
  unconfiguredArtifacts,
  ArtifactIntegrityError,
  UnknownParentRefError,
  type ArtifactEventFact,
  type ArtifactScope,
} from '../../src/index.js';

const SCOPE: ArtifactScope = { conversationId: 'conv-cap' };

const sink = () => {
  const facts: ArtifactEventFact[] = [];
  return { facts, onEvent: (fact: ArtifactEventFact) => facts.push(fact) };
};

describe('bindArtifacts — the framework binding', () => {
  it('put stamps the FRAMEWORK origin and reports expired-then-minted, in order', async () => {
    const store = inMemoryArtifacts({ retention: { maxCountPerScope: 1 } });
    const { facts, onEvent } = sink();
    const bound = bindArtifacts(store, SCOPE, {
      origin: { runId: 'run-1', toolCallId: 'call-1' },
      onEvent,
    });
    const first = await bound.put({ kind: 'a', mediaType: 't', data: '1' });
    expect(first.origin).toEqual({ runId: 'run-1', toolCallId: 'call-1' });
    const second = await bound.put({ kind: 'b', mediaType: 't', data: '2' });
    expect(second.origin).toEqual({ runId: 'run-1', toolCallId: 'call-1' });
    expect(facts.map((f) => f.type)).toEqual(['minted', 'expired', 'minted']);
    const expired = facts[1] as Extract<ArtifactEventFact, { type: 'expired' }>;
    expect(expired.swept).toMatchObject({ ref: first.ref, reason: 'max-count' });
  });

  it('a caller-smuggled origin is discarded — origin is the framework’s field', async () => {
    const store = inMemoryArtifacts();
    const bound = bindArtifacts(store, SCOPE, { origin: { runId: 'true-run' } });
    const meta = await bound.put({
      kind: 'k',
      mediaType: 't',
      data: 'x',
      // @ts-expect-error — origin is not on ToolArtifactPutInput; a JS caller
      // could still pass it, so the runtime must discard it too.
      origin: { runId: 'forged' },
    });
    expect(meta.origin).toEqual({ runId: 'true-run' });
  });

  it('head/get report resolved on a hit and refused(missing-or-expired) on a miss — API stays null', async () => {
    const store = inMemoryArtifacts();
    const { facts, onEvent } = sink();
    const bound = bindArtifacts(store, SCOPE, { onEvent });
    const meta = await bound.put({ kind: 'k', mediaType: 't', data: 'x' });
    expect(await bound.head(meta.ref)).not.toBeNull();
    expect((await bound.get(meta.ref))?.data).toBe('x');
    const ghost = mintArtifactRef();
    expect(await bound.get(ghost)).toBeNull();
    expect(facts.map((f) => f.type)).toEqual(['minted', 'resolved', 'resolved', 'refused']);
    expect(facts[1]).toMatchObject({ via: 'head', ref: meta.ref });
    expect(facts[2]).toMatchObject({ via: 'get', bytes: 1 });
    expect(facts[3]).toMatchObject({ op: 'get', reason: 'missing-or-expired', ref: ghost });
  });

  it('the scope is CLOSED OVER — the same binding cannot see another scope’s refs', async () => {
    const store = inMemoryArtifacts();
    const boundA = bindArtifacts(store, { conversationId: 'a' });
    const boundB = bindArtifacts(store, { conversationId: 'b' });
    const meta = await boundA.put({ kind: 'k', mediaType: 't', data: 'x' });
    expect(await boundB.get(meta.ref)).toBeNull();
    expect(await boundA.get(meta.ref)).not.toBeNull();
  });

  it('an unknown parent refuses: fact reported, error rethrown, nothing stored', async () => {
    const store = inMemoryArtifacts();
    const { facts, onEvent } = sink();
    const bound = bindArtifacts(store, SCOPE, { onEvent });
    await expect(
      bound.put({ kind: 'k', mediaType: 't', data: 'x', parentRefs: [mintArtifactRef()] }),
    ).rejects.toThrow(UnknownParentRefError);
    expect(facts).toHaveLength(1);
    expect(facts[0]).toMatchObject({ type: 'refused', op: 'put', reason: 'unknown-parent' });
    expect((await bound.list()).artifacts).toEqual([]);
  });

  it('a digest mismatch reports refused(digest-mismatch) and rethrows the teaching error', async () => {
    // Verification lives in the STORE (adapter suites pin real tampering);
    // here the binding must relay an integrity refusal as a fact + rethrow.
    const store = inMemoryArtifacts();
    const { facts, onEvent } = sink();
    const ref = mintArtifactRef();
    const verifying = {
      ...store,
      get: async (): Promise<never> => {
        throw new ArtifactIntegrityError(ref, 'sha-256:aaaa', 'sha-256:beef');
      },
    };
    const bound = bindArtifacts(verifying, SCOPE, { onEvent });
    await expect(bound.get(ref)).rejects.toThrow(ArtifactIntegrityError);
    expect(facts).toHaveLength(1);
    expect(facts[0]).toMatchObject({ type: 'refused', op: 'get', reason: 'digest-mismatch', ref });
  });
});

describe('unconfiguredArtifacts — the fail-closed teacher', () => {
  it('every verb throws the SAME teaching refusal naming the door, and reports no-store', async () => {
    const { facts, onEvent } = sink();
    const teacher = unconfiguredArtifacts(onEvent);
    for (const call of [
      () => teacher.put({ kind: 'k', mediaType: 't', data: 'x' }),
      () => teacher.head(mintArtifactRef()),
      () => teacher.get(mintArtifactRef()),
      () => teacher.delete(mintArtifactRef()),
      () => teacher.list(),
    ]) {
      await expect(call()).rejects.toThrow(/Agent\.create\(\{ \.\.\., artifacts \}\)/);
      await expect(call()).rejects.toThrow(/hasArtifacts/);
    }
    expect(facts.every((f) => f.type === 'refused' && f.reason === 'no-store')).toBe(true);
    expect(facts.map((f) => (f as { op: string }).op)).toEqual([
      'put',
      'put',
      'head',
      'head',
      'get',
      'get',
      'delete',
      'delete',
      'list',
      'list',
    ]);
  });

  it('works without a sink too — silence is allowed, lying is not', async () => {
    const teacher = unconfiguredArtifacts();
    await expect(teacher.list()).rejects.toThrow(/No artifact store is attached/);
  });
});
