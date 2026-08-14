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
  it('tenant with embedded slash is ESCAPED, not passed through', () => {
    // This test used to pin the opposite: that a `/` inside a tenant was
    // "passed through, adapter responsibility to reject". That premise was
    // the defect. No adapter rejected it, none could — by the time a store
    // sees `a/b/_/c` the field boundary has already moved, and
    // `{tenant:'a/b'}` and `{tenant:'a', principal:'b'}` are one scope
    // reading each other's rows. The encoder is not a validator, but it IS
    // the thing that decides where one field ends, so escaping is its job
    // and nobody else's.
    //
    // Stricter than what it replaces: it pins the escape AND the
    // non-collision. See identity-injective.test.ts for the full proof.
    const ns = identityNamespace({ tenant: 'a/b', conversationId: 'c' });
    expect(ns).toBe('a%2Fb/_/c');
    expect(ns).not.toBe(identityNamespace({ tenant: 'a', principal: 'b', conversationId: 'c' }));
    expect(ns.split('/')).toHaveLength(3);
  });
});
