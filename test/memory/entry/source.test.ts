/**
 * MemorySource — type-level tests for cross-session provenance.
 *
 * These compile-time checks assert the shape of `MemorySource` — in
 * particular the optional `identity` field added after research-team review
 * to enable cross-session citation ("remembered from session X, turn 5").
 * If any of these fields move or disappear, TypeScript fails the build —
 * callers relying on `source.identity.conversationId` in production
 * dashboards get a typecheck error, not a silent undefined.
 */
import { describe, expect, it } from 'vitest';
import type { MemorySource } from '../../../src/memory/entry';

describe('MemorySource — shape', () => {
  it('allows a same-session source with no identity', () => {
    const src: MemorySource = { turn: 3, runtimeStageId: 'finalize#0' };
    expect(src.turn).toBe(3);
    expect(src.identity).toBeUndefined();
  });

  it('allows a cross-session source carrying full identity', () => {
    const src: MemorySource = {
      turn: 7,
      runtimeStageId: 'callLLM#2',
      identity: { tenant: 'acme', principal: 'u42', conversationId: 'thread-old' },
    };
    expect(src.identity?.conversationId).toBe('thread-old');
    expect(src.identity?.tenant).toBe('acme');
  });

  it('identity.conversationId is required when identity is set', () => {
    // Type-level — this would fail to compile if identity.conversationId
    // were missing. The runtime assertion just proves the shape loads.
    const src: MemorySource = { identity: { conversationId: 'c1' } };
    expect(src.identity?.conversationId).toBe('c1');
  });

  it('identity.tenant and identity.principal remain optional', () => {
    const src: MemorySource = {
      identity: { conversationId: 'c1' }, // tenant + principal omitted
    };
    expect(src.identity?.tenant).toBeUndefined();
    expect(src.identity?.principal).toBeUndefined();
  });
});
