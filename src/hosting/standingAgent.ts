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
 * An Agent instance holds per-run state on itself. Two runs overlapping on ONE
 * instance do not crash — which is precisely the danger. They both finish, and
 * the state the composer reads afterwards belongs to whichever started last, so
 * one session's envelope can end up holding another session's conversation.
 * Nothing in the recording would say so. **Runs on one instance are therefore
 * serialized, and that is a correctness requirement rather than a tuning
 * choice.**
 *
 * What CHANGED in 9.10.0 is not that rule but its scope. `{ agent }` hands this
 * composer one instance to share, so the serialization is global — the shape
 * every earlier release had, unchanged to the byte. `{ agentFactory }` hands it
 * a way to MAKE instances, so each session gets its own and the same rule binds
 * per session: sessions run in parallel, each session's turns queue behind that
 * session's own instance.
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

import { bindArtifacts, type ArtifactEventFact } from '../artifacts/capability.js';
import { readAskComponent } from '../core/askComponent.js';
import { isPaused, type RunnerPauseOutcome } from '../core/pause.js';
import type { AgentRunCheckpoint } from '../core/runCheckpoint.js';
import type { ArtifactWireRequest, ArtifactWireResult } from './artifactWire.js';
import { durableWriter, type DurableWriter } from './durability.js';
import {
  envelopeOwner,
  envelopeTranscript,
  readEnvelope,
  readPausedRun,
  toEnvelope,
  toPausedEnvelope,
} from './envelope.js';
import {
  AdmissionRefusedError,
  ArtifactNotCarriedError,
  ArtifactNotFoundError,
  ArtifactSessionRequiredError,
  AwaitingDecisionError,
  ConcurrentRunError,
  NoArtifactStoreError,
  NoPendingAskError,
  PauseNotCarriedError,
  SessionIndexUnavailableError,
  SessionNotFoundError,
  SessionOpNeedsIdentityError,
  SessionsNotCarriedError,
  UnreadableEnvelopeError,
} from './errors.js';
import { verifyRequestIdentity, type VerifiedIdentity } from './identityVerification.js';
import { spendKeyFor, spendLedger, type SpendLedger } from './admission.js';
import { beginIngress, type IngressNote } from './ingressRecord.js';
import type { SessionWireRequest, SessionWireResult } from './sessionWire.js';
import { SESSION_LIST_OP, SESSION_TRANSCRIPT_OP } from './sessionWire.js';
import type {
  CheckpointEnvelope,
  HostHandle,
  HostReply,
  HostRequest,
  PausedRun,
  PendingAsk,
  StandingAgentOptions,
  SessionLifecycle,
} from './types.js';
import { DEFAULT_MAX_ACTIVE_SESSIONS } from './types.js';
import type { Agent, AgentRunOptions } from '../core/Agent.js';
import type { MemoryIdentity } from '../memory/identity/types.js';

/**
 * The pool key the anonymous fallback instance is held under, and the session
 * key it can never collide with: a real session id from a transport is a
 * string somebody sent, and no wire delivers one that starts with `#`… which is
 * not a guarantee, so it is not relied on — anonymous requests are routed by
 * ABSENCE of a session id, never by matching this string.
 */
const ANONYMOUS_LANE = '#anonymous';

/**
 * One agent, and everything this composer keeps beside it.
 *
 * A lane is the unit of serialization: one queue, one active run, one reply to
 * emit tokens into. `{ agent }` builds exactly one lane and every session maps
 * to it — which is what makes that shape's global serialization fall out of the
 * same code rather than being a second implementation of it. `{ agentFactory }`
 * builds one per active session plus one for anonymous traffic.
 *
 * The listener wiring, the durable writer and the "which reply is live" slot
 * are all per lane because they are all per INSTANCE: a token event carries no
 * session, so the only honest way to know which reply it belongs to is to have
 * subscribed on the agent that produced it.
 */
