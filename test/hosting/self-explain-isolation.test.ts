/**
 * SELF-EXPLAIN READS ONLY ITS OWN CONVERSATION — on an agent shared by many
 * signed-in people (`standingAgent({ agent })`).
 *
 * Before this fix `SelfExplainBinding` held ONE slot of evidence per agent
 * instance: "the previous completed run" was whoever ran last, so bob's
 * why-question was answered from alice's snapshot and narrative (her message
 * text included), and `inspect_tool_run` descended into any person's retained
 * tool run by id (R2-11 of the run-scope devil review).
 *
 * The laws being pinned:
 *   • Evidence is kept PER CONVERSATION: a session-bound run reads the
 *     previous completed run of ITS OWN session and nothing else; a run with no
 *     session reads the previous run that had none.
 *   • A tool's retained inner runs are served through the same key — a record
 *     filed by another session's run is not found, not listed.
 *   • No event from serving session S enters another session's recording
 *     (the 9.115.0 membership rule, `eventBelongsToRun`, re-asserted here
 *     under interleaving).
 *
 * Test types (Convention 3): property (N people, seeded interleavings, every
 * recording and every self-explain answer holds only its own conversation) ·
 * security (another person's secret text never reaches a model's tool result)
 * · scenario (the answer is still SERVED to its owner — isolation is not
 * denial) · integration (through `standingAgent` with a verifying door).
 */

import { afterEach, describe, expect, it } from 'vitest';
import { flowChart } from 'footprintjs';

import { Agent, flowchartAsTool, inMemoryArtifacts } from '../../src/index.js';
import type { AgentfootprintEvent } from '../../src/events.js';
import type { LLMRequest } from '../../src/adapters/types.js';
import { mock } from '../../src/llm-providers.js';
import { IdentityNotVerifiedError } from '../../src/hosting/index.js';
import type { IdentityVerifier, VerifiedIdentity } from '../../src/hosting/index.js';
import { harness, recordingsOf, redeem, textOf, type FilingHost } from './turnArtifactsHarness.js';

const { served, closeAll } = harness();
afterEach(closeAll);

/** A tiny deterministic PRNG (mulberry32) — a failing seed replays exactly. */
function prng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function verifierFor(users: readonly string[]): IdentityVerifier {
  const accepted = new Map<string, VerifiedIdentity>(users.map((u) => [`tok-${u}`, { userId: u }]));
  return {
    verify: (token: string) => {
      const found = accepted.get(token);
      return found === undefined
        ? Promise.reject(new IdentityNotVerifiedError('unverifiable', false))
        : Promise.resolve(found);
    },
  };
}

const secretOf = (user: string, turn: number) => `SECRET-${user}-${turn}`;
const stashIdOf = (user: string, turn: number) => `stash-${user}-${turn}`;

/**
 * A scripted model that decides from the request, not from a global reply
 * queue, so any interleaving of people gets a coherent script:
 *   `STASH <secret> <callId>`  → call `stash({ secret })`, then say "stashed";
 *   `WHY <foreignCallId>`      → activate self-explain, then read the narrative,
 *                                the overview, search for "SECRET", and try to
 *                                descend into ANOTHER person's stash call.
 */
function scriptedModel() {
  let seq = 0;
  const lastUserText = (request: LLMRequest): { text: string; toolsAfter: number } => {
    const messages = request.messages;
    let at = -1;
    for (let i = 0; i < messages.length; i++) if (messages[i]?.role === 'user') at = i;
    const content = messages[at]?.content;
    const text = typeof content === 'string' ? content : JSON.stringify(content ?? '');
    const toolsAfter = messages.slice(at + 1).filter((m) => m.role === 'tool').length;
    return { text, toolsAfter };
  };
  const base = mock({
    respond: (request: LLMRequest) => {
      const { text, toolsAfter } = lastUserText(request);
      const [verb, a, b] = text.split(' ');
      if (verb === 'STASH') {
        return toolsAfter === 0
          ? { toolCalls: [{ id: b as string, name: 'stash', args: { secret: a } }] }
          : { content: 'stashed' };
      }
      if (verb === 'WHY') {
        const plan: Array<[string, Record<string, unknown>]> = [
          ['read_skill', { id: 'self-explain' }],
          ['read_narrative', {}],
          ['run_overview', {}],
          ['find_in_trace', { query: 'SECRET' }],
          ['inspect_tool_run', { toolCallId: a, find: 'SECRET' }],
        ];
        const step = plan[toolsAfter];
        if (step === undefined) return { content: 'here is why' };
        return { toolCalls: [{ id: `why-${++seq}`, name: step[0], args: step[1] }] };
      }
      return { content: 'noted' };
    },
  });
  // Non-streaming, as in the R2-11 reproduction: the scripted tool calls ride `complete`.
  return new Proxy(base, {
    get: (target, prop) => (prop === 'stream' ? undefined : Reflect.get(target, prop, target)),
  });
}

/** A chart tool that keeps a record of its own run — the secret is IN that record. */
function stashTool() {
  return flowchartAsTool({
    name: 'stash',
    description: 'Keep a note.',
    inputSchema: {
      type: 'object',
      properties: { secret: { type: 'string' } },
      required: ['secret'],
    },
    flowchart: flowChart<{ kept: string }>(
      'Keep',
      (scope) => {
        scope.kept = (scope.$getArgs() as { secret: string }).secret;
      },
      'keep',
    ).build(),
    keepRecord: true,
  });
}

function sharedExplainingAgent(): Agent {
  return Agent.create({
    provider: scriptedModel() as never,
    model: 'm',
    maxIterations: 8,
    artifacts: { store: inMemoryArtifacts(), recordings: true },
  })
    .tool(stashTool())
    .selfExplain({})
    .build();
}

