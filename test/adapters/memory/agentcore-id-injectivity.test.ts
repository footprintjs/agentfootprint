/**
 * AgentCoreStore identity encoding — the tenant boundary at the AWS seam.
 *
 * `MemoryIdentity` → (`actorId`, `sessionId`) is where a tuple becomes the
 * address AgentCore stores rows under. If two tuples spell one address, one
 * scope reads, overwrites and erases another scope's memory — no race
 * required. So the mapping must be INJECTIVE, and this file proves it rather
 * than asserting a couple of happy examples.
 *
 * Before the fix it was not. `safeId` slugged every character outside
 * `[A-Za-z0-9_-]` to `-` (so `a.b`, `a/b` and `a b` were one actor), then
 * joined tenant and principal with a bare `_` (so tenant `a_b` + principal `c`
 * was the same actor as tenant `a` + principal `b_c`) — cross-tenant, both.
 *
 * Everything here goes through the real store and a recording client, so what
 * is asserted is the id AWS would actually receive, not a helper's return
 * value. The encoders themselves stay module-private.
 */

import { describe, expect, it } from 'vitest';

import { AgentCoreStore } from '../../../src/adapters/memory/agentcore.js';
import type {
  AgentCoreEvent,
  AgentCoreLikeClient,
} from '../../../src/adapters/memory/agentcore.js';
import type { MemoryEntry } from '../../../src/memory/entry/index.js';
import type { MemoryIdentity } from '../../../src/memory/identity/index.js';

/** Records the scope of the last write — the ids AgentCore would be handed. */
class RecordingClient implements AgentCoreLikeClient {
  actorId = '';
  sessionId = '';
  async createEvent(input: { actorId: string; sessionId: string }): Promise<void> {
    this.actorId = input.actorId;
    this.sessionId = input.sessionId;
  }
  async listEvents(): Promise<{ events: readonly AgentCoreEvent[]; nextToken?: string }> {
    return { events: [] };
  }
  async deleteEvent(): Promise<void> {}
}

const entry: MemoryEntry<{ t: string }> = {
  id: 'e',
  value: { t: 'x' },
  version: 1,
  createdAt: 0,
  updatedAt: 0,
  lastAccessedAt: 0,
  accessCount: 0,
};

/** Drive one identity through `put` and read back the ids that reached the client. */
async function idsFor(identity: MemoryIdentity): Promise<{ actorId: string; sessionId: string }> {
  const client = new RecordingClient();
  const store = new AgentCoreStore({ memoryId: 'mem-1', _client: client });
  await store.put(identity, entry);
  return { actorId: client.actorId, sessionId: client.sessionId };
}

// ─── The decoders. Their existence IS the injectivity proof ──────────
//
// A function with a left inverse cannot map two inputs to one output. These
// mirror the encoders in `agentcore.ts`; if a change to the encoder breaks the
// left-inverse tests below, the change broke injectivity.

function unescapeSegment(seg: string, introducer: string): string {
  let out = '';
  for (let i = 0; i < seg.length; i++) {
    if (seg[i] !== introducer) {
      out += seg[i];
      continue;
    }
    out += String.fromCharCode(parseInt(seg.slice(i + 1, i + 5), 16));
    i += 4;
  }
  return out;
}

function decodeActor(actorId: string): { tenant?: string; principal?: string } {
  const body = actorId.slice('afp-'.length);
  // A present field never encodes to '' and never contains '_' (it is escaped),
  // so a leading '_' can only be the absence marker.
  const [a, b] = body.startsWith('_')
    ? ['_', body.slice(2)]
    : [body.slice(0, body.indexOf('_')), body.slice(body.indexOf('_') + 1)];
  const field = (seg: string): string | undefined =>
    seg === '_' ? undefined : unescapeSegment(seg, '/');
  return { tenant: field(a), principal: field(b) };
}

function decodeSession(sessionId: string): string {
  return unescapeSegment(sessionId.slice('afp-'.length), '_');
}

// ─── Adversarial corpus ─────────────────────────────────────────────