interface Lane {
  /** How the pool holds it: a session id, or {@link ANONYMOUS_LANE}. */
  readonly poolKey: string;
  readonly agent: Agent;
  /** The FIFO every request on this lane waits behind. Never rejects. */
  chain: Promise<void>;
  /** Session keys admitted and not yet started — the `'reject'` collision set. */
  readonly queued: string[];
  /** The session key of the run in flight, when there is one. */
  activeSession?: string;
  activeRunId?: string;
  /** The REAL session id of the active run — never the anonymous placeholder. */
  activeSessionId?: string;
  activeReply?: HostReply;
  /** Requests admitted and not yet finished. A lane with work is never evicted. */
  admitted: number;
  /** When this lane last took a request — the LRU key. */
  lastUsedMs: number;
  writer?: DurableWriter;
  /**
   * The ledger key of the run in flight (9.26.0), so the token and cost events
   * this lane emits are billed to whoever caused them.
   *
   * Per LANE and set for the duration of one run, which is exact rather than
   * approximate: a lane runs one request at a time, and an event names no
   * caller of its own — the agent that produced it is the only thing that says
   * whose it was. `undefined` with no admission policy, and then nothing
   * subscribes at all.
   */
  activeSpendKey?: string;
  /** Undo everything this composer attached to the agent. */
  detach: () => void;
}

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
): Promise<TH> {
  const { sessions, host } = options;
  const policy = options.onConcurrentInvoke ?? 'reject';
  const durability = options.durability ?? 'exit';
  const sharedAgent = options.agent;
  const factory = options.agentFactory;
  /** The badge check (9.26.0), or `undefined` — the zero-delta path. */
  const identityOptions = options.identity;
  /** The admission policy (9.26.0), or `undefined`. */
  const admission = options.admission;
  /**
   * The rolling-window accountant — built ONLY when a policy exists, because
   * with no policy nobody would ever read it and keeping a per-caller map of a
   * server's whole traffic would be a cost nobody asked for.
   */
  const ledger: SpendLedger | undefined = admission !== undefined ? spendLedger() : undefined;
  /**
   * Where ingress decisions go (9.32.0), or `undefined` — the zero-delta path.
   * With no sink nothing is wrapped and the handler uses the host's own reply
   * object, which is what makes this option free for everyone who never asks
   * for it.
   */
  const ingressSink = options.onIngressDecision;

  // ── Refused at construction, before a socket exists ──────────────────
  //
  // Two spellings of one decision, and nothing could make the winner visible
  // afterwards: an operator reading `{ agent, agentFactory }` in a config would
  // have no way to know whether their sessions were isolated or not.
  if (sharedAgent !== undefined && factory !== undefined) {
    throw new Error(
      `[hosting] standingAgent was given both 'agent' and 'agentFactory'. They are two ` +
        `answers to one question — whether sessions SHARE an instance or each get their ` +
        `own — and honouring either would leave the other silently ignored. Pass 'agent' ` +
        `for one shared instance (runs serialized globally, the original shape), or ` +
        `'agentFactory' for one instance per active session (sessions run in parallel).`,
    );
  }
  if (sharedAgent === undefined && factory === undefined) {
    throw new Error(
      `[hosting] standingAgent needs something to answer with: pass 'agent' (one instance ` +
        `shared by every session) or 'agentFactory' (a new instance per active session). ` +
        `Neither was given, so there is nothing to serve.`,
    );
  }
  // Two options whose shape TypeScript enforces and plain JavaScript does not.
  // Both fail CLOSED at runtime if left half-spelled — an `identity` with no
  // `verify` would refuse every caller as unverifiable, an `admission` with no
  // `decide` would throw on the first turn — and a door that refuses everybody
  // for a configuration reason is exactly the outage that takes an hour to
  // diagnose from the outside. Named here instead, before a socket exists.
  if (identityOptions !== undefined && typeof identityOptions.verify !== 'function') {
    throw new Error(
      `[hosting] standingAgent was given 'identity' without a \`verify\` function. It is the ` +
        `strategy that turns a caller's bearer token into a proven user, so there is nothing ` +
        `to verify with — and with it half-spelled every request would be refused as ` +
        `unverifiable. Pass identity: { verify: jwksIdentity({ jwksUrl, issuer, audience }` +
        `).verify } — or any IdentityVerifier's verify — or drop the option and read ` +
        `HostRequest.userId as the transport's own claim, exactly as before.`,
    );
  }
  if (admission !== undefined && typeof admission.decide !== 'function') {
    throw new Error(
      `[hosting] standingAgent was given 'admission' without a \`decide\` function. It is the ` +
        `whole policy — one method answering 'allow' | { queue: true } | { refuse: '<why>' } ` +
        `— so a bag without it decides nothing and would throw on the first turn. Pass ` +
        `admission: turnsPerHour({ limit }), or your own { decide }, or drop the option.`,
    );
  }
  // A pool bound with no pool is a caller who believes something untrue about
  // how their process will behave under load. Named rather than ignored.
  if (factory === undefined && options.maxActiveSessions !== undefined) {
    throw new Error(
      `[hosting] standingAgent was given 'maxActiveSessions' without 'agentFactory'. ` +
        `With a single shared 'agent' there is no pool to bound — every session already ` +
        `uses the one instance you passed. Drop it, or switch to 'agentFactory' to get ` +
        `the per-session pool it describes.`,
    );
  }
  const maxActiveSessions = options.maxActiveSessions ?? DEFAULT_MAX_ACTIVE_SESSIONS;
  if (factory !== undefined && (!Number.isInteger(maxActiveSessions) || maxActiveSessions < 1)) {
    throw new Error(
      `[hosting] standingAgent was given maxActiveSessions: ${String(
        options.maxActiveSessions,
      )}. ` +
        `It is how many sessions may hold an agent at once, so it has to be a positive ` +
        `integer — a pool that can hold no sessions could never serve one.`,
    );
  }

  /** Session id → its lane. Empty and unused in the shared shape. */
  const pool = new Map<string, Lane>();
  /**
   * Every instance the factory has handed over. A WeakSet so a retired agent is
   * collectable — the check is "have I seen this object", and nothing here
   * needs to keep it alive to answer that.
   */
  const handedOver = new WeakSet<Agent>();
  /** The single lane of the shared shape, or `undefined` in the pooled one. */
  const shared = sharedAgent !== undefined ? makeLane(sharedAgent, '#shared') : undefined;
  let anonymous = 0;

  /**
   * Attach this composer's wiring to one agent and hand back its lane.
   *
   * Everything installed here is undone by `lane.detach()` — on `close()`, and
   * on eviction. An agent whose lane was detached has nothing of this
   * composer's left on it.
   */
  function makeLane(agent: Agent, poolKey: string): Lane {
    const lane: Lane = {
      poolKey,
      agent,
      chain: Promise.resolve(),
      queued: [],
      admitted: 0,
      lastUsedMs: Date.now(),
      detach: () => undefined,
    };
    const offTurnStart = agent.on('agentfootprint.agent.turn_start', (event) => {
      lane.activeRunId = (event as { meta?: { runId?: string } }).meta?.runId;
    });
    // Tokens reach the caller only if the host streams; `emit` on a host that
    // does not is a no-op by design, so this needs no capability check. The
    // subscription is per LANE because a token event names no session — the
    // agent that produced it is the only thing that identifies whose it is,
    // and with a pool that is the whole reason two sessions' tokens cannot mix.
    const offToken = agent.on('agentfootprint.stream.token', (event) => {
      const content = (event as { payload?: { content?: string } }).payload?.content;
      if (typeof content === 'string' && content.length > 0) lane.activeReply?.emit?.(content);
    });
    // ── Spend accounting (9.26.0) ────────────────────────────────────
    // Only with an admission policy. Without one these two subscriptions are
    // never made — the agent is untouched and the events cost their usual
    // nothing (the dispatcher's own no-listener fast path).
    //
    // Two sources, because they answer two different questions honestly:
    // `llm_end` always carries TOKENS, and `cost.tick` carries MONEY only
    // where a pricing table turned tokens into it. Summing an invented rate
    // here would be a number that looks like a bill.
    const offUsage =
      ledger === undefined
        ? undefined
        : agent.on('agentfootprint.stream.llm_end', (event) => {
            const key = lane.activeSpendKey;
            if (key === undefined) return;
            const usage = (event as { payload?: { usage?: { input?: number; output?: number } } })
              .payload?.usage;
            ledger.add(key, {
              inputTokens: usage?.input ?? 0,
              outputTokens: usage?.output ?? 0,
            });
          });
    const offCost =
      ledger === undefined
        ? undefined
        : agent.on('agentfootprint.cost.tick', (event) => {
            const key = lane.activeSpendKey;
            if (key === undefined) return;
            const usd = (event as { payload?: { estimatedUsd?: number } }).payload?.estimatedUsd;
            if (typeof usd === 'number' && Number.isFinite(usd)) ledger.add(key, { usd });
          });
    // Under 'exit' NOTHING is built: no observer on the agent, no barrier, no
    // per-commit work. That is what "the default is byte-identical" means here —
    // not a mode that happens to write once, but wiring that is never installed.
    const writer: DurableWriter | undefined =
      durability === 'exit'
        ? undefined
        : durableWriter({
            mode: durability,
            session: () => lane.activeSessionId,
            runId: () => lane.activeRunId,
            write: (sessionId, conversation) =>
              sessions.persist(sessionId, toEnvelope(conversation)),
          });
    const detachWriter = writer ? agent.attach(writer.recorder) : undefined;
    const uninstallBarrier = writer?.install(agent);
    lane.writer = writer;
    lane.detach = (): void => {
      offTurnStart();
      offToken();
      offUsage?.();
      offCost?.();
      uninstallBarrier?.();
      detachWriter?.();
    };
    return lane;
  }

  /**
   * The lane this request runs on.
   *
   * Shared shape: always the one lane, so every request queues behind every
   * other — the global serialization, unchanged. Pooled shape: this session's
   * lane, built on first sight, with anonymous traffic sharing one.
   *
   * SYNCHRONOUS on purpose, and called with no `await` between it and the
   * `serialize` that admits the request. A gap there would let the pool evict
   * the very lane the caller is about to run on.
   */
  function laneFor(sessionId: string | undefined): Lane {
    if (shared !== undefined) return shared;
    const key = sessionId ?? ANONYMOUS_LANE;
    const held = pool.get(key);
    if (held !== undefined) {
      held.lastUsedMs = Date.now();
      return held;
    }
    evictToFit();
    const built = makeLane(fromFactory(), key);
    pool.set(key, built);
    return built;
  }

  /**
   * One new agent out of the factory — or a refusal naming what went wrong.
   *
   * The repeat-instance check is the load-bearing one. A factory that closes
   * over a single agent and returns it every time type-checks perfectly and
   * destroys the only property the pool exists for: two sessions would share
   * per-run state, both runs would finish, and one person's conversation would
   * end up holding another person's turn with nothing in the recording to say
   * so. That is the exact failure the shared shape serializes to avoid, and it
   * is worth a loud refusal at the moment it becomes possible.
   */
  function fromFactory(): Agent {
    const made = factory?.() as Agent | undefined;
    if (made === undefined || made === null) {
      throw new Error(
        `[hosting] standingAgent's agentFactory returned nothing. It is called once per ` +
          `active session and must return a NEW Agent each time — build it inside the ` +
          `factory: agentFactory: () => Agent.create({ provider, model }).build().`,
      );
    }
    if (handedOver.has(made)) {
      throw new Error(
        `[hosting] standingAgent's agentFactory returned an Agent it has already returned. ` +
          `One instance per session is the entire point: an Agent holds per-run state on ` +
          `itself, so two sessions sharing one would each finish while the composer read ` +
          `the other's state — one person's conversation quietly holding another's turn. ` +
          `Build a NEW Agent inside the factory rather than closing over one; if you meant ` +
          `every session to share a single instance, pass it as 'agent' instead and get ` +
          `the global serialization that makes it safe.`,
      );
    }
    handedOver.add(made);
    return made;
  }

  /**
   * Make room for one more session, if room is needed.
   *
   * Least recently used, and never a lane with work: `admitted` counts requests
   * that are queued or running, and retiring one of those would abandon a turn
   * a person is waiting on. When EVERY lane is busy the pool grows past its
   * bound instead — stated on the option, and the honest trade. It comes back
   * under the bound as soon as a run finishes and another session arrives.
   */
  function evictToFit(): void {
    while (pool.size >= maxActiveSessions) {
      let victim: Lane | undefined;
      for (const lane of pool.values()) {
        if (lane.admitted > 0) continue;
        if (victim === undefined || lane.lastUsedMs < victim.lastUsedMs) victim = lane;
      }
      if (victim === undefined) return;
      // Out of the pool FIRST, so a request arriving for that session during
      // the teardown below builds itself a fresh lane rather than racing one
      // that is being dismantled.
      pool.delete(victim.poolKey);
      void retire(victim);
    }
  }

  /**
   * Retire an evicted lane: detach, close what its tools were holding, stop it.
   *
   * The conversation is NOT touched — it is in the session store, which is why
   * eviction is invisible to the person on the other end. What is torn down is
   * the instance: tool sessions first, under the `'evicted'` reason the tool
   * teardown vocabulary already has (9.7.0), so a sandbox or a browser context
   * this session was holding is released and SAYS which firing site released
   * it. Then the agent itself, stopped rather than merely drained — nothing can
   * reach it again, so leaving its timers running would be a leak with no
   * owner.
   *
   * Failures here are swallowed, and this is the only place that happens: the
   * agent's own event channel already reports a teardown that threw
   * (`tools.session_close_failed`, with its error class), and failing the
   * UNRELATED request that happened to trigger the eviction would blame one
   * person's turn for another session's broken cleanup.
   */
  async function retire(lane: Lane): Promise<void> {
    lane.detach();
    const sessionId = lane.poolKey === ANONYMOUS_LANE ? undefined : lane.poolKey;
    try {
      await lane.agent.closeToolSessions({
        ...(sessionId !== undefined && { sessionId }),
        reason: 'evicted',
      });
    } catch {
      // Reported on the agent's own channel; see above.
    }
    try {
      await lane.agent.shutdown({ stop: true });
    } catch {
      // Same.
    }
  }

  /** Queue `work` behind everything already waiting on this lane, FIFO. */
  function serialize(
    lane: Lane,
    sessionKey: string,
    work: () => Promise<void>,
    queueAnyway = false,
  ): Promise<void> {
    if (
      policy === 'reject' &&
      !queueAnyway &&
      (lane.activeSession === sessionKey || lane.queued.includes(sessionKey))
    ) {
      return Promise.reject(new ConcurrentRunError(sessionKey, lane.activeRunId));
    }
    lane.queued.push(sessionKey);
    // Admitted from here, so the pool cannot retire this lane out from under a
    // request that is merely waiting its turn.
    lane.admitted += 1;
    lane.lastUsedMs = Date.now();
    const mine = lane.chain.then(async () => {
      lane.queued.splice(lane.queued.indexOf(sessionKey), 1);
      lane.activeSession = sessionKey;
      try {
        await work();
      } finally {
        lane.activeSession = undefined;
        lane.activeRunId = undefined;
        lane.admitted -= 1;
        lane.lastUsedMs = Date.now();
      }
    });
    // The chain must never reject, or one failed request would wedge every
    // request behind it.
    lane.chain = mine.then(
      () => undefined,
      () => undefined,
    );
    return mine;
  }

  /**
   * The composer's whole request path — with the reply it is handed already
   * wrapped, when an ingress record is being kept.
   *
   * Split out from {@link handler} for exactly one reason: the record's funnel
   * has to be ONE place. Every exit below ends at a reply terminal, so wrapping
   * the reply once above this function covers all of them — a refusal added
   * later cannot forget to report, because reporting is not something any exit
   * does.
   */
  const answerRequest = async (
    request: HostRequest,
    reply: HostReply,
    note: IngressNote | undefined,
  ): Promise<void> => {
    // ── The badge, before anything else ───────────────────────────────
    // FIRST, and once — so a turn, a claim-ticket redemption and a session
    // read all inherit one answer to "who is this", and a door added later
    // cannot accidentally be the lenient one. With no verifier configured this
    // returns `undefined` without touching the request: every earlier
    // release's behaviour, to the byte.
    let verified: VerifiedIdentity | undefined;
    try {
      verified = await verifyRequestIdentity(identityOptions, request.headers, request.userId);
    } catch (err) {
      reply.fail(err instanceof Error ? err : new Error(String(err)));
      return;
    }
    // The PROVEN id, on the record — never the claimed one, which is the whole
    // distinction the verifier exists to draw. Nothing is recorded when nobody
    // was proven; absent and "anonymous" are the same fact here.
    note?.identified(verified);
    // The user id that reaches every downstream composition. With a verifier
    // it is the one the TOKEN proved (the request's own claim was already
    // reconciled or refused); without one it is exactly what the transport
    // said, unchanged since 9.12.0.
    const userId = verified?.userId ?? request.userId;
    const identified: HostRequest = userId === request.userId ? request : { ...request, userId };

    // ── Reading history is not a turn either ──────────────────────────
    if (identified.session !== undefined) {
      try {
        await answerSessionOp(identified.session, verified, reply);
      } catch (err) {
        reply.fail(err instanceof Error ? err : new Error(String(err)));
      }
      return;
    }
    // ── A claim-ticket redemption is not a turn ────────────────────────
    // Its presence is the discriminant, exactly as `decision`'s is one line
    // down: a request carrying `artifact` redeems a ref and never starts,
    // queues behind, or is refused as, a run. Read-only against the store, so
    // it deliberately bypasses the lane's serialization — a screen describing
    // a chart while the model is mid-turn must not be refused as a
    // "concurrent run", and must not make the turn wait either.
    if (identified.artifact !== undefined) {
      try {
        await answerArtifact(identified.artifact, identified, reply);
      } catch (err) {
        reply.fail(err instanceof Error ? err : new Error(String(err)));
      }
      return;
    }
    const sessionId = identified.sessionId;
    // A request with no session has nothing to hydrate and nowhere to persist
    // that the caller could ask for again, so it gets its own key and can never
    // collide with anyone. In the pooled shape those requests still SHARE one
    // fallback instance — there is no conversation to isolate — and this unique
    // key is what keeps them from ever refusing each other as a "same session"
    // collision, which they are not.
    const sessionKey = sessionId ?? `#anonymous-${++anonymous}`;
    try {
      // ── Admission, before a lane is even chosen ────────────────────
      // The cheapest refusal is the one made before any work: no hydrate, no
      // model call, no store write. With no policy this is a single
      // `undefined` check and nothing else runs.
      const spendKey = spendKeyFor(verified);
      let queueAnyway = false;
      if (admission !== undefined && ledger !== undefined) {
        const verdict = await admission.decide({
          ...(verified !== undefined && { identity: verified }),
          ...(sessionId !== undefined && { sessionId }),
          recentSpend: ledger.read(spendKey),
        });
        if (typeof verdict === 'object' && verdict !== null && 'refuse' in verdict) {
          note?.admitted('refuse');
          reply.fail(new AdmissionRefusedError(verdict.refuse, userId));
          return;
        }
        queueAnyway = typeof verdict === 'object' && verdict !== null && 'queue' in verdict;
        // An ALLOW is recorded too. A stream of refusals alone cannot answer
        // "was anybody turned away?" — only a census can, which is the same
        // reason an empty audit bundle is not evidence of an empty door.
        note?.admitted(queueAnyway ? 'queue' : 'allow');
        // Counted at ADMISSION, not at completion: a turn that is running has
        // been spent whether or not it ever answers, and counting on the way
        // out would let a caller hold N runs open under a limit of one.
        //
        // The stated consequence: a request the LANE then refuses as a
        // concurrent run still counts against the window. Deferring the count
        // to the moment a run actually starts would fix that and open a
        // bigger hole — a burst of simultaneous requests would each be decided
        // against a window none of them had joined, and walk straight through
        // the ceiling. A bound that a burst defeats is not a bound.
        ledger.admit(spendKey);
      }
      const lane = laneFor(sessionId);
      await serialize(
        lane,
        sessionKey,
        () => answerOne(lane, sessions, identified, reply, sessionId, verified, spendKey),
        queueAnyway,
      );
    } catch (err) {
      reply.fail(err instanceof Error ? err : new Error(String(err)));
    }
  };

  /**
   * What the host calls — {@link answerRequest} with the ingress record's one
   * funnel around it (9.32.0).
   *
   * With no sink configured this is the identity function over the host's own
   * reply: no wrapper object, no bookkeeping, no branch inside any exit path.
   *
   * `settle()` covers the one case a terminal cannot: a request that leaves
   * without ending its reply at all. The composer never does that, and the
   * `finally` is there because "never" is a claim about today's code rather
   * than a guarantee — a census with a hole in it is what this replaces.
   */
  const handler = async (request: HostRequest, hostReply: HostReply): Promise<void> => {
    const note: IngressNote | undefined =
      ingressSink === undefined ? undefined : beginIngress(request, ingressSink);
    const reply = note === undefined ? hostReply : note.watch(hostReply);
    try {
      await answerRequest(request, reply, note);
    } finally {
      note?.settle();
    }
  };

  /**
   * Answer "which conversations are mine?" and "what did we say?" — the two
   * session-history ops (9.26.0).
   *
   * ── Three refusals before an answer is even attempted ────────────────────
   *  1. no verifier on this door → {@link SessionOpNeedsIdentityError}. Reading
   *     "your" sessions off an unverified header is enumeration.
   *  2. a verifier, and this caller proved nothing (an anonymous request at a
   *     door built with `allowAnonymous`) → the same refusal shape: anonymous
   *     owns nothing, and answering an empty list would imply the question was
   *     honoured.
   *  3. the session store keeps no owner index →
   *     {@link SessionIndexUnavailableError}, naming the missing member. An
   *     unanswerable question is not an empty result.
   *
   * ── And ONE indistinguishable not-found ──────────────────────────────────
   * A transcript for a session that does not exist, one owned by somebody
   * else, and one whose stored conversation names no owner all end the same
   * way. Told apart, they would be an oracle for which session ids are real.
   *
   * Read-only and lane-free: history is answered out of the session store,
   * which no run holds, so nothing here queues behind a turn or is refused as
   * a concurrent one.
   */
  async function answerSessionOp(
    op: SessionWireRequest,
    verified: VerifiedIdentity | undefined,
    reply: HostReply,
  ): Promise<void> {
    const opName = op.op === 'list' ? SESSION_LIST_OP : SESSION_TRANSCRIPT_OP;
    if (identityOptions === undefined || verified === undefined) {
      reply.fail(new SessionOpNeedsIdentityError(opName));
      return;
    }
    if (op.op === 'list') {
      if (sessions.listByUser === undefined) {
        reply.fail(new SessionIndexUnavailableError(opName, 'listByUser'));
        return;
      }
      const page = await sessions.listByUser(verified.userId);
      deliverSessions(reply, opName, { op: 'list', sessions: page.sessions });
      return;
    }
    if (sessions.ownerOf === undefined) {
      reply.fail(new SessionIndexUnavailableError(opName, 'ownerOf'));
      return;
    }
    const owner = await sessions.ownerOf(op.sessionId);
    if (owner === undefined || owner !== verified.userId) {
      // The ONE not-found. Missing, foreign and owner-less are one answer.
      reply.fail(new SessionNotFoundError(op.sessionId));
      return;
    }
    await sessions.onWake?.(op.sessionId, 'transcript');
    let stored;
    try {
      stored = await sessions.hydrate(op.sessionId);
    } catch (err) {
      throw err instanceof UnreadableEnvelopeError ? err.withSession(op.sessionId) : err;
    }
    if (stored === undefined) {
      // The index said one thing and the store another — a session forgotten
      // between the two calls. Same not-found: the caller learns nothing it
      // did not already know.
      reply.fail(new SessionNotFoundError(op.sessionId));
      return;
    }
    deliverSessions(reply, opName, {
      op: 'transcript',
      sessionId: op.sessionId,
      messages: envelopeTranscript(stored),
    });
  }

  /**
   * Redeem one claim ticket for the screen: `artifact-head` (metadata — the
   * render-by-ref decision) or `artifact-get` (metadata + payload), against
   * the store of the agent that serves this session.
   *
   * ── The scope is the run's own, re-composed — one isolation rule ────────
   * A ref is redeemed under EXACTLY the scope the run's tools minted it in:
   * `identityForRequest(userId, sessionId, storedIdentity)` when the request
   * names a user — the same call, on the same inputs, that composed the run's
   * identity — else the session rung `{ conversationId: sessionId }` (what
   * seed derives for an identity-less served run). No new spelling exists to
   * drift. The stored identity is read only when a `userId` arrived (it is
   * the only rung that needs the stored tenant/conversation tuple), through
   * the same wake → hydrate → refuse-unreadable steps a turn takes.
   *
   * A ref from another session — or a right session presented with the wrong
   * identity — composes a different tuple, and the store answers a wrong
   * tuple with "no data", never with a distinguishable error. So the wire's
   * not-found is ONE shape for missing, expired and foreign alike:
   * {@link ArtifactNotFoundError}, byte-identical but for the ref itself.
   *
   * ── On the record, once ─────────────────────────────────────────────────
   * Resolution rides the existing `artifacts.resolved` / `artifacts.refused`
   * events through the capability's own fact sink (the raw store emits
   * nothing, so binding is the ONE emitter — no double-emit), delivered on
   * the serving agent's dispatcher with no `tool` field: the redeemer was the
   * hosting door, and a phantom tool name would be an actor that does not
   * exist.
   *
   * Zero-cost when unused: an agent without a store answers with the teaching
   * refusal naming the attach, and nothing else in the composer changes.
   */
  async function answerArtifact(
    op: ArtifactWireRequest,
    request: HostRequest,
    reply: HostReply,
  ): Promise<void> {
    const sessionId = request.sessionId;
    if (sessionId === undefined) {
      // An anonymous run scopes its artifacts to its own runId — a name no
      // later request can present — so there is genuinely nothing a
      // session-less redemption could ever resolve. Taught, not 404'd: this
      // is a caller gap, not a missing ref.
      reply.fail(new ArtifactSessionRequiredError(op.op));
      return;
    }
    const lane = laneFor(sessionId);
    // Admitted for the duration: a lane with work is never evicted, and a
    // resolution mid-flight is work — retiring the instance under it would
    // tear down the very store being read.
    lane.admitted += 1;
    try {
      const store = lane.agent.getArtifactStore();
      if (store === undefined) {
        // The fail-closed law at the wire: the refusal lands on the record
        // (`no-store`, the same reason `ctx.artifacts` teaches with) and the
        // reply names the attach.
        emitArtifactFact(lane.agent, {
          type: 'refused',
          op: op.op,
          reason: 'no-store',
          ref: op.ref,
        });
        reply.fail(new NoArtifactStoreError(op.op));
        return;
      }
      let stored: MemoryIdentity | undefined;
      if (request.userId !== undefined) {
        await sessions.onWake?.(sessionId, 'artifact');
        try {
          const envelope = await sessions.hydrate(sessionId);
          if (envelope !== undefined) {
            stored =
              envelope.format === 'flowchart-v1'
                ? readPausedRun(envelope).conversation.identity
                : readEnvelope(envelope).identity;
          }
        } catch (err) {
          // The same law as a turn: an unreadable stored conversation is a
          // different fact from an absent one, and only one of them is safe
          // to compose a scope from.
          throw err instanceof UnreadableEnvelopeError ? err.withSession(sessionId) : err;
        }
      }
      const scope: MemoryIdentity = identityForRequest(request.userId, sessionId, stored) ?? {
        conversationId: sessionId,
      };
      const bound = bindArtifacts(store, scope, {
        onEvent: (fact) => emitArtifactFact(lane.agent, fact),
      });
      if (op.op === 'head') {
        const meta = await bound.head(op.ref);
        if (meta === null) {
          reply.fail(new ArtifactNotFoundError(op.ref));
          return;
        }
        deliverArtifact(reply, { op: 'head', ref: op.ref, meta });
      } else {
        // A digest mismatch throws here (ArtifactIntegrityError) rather than
        // returning corrupt bytes as whole — it propagates to the handler's
        // catch as this request's failure, already on the record via the sink.
        const record = await bound.get(op.ref);
        if (record === null) {
          reply.fail(new ArtifactNotFoundError(op.ref));
          return;
        }
        deliverArtifact(reply, { op: 'get', ref: op.ref, meta: record.meta, data: record.data });
      }
    } finally {
      lane.admitted -= 1;
      lane.lastUsedMs = Date.now();
    }
  }

  /**
   * Whose conversation is this — and may THIS caller open it? (9.26.0)
   *
   * The ownership question, asked ONCE and answered the same way at every door
   * that opens a session. `session-transcript` asks it of the store's index;
   * a TURN asks it of the conversation it just hydrated — the same derivation
   * (`envelopeOwner`, the `principal` the composer itself wrote), so a store
   * with no index is protected exactly as well as one with a fast one, and no
   * second round-trip is spent to learn something already in hand.
   *
   * That a turn had to ask at all is the lesson: the ops that READ history were
   * gated from the day they were written, while the ordinary door beside them
   * hydrated any named session, answered from it, and re-stamped its owner —
   * one handler, two answers, and the strict one was the decoration. A gate
   * that only some doors honour is not a gate.
   *
   * The rule, whole:
   *
   *  - **No verifier configured → no question asked.** A door that reads
   *    `userId` off a header has no proof to compare against, and inventing
   *    one would refuse turns that worked in every earlier release. Byte-
   *    identical, deliberately: how much a header is worth is the deployment's
   *    answer, and this is the option that says so.
   *  - **Verified caller, owned session → the owner, and only the owner.**
   *  - **Verified caller, session that names no owner → refused.** The same
   *    answer `session-transcript` gives, for the same reason: a conversation
   *    nobody signed for is not evidence that it is yours. A store written
   *    before this door verified anything therefore holds sessions that cannot
   *    be continued — a stated migration boundary, and a loud one, rather than
   *    a door that hands over conversations to whoever names them first.
   *  - **Anonymous caller (`allowAnonymous`) → only a session nobody owns.**
   *    Which is the same rule spelled with `undefined` on both sides.
   *
   * A session that does not exist YET is not this function's business: the
   * caller's own first turn creates it, and the ownership fact is written when
   * it persists.
   *
   * ── A conversation this runtime cannot read has no owner it can name ───────
   * The question is asked BEFORE the strict readers, so a stored session in a
   * format this build does not know refuses as "not one you can open" rather
   * than describing the state of somebody's storage to a stranger. The
   * consequence, stated: at a verifying door that is also the answer its real
   * owner gets, because a runtime that cannot read a conversation genuinely
   * cannot tell whose it is, and "this is yours, but broken" is a claim it
   * would be making up. A door with no verifier is untouched — it still fails
   * loudly by name (`UnreadableEnvelopeError`), which is where an operator
   * mid-migration meets that fact.
   *
   * ── The one thing this cannot hide ─────────────────────────────────────────
   * A refused turn tells the caller the id is taken, because the alternative
   * (starting a fresh conversation over somebody else's) destroys it. That is
   * the only fact a door which lets callers choose their own session ids can
   * never conceal — and it is a long way from the conversation itself, which is
   * what the refusal keeps.
   */
  function mayOpenSession(
    stored: CheckpointEnvelope,
    verified: VerifiedIdentity | undefined,
  ): boolean {
    if (identityOptions === undefined) return true;
    return envelopeOwner(stored) === verified?.userId;
  }

  async function answerOne(
    lane: Lane,
    store: SessionLifecycle,
    request: HostRequest,
    reply: HostReply,
    sessionId: string | undefined,
    verified: VerifiedIdentity | undefined,
    spendKey?: string,
  ): Promise<void> {
    const runner = lane.agent;
    lane.activeReply = reply;
    // The writer only ever writes for the run it is inside; an anonymous
    // request has nowhere to write to and gets nothing.
    lane.activeSessionId = sessionId;
    // Whose usage this lane's next token and cost events belong to. Set only
    // with an admission policy; the subscriptions that read it do not exist
    // otherwise.
    if (ledger !== undefined) lane.activeSpendKey = spendKey;
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
            // WHOSE conversation this is, before a single line of it is read
            // into this run. A turn is the door that hydrates history into a
            // model's context AND the door that re-persists who owns it, so it
            // is the door where getting this wrong costs the most: see
            // `mayOpenSession` for the rule and its one honest leak.
            //
            // Placed before the readers on purpose — an unreadable envelope
            // belonging to somebody else must answer "not yours", not describe
            // the state of a stranger's storage.
            if (!mayOpenSession(stored, verified)) {
              reply.fail(new SessionNotFoundError(sessionId));
              return;
            }
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
      //
      // `sessionId` (9.4.0) rides the same bag onto every event this run
      // emits, so a shipped telemetry stream can be asked "what happened in
      // this conversation?" and not only "what happened in this run?". Since
      // 9.10.0 it also decides the memory namespace when the caller named no
      // identity — a session IS a conversation, so a served session recalls its
      // own earlier turns with no configuration. This is the only place that
      // knows the answer — the agent is handed a message, not a session. An
      // ANONYMOUS request has no session and gets no key: `sessionKey` above is
      // a concurrency latch this host invented, and stamping it on telemetry
      // would be publishing a fact nobody can join to.
      //
      // `identity` (9.12.0) is the WHO beside that WHICH-conversation: a
      // transport that named the end user gets a principal on the run, which is
      // what puts a real person in `EventMeta.principal`, in `ctx.identity`
      // inside a tool, and in the identity a credential provider scopes its
      // token vault on — the whole chain, from the front door to the downstream
      // API, without anybody configuring it. See `identityForRequest` for what
      // each field is composed from and why. A transport that named nobody
      // produces `undefined` here and every earlier release's behaviour is
      // unchanged.
      const identity = identityForRequest(
        request.userId,
        sessionId,
        prior?.identity ?? paused?.conversation.identity,
      );
      const runOptions: AgentRunOptions | undefined =
        request.signal !== undefined || sessionId !== undefined || identity !== undefined
          ? {
              ...(request.signal !== undefined && { env: { signal: request.signal } }),
              ...(sessionId !== undefined && { sessionId }),
              ...(identity !== undefined && { identity }),
            }
          : undefined;

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
          lane,
          await runner.resume(paused.checkpoint, request.decision, runOptions),
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
        ? await runner.run({ message: request.input, continueFrom: prior }, runOptions)
        : await runner.run({ message: request.input }, runOptions);
      await deliver(lane, output, store, reply, sessionId);
    } catch (err) {
      // A run that threw still has to drain. A write left in flight would race
      // the NEXT turn's terminal write and could land after it. The drain's own
      // failure is swallowed here and only here: the caller is already being
      // told about the run's error, and replacing it with a storage error would
      // hide the thing that actually went wrong.
      await lane.writer?.settle().catch(() => undefined);
      throw err;
    } finally {
      lane.activeReply = undefined;
      lane.activeSessionId = undefined;
      lane.activeSpendKey = undefined;
    }
  }

  /** Store what the run left behind, then end the reply with the right terminal. */
  async function deliver(
    lane: Lane,
    output: unknown,
    store: SessionLifecycle,
    reply: HostReply,
    sessionId: string | undefined,
  ): Promise<void> {
    const runner = lane.agent;
    // Mid-run writes settle FIRST. Ordering, not tidiness: an 'async' write
    // still in flight would otherwise land after the terminal envelope and
    // overwrite it — a stored pause quietly demoted back to a conversation,
    // and the question a person was asked gone with it. It also rethrows a
    // store that refused this run's progress, so a broken store fails the
    // request rather than being reported as a clean answer.
    await lane.writer?.settle();

    if (isPaused(output)) {
      const pending = describePause(output, sessionId);
      const conversation = sessionId === undefined ? undefined : runner.checkpoint();
      try {
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
      } finally {
        // ── OWNERSHIP MOVES HERE ────────────────────────────────────────
        // A pause belongs to a SESSION. In the shared shape one Agent carries
        // every session, and the Agent's own pending-question guard (9.2.0) is
        // right for a script driving one instance and wrong here: the instance
        // would go on holding session A's question, and session B's next
        // message — a different conversation, a different person — would be
        // refused on behalf of an answer B was never asked for.
        //
        // Once the pause is in the STORE, the store owns it: a later request
        // for that session carrying `decision` continues it from exactly
        // where it stopped, and nothing about that consults the instance. So
        // the instance is released, here, at the moment ownership transfers.
        // On the failure path above it is released for the opposite reason —
        // the question could not be carried at all, and blocking every other
        // session on one nobody can ever answer is strictly worse.
        //
        // The pooled shape releases it too, and for a reason of its own: this
        // session's instance can be EVICTED while the question is outstanding,
        // and a pause held only in an instance nobody can reach again is a
        // question nobody could ever answer. The store is the one place it can
        // survive that, so the store is the only place it is kept.
        runner.abandonPause();
      }
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
          // must not strand the drain of every other session's.
          await Promise.allSettled(lanes.map((lane) => lane.agent.shutdown({ stop: true })));
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
  } as TH;
}

