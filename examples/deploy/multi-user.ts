/**
 * deploy/multi-user — many people, at the same time, each with their own
 * memory (9.10.0).
 *
 * `standing-agent.ts` next door serves one agent to every session. That is
 * correct and it is serial: an `Agent` holds per-run state on itself, so one
 * instance can only be in one run at a time, and the composer serializes to
 * keep two conversations from overwriting each other.
 *
 * Three lines change that here:
 *
 *   agentFactory: () => buildAgent()   // one agent PER ACTIVE SESSION
 *   maxActiveSessions: 50              // bounded, LRU, eviction invisible
 *   sessionHeader / browserSessionId() // who is asking, from the client
 *
 * …and a fourth thing happens with no line at all: a run that carries a
 * `sessionId` and no `identity` is memory-scoped to `{ conversationId:
 * sessionId }`. A session IS a conversation, so a `.memory()` registered on the
 * agent recalls THAT person's earlier turns and nobody else's.
 *
 * This file is its own integration test: it binds an ephemeral port, has two
 * people talk to it AT THE SAME TIME, proves their turns overlapped in wall
 * clock, proves each remembered their own facts and neither saw the other's,
 * then shuts down. Set `SERVE=1` to keep it listening on :8080.
 *
 * In a browser the client half is one line:
 *
 *   import { browserSessionId } from 'agentfootprint';
 *   fetch('/invoke', { headers: { 'x-session-id': browserSessionId() }, ... })
 *
 * Run:  npm run example examples/deploy/multi-user.ts
 */

import { Agent, type LLMProvider } from '../../src/index.js';
import type { LLMRequest, LLMResponse } from '../../src/adapters/types.js';
import { memorySessions, nodeHost, standingAgent } from '../../src/doors/hosting.js';
import {
  defineMemory,
  MEMORY_STRATEGIES,
  MEMORY_TYPES,
  InMemoryStore,
} from '../../src/doors/memory.js';
import { isCliEntry, printResult, type ExampleMeta } from '../helpers/cli.js';

export const meta: ExampleMeta = {
  id: 'deploy/multi-user',
  title: 'Multi-user hosting — sessions in parallel, memory per person',
  group: 'deploy',
  description:
    'standingAgent({ agentFactory }) gives every active session its own Agent, so two people are answered at the same time; each session bounded by an LRU pool whose evictions are invisible because the conversation lives in the store. Proves the two runs overlapped and that neither person saw the other’s memory.',
  defaultInput: 'My favourite colour is vermilion.',
  providerSlots: ['default'],
  tags: ['deploy', 'hosting', 'sessions', 'concurrency', 'memory', 'multi-tenant'],
};

/**
 * One shared store behind every session's memory — and it stays isolated
 * anyway, because the SESSION is the namespace. Nothing here says `identity`.
 */
const conversations = new InMemoryStore();

/**
 * A stand-in model that ANSWERS FROM WHAT IT WAS SHOWN.
 *
 * The recall this example demonstrates arrives in the system prompt as a
 * `<memory>` block, so a mock with a fixed reply could not tell you whether it
 * arrived at all. This one reads its own prompt, which is the honest way to
 * show that session A's memory reached session A and nobody else's. Swap it for
 * a real provider and the same question is the model's to answer.
 *
 * The deliberate pause is what makes "at the same time" checkable rather than
 * asserted.
 */
function recallingProvider(pauseMs: number): LLMProvider {
  return {
    name: 'recalling',
    async complete(req: LLMRequest): Promise<LLMResponse> {
      await new Promise((resolve) => setTimeout(resolve, pauseMs));
      const colour = /favourite colour is (\w+)/i.exec(req.systemPrompt ?? '')?.[1];
      return {
        content: colour ? `I remember: ${colour}.` : 'I have not been told a colour.',
        toolCalls: [],
        usage: { input: 1, output: 1 },
        stopReason: 'stop',
      };
    },
  };
}

/** A consumer swaps the stand-in for a real provider — nothing else changes. */
function buildAgent(provider?: LLMProvider): Agent {
  return Agent.create({
    provider: provider ?? recallingProvider(100),
    model: 'mock',
    maxIterations: 2,
  })
    .system('You are a warm, very brief assistant.')
    .memory(
      defineMemory({
        id: 'chat',
        type: MEMORY_TYPES.EPISODIC,
        strategy: { kind: MEMORY_STRATEGIES.WINDOW, size: 10 },
        store: conversations,
      }),
    )
    .build();
}

// #region pool
/** Serve MANY sessions at once: one agent each, bounded, evicted LRU. */
async function serve(port: number, provider?: LLMProvider) {
  return standingAgent({
    // The one change from the single-agent shape. Return a NEW agent every
    // call — a factory that closes over one instance is refused by name,
    // because two sessions on one instance is the corruption this prevents.
    agentFactory: () => buildAgent(provider),
    sessions: memorySessions(), // swap for sqliteSessions/Redis; nothing else changes
    host: nodeHost({
      port,
      hostname: '127.0.0.1',
      // Where the session id arrives. 'x-session-id' is the default; naming it
      // is how a deployment behind a gateway points it somewhere else.
      sessionHeader: 'x-session-id',
    }),
    // How many sessions hold an agent at once. A new session at a full pool
    // retires the least recently used IDLE one — its conversation stays in the
    // store, so its next request re-hydrates onto a fresh instance and the
    // person never knows. A RUNNING session is never evicted.
    maxActiveSessions: 50,
  });
}
// #endregion pool

// #region turn
/** One turn. The header is the whole of "who is asking". */
async function say(base: string, sessionId: string, input: string): Promise<string> {
  const response = await fetch(`${base}/invoke`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-session-id': sessionId },
    body: JSON.stringify({ input }),
  });
  const body = (await response.json()) as { output?: string; error?: string };
  if (body.error) throw new Error(body.error);
  return body.output ?? '';
}
// #endregion turn

export async function run(input: string, provider?: LLMProvider): Promise<unknown> {
  const handle = await serve(0, provider);
  const base = handle.url;

  try {
    // ── Two people, at the same time ────────────────────────────────
    const startedAt = Date.now();
    await Promise.all([
      say(base, 'ada', input),
      say(base, 'grace', 'My favourite colour is teal.'),
    ]);
    const together = Date.now() - startedAt;

    // The same two turns, one after the other, for comparison. Two sessions in
    // parallel take about as long as one; in series they take about twice.
    const serialStart = Date.now();
    await say(base, 'ada', 'Still here?');
    await say(base, 'grace', 'Still here?');
    const inSeries = Date.now() - serialStart;

    // ── …and neither of them can see the other's memory ─────────────
    const adaRecall = await say(base, 'ada', 'What is my favourite colour?');
    const graceRecall = await say(base, 'grace', 'What is my favourite colour?');

    return {
      parallelMs: together,
      serialMs: inSeries,
      // Two sessions in parallel cost about one session's latency; the same two
      // turns in series cost two.
      sessionsRanInParallel: together < inSeries,
      adaRecall,
      graceRecall,
      // Nothing configured this. The session id IS the memory namespace, so
      // each person's recall is their own and neither can see the other's.
      memoryIsPerSession:
        adaRecall.includes('vermilion') &&
        graceRecall.includes('teal') &&
        !adaRecall.includes('teal') &&
        !graceRecall.includes('vermilion'),
    };
  } finally {
    await handle.close();
  }
}

if (isCliEntry(import.meta.url)) {
  if (process.env.SERVE === '1') {
    void serve(8080);
  } else {
    void run(meta.defaultInput!).then(printResult);
  }
}
