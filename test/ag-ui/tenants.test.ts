/**
 * TWO TENANTS AT ONCE — nothing of one request reaches another.
 *
 * Two different users' requests run CONCURRENTLY through one handler: each
 * request's tool waits until the other's has started, so both runs are in
 * flight together. Each stream is read as the bytes its browser receives and
 * must hold only its own run: its own run id on every id it mints, one tool
 * call and one result of its own, agentfootprint's run id of its own — and,
 * under a redaction policy, neither user's marked values. The server-side
 * store keeps each conversation under its own user's key, with its own words.
 *
 * Without a policy the same two requests must still each see only their own
 * tool result — content isolation, read directly.
 */

import { describe, expect, it } from 'vitest';

import { Agent, defineTool } from '../../src/index.js';
import { mock } from '../../src/llm-providers.js';
import { memorySessions } from '../../src/hosting/memorySessions.js';
import { readEnvelope } from '../../src/hosting/envelope.js';
import { streamHandler } from '../../src/hosting/streamHandler.js';
import { agUi } from '../../src/ag-ui/adapter.js';
import type { AgUiEvent } from '../../src/ag-ui/types.js';

/** A barrier both requests' tools wait at — so the two runs overlap for certain. */
function barrier(parties: number) {
  let arrived = 0;
  let open!: () => void;
  const opened = new Promise<void>((resolve) => (open = resolve));
  return {
    async arrive() {
      arrived += 1;
      if (arrived === parties) open();
      await opened;
    },
    get arrived() {
      return arrived;
    },
  };
}

const USERS = {
  alice: { ssn: 'zqALICE-SSN-11', city: 'Lyon', message: 'alice asks about zqALICE-MSG' },
  bob: { ssn: 'zqBOB-SSN-22', city: 'Oslo', message: 'bob asks about zqBOB-MSG' },
} as const;
type User = keyof typeof USERS;

function handlerFor(redact: boolean) {
  const gate = barrier(2);
  const sessions = memorySessions();
  const handle = streamHandler({
    agent: ({ thread }) => {
      const user = thread?.identity?.principal as User;
      const lookup = defineTool({
        name: 'lookup',
        description: 'Look the customer up.',
        inputSchema: { type: 'object', properties: {} },
        execute: async () => {
          await gate.arrive();
          return { ssn: USERS[user].ssn, city: USERS[user].city, owner: `record of ${user}` };
        },
      });
      return Agent.create({
        provider: mock({
          chunkDelayMs: 0,
          replies: [
            { content: '', toolCalls: [{ id: 'call_1', name: 'lookup', args: {} }] },
            `${user} lives in ${USERS[user].city}`,
          ],
        }),
        model: 'm',
        ...(redact && { redact: { keys: ['ssn'] } }),
      })
        .system('Help.')
        .tool(lookup)
        .build();
    },
    adapter: agUi(),
    threads: {
      bind: ({ conversation, headers }) => ({
        sessionId: `${headers['x-user']}:${conversation}`,
        identity: { principal: headers['x-user'] as string, conversationId: conversation },
      }),
    },
    sessions,
    heartbeatMs: 0,
  });
  return { handle, sessions, gate };
}

const request = (user: User, runId: string) =>
  new Request('http://localhost/api/agent', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-user': user },
    // Both name the SAME thread id: the binding, not the name, decides whose it is.
    body: JSON.stringify({
      threadId: 'support',
      runId,
      messages: [{ id: 'u1', role: 'user', content: USERS[user].message }],
      tools: [],
      context: [],
    }),
  });

async function read(response: Response): Promise<{ wire: string; events: AgUiEvent[] }> {
  const wire = await response.text();
  const events = wire
    .split('\n\n')
    .filter((f) => f.startsWith('data: '))
    .map((f) => JSON.parse(f.slice('data: '.length)) as AgUiEvent);
  return { wire, events };
}

/** Every AG-UI id an event carries. */
const idsOf = (event: AgUiEvent): string[] =>
  ['messageId', 'toolCallId', 'subagentRunId', 'parentMessageId']
    .map((key) => (event as unknown as Record<string, unknown>)[key])
    .filter((v): v is string => typeof v === 'string');

async function runBoth(redact: boolean) {
  const { handle, sessions, gate } = handlerFor(redact);
  const [a, b] = await Promise.all([
    handle(request('alice', 'run-a')),
    handle(request('bob', 'run-b')),
  ]);
  const [alice, bob] = await Promise.all([read(a), read(b)]);
  expect(gate.arrived).toBe(2); // both runs were in flight together
  return { alice, bob, sessions };
}

function expectOnlyItsOwn(stream: { events: AgUiEvent[] }, runId: string) {
  expect(stream.events[0]).toMatchObject({ type: 'RUN_STARTED', runId });
  expect(stream.events.at(-1)).toMatchObject({ type: 'RUN_FINISHED', runId });
  for (const event of stream.events)
    for (const id of idsOf(event))
      expect(id.startsWith(`${runId}/`), `${event.type} ${id}`).toBe(true);
  expect(stream.events.filter((e) => e.type === 'TOOL_CALL_START')).toHaveLength(1);
  expect(stream.events.filter((e) => e.type === 'TOOL_CALL_RESULT')).toHaveLength(1);
  // agentfootprint's own run: one, the same on its start and its end.
  const recordRun = stream.events[0]!.metadata?.agentfootprint?.runId;
  expect(recordRun).toBeDefined();
  expect(stream.events.at(-1)!.metadata?.agentfootprint?.runId).toBe(recordRun);
  return recordRun;
}

describe('two tenants at once — each request sees only its own run', () => {
  it('under a redaction policy: own ids, own call and result, no marked value of either', async () => {
    const { alice, bob, sessions } = await runBoth(true);
    const aliceRun = expectOnlyItsOwn(alice, 'run-a');
    const bobRun = expectOnlyItsOwn(bob, 'run-b');
    expect(aliceRun).not.toBe(bobRun);
    for (const secret of [USERS.alice.ssn, USERS.bob.ssn]) {
      expect(alice.wire).not.toContain(secret);
      expect(bob.wire).not.toContain(secret);
    }
    // Neither stream mentions the other user at all.
    expect(alice.wire).not.toContain('bob');
    expect(bob.wire).not.toContain('alice');

    // The server keeps each conversation under its own user's key, in its own words.
    const kept = {
      alice: JSON.stringify(readEnvelope(await sessions.hydrate('alice:support'))),
      bob: JSON.stringify(readEnvelope(await sessions.hydrate('bob:support'))),
    };
    expect(kept.alice).toContain('zqALICE-MSG');
    expect(kept.alice).not.toContain('zqBOB');
    expect(kept.bob).toContain('zqBOB-MSG');
    expect(kept.bob).not.toContain('zqALICE');
    expect(await sessions.hydrate('support')).toBeUndefined();
  });

  it('with no policy: each stream holds its own tool result and answer, never the other’s', async () => {
    const { alice, bob } = await runBoth(false);
    expectOnlyItsOwn(alice, 'run-a');
    expectOnlyItsOwn(bob, 'run-b');
    const resultOf = (s: { events: AgUiEvent[] }) =>
      (s.events.find((e) => e.type === 'TOOL_CALL_RESULT') as { content: string }).content;
    expect(resultOf(alice)).toContain('record of alice');
    expect(resultOf(bob)).toContain('record of bob');
    expect(alice.wire).toContain('alice lives in Lyon');
    expect(alice.wire).not.toContain('Oslo');
    expect(bob.wire).toContain('bob lives in Oslo');
    expect(bob.wire).not.toContain('Lyon');
  });
});
