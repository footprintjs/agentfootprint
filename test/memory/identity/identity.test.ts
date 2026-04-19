/**
 * MemoryIdentity — 5-pattern tests.
 *
 * Verifies the namespace encoding is deterministic + collision-safe +
 * stable across library versions (pins the format so storage adapters
 * can safely use it as a long-lived key).
 */
import { describe, expect, it } from 'vitest';
import { identityNamespace } from '../../../src/memory/identity';
import type { MemoryIdentity } from '../../../src/memory/identity';

// ── Unit ────────────────────────────────────────────────────

describe('identityNamespace — unit', () => {
  it('encodes all three fields in tenant/principal/conversationId order', () => {
    const id: MemoryIdentity = {
      tenant: 'acme',
      principal: 'user-42',
      conversationId: 'thread-7',
    };
    expect(identityNamespace(id)).toBe('acme/user-42/thread-7');
  });

  it('collapses missing tenant to underscore', () => {
    expect(identityNamespace({ principal: 'u1', conversationId: 'c1' })).toBe('_/u1/c1');
  });

  it('collapses missing principal to underscore', () => {
    expect(identityNamespace({ tenant: 't1', conversationId: 'c1' })).toBe('t1/_/c1');
  });

  it('collapses both missing to underscores — shape stays constant', () => {
    expect(identityNamespace({ conversationId: 'c1' })).toBe('_/_/c1');
  });
});

// ── Boundary ────────────────────────────────────────────────

describe('identityNamespace — boundary', () => {
  it('empty string tenant/principal treated same as missing', () => {
    expect(identityNamespace({ tenant: '', principal: '', conversationId: 'c1' })).toBe('_/_/c1');
  });
});

// ── Scenario ────────────────────────────────────────────────

describe('identityNamespace — scenario', () => {
  it('distinct conversations under same principal produce distinct namespaces', () => {
    const base = { tenant: 't', principal: 'u' };
    expect(identityNamespace({ ...base, conversationId: 'a' })).not.toBe(
      identityNamespace({ ...base, conversationId: 'b' }),
    );
  });

  it('same conversationId but different tenants never collide', () => {
    const a = identityNamespace({ tenant: 't1', conversationId: 'shared' });
    const b = identityNamespace({ tenant: 't2', conversationId: 'shared' });
    expect(a).not.toBe(b);
  });
});

// ── Property ────────────────────────────────────────────────

describe('identityNamespace — property', () => {
  it('namespace always has exactly two slashes (3-part shape)', () => {
    const cases: MemoryIdentity[] = [
      { conversationId: 'c' },
      { tenant: 't', conversationId: 'c' },
      { principal: 'p', conversationId: 'c' },
      { tenant: 't', principal: 'p', conversationId: 'c' },
    ];
    for (const id of cases) {
      const ns = identityNamespace(id);
      expect(ns.split('/').length).toBe(3);
    }
  });

  it('function is pure — same input always returns same output', () => {
    const id: MemoryIdentity = { tenant: 't', principal: 'p', conversationId: 'c' };
    const a = identityNamespace(id);
    const b = identityNamespace(id);
    const c = identityNamespace({ ...id });
    expect(a).toBe(b);
    expect(b).toBe(c);
  });
});

// ── Security ────────────────────────────────────────────────

describe('identityNamespace — security', () => {
  it('tenant with embedded slash is passed through (adapter responsibility to reject)', () => {
    // The namespace function is not a validator — it's a deterministic
    // encoder. Storage adapters enforce character safety. This test pins
    // that contract so future "helpful" sanitization doesn't silently
    // change behavior.
    const ns = identityNamespace({ tenant: 'a/b', conversationId: 'c' });
    expect(ns).toBe('a/b/_/c');
  });
});