/** Values chosen to break the encoding, one hazard each. */
const HOSTILE_VALUES: readonly string[] = [
  'a', // plain
  'A', // case matters
  'a-b', // the one punctuation that stays verbatim
  'a_b', // contains the SEPARATOR
  'b_c', // the other half of the classic join collision
  'c',
  'a/b', // contains the actor escape introducer
  'a.b', // the old slug flattened this onto a/b and a-b
  'a b', // …and this
  'a:b', // a character AWS allows but only positionally
  '_', // spells the absence SENTINEL
  '__',
  '/005F', // looks like an already-escaped '_'
  'a/005Fb', // …embedded
  '_005F', // the session-escape spelling of the same trap
  '%2F', // the SHARED encoder's escape — inert here, must not be special
  'a%2Fb',
  'é', // non-ASCII
  '日本語', // multi-byte, multi-char
  '\u{1F600}', // astral: two UTF-16 code units
  '\uD800', // LONE surrogate — a legal JS string a UTF-8 pass would flatten
  'x'.repeat(40), // long but comfortably legal
];

describe('AgentCoreStore ids — byte preservation for well-behaved values', () => {
  // The reason this fix is deployable: a simple id keeps the address it had
  // before the fix, so nothing re-keys except the tuples that were colliding.
  it.each([
    [{ tenant: 'acme', principal: 'alice', conversationId: 'thread-1' }, 'afp-acme_alice'],
    [{ tenant: 'acme-corp', principal: 'user-42', conversationId: 'c' }, 'afp-acme-corp_user-42'],
    [{ principal: 'alice', conversationId: 'c' }, 'afp-__alice'], // tenant omitted
    [{ tenant: 'acme', conversationId: 'c' }, 'afp-acme__'], // principal omitted
    [{ conversationId: 'c' }, 'afp-___'], // both omitted
  ])('actorId for %j is unchanged: %s', async (identity, expected) => {
    expect((await idsFor(identity as MemoryIdentity)).actorId).toBe(expected);
  });

  it('sessionId keeps a UUID a UUID (`-` is verbatim)', async () => {
    const conversationId = '550e8400-e29b-41d4-a716-446655440000';
    expect((await idsFor({ conversationId })).sessionId).toBe(`afp-${conversationId}`);
  });

  it("an empty tenant and an omitted tenant are the same scope ('' is not a name)", async () => {
    const a = await idsFor({ tenant: '', principal: 'alice', conversationId: 'c' });
    const b = await idsFor({ principal: 'alice', conversationId: 'c' });
    expect(a.actorId).toBe(b.actorId);
  });
});

describe('AgentCoreStore ids — the collisions this fix closes', () => {
  it('a value containing the separator no longer donates a field boundary', async () => {
    const a = await idsFor({ tenant: 'a_b', principal: 'c', conversationId: 'x' });
    const b = await idsFor({ tenant: 'a', principal: 'b_c', conversationId: 'x' });
    expect(a.actorId).not.toBe(b.actorId);
  });

  it('the lossy slug is gone: `a.b`, `a/b`, `a b` and `a-b` are four actors', async () => {
    const ids = await Promise.all(
      ['a.b', 'a/b', 'a b', 'a-b'].map(
        async (tenant) => (await idsFor({ tenant, principal: 'p', conversationId: 'x' })).actorId,
      ),
    );
    expect(new Set(ids).size).toBe(4);
  });

  it('…and in the session too: `a.b` and `a-b` are two conversations', async () => {
    const a = await idsFor({ conversationId: 'a.b' });
    const b = await idsFor({ conversationId: 'a-b' });
    expect(a.sessionId).not.toBe(b.sessionId);
  });

  it('a tenant literally named `_` is not the anonymous tenant', async () => {
    const named = await idsFor({ tenant: '_', principal: 'p', conversationId: 'x' });
    const absent = await idsFor({ principal: 'p', conversationId: 'x' });
    expect(named.actorId).not.toBe(absent.actorId);
  });

  it('a value that merely LOOKS escaped lands on itself, not on what produced it', async () => {
    const looksEscaped = await idsFor({ tenant: 'a/005Fb', principal: 'p', conversationId: 'x' });
    const produced = await idsFor({ tenant: 'a_b', principal: 'p', conversationId: 'x' });
    expect(looksEscaped.actorId).not.toBe(produced.actorId);
  });
});