interface Turn {
  readonly user: string;
  readonly kind: 'STASH' | 'WHY';
  readonly turn: number;
}

/** Each person's own order is fixed (STASH, WHY, STASH, WHY); only the interleaving is random. */
function schedule(users: readonly string[], rounds: number, random: () => number): Turn[] {
  const queues = users.map((user) =>
    Array.from({ length: rounds * 2 }, (_, i) => ({
      user,
      kind: i % 2 === 0 ? ('STASH' as const) : ('WHY' as const),
      turn: Math.floor(i / 2),
    })),
  );
  const out: Turn[] = [];
  while (queues.some((q) => q.length > 0)) {
    const live = queues.filter((q) => q.length > 0);
    const pick = live[Math.floor(random() * live.length)] as Turn[];
    out.push(pick.shift() as Turn);
  }
  return out;
}

async function play(seed: number, users: readonly string[], rounds: number) {
  const random = prng(seed);
  const agent = sharedExplainingAgent();
  const toolEnds: AgentfootprintEvent[] = [];
  agent.on('agentfootprint.stream.tool_end', (event: AgentfootprintEvent) => toolEnds.push(event));
  const recordings = recordingsOf(agent);
  const { host } = await served(agent, {
    verify: true,
    extra: { identity: { verify: verifierFor(users).verify } },
  });
  const headersOf = (user: string) => ({ authorization: `Bearer tok-${user}` });
  const filedBy: Array<{ user: string; ref: string }> = [];

  const stashed = new Set<string>();
  for (const step of schedule(users, rounds, random)) {
    // Aim the descent at somebody who HAS filed a record, when anybody has —
    // a target that does not exist yet proves nothing.
    const others = users.filter((u) => u !== step.user);
    const filed = others.filter((u) => stashed.has(u));
    const pool = filed.length > 0 ? filed : others;
    const foreign = pool[Math.floor(random() * pool.length)] as string;
    if (step.kind === 'STASH') stashed.add(step.user);
    const input =
      step.kind === 'STASH'
        ? `STASH ${secretOf(step.user, step.turn)} ${stashIdOf(step.user, step.turn)}`
        : `WHY ${stashIdOf(foreign, 0)}`;
    const before = recordings().length;
    const delivered = await host.deliver({
      sessionId: `s-${step.user}`,
      input,
      headers: headersOf(step.user),
    });
    expect(delivered.code, `${step.user} ${step.kind}: ${delivered.error}`).toBeUndefined();
    for (const fact of recordings().slice(before)) filedBy.push({ user: step.user, ref: fact.ref });
  }
  return { host, users, toolEnds, filedBy, headersOf };
}

const foreignSecretsIn = (text: string, owner: string, users: readonly string[]) =>
  users
    .filter((u) => u !== owner)
    .flatMap((u) => [0, 1, 2, 3].map((t) => secretOf(u, t)))
    .filter((secret) => text.includes(secret));

/** Another person's retained call, OFFERED as one to open or DESCENDED into. */
const foreignCallsOfferedIn = (text: string, owner: string, users: readonly string[]) =>
  users
    .filter((u) => u !== owner)
    .flatMap((u) =>
      [0, 1, 2, 3].flatMap((t) => [
        `${stashIdOf(u, t)} (stash,`,
        `INSIDE TOOL CALL ${stashIdOf(u, t)}`,
      ]),
    )
    .filter((offer) => text.includes(offer));

describe('R2-11 — self-explain on a shared agent reads only the asking conversation', () => {
  it('property: N people, seeded interleavings — every self-explain answer holds only its own conversation, and is still served', async () => {
    const users = ['ann', 'ben', 'cat', 'dev'];
    for (const seed of [1, 2, 3, 4, 5]) {
      const { toolEnds } = await play(seed, users, 2);
      for (const user of users) {
        const own = toolEnds.filter((event) => event.meta.sessionId === `s-${user}`);
        const text = own.map((event) => JSON.stringify(event.payload)).join('\n');
        expect(foreignSecretsIn(text, user, users), `seed ${seed}, ${user}`).toEqual([]);
        expect(foreignCallsOfferedIn(text, user, users), `seed ${seed}, ${user}`).toEqual([]);
        // Isolation is not denial: each WHY follows the same person's STASH,
        // so their own evidence (their own secret) is what the model was served.
        expect(text, `seed ${seed}, ${user} was served nothing of their own`).toContain(
          secretOf(user, 1),
        );
      }
      await closeAll();
    }
  });

  it('property: every recording holds only its own run’s events and its own conversation’s text', async () => {
    const users = ['ann', 'ben', 'cat'];
    for (const seed of [11, 12, 13]) {
      const { host, filedBy, headersOf } = await play(seed, users, 2);
      expect(filedBy.length).toBe(users.length * 4);
      for (const { user, ref } of filedBy) {
        const got = await redeem(host as FilingHost, `s-${user}`, ref, headersOf(user));
        expect(got.error, `${user} could not redeem their own recording`).toBeUndefined();
        const text = textOf(got);
        expect(foreignSecretsIn(text, user, users), `seed ${seed}, ${user}`).toEqual([]);
        const data = JSON.parse(text) as { events: Array<{ meta: { sessionId?: string } }> };
        const strangers = data.events.filter(
          (event) => event.meta.sessionId !== undefined && event.meta.sessionId !== `s-${user}`,
        );
        expect(strangers, `seed ${seed}, ${user}`).toEqual([]);
      }
      await closeAll();
    }
  });
});
