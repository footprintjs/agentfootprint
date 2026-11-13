/**
 * A stored session keeps its owner — through the real hosted doors, with two
 * callers, with and without an identity verifier, and across a save and a
 * reload of the session store (every envelope goes through `JSON.stringify` /
 * `JSON.parse`, and a reload is a NEW standing agent over the same bytes).
 *
 * Findings: r3-45-hosting-1 (a save in the middle of a run dropped the
 * conversation's owner) and r3-47-hosting-1 (reloading a waiting question
 * ignored who the caller named). The Google store's half of "the first signer
 * stays the owner" is in test/adapters/google/agent-engine-owner.test.ts.
 *
 * What is real here: `standingAgent`, its turn, answer and session-pending
 * doors, the durability writer, the agent loop. What is scripted: the model (a
 * provider that answers from a list) and the store (a JSON map that keeps the
 * same write-once owner index every shipped store keeps, through
 * `resolveSessionOwner`).
 */
import { describe, expect, it } from 'vitest';

import { Agent, defineTool, requestInput } from '../../src/index.js';
import {
  checkEnvelope,
  envelopeOwner,
  resolveSessionOwner,
  standingAgent,
} from '../../src/hosting/index.js';
import type {
  CheckpointEnvelope,
  HostHandler,
  HostRequest,
  PendingAsk,
  SessionLifecycle,
  SessionWireResult,
} from '../../src/hosting/index.js';
import type { LLMProvider, LLMResponse } from '../../src/provider-contract/types.js';

// ── A store whose bytes leave the process ───────────────────────────

/** What survives a restart: JSON text and the owner index, nothing else. */
interface Disk {
  readonly rows: Map<string, string>;
  readonly owners: Map<string, string>;
}

const newDisk = (): Disk => ({ rows: new Map(), owners: new Map() });

/** A store over `disk`. Building a second one over the same disk is a reload. */
function jsonSessions(disk: Disk): SessionLifecycle {
  return {
    async hydrate(sessionId) {
      const text = disk.rows.get(sessionId);
      return text === undefined ? undefined : checkEnvelope(JSON.parse(text), sessionId);
    },
    async persist(sessionId, envelope) {
      const checked = checkEnvelope(JSON.parse(JSON.stringify(envelope)), sessionId);
      const owner = resolveSessionOwner(
        sessionId,
        disk.owners.get(sessionId),
        envelopeOwner(checked),
      );
      disk.rows.set(sessionId, JSON.stringify(checked));
      if (owner !== undefined) disk.owners.set(sessionId, owner);
    },
    async ownerOf(sessionId) {
      return disk.owners.get(sessionId);
    },
  };
}

const storedOwner = (disk: Disk, sessionId: string): string =>
  envelopeOwner(JSON.parse(disk.rows.get(sessionId) ?? 'null') as CheckpointEnvelope) ?? 'NO-OWNER';

// ── A door that answers every reply terminal ────────────────────────

interface Answer {
  readonly output?: string;
  readonly code?: string;
  readonly awaiting?: PendingAsk;
  readonly sessions?: SessionWireResult;
}

const act = defineTool<{ step: string }, string>({
  name: 'act',
  description: 'act',
  inputSchema: { type: 'object', properties: { step: { type: 'string' } }, required: ['step'] },
  execute: ({ step }) => Promise.resolve(`did ${step}`),
});

const collect = defineTool({
  name: 'collect',
  description: 'Collect input.',
  inputSchema: { type: 'object', properties: {} },
  execute: () =>
    requestInput({ id: 'input', question: 'Year?', fields: [{ id: 'year', type: 'number' }] }),
});

type Step = 'act' | 'collect' | 'throw' | 'answer';

/** A model that answers from `plan`, and keeps every request it was sent. */
function scripted(plan: readonly Step[]) {
  const seen: string[] = [];
  let n = 0;
  const provider: LLMProvider = {
    name: 'scripted',
    complete(request: unknown): Promise<LLMResponse> {
      seen.push(JSON.stringify(request));
      const step = plan[n++] ?? 'answer';
      if (step === 'throw') return Promise.reject(new Error('the model service went away'));
      if (step === 'answer')
        return Promise.resolve({ content: 'fine', toolCalls: [], usage: { input: 1, output: 1 } });
      return Promise.resolve({
        content: '',
        toolCalls: [{ id: `t${n}`, name: step, args: step === 'act' ? { step: `s${n}` } : {} }],
        usage: { input: 1, output: 1 },
      });
    },
  };
  return { provider, seen };
}