describe('AgentCoreStore ids — injectivity (property)', () => {
  it('no two identities in the adversarial cross-product share an actorId', async () => {
    // undefined = omitted; '' is excluded because it MEANS omitted (asserted above).
    const fields: readonly (string | undefined)[] = [undefined, ...HOSTILE_VALUES];
    const seen = new Map<string, string>();
    for (const tenant of fields) {
      for (const principal of fields) {
        const { actorId } = await idsFor({ tenant, principal, conversationId: 'c' });
        const tuple = JSON.stringify([tenant, principal]);
        const prior = seen.get(actorId);
        expect(
          prior === undefined || prior === tuple,
          `${prior} and ${tuple} share ${actorId}`,
        ).toBe(true);
        seen.set(actorId, tuple);
      }
    }
    expect(seen.size).toBe(fields.length * fields.length);
  });

  it('no two conversation ids in the adversarial corpus share a sessionId', async () => {
    const ids = new Set<string>();
    for (const conversationId of HOSTILE_VALUES) {
      ids.add((await idsFor({ conversationId })).sessionId);
    }
    expect(ids.size).toBe(HOSTILE_VALUES.length);
  });

  it('actorId decodes back to the exact tuple (a left inverse exists)', async () => {
    const fields: readonly (string | undefined)[] = [undefined, ...HOSTILE_VALUES];
    for (const tenant of fields) {
      for (const principal of fields) {
        const { actorId } = await idsFor({ tenant, principal, conversationId: 'c' });
        expect(decodeActor(actorId)).toEqual({ tenant, principal });
      }
    }
  });

  it('sessionId decodes back to the exact conversation id', async () => {
    for (const conversationId of HOSTILE_VALUES) {
      const { sessionId } = await idsFor({ conversationId });
      expect(decodeSession(sessionId)).toBe(conversationId);
    }
  });

  it('every produced id satisfies AgentCore’s documented patterns', async () => {
    // actorId   1..255  [a-zA-Z0-9][a-zA-Z0-9-_/]*(?::[a-zA-Z0-9-_/]+)*[a-zA-Z0-9-_/]*
    // sessionId 1..100  [a-zA-Z0-9][a-zA-Z0-9-_]*
    const ACTOR = /^[a-zA-Z0-9][a-zA-Z0-9\-_/]*(?::[a-zA-Z0-9\-_/]+)*[a-zA-Z0-9\-_/]*$/;
    const SESSION = /^[a-zA-Z0-9][a-zA-Z0-9\-_]*$/;
    for (const v of HOSTILE_VALUES) {
      const { actorId, sessionId } = await idsFor({
        tenant: v,
        principal: v,
        conversationId: v,
      });
      expect(actorId, actorId).toMatch(ACTOR);
      expect(actorId.length).toBeLessThanOrEqual(255);
      expect(sessionId, sessionId).toMatch(SESSION);
      expect(sessionId.length).toBeLessThanOrEqual(100);
    }
  });
});

describe('AgentCoreStore ids — the length ceiling refuses rather than truncates', () => {
  // Truncation (hash tail or not) maps infinitely many identities onto finitely
  // many ids, so it cannot be injective. It used to turn "your id is too long"
  // into "your tenant occasionally reads someone else's memory", silently.
  it('an over-long actor tuple refuses by name, naming the limit not the value', async () => {
    const secret = 'z'.repeat(300);
    await expect(idsFor({ tenant: secret, principal: 'p', conversationId: 'c' })).rejects.toThrow(
      /actorId/,
    );
    const err = await idsFor({ tenant: secret, principal: 'p', conversationId: 'c' }).catch(
      (e: Error) => e,
    );
    expect(String(err)).toContain('255');
    expect(String(err)).not.toContain(secret); // never quote a tenant id
  });

  it('an over-long conversation id refuses too', async () => {
    await expect(idsFor({ conversationId: 'z'.repeat(200) })).rejects.toThrow(/sessionId/);
  });

  it('the ceilings are AWS’s own, not a shared guess (actor 255, session 100)', async () => {
    const actor = await idsFor({
      tenant: 'z'.repeat(120),
      principal: 'y'.repeat(120),
      conversationId: 'c',
    });
    expect(actor.actorId.length).toBe(245); // 'afp-' + 120 + '_' + 120 — was truncated at 99
    const session = await idsFor({ conversationId: 'z'.repeat(96) });
    expect(session.sessionId.length).toBe(100);
  });
});