/**
 * WHO this request is for, when the transport said (9.12.0) — and `undefined`
 * when it did not, which leaves every earlier release's behaviour untouched to
 * the byte.
 *
 * The composition, field by field, because each one has a different rightful
 * source:
 *
 *  - `principal` — {@link HostRequest.userId}, the fact THIS request carried.
 *    It is the only field the transport supplies and the only one this function
 *    ever introduces.
 *  - `conversationId` — the namespace the conversation already runs in, else
 *    the session id. Composed with the 9.10.0 derivation rather than replacing
 *    it: a session IS a conversation, and moving a live conversation's
 *    namespace because a header appeared would lose its memory mid-thread.
 *  - `tenant` — whatever the stored identity carried. No transport field
 *    supplies one, so there is nothing here to override it with.
 *
 * **Why the header wins on `principal` specifically.** Every other field
 * belongs to the conversation and survives untouched; the actor belongs to the
 * request. Before this release `standingAgent` named no identity at all, so the
 * only principal a stored conversation can realistically carry is one an
 * EARLIER turn of this same mechanism put there — and preferring it would pin a
 * whole session to whoever spoke first, which is precisely the audit trail that
 * "looks complete and names the wrong party".
 *
 * **Nothing is invented.** With no session and no stored conversation there is
 * no conversation to name, and this returns `undefined` rather than fabricating
 * one; the id still reaches a custom handler on `HostRequest`. The managed
 * runtimes that forward a user require a session id on the same call, so that
 * gap is a guard rather than the shape this exists for.
 *
 * One consequence worth stating: naming an identity here takes the run off the
 * 9.10.0 derived rung, so `runIdentitySource: 'session'` is not written on this
 * path. The namespace is identical either way — the marker distinguishes a
 * namespace the caller chose from one the library derived, and on this path the
 * caller did choose.
 */
