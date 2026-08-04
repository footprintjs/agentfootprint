/**
 * hosting/standingAgent — an agent that stays up and remembers.
 *
 *   await standingAgent({
 *     agent,
 *     sessions: memorySessions(),
 *     host: nodeHost({ port: 8080 }),
 *     durability: 'sync',          // optional; 'exit' is the default
 *   });
 *
 * One request at a time it does four things: wake and hydrate the session,
 * continue that session or start a fresh one, persist what the run leaves
 * behind, then reply. Everything else is somebody else's job — the host carries
 * bytes, the store keeps them, the agent thinks.
 *
 * ── A run has three ends, and this composer honours all three ────────────────
 * It answered, it asked a person something, or it failed. An answer completes
 * the reply and stores a conversation. A QUESTION stores the paused run as
 * `'flowchart-v1'` and leaves through `reply.awaiting(...)` — its own terminal,
 * never `fail`, because a pause is unfinished work and reporting it as a failure
 * tells every dashboard downstream something untrue. A later request for that
 * session carrying `decision` continues the run from exactly where it stopped.
 *
 * ── "Start a fresh one" is an answer it must EARN ───────────────────────────
 * A session with nothing stored is answered fresh, and that is right. A session
 * whose stored conversation cannot be READ is not: an unreadable stored
 * conversation and an absent one are different facts, and only one of them is
 * safe to answer with a fresh start. So an `UnreadableEnvelopeError` out of the
 * store fails THIS REQUEST, naming the session, and the fresh-start path is
 * never reached. The alternative is a reply that looks perfect to everyone
 * involved while a user's conversation quietly stops existing.
 *
 * ── Resuming a CONVERSATION is a REPLAY, and that has a cost ─────────────────
 * A stored conversation is restored through `agent.resumeOnError(...)`, and this
 * is its caveat, stated here in the words the Agent states it in, because a
 * composition that hides the caveat of the thing it composes is worse than no
 * composition at all:
 *
 *   > **Tool re-execution / idempotency**: tool side effects from the FAILED
 *   > iteration are not in the checkpoint. The model re-decides from the
 *   > restored history and may re-issue those tool calls — they WILL execute
 *   > again (there is no built-in toolCallId dedup). Mutating tools (payments,
 *   > emails, DB writes) must be idempotent — key on stable call content, not
 *   > `ctx.toolCallId` (a re-issued call gets a new id).
 *
 * `durability` is the dial that bounds how much of that a crash can cost you.
 * Resuming a PAUSED run is different in kind: it is not a replay at all — the
 * engine continues from its own checkpoint, and no earlier tool call re-runs.
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

import { isPaused, type RunnerPauseOutcome } from '../core/pause.js';
import type { AgentRunCheckpoint } from '../core/runCheckpoint.js';
import { durableWriter, type DurableWriter } from './durability.js';
import { readEnvelope, readPausedRun, toEnvelope, toPausedEnvelope } from './envelope.js';
import {
  AwaitingDecisionError,
  ConcurrentRunError,
  NoPendingAskError,
  PauseNotCarriedError,
  UnreadableEnvelopeError,
} from './errors.js';
import type {
  HostHandle,
  HostReply,
  HostRequest,
  PausedRun,
  PendingAsk,
  StandingAgentOptions,
  SessionLifecycle,
} from './types.js';
import type { Agent } from '../core/Agent.js';

/**
 * Serve one agent, with per-session conversation memory, on any
 * {@link AgentHost}.
 *
 * Resolves once the host is live. Closing the returned handle closes the host,
 * detaches the listeners this composer added to the agent, and removes its
 * durability wiring.
 *
 * @example
 *   const handle = await standingAgent({
 *     agent,
 *     sessions: memorySessions(),
 *     host: nodeHost({ port: 0 }),
 *     onConcurrentInvoke: 'enqueue',
 *     durability: 'sync',
 *   });
 *   process.on('SIGTERM', () => void handle.close());
 */