/** Tokens are the user ids they prove. */
const verify = (token: string) => Promise.resolve({ userId: token });

async function door(
  disk: Disk,
  plan: readonly Step[],
  options: {
    readonly verifier?: boolean;
    readonly allowAnonymous?: boolean;
    readonly durability?: 'exit' | 'sync' | 'async';
  } = {},
) {
  const { provider, seen } = scripted(plan);
  const agent = Agent.create({ provider, model: 'm', maxIterations: 5 })
    .system('x')
    .tool(act)
    .tool(collect)
    .build();
  let handler: HostHandler | undefined;
  const handle = await standingAgent({
    agent,
    sessions: jsonSessions(disk),
    durability: options.durability ?? 'exit',
    ...(options.verifier === true && {
      identity: { verify, ...(options.allowAnonymous === true && { allowAnonymous: true }) },
    }),
    host: {
      name: 'two-callers',
      capabilities: [],
      serve: async (incoming) => {
        handler = incoming;
        return { close: async () => undefined };
      },
    },
  });
  const send = async (request: HostRequest): Promise<Answer> => {
    let answer: Answer = {};
    await handler!(request, {
      emit: () => undefined,
      complete: (output) => (answer = { output }),
      fail: (err) => (answer = { code: (err as { code?: string }).code ?? err.message }),
      awaiting: (awaiting) => (answer = { awaiting }),
      sessions: (result) => (answer = { sessions: result }),
    });
    return answer;
  };
  /** A caller: a verified token at a verifying door, else a named user (or nobody). */
  const as = (who: string | undefined) => (request: Omit<HostRequest, 'userId' | 'headers'>) =>
    send({
      ...request,
      ...(who !== undefined &&
        (options.verifier === true
          ? { headers: { authorization: `Bearer ${who}` } }
          : { userId: who })),
    } as HostRequest);
  return { handle, seen, alice: as('alice'), bob: as('bob'), nobody: as(undefined) };
}

// ── Contract 1: a save in the middle of a run carries the owner ─────

describe('a save in the middle of a run keeps who the conversation belongs to (r3-45-hosting-1)', () => {
  for (const durability of ['sync', 'async'] as const) {
    for (const verifier of [true, false]) {
      it(`${durability}, ${
        verifier ? 'verifying' : 'unverified'
      } door: a turn that fails after a tool leaves a row its owner can continue`, async () => {
        const disk = newDisk();
        const first = await door(disk, ['act', 'throw'], { verifier, durability });
        try {
          const failed = await first.alice({ input: 'alice private task', sessionId: 's1' });
          expect(failed.output).toBeUndefined();
        } finally {
          await first.handle.close();
        }
        // The row the mid-run save left — read back from its JSON text.
        expect(disk.rows.has('s1')).toBe(true);
        expect(storedOwner(disk, 's1')).toBe('alice');

        // A reload: a new standing agent over the same bytes.
        const second = await door(disk, ['answer'], { verifier, durability });
        try {
          expect((await second.alice({ input: 'continue', sessionId: 's1' })).output).toBe('fine');
          expect(storedOwner(disk, 's1')).toBe('alice');
        } finally {
          await second.handle.close();
        }
      });
    }
  }

  it('an anonymous caller at a door that allows them is not served the owner’s conversation', async () => {
    const disk = newDisk();
    const first = await door(disk, ['act', 'throw'], {
      verifier: true,
      allowAnonymous: true,
      durability: 'sync',
    });
    try {
      await first.alice({ input: 'alice private task', sessionId: 's1' });
    } finally {
      await first.handle.close();
    }
    const second = await door(disk, ['answer'], {
      verifier: true,
      allowAnonymous: true,
      durability: 'sync',
    });
    try {
      const stranger = await second.nobody({ input: 'what did she say?', sessionId: 's1' });
      expect(stranger.code).toBe('ERR_SESSION_NOT_FOUND');
      expect(second.seen.join('\n')).not.toContain('alice private task');
      const other = await second.bob({ input: 'what did she say?', sessionId: 's1' });
      expect(other.code).toBe('ERR_SESSION_NOT_FOUND');
      expect(second.seen).toHaveLength(0);
    } finally {
      await second.handle.close();
    }
  });
});

// ── Contract 2: the first signer stays the owner ────────────────────

