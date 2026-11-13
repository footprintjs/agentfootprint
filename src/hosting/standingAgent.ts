import { type HostHandle, type StandingAgentHandle, type StandingAgentOptions } from './types.js';
import { createArtifactAccess } from './standingAgent/artifacts/access.js';
import { createArtifactWire } from './standingAgent/artifacts/wire.js';
import { createLanePool } from './standingAgent/lanes/pool.js';
import { createRequestHandler } from './standingAgent/requests/handler.js';
import { createSessionHistory } from './standingAgent/sessions/history.js';
import { createTurnRunner } from './standingAgent/turn/run.js';
import { readConfiguration } from './standingAgent/configuration/read.js';
import { recordHostRefusal } from './ingressRecord.js';

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
 * A stored conversation is restored through `agent.run({ message, continueFrom })`
 * — the public conversation door since 9.2.0. This composer used to assemble the
 * continuation by hand (append the turn, rewrite `originalInput`, hand the result
 * to `resumeOnError`); that hand-assembly IS the door now, so a server and a
 * script continue a conversation the same way and the identity travels with it.
 * The caveat below is stated here in the words the Agent states it in, because a
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
 * ── Why one run at a time, and where that bound actually is ─────────────────
 * Native admission refuses overlapping use of one Agent instance. This host
 * serializes a lane's turns through persistence and delivery too. `{ agent }`
 * shares one global lane; `{ agentFactory }` creates a lane for each session.
 * Independent sessions can then run concurrently on separate instances.
 *
 *   standingAgent({ agent })          → one instance,  global queue
 *   standingAgent({ agentFactory })   → one per session, a queue each
 *
 * Everything else is identical between the two: the same stores, the same
 * durability modes, the same pause/resume contract, the same refusals. The
 * session store is keyed per session already, which is why the pool can evict a
 * session's instance without the person on the other end noticing — the
 * CONVERSATION was never in the instance.
 *
 * `onConcurrentInvoke` is the separate question of what to do when a second
 * turn of the SAME conversation arrives while the first is running: refuse it
 * (default) or queue it. It means the same thing in both shapes. A request for
 * a DIFFERENT session is never refused — there is nothing wrong with it; in the
 * shared shape it waits its turn, and in the pooled shape it does not have to.
 *
 * ── The pool, in one paragraph ──────────────────────────────────────────────
 * One instance per ACTIVE session, built on first sight by the factory, bounded
 * by `maxActiveSessions` (default 100) and evicted least-recently-used. An
 * evicted session's agent has its tool sessions closed with reason `'evicted'`
 * — the 9.7.0 vocabulary, not a new one — and is then shut down; its
 * conversation stays in the store, so its next request re-hydrates onto a fresh
 * instance and nothing was lost. A session that is RUNNING is never evicted:
 * the bound is on retained idle instances, and a cache policy does not get to
 * end somebody's turn. Requests with NO session share one fallback instance,
 * because there is no conversation to isolate and an instance per anonymous
 * request would be an instance per request.
 *
 * Pattern: Composition root. It owns wiring and ordering; it invents no
 * mechanism of its own.
 */

/**
 * Serve an agent, with per-session conversation memory, on any
 * {@link AgentHost}.
 *
 * Resolves once the host is live. Closing the returned handle closes the host,
 * detaches the listeners this composer added, and removes its durability
 * wiring.
 *
 * Two shapes, one composer — see the file header for the full comparison:
 *
 *  - `{ agent }` — one instance for every session, runs serialized globally.
 *    Correct, and unchanged from every earlier release.
 *  - `{ agentFactory }` — one instance per active session, sessions in
 *    PARALLEL, each session's turns serialized on its own instance.
 *
 * @example  One agent, every session
 *   const handle = await standingAgent({
 *     agent,
 *     sessions: memorySessions(),
 *     host: nodeHost({ port: 0 }),
 *     onConcurrentInvoke: 'enqueue',
 *     durability: 'sync',
 *   });
 *   process.on('SIGTERM', () => void handle.close());
 *
 * @example  One agent per session — they answer at the same time
 *   const handle = await standingAgent({
 *     agentFactory: () => Agent.create({ provider, model }).system('…').build(),
 *     sessions: sqliteSessions({ file: './sessions.db' }),
 *     host: nodeHost({ port: 8080 }),
 *     maxActiveSessions: 200,
 *   });
 */