function identityForRequest(
  userId: string | undefined,
  sessionId: string | undefined,
  stored: MemoryIdentity | undefined,
): MemoryIdentity | undefined {
  if (userId === undefined) return undefined;
  const conversationId = stored?.conversationId ?? sessionId;
  if (conversationId === undefined) return undefined;
  return {
    conversationId,
    ...(stored?.tenant !== undefined && { tenant: stored.tenant }),
    principal: userId,
  };
}

/**
 * End the reply with a resolved artifact — through the terminal built for it
 * when the host has one, and through the named refusal when it does not.
 *
 * The `awaiting` fallback law, applied to the other optional terminal: a host
 * that cannot describe the result must say so by name rather than deliver an
 * improvised shape or nothing. The resolution itself already happened and is
 * already on the record either way.
 */
function deliverArtifact(reply: HostReply, result: ArtifactWireResult): void {
  if (reply.artifact) {
    reply.artifact(result);
    return;
  }
  reply.fail(new ArtifactNotCarriedError(result.ref));
}

/**
 * End the reply with resolved session history — through the terminal built for
 * it when the host has one, and through the named refusal when it does not.
 *
 * The {@link deliverArtifact} law, applied to the third optional terminal: a
 * host that cannot describe the result says so by name rather than delivering
 * an improvised shape or nothing.
 */