describe('the first party that signed a conversation stays its owner', () => {
  it('unverified door: a later turn naming nobody erases nothing, and a different signer is refused', async () => {
    const disk = newDisk();
    const first = await door(disk, ['answer', 'answer'], { durability: 'sync' });
    try {
      expect((await first.alice({ input: 'hello', sessionId: 's1' })).output).toBe('fine');
      expect((await first.nobody({ input: 'more', sessionId: 's1' })).output).toBe('fine');
      expect(storedOwner(disk, 's1')).toBe('alice');
    } finally {
      await first.handle.close();
    }
    const second = await door(disk, ['answer'], { durability: 'sync' });
    try {
      const other = await second.bob({ input: 'mine now', sessionId: 's1' });
      expect(other.code).toBe('ERR_SESSION_OWNERSHIP_CONFLICT');
      expect(storedOwner(disk, 's1')).toBe('alice');
    } finally {
      await second.handle.close();
    }
  });

  it('unverified door: an answer given by a caller naming nobody keeps the owner on the stored conversation', async () => {
    const disk = newDisk();
    const first = await door(disk, ['collect', 'answer'], { durability: 'sync' });
    try {
      const asked = await first.alice({ input: 'my private request', sessionId: 's1' });
      const requestId = asked.awaiting?.awaitingInput?.requestId;
      expect(requestId).toBeDefined();
      const answered = await first.nobody({
        input: '',
        sessionId: 's1',
        decision: { requestId, values: { year: 1999 } },
      });
      expect(answered.output).toBe('fine');
      expect(storedOwner(disk, 's1')).toBe('alice');
    } finally {
      await first.handle.close();
    }
  });

  it('verifying door: an old row that names nobody is refused to a signed caller', async () => {
    const disk = newDisk();
    // Built by hand: the shape a pre-fix mid-run save left behind.
    disk.rows.set(
      's1',
      JSON.stringify({
        format: 'conversation-v1',
        savedAt: 1,
        data: {
          version: 1,
          runId: 'r-old',
          history: [{ role: 'user', content: 'somebody’s words' }],
          lastCompletedIteration: 0,
          originalInput: { message: 'somebody’s words' },
          checkpointedAt: 1,
        },
      }),
    );
    const served = await door(disk, ['answer'], { verifier: true });
    try {
      expect((await served.bob({ input: 'mine?', sessionId: 's1' })).code).toBe(
        'ERR_SESSION_NOT_FOUND',
      );
      expect(served.seen).toHaveLength(0);
    } finally {
      await served.handle.close();
    }
  });
});

// ── Contract 3: reading a waiting question follows the ownership rule ─

describe('reloading a waiting question follows the rule a turn and an answer follow (r3-47-hosting-1)', () => {
  const pending = (sessionId: string) => ({
    input: '',
    session: { op: 'pending' as const, sessionId },
  });

  for (const verifier of [false, true]) {
    it(`${
      verifier ? 'verifying' : 'unverified'
    } door, across a reload: the owner is served, another named user is not`, async () => {
      const disk = newDisk();
      const first = await door(disk, ['collect'], { verifier });
      let requestId: string | undefined;
      try {
        const asked = await first.alice({ input: 'my private request', sessionId: 's1' });
        requestId = asked.awaiting?.awaitingInput?.requestId;
        expect(requestId).toBeDefined();
      } finally {
        await first.handle.close();
      }
      const second = await door(disk, ['answer'], { verifier });
      try {
        const own = await second.alice(pending('s1'));
        expect(
          own.sessions?.op === 'pending' && own.sessions.pending?.awaitingInput?.requestId,
        ).toBe(requestId);
        const other = await second.bob(pending('s1'));
        expect(other.code).toBe('ERR_SESSION_NOT_FOUND');
        expect(JSON.stringify(other)).not.toContain(String(requestId));
      } finally {
        await second.handle.close();
      }
    });
  }

  it('unverified door: a caller naming nobody is served — the session id is the key there, by law', async () => {
    const disk = newDisk();
    const served = await door(disk, ['collect'], {});
    try {
      const asked = await served.alice({ input: 'my private request', sessionId: 's1' });
      const reloaded = await served.nobody(pending('s1'));
      expect(
        reloaded.sessions?.op === 'pending' && reloaded.sessions.pending?.awaitingInput?.requestId,
      ).toBe(asked.awaiting?.awaitingInput?.requestId);
    } finally {
      await served.handle.close();
    }
  });
});