export async function standingAgent<TH extends HostHandle>(
  options: StandingAgentOptions<TH>,
): Promise<TH & StandingAgentHandle> {
  const configuration = readConfiguration(options);
  const { host, ingressSink } = configuration;
  const lanePool = createLanePool({ ...configuration, isClosing: () => closing !== undefined });
  const { shared, pool } = lanePool;
  const history = createSessionHistory(configuration);
  const access = createArtifactAccess({
    ...configuration,
    shared,
    pool,
    retired: lanePool.retired,
    redeemerFor: lanePool.redeemerFor,
    mayOpenSession: history.mayOpenSession,
    isClosing: () => closing !== undefined,
  });
  const answerArtifact = createArtifactWire({
    ...configuration,
    ...access,
    redeemerFor: lanePool.redeemerFor,
    isClosing: () => closing !== undefined,
  });
  const answerOne = createTurnRunner({ ...configuration, mayOpenSession: history.mayOpenSession });
  const handler = createRequestHandler({
    ...configuration,
    laneFor: lanePool.laneFor,
    serialize: lanePool.serialize,
    answerSessionOp: history.answerSessionOp,
    answerArtifact,
    answerOne,
  });
  const { artifactsForRequest } = access;

  // The HOST's own refusals — a forged request its door guard turned away, a
  // session id over the bound — never reach `handler`, so they would never
  // reach the record either. Subscribed only when a sink is set (the zero-delta
  // path stays zero), and only on a host that reports them (feature-detected).
  // Before `serve`, so a refusal in the first instant of serving is not lost.
  const stopHostRefusals =
    ingressSink !== undefined && typeof host.onRefusal === 'function'
      ? host.onRefusal((refusal) => recordHostRefusal(refusal, ingressSink))
      : undefined;
  let handle: HostHandle;
  try {
    handle = await host.serve(handler);
  } catch (err) {
    stopHostRefusals?.();
    throw err;
  }

  // ── Shutdown ────────────────────────────────────────────────────────
  //
  // Telemetry drains on close, because a batching exporter that loses its
  // last batch when the server stops is the most common way a shutdown lies
  // about what happened. Draining is safe on an agent this composer only
  // borrowed; RELEASING it is not, so that is opt-in.
  //
  // A POOLED instance is not borrowed — this composer made it, and nothing can
  // reach it once the pool is dropped. So `'flush'` and `'flush-and-stop'` both
  // stop a pooled agent (drain, then release), because the alternative is
  // leaving timers running that nobody owns. `'none'` still means what it says:
  // touch nothing.
  const shutdownMode = options.shutdown ?? 'flush';
  const installedSignals: Array<{ signal: NodeJS.Signals; listener: () => void }> = [];

  function removeSignalListeners(): void {
    for (const { signal, listener } of installedSignals) process.removeListener(signal, listener);
    installedSignals.length = 0;
  }

  // Idempotent: the first call owns the shutdown, later ones await it — the
  // same rule `httpHost.close()` follows, and what lets a signal handler and
  // an explicit close coexist.
  let closing: Promise<void> | undefined;
  function closeOnce(): Promise<void> {
    closing ??= (async () => {
      await handle.close();
      stopHostRefusals?.();
      if (shared !== undefined) {
        shared.detach();
        if (shutdownMode !== 'none') {
          // `stop: false` under 'flush' — drain without releasing what the
          // caller still owns.
          await shared.agent.shutdown({ stop: shutdownMode === 'flush-and-stop' });
        }
      } else {
        const lanes = [...pool.values()];
        pool.clear();
        for (const lane of lanes) lane.detach();
        if (shutdownMode !== 'none') {
          // allSettled, not all: one instance whose exporter refuses to drain
          // must not strand the drain of every other session's. The reader is
          // this composer's too, so it stops with them.
          const owned = [
            ...lanes.map((lane) => lane.agent),
            ...(lanePool.reader ? [lanePool.reader] : []),
          ];
          await Promise.allSettled(owned.map((agent) => agent.shutdown({ stop: true })));
        }
      }
      removeSignalListeners();
    })();
    return closing;
  }

  for (const signal of options.shutdownOn ?? []) {
    const listener = (): void => {
      void closeOnce().finally(() => {
        // Our listeners are gone by now (closeOnce removes them), so
        // re-raising lands on the DEFAULT disposition: the process ends the
        // way the platform meant it to, not by an exit code we invented.
        removeSignalListeners();
        process.kill(process.pid, signal);
      });
    };
    process.on(signal, listener);
    installedSignals.push({ signal, listener });
  }

  // Keep whatever the adapter put on its own handle (nodeHost's bound `url`,
  // say) and replace only `close`, which now also detaches this composer's
  // listeners. The cast is the one place TypeScript cannot see that a spread
  // plus one override is still the adapter's handle type.
  return {
    ...handle,
    close: closeOnce,
    artifactsForRequest,
  } as TH & StandingAgentHandle;
}
