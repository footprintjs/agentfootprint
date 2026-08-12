/**
 * `EventMeta.principal` / `EventMeta.tenant` — the actor on the audit wire
 * (9.11.0).
 *
 *   P1 Unit         — `buildEventMeta` carries them, and omits absent ones
 *   P2 Boundary     — an EXPLICIT identity stamps; the 9.10.0 session-derived
 *                     default does NOT (a conversation id is not an actor);
 *                     anonymous stamps nothing
 *   P3 Scenario     — every event of a real run carries the same who→what→when
 *   P4 Property     — the key is ABSENT, never an empty string, for every
 *                     partial identity shape
 *   P5 Security     — a caller-supplied `sessionId` never becomes a principal
 *   P6 Performance  — n/a (two conditional spreads per event)
 *   P7 ROI          — the envelope-serializing sinks inherit it for free; the
 *                     span-mapping one places it deliberately
 *
 * Why this file exists: the event stream has always said WHAT happened and
 * WHEN. An audit log needs WHO, and the only honest source for that is an
 * identity somebody NAMED. Deriving one from the session would put a string
 * anybody who can reach the host may send into the field an auditor reads as
 * "who did this" — which is worse than an empty audit trail, because it looks
 * like a full one.
 */

import { describe, expect, it } from 'vitest';

import { Agent } from '../../src/core/Agent.js';
import { mock } from '../../src/llm-providers.js';
import { buildEventMeta } from '../../src/bridge/eventMeta.js';
import type { EventMeta } from '../../src/events/types.js';

// ─── Fixtures ────────────────────────────────────────────────────────

function agent() {
  return Agent.create({ provider: mock({ reply: 'done' }), model: 'mock' }).build();
}

/** Every meta an agent run emitted, in arrival order. */
async function metasFrom(
  a: ReturnType<typeof agent>,
  run: (a: ReturnType<typeof agent>) => Promise<unknown>,
): Promise<EventMeta[]> {
  const metas: EventMeta[] = [];
  a.on('*', (e) => metas.push(e.meta));
  await run(a);
  return metas;
}

// ─── P1 Unit ─────────────────────────────────────────────────────────

describe('buildEventMeta', () => {
  const base = { runStartMs: 0, runId: 'r1', compositionPath: [] as readonly string[] };

  it('carries principal and tenant when the run context has them', () => {
    const meta = buildEventMeta(
      { runtimeStageId: 'seed#0' },
      {
        ...base,
        principal: 'alice@acme.test',
        tenant: 'acme',
      },
    );
    expect(meta.principal).toBe('alice@acme.test');
    expect(meta.tenant).toBe('acme');
  });

  it('omits the KEYS entirely when the run context has neither', () => {
    const meta = buildEventMeta({ runtimeStageId: 'seed#0' }, base);
    expect('principal' in meta).toBe(false);
    expect('tenant' in meta).toBe(false);
  });

  it('carries one without inventing the other', () => {
    const meta = buildEventMeta({ runtimeStageId: 'seed#0' }, { ...base, tenant: 'acme' });
    expect(meta.tenant).toBe('acme');
    expect('principal' in meta).toBe(false);
  });
});

// ─── P2 Boundary — the three identity shapes ─────────────────────────

describe('what stamps an actor, and what does not', () => {
  it('an EXPLICIT identity stamps both facts', async () => {
    const metas = await metasFrom(agent(), (a) =>
      a.run(
        { message: 'hi' },
        { identity: { tenant: 'acme', principal: 'alice', conversationId: 'c-1' } },
      ),
    );
    expect(metas.length).toBeGreaterThan(0);
    for (const m of metas) {
      expect(m.principal).toBe('alice');
      expect(m.tenant).toBe('acme');
    }
  });

  it('an identity on the INPUT bag stamps too — same door, first place a caller looks', async () => {
    const metas = await metasFrom(agent(), (a) =>
      a.run({ message: 'hi', identity: { principal: 'bob', conversationId: 'c-2' } }),
    );
    for (const m of metas) expect(m.principal).toBe('bob');
  });

  it('the 9.10.0 session-derived identity stamps NOTHING — a conversation id is not an actor', async () => {
    const metas = await metasFrom(agent(), (a) => a.run({ message: 'hi' }, { sessionId: 's-42' }));
    expect(metas.length).toBeGreaterThan(0);
    for (const m of metas) {
      // The session IS carried — it is the fact the transport delivered.
      expect(m.sessionId).toBe('s-42');
      // …and it is not laundered into an actor.
      expect('principal' in m).toBe(false);
      expect('tenant' in m).toBe(false);
    }
  });

  it('an anonymous run stamps nothing', async () => {
    const metas = await metasFrom(agent(), (a) => a.run({ message: 'hi' }));
    expect(metas.length).toBeGreaterThan(0);
    for (const m of metas) {
      expect('principal' in m).toBe(false);
      expect('tenant' in m).toBe(false);
    }
  });

  it('an explicit identity with ONLY a conversationId stamps nothing either', async () => {
    // The caller named a conversation, not a person. Absent is the honest
    // answer, and it is what the meta says.
    const metas = await metasFrom(agent(), (a) =>
      a.run({ message: 'hi' }, { identity: { conversationId: 'c-3' } }),
    );
    for (const m of metas) {
      expect('principal' in m).toBe(false);
      expect('tenant' in m).toBe(false);
    }
  });
});

// ─── P3 Scenario ─────────────────────────────────────────────────────

describe('who → what → when', () => {
  it('every event of one run answers all three', async () => {
    const metas = await metasFrom(agent(), (a) =>
      a.run(
        { message: 'hi' },
        { sessionId: 's-9', identity: { tenant: 'acme', principal: 'carol', conversationId: 'c' } },
      ),
    );
    for (const m of metas) {
      expect(m.principal).toBe('carol'); // who
      expect(m.runtimeStageId).toBeTruthy(); // what
      expect(typeof m.wallClockMs).toBe('number'); // when
      expect(m.sessionId).toBe('s-9'); // and which conversation
    }
  });

  it('a second run under a different identity does not inherit the first', async () => {
    const a = agent();
    await a.run({ message: 'one' }, { identity: { principal: 'alice', conversationId: 'c' } });
    const metas = await metasFrom(a, (x) => x.run({ message: 'two' }));
    // `lastRunIdentity` is re-resolved per run and nobody named one this time.
    for (const m of metas) expect('principal' in m).toBe(false);
  });
});

// ─── P5 Security ─────────────────────────────────────────────────────

describe('a session id never becomes a principal', () => {
  it('even when it looks exactly like one', async () => {
    const metas = await metasFrom(agent(), (a) =>
      a.run({ message: 'hi' }, { sessionId: 'alice@acme.test' }),
    );
    for (const m of metas) expect('principal' in m).toBe(false);
  });
});
