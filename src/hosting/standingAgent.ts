/**
 * hosting/standingAgent — an agent that stays up and remembers.
 *
 *   await standingAgent({
 *     agent,
 *     sessions: memorySessions(),
 *     host: nodeHost({ port: 8080 }),
 *   });
 *
 * One request at a time it does four things: wake and hydrate the session,
 * resume that conversation or start a fresh one, persist what the run leaves
 * behind, then reply. Everything else is somebody else's job — the host carries
 * bytes, the store keeps them, the agent thinks.
 *
 * ── Resuming is a REPLAY, and that has a cost you must know about ────────────
 * A stored conversation is restored through `agent.resumeOnError(...)`, and
 * this is its caveat, stated here in the words the Agent states it in, because
 * a composition that hides the caveat of the thing it composes is worse than no
 * composition at all:
 *
 *   > **Tool re-execution / idempotency**: tool side effects from the FAILED
 *   > iteration are not in the checkpoint. The model re-decides from the
 *   > restored history and may re-issue those tool calls — they WILL execute
 *   > again (there is no built-in toolCallId dedup). Mutating tools (payments,
 *   > emails, DB writes) must be idempotent — key on stable call content, not
 *   > `ctx.toolCallId` (a re-issued call gets a new id).
 *
 * ── Why one run at a time ───────────────────────────────────────────────────
 * An Agent instance holds per-run state on itself, and this composer shares ONE
 * instance across every session. Two runs overlapping on it do not crash —
 * which is precisely the danger. They both finish, and the state the composer
 * reads afterwards belongs to whichever started last, so one session's envelope
 * can end up holding another session's conversation. Nothing in the recording
 * would say so. Runs are therefore serialized, globally, and that is a
 * correctness requirement rather than a tuning choice.
 *
 * `onConcurrentInvoke` is the separate question of what to do when a second
 * turn of the SAME conversation arrives while the first is running: refuse it
 * (default) or queue it. A request for a DIFFERENT session is never refused —
 * there is nothing wrong with it; it simply waits its turn.
 *
 * Pattern: Composition root. It owns wiring and ordering; it invents no
 * mechanism of its own.
 */

import { isPaused } from '../core/pause.js';
import type { AgentRunCheckpoint } from '../core/runCheckpoint.js';
import { toEnvelope, readEnvelope } from './envelope.js';
import { ConcurrentRunError, PauseNotCarriedError } from './errors.js';
import type {
  HostHandle,
  HostReply,
  HostRequest,
  StandingAgentOptions,
  SessionLifecycle,
} from './types.js';
import type { Agent } from '../core/Agent.js';

/**
 * Serve one agent, with per-session conversation memory, on any
 * {@link AgentHost}.
 *
 * Resolves once the host is live. Closing the returned handle closes the host
 * and detaches the listeners this composer added to the agent.
 *
 * @example
 *   const handle = await standingAgent({
 *     agent,
 *     sessions: memorySessions(),
 *     host: nodeHost({ port: 0 }),
 *     onConcurrentInvoke: 'enqueue',
 *   });
 *   process.on('SIGTERM', () => void handle.close());
 */
