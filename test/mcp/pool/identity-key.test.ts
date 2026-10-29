/**
 * The identity key (§ 4): one client per authenticated conversation, keyed by
 * the library's one injective identity encoding of the identity the CALLER
 * named — never a derived one, never anything a request or the model carries.
 */

import { describe, expect, it } from 'vitest';

import { McpPoolRefusedError } from '../../../src/tool-providers/index.js';
import { takeListUses, type McpClientUse } from '../../../src/tools/mcpClientUse.js';
import type { ToolDispatchContext } from '../../../src/tools/toolProvider.js';
import { fakeEndpoint } from './fakeEndpoint.js';
import { callCtx, everything, id, poolOver } from './harness.js';

const listCtx = (callerIdentity: unknown): ToolDispatchContext =>
  ({
    iteration: 1,
    ...(callerIdentity !== undefined && { callerIdentity }),
  } as ToolDispatchContext);

const opens = (endpoint: ReturnType<typeof fakeEndpoint>) =>
  endpoint.requests.filter((r) => r.rpc === 'initialize').length;

describe('the key', () => {
  it("two principals never share a client; each conversation's calls land in its own session", async () => {
    const endpoint = fakeEndpoint();
    const { pool } = poolOver(endpoint);
    const alice = id('alice', 'c1');
    const bob = id('bob', 'c1');
    const [a] = await pool.toolProvider().list(listCtx(alice));
    const [b] = await pool.toolProvider().list(listCtx(bob));
    const fromAlice = await a!.execute({}, callCtx(alice));
    const fromBob = await b!.execute({}, callCtx(bob));
    expect(opens(endpoint)).toBe(2);
    expect(fromAlice).not.toBe(fromBob);
    const calls = endpoint.requests.filter((r) => r.rpc === 'tools/call');
    expect(new Set(calls.map((r) => r.session)).size).toBe(2);
  });

  it('tenant acme/hr with principal alice and tenant acme with principal hr/alice are two clients', async () => {
    const endpoint = fakeEndpoint();
    const { pool } = poolOver(endpoint);
    (await pool.acquire(id('alice', 'c1', 'acme/hr'))).release();
    (await pool.acquire(id('hr/alice', 'c1', 'acme'))).release();
    expect(opens(endpoint)).toBe(2);
  });

  it('an absent tenant and a tenant named `_` are two clients', async () => {
    const endpoint = fakeEndpoint();
    const { pool } = poolOver(endpoint);
    (await pool.acquire(id('alice', 'c1'))).release();
    (await pool.acquire(id('alice', 'c1', '_'))).release();
    expect(opens(endpoint)).toBe(2);
  });
});

describe('terminate names exactly what it says', () => {
  it("one conversation's terminate leaves the principal's other conversation open", async () => {
    const endpoint = fakeEndpoint();
    const { pool } = poolOver(endpoint);
    (await pool.acquire(id('alice', 'c1'))).release();
    (await pool.acquire(id('alice', 'c2'))).release();
    const outcomes = await pool.terminate({ principal: 'alice', conversationId: 'c1' });
    expect(outcomes).toHaveLength(1);
    await pool.settled();
    expect(pool.stats().open).toBe(1);
    // c2 still has its client: reusing it opens nothing.
    (await pool.acquire(id('alice', 'c2'))).release();
    expect(opens(endpoint)).toBe(2);
    // A principal's scope ends every conversation of that principal, and no other.
    (await pool.acquire(id('bob', 'c1'))).release();
    await pool.terminate({ principal: 'alice' });
    await pool.settled();
    expect(pool.stats().open).toBe(1);
  });

  it('a scope that names neither a principal nor a conversation is refused — ending a whole tenant is close()', async () => {
    const { pool } = poolOver(fakeEndpoint());
    await expect(pool.terminate({ tenant: 'acme' })).rejects.toThrow(TypeError);
    await expect(pool.terminate({})).rejects.toThrow(TypeError);
  });
});