export async function standingAgent<TH extends HostHandle>(
  options: StandingAgentOptions<TH>,
): Promise<TH> {
  const { agent, sessions, host } = options;
  const policy = options.onConcurrentInvoke ?? 'reject';
  const durability = options.durability ?? 'exit';

  // Runs are serialized, so at any moment there is at most one active reply and
  // at most one active run to name in a refusal.
  let activeReply: HostReply | undefined;
  let activeRunId: string | undefined;
  let activeSession: string | undefined;
  /** The REAL session id of the active run — never the anonymous placeholder. */
  let activeSessionId: string | undefined;
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

  // Under 'exit' NOTHING is built: no observer on the agent, no barrier, no
  // per-commit work. That is what "the default is byte-identical" means here —
  // not a mode that happens to write once, but wiring that is never installed.
  const writer: DurableWriter | undefined =
    durability === 'exit'
      ? undefined
      : durableWriter({
          mode: durability,
          session: () => activeSessionId,
          runId: () => activeRunId,
          write: (sessionId, conversation) => sessions.persist(sessionId, toEnvelope(conversation)),
        });
  const detachWriter = writer ? agent.attach(writer.recorder) : undefined;
  const uninstallBarrier = writer?.install(agent);

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
    // The writer only ever writes for the run it is inside; an anonymous
    // request has nowhere to write to and gets nothing.
    activeSessionId = sessionId;
    try {
      let prior: AgentRunCheckpoint | undefined;
      let paused: PausedRun | undefined;
      if (sessionId !== undefined) {
        // A request carrying a decision is waking this session to CONTINUE a
        // run, which is a different thing to ask a store to be ready for.
        await store.onWake?.(sessionId, request.decision !== undefined ? 'resume' : 'invoke');
        try {
          const stored = await store.hydrate(sessionId);
          if (stored !== undefined) {
            // Both readers throw by name on a format this runtime cannot read —
            // better a loud refusal than an agent answering from half a session.
            if (stored.format === 'flowchart-v1') paused = readPausedRun(stored);
            else prior = readEnvelope(stored);
          }
        } catch (err) {
          // A stored conversation this runtime cannot read fails THIS REQUEST,
          // naming the session. It must never fall through to the fresh-start
          // path below: the conversation exists, and answering it as if the
          // caller were new is the one failure nobody can see from the outside.
          // A store that knows the session already named it; one that does not
          // gets the name added here, so the guarantee does not depend on which
          // store you chose.
          throw err instanceof UnreadableEnvelopeError ? err.withSession(sessionId) : err;
        }
      }

      // The signal reaches tool execution, tool discovery and skill-entry
      // scoring. It does NOT currently reach the LLM call, so a caller who
      // hangs up mid-generation stops the tools, not the token stream.
      const runOptions = request.signal ? { env: { signal: request.signal } } : undefined;

      // ── The one discriminant ─────────────────────────────────────────
      // A request carrying `decision` answers a pending question; a request
      // without one is a new message. Never inferred from the text: reading
      // approval out of prose is a guess, and a consent gate may not be built
      // on a guess.
      if (request.decision !== undefined) {
        if (!paused) {
          reply.fail(new NoPendingAskError(sessionId ?? '(anonymous)'));
          return;
        }
        await deliver(
          await runner.resume(paused.checkpoint, request.decision, runOptions),
          runner,
          store,
          reply,
          sessionId,
        );
        return;
      }
      if (paused && sessionId !== undefined) {
        // The message is not run and the pause is not discarded. Both of the
        // other options lose something a person cared about.
        reply.fail(new AwaitingDecisionError(sessionId, paused.pending));
        return;
      }

      const output = prior
        ? await runner.resumeOnError(continueConversation(prior, request.input), runOptions)
        : await runner.run({ message: request.input }, runOptions);
      await deliver(output, runner, store, reply, sessionId);
    } catch (err) {
      // A run that threw still has to drain. A write left in flight would race
      // the NEXT turn's terminal write and could land after it. The drain's own
      // failure is swallowed here and only here: the caller is already being
      // told about the run's error, and replacing it with a storage error would
      // hide the thing that actually went wrong.
      await writer?.settle().catch(() => undefined);
      throw err;
    } finally {
      activeReply = undefined;
      activeSessionId = undefined;
    }
  }

  /** Store what the run left behind, then end the reply with the right terminal. */
  async function deliver(
    output: unknown,
    runner: Agent,
    store: SessionLifecycle,
    reply: HostReply,
    sessionId: string | undefined,
  ): Promise<void> {
    // Mid-run writes settle FIRST. Ordering, not tidiness: an 'async' write
    // still in flight would otherwise land after the terminal envelope and
    // overwrite it — a stored pause quietly demoted back to a conversation,
    // and the question a person was asked gone with it. It also rethrows a
    // store that refused this run's progress, so a broken store fails the
    // request rather than being reported as a clean answer.
    await writer?.settle();

    if (isPaused(output)) {
      const pending = describePause(output, sessionId);
      const conversation = sessionId === undefined ? undefined : runner.checkpoint();
      if (sessionId !== undefined && conversation) {
        await store.persist(
          sessionId,
          toPausedEnvelope({ checkpoint: output.checkpoint, conversation, pending }),
        );
        if (reply.awaiting) {
          reply.awaiting(pending);
          return;
        }
      }
      // Either there was nowhere to store it, or the host cannot describe a
      // question. Both are refusals about THIS reply, not about the run.
      reply.fail(new PauseNotCarriedError(pending.tool, sessionId, conversation !== undefined));
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
      uninstallBarrier?.();
      detachWriter?.();
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

/**
 * Project a paused run into the part that is safe to hand back: the question,
 * never the state.
 *
 * Every field is read from what the run actually recorded — the tool name and
 * question the dispatch loop stamps on `pauseData`, the typed `checkIn`, the
 * middleware `ask`. A field the run did not record is simply absent. Nothing
 * here infers, summarises or invents, which is why the raw `pauseData` rides
 * along untouched: the tool's author chose those words.
 */
function describePause(outcome: RunnerPauseOutcome, sessionId: string | undefined): PendingAsk {
  const data = outcome.pauseData as { toolName?: unknown; question?: unknown } | undefined;
  const tool = typeof data?.toolName === 'string' ? data.toolName : undefined;
  const question = typeof data?.question === 'string' ? data.question : undefined;
  return {
    ...(sessionId !== undefined && { sessionId }),
    ...(tool !== undefined && { tool }),
    ...(question !== undefined && { question }),
    ...(outcome.checkIn !== undefined && { checkIn: outcome.checkIn }),
    ...(outcome.ask !== undefined && { ask: outcome.ask }),
    pauseData: outcome.pauseData,
  };
}