function deliverSessions(reply: HostReply, op: string, result: SessionWireResult): void {
  if (reply.sessions) {
    reply.sessions(result);
    return;
  }
  reply.fail(new SessionsNotCarriedError(op));
}

/**
 * Put one capability fact on the serving agent's typed record — the wire
 * door's adapter onto the SAME `artifacts.resolved` / `artifacts.refused`
 * events every tool redemption rides, minus the `tool` field (the redeemer
 * was the hosting door, and payloads never carry an actor that does not
 * exist).
 *
 * `minted` and `expired` have no arm because a read-only door cannot produce
 * them — only `put` does, and the wire deliberately has no put. Dropped when
 * nobody listens (the dispatcher's own fast path), so an unobserved agent
 * pays one listener check per fact and nothing more.
 */
function emitArtifactFact(agent: Agent, fact: ArtifactEventFact): void {
  switch (fact.type) {
    case 'resolved':
      agent.emit('agentfootprint.artifacts.resolved', {
        ref: fact.ref,
        via: fact.via,
        kind: fact.kind,
        bytes: fact.bytes,
      });
      return;
    case 'refused':
      agent.emit('agentfootprint.artifacts.refused', {
        op: fact.op,
        reason: fact.reason,
        ...(fact.ref !== undefined && { ref: fact.ref }),
        ...(fact.detail !== undefined && { detail: fact.detail }),
      });
      return;
    default:
      return;
  }
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
  // The typed half of the question (9.24.0), lifted from whichever pause kind
  // carried it — a plain ask keeps it at the top of `pauseData`, a check-in on
  // the typed request, a middleware ask on the question. `readAskComponent` is
  // the one reader of those homes; this projection is where a screen looks.
  const component = readAskComponent(outcome.pauseData);
  return {
    ...(sessionId !== undefined && { sessionId }),
    ...(tool !== undefined && { tool }),
    ...(question !== undefined && { question }),
    ...(outcome.checkIn !== undefined && { checkIn: outcome.checkIn }),
    ...(outcome.ask !== undefined && { ask: outcome.ask }),
    ...(component !== undefined && { component }),
    pauseData: outcome.pauseData,
  };
}