describe('the doors', () => {
  it('a run with no caller identity is refused (no-identity) — a derived one counts as none — before anything opens', async () => {
    const endpoint = fakeEndpoint();
    const { pool } = poolOver(endpoint);
    // The run's internal identity is derived; the caller named none.
    const ctx = { iteration: 1, identity: { conversationId: 'run-1-1' } } as ToolDispatchContext;
    await expect(pool.toolProvider().list(ctx)).rejects.toMatchObject({
      reason: 'no-identity',
      sent: false,
    });
    expect(takeListUses(ctx)).toEqual([
      expect.objectContaining({ client: 'refused', refusal: 'no-identity' }),
    ]);
    expect(endpoint.requests).toEqual([]);
  });

  it('a missing principal is refused unless requirePrincipal: false', async () => {
    const endpoint = fakeEndpoint();
    const strict = poolOver(endpoint).pool;
    await expect(strict.acquire({ conversationId: 'c1' })).rejects.toMatchObject({
      reason: 'incomplete-identity',
    });
    const single = poolOver(endpoint, { requirePrincipal: false }).pool;
    (await single.acquire({ conversationId: 'c1' })).release();
    expect(opens(endpoint)).toBe(1);
  });

  it('a missing tenant is refused under requireTenant: true', async () => {
    const endpoint = fakeEndpoint();
    const { pool } = poolOver(endpoint, { requireTenant: true });
    await expect(pool.acquire(id('alice', 'c1'))).rejects.toMatchObject({
      reason: 'incomplete-identity',
    });
    (await pool.acquire(id('alice', 'c1', 'acme'))).release();
  });

  it('a missing conversation, or a field that is not a string, is incomplete', async () => {
    const endpoint = fakeEndpoint();
    const { pool } = poolOver(endpoint);
    await expect(pool.acquire({ principal: 'alice' } as never)).rejects.toMatchObject({
      reason: 'incomplete-identity',
    });
    await expect(
      pool.acquire({ principal: 7, conversationId: 'c1' } as never),
    ).rejects.toMatchObject({
      reason: 'incomplete-identity',
    });
  });
});

describe('no identity value is ever written', () => {
  it('canary identity strings appear in no error, event, report or stats()', async () => {
    const endpoint = fakeEndpoint();
    const { pool, reports } = poolOver(endpoint, { maxClients: 1 });
    const canary = id('PRINCIPAL-CANARY-7731', 'CONVERSATION-CANARY-5520', 'TENANT-CANARY-9902');
    const ctx = listCtx(canary);
    const [tool] = await pool.toolProvider().list(ctx);
    const uses = [...takeListUses(ctx)];
    const errors: unknown[] = [];
    const refusedUses: McpClientUse[] = [];
    errors.push(
      await tool!
        .execute({}, callCtx(id('mallory', 'x'), undefined, refusedUses))
        .catch((e: unknown) => e),
    );
    // Refused before any lease: its record still carries the digest, never the key.
    expect(refusedUses[0]).toMatchObject({ client: 'refused', refusal: 'identity-mismatch' });
    expect(refusedUses[0]?.keyHash).toMatch(/^[0-9a-f]{8,16}$/);
    uses.push(...refusedUses);
    errors.push(
      await pool.acquire({ conversationId: 'CONVERSATION-CANARY-5520' }).catch((e: unknown) => e),
    );
    const held = await pool.acquire(canary);
    errors.push(await pool.acquire(id('other', 'y')).catch((e: unknown) => e));
    held.release();
    await pool.terminate({ tenant: 'TENANT-CANARY-9902', principal: 'PRINCIPAL-CANARY-7731' });
    await pool.settled();
    for (const error of errors) expect(error).toBeInstanceOf(Error);
    expect(errors.some((e) => e instanceof McpPoolRefusedError)).toBe(true);
    const all = everything(...errors, ...uses, ...reports, pool.stats());
    for (const canaryValue of ['PRINCIPAL-CANARY', 'CONVERSATION-CANARY', 'TENANT-CANARY']) {
      expect(all).not.toContain(canaryValue);
    }
    expect(reports.length).toBeGreaterThan(0);
  });
});