export async function standingAgent<TH extends HostHandle>(
  options: StandingAgentOptions<TH>,
): Promise<TH> {
  const { agent, sessions, host } = options;
  const policy = options.onConcurrentInvoke ?? 'reject';

  // Runs are serialized, so at any moment there is at most one active reply and
  // at most one active run to name in a refusal.
  let activeReply: HostReply | undefined;
  let activeRunId: string | undefined;
  let activeSession: string | undefined;
  const queued: string[] = [];
  let chain: Promise<void> = Promise.resolve();
  let anonymous = 0;

  const offTurnStart = agent.on('agentfootprint.agent.turn_start', (event) => {
    activeRunId = (event as { meta?: { runId?: string } }).meta?.runId;
  });
  // Tokens reach the caller only if the host streams; `emit` on a host that
  // does not is a no-op by design, so this needs no capability check.
  const offToken = agent.on('agentfootprint.stream.token', (event) => {
    const content = (event as { payload?: { content?: string } }).payload?.content;
    if (typeof content === 'string' && content.length > 0) activeReply?.emit?.(content);
  });

  /** Queue `work` behind everything already waiting, FIFO. */
  function serialize(sessionKey: string, work: () => Promise<void>): Promise<void> {
    if (policy === 'reject' && (activeSession === sessionKey || queued.includes(sessionKey))) {
      return Promise.reject(new ConcurrentRunError(sessionKey, activeRunId));
    }
    queued.push(sessionKey);
    const mine = chain.then(async () => {
      queued.splice(queued.indexOf(sessionKey), 1);
      activeSession = sessionKey;
      try {
        await work();
      } finally {
        activeSession = undefined;
        activeRunId = undefined;
      }
    });
    // The chain must never reject, or one failed request would wedge every
    // request behind it.
    chain = mine.then(
      () => undefined,
      () => undefined,
    );
    return mine;
  }

  const handler = async (request: HostRequest, reply: HostReply): Promise<void> => {
    const sessionId = request.sessionId;
    // A request with no session has nothing to hydrate and nowhere to persist
    // that the caller could ask for again, so it gets its own key and can never
    // collide with anyone.
    const sessionKey = sessionId ?? `#anonymous-${++anonymous}`;
    try {
      await serialize(sessionKey, () => answerOne(agent, sessions, request, reply, sessionId));
    } catch (err) {
      reply.fail(err instanceof Error ? err : new Error(String(err)));
    }
  };

  async function answerOne(
    runner: Agent,
    store: SessionLifecycle,
    request: HostRequest,
    reply: HostReply,
    sessionId: string | undefined,
  ): Promise<void> {
    activeReply = reply;
    try {
      let prior: AgentRunCheckpoint | undefined;
      if (sessionId !== undefined) {
        await store.onWake?.(sessionId, 'invoke');
        const stored = await store.hydrate(sessionId);
        // Throws by name on a format this runtime cannot read — better a loud
        // refusal than an agent answering from half a conversation.
        if (stored !== undefined) prior = readEnvelope(stored);
      }

      // The signal reaches tool execution, tool discovery and skill-entry
      // scoring. It does NOT currently reach the LLM call, so a caller who
      // hangs up mid-generation stops the tools, not the token stream.
      const runOptions = request.signal ? { env: { signal: request.signal } } : undefined;

      const output = prior
        ? await runner.resumeOnError(continueConversation(prior, request.input), runOptions)
        : await runner.run({ message: request.input }, runOptions);

      if (isPaused(output)) {
        reply.fail(new PauseNotCarriedError(pausedToolName(runner), sessionId));
        return;
      }

      if (sessionId !== undefined) {
        const conversation = runner.checkpoint();
        // Persist BEFORE answering: the caller learns the answer only once the
        // conversation that produced it is durable, so a queued next turn can
        // never read state older than the answer already given.
        if (conversation) await store.persist(sessionId, toEnvelope(conversation));
      }
      reply.complete(typeof output === 'string' ? output : String(output));
    } finally {
      activeReply = undefined;
    }
  }

  const handle = await host.serve(handler);
  // Keep whatever the adapter put on its own handle (nodeHost's bound `url`,
  // say) and replace only `close`, which now also detaches this composer's
  // listeners. The cast is the one place TypeScript cannot see that a spread
  // plus one override is still the adapter's handle type.
  return {
    ...handle,
    async close(): Promise<void> {
      await handle.close();
      offTurnStart();
      offToken();
    },
  } as TH;
}

/**
 * The stored conversation plus this turn's message.
 *
 * The new message has to be appended by hand: `resumeOnError` restores the
 * history it is given and the LLM stage reads that history directly, so a
 * message left out here is a message the model never sees.
 */
function continueConversation(prior: AgentRunCheckpoint, input: string): AgentRunCheckpoint {
  return {
    ...prior,
    history: [...prior.history, { role: 'user', content: input }],
    originalInput: { message: input },
    checkpointedAt: Date.now(),
  };
}

/** Which tool asked for a human, when the paused run recorded one. */
function pausedToolName(runner: Agent): string | undefined {
  const state = runner.getLastSnapshot()?.sharedState as { pausedToolName?: unknown } | undefined;
  const name = state?.pausedToolName;
  return typeof name === 'string' && name.length > 0 ? name : undefined;
}
