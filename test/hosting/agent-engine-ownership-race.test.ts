/**
 * The Agent Engine concurrent-ownership race — RECORDED, not fixed.
 *
 * `persist` re-reads ownership after a create loses with ALREADY_EXISTS, and the
 * comment on that branch argues the re-read is sufficient: "the 409 itself
 * guarantees the other writer's create has already landed, so this read cannot
 * miss it." That is true of the RESOURCE. It is unproven for the FIELDS.
 *
 * `signedBy` answers from `Session.userId`, falling back to the signer inside
 * `sessionState`. If the service can return a session that EXISTS — enough for a
 * competing create to get 409 — while neither field is readable yet, `signedBy`
 * answers `undefined`, `resolveSessionOwner` sees no stored owner, and the losing
 * signer appends its conversation into the winner's session. `ownerOf` then names
 * the winner and `hydrate` returns the loser's conversation: the split brain
 * closed across four stores in 9.37.0, reachable here through a window the
 * adapter assumes away.
 *
 * **Whether that window exists on Google's service is not something a double can
 * settle**, which is exactly why `agentEngineSessions` stays at
 * `contract-shaped and tested` in docs/ADAPTER_STATUS.md and why the finding is
 * tracked privately rather than published as a reproduction. What IS settled, and
 * what this file pins, is that the adapter has no defence if the window is real:
 * its correctness rests on a service-behaviour assumption it does not verify.
 *
 * The second test is the control — with the fields readable, the re-check works.
 * Without it, the first test would prove only that the double can break things.
 *
 * When the race is repaired, `it.fails` starts FAILING, which is the intended
 * alarm: it means this file needs deleting and the ledger needs revisiting — but
 * only alongside a fresh live trial, since a double cannot promote a status.
 */
import { describe, expect, it } from 'vitest';

import { agentEngineSessions } from '../../src/adapters/hosting/googleAgentEngine.js';
import { envelopeOwner, toEnvelope } from '../../src/hosting/index.js';
import type { AgentRunCheckpoint } from '../../src/core/runCheckpoint.js';

const CONNECTION = { project: 'p', location: 'us-central1', reasoningEngine: 'engine-1' } as const;

function envelopeFor(text: string, principal: string) {
  return toEnvelope({
    version: 1,
    runId: `run-${text}`,
    history: [{ role: 'user', content: text }],
    lastCompletedIteration: 1,
    originalInput: { message: text },
    identity: { principal },
  } as unknown as AgentRunCheckpoint);
}

/**
 * A service whose created sessions exist before their fields are readable.
 *
 * `fieldsVisible: false` is the window under test: `create` registers the
 * resource (so a competing `create` gets 409 and a `get` succeeds) while `get`
 * withholds `userId` and `sessionState` until {@link settle}.
 */
function serviceWithPartialVisibility(fieldsVisible: boolean) {
  const rows = new Map<string, Record<string, unknown>>();
  const calls: string[] = [];
  let clock = 1_700_000_000_000;
  const stamp = (): string => new Date(++clock).toISOString();
  const notFound = (): never => {
    throw { code: 404 };
  };

  const sessions = {
    get: ({ name }: { name: string }) => {
      calls.push('get');
      const found = rows.get(name);
      if (found === undefined) return Promise.resolve(notFound());
      if (!fieldsVisible && found['_pending'] === true) {
        return Promise.resolve({ data: { name: found['name'], createTime: found['createTime'] } });
      }
      return Promise.resolve({ data: found });
    },
    appendEvent: ({
      name,
      requestBody,
    }: {
      name: string;
      requestBody: Record<string, unknown>;
    }) => {
      calls.push('appendEvent');
      const session = rows.get(name);
      if (session === undefined) return Promise.resolve(notFound());
      const delta = (requestBody as { actions?: { stateDelta?: Record<string, unknown> } }).actions
        ?.stateDelta;
      rows.set(name, {
        ...session,
        updateTime: stamp(),
        sessionState: {
          ...((session['sessionState'] as Record<string, unknown>) ?? {}),
          ...(delta ?? {}),
        },
      });
      return Promise.resolve({ data: {} });
    },
    create: ({
      parent,
      sessionId,
      requestBody,
    }: {
      parent: string;
      sessionId: string;
      requestBody: Record<string, unknown>;
    }) => {
      calls.push('create');
      const name = `${parent}/sessions/${sessionId}`;
      if (rows.has(name)) throw { code: 409, message: 'ALREADY_EXISTS' };
      rows.set(name, {
        name,
        createTime: stamp(),
        updateTime: stamp(),
        _pending: true,
        ...requestBody,
      });
      return Promise.resolve({ data: { name: 'op/1', done: true } });
    },
    delete: ({ name }: { name: string }) => {
      rows.delete(name);
      return Promise.resolve({ data: { done: true } });
    },
    list: () => Promise.resolve({ data: { sessions: [] } }),
    operations: { wait: () => Promise.resolve({ data: { done: true } }) },
  };

  return {
    calls,
    /** The winner's create finishes; every field becomes readable. */
    settle: (): void => {
      for (const [key, row] of rows) rows.set(key, { ...row, _pending: false });
    },
    client: { projects: { locations: { reasoningEngines: { sessions, memories: {} } } } } as never,
  };
}

/** Alice creates, Bob races in and loses the create. Returns what the store ends up holding. */
async function contest(fieldsVisible: boolean): Promise<{
  bobRefused: boolean;
  owner: string | undefined;
  signer: string | undefined;
  appends: number;
}> {
  const service = serviceWithPartialVisibility(fieldsVisible);
  const store = agentEngineSessions({ ...CONNECTION, _client: service.client });
  const id = 'contested';

  await store.persist(id, envelopeFor('alice private', 'alice'));
  const refusal = await store.persist(id, envelopeFor('bob speaking', 'bob')).then(
    () => undefined,
    (err: unknown) => err,
  );

  service.settle();
  const stored = await store.hydrate(id);
  return {
    bobRefused: refusal !== undefined,
    owner: await store.ownerOf!(id),
    signer: stored === undefined ? undefined : envelopeOwner(stored),
    appends: service.calls.filter((call) => call === 'appendEvent').length,
  };
}

describe('agentEngineSessions — ownership when a create loses to ALREADY_EXISTS', () => {
  it('refuses the losing signer when the winner’s fields are readable', async () => {
    const { bobRefused, owner, signer } = await contest(true);
    expect(bobRefused, 'a conversation signed by a different person was accepted').toBe(true);
    expect(owner).toBe('alice');
    expect(signer).toBe('alice');
  });

  // KNOWN DEFECT. Passes while the race is live; starts failing when it is fixed.
  it.fails('KNOWN, UNFIXED: a partially-visible winner lets the losing signer append', async () => {
    const { bobRefused, owner, signer } = await contest(false);
    expect(bobRefused, 'bob’s foreign write was accepted').toBe(true);
    expect(
      owner === undefined || signer === undefined || owner === signer,
      `SPLIT BRAIN: ownerOf() says ${String(owner)} and the stored conversation is signed by ` +
        `${String(signer)}. The index decides who may open it and the conversation decides ` +
        `what they read, and they disagree.`,
    ).toBe(true);
  });
});
