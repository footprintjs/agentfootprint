import { type Agent } from '../../../core/Agent.js';
import { type AgentfootprintEvent } from '../../../events/registry.js';
import { ConcurrentRunError } from '../../errors.js';
import { type Configuration } from '../configuration/read.js';
import { type DurableWriter, durableWriter } from '../../durability.js';
import { type Lane } from '../lane.js';
import { hostedTurnOf } from '../turn/port.js';
import { laneKeyOf } from './keys.js';
import { runnerLive } from '../../../core/runnerLive.js';
import { toEnvelope } from '../../envelope.js';

type PoolOptions = Pick<
  Configuration,
  'sharedAgent' | 'factory' | 'maxActiveSessions' | 'sessions' | 'durability' | 'ledger' | 'policy'
> & { readonly isClosing: () => boolean };

export function createLanePool({
  sharedAgent,
  factory,
  maxActiveSessions,
  sessions,
  durability,
  ledger,
  policy,
  isClosing,
}: PoolOptions) {
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

  /** The pooled shape's reader — see `redeemerFor`. Built on first need only. */
  let reader: Agent | undefined;

  /** Instances retired from the pool — a seam binding to one is revoked. */
  const retired = new WeakSet<Agent>();

  /**
   * Attach this composer's wiring to one agent and hand back its lane.
   *
   * Everything installed here is undone by `lane.detach()` — on `close()`, and
   * on eviction. An agent whose lane was detached has nothing of this
   * composer's left on it.
   */
  function makeLane(agent: Agent, poolKey: string, sessionId?: string): Lane {
    const lane: Lane = {
      poolKey,
      ...(sessionId !== undefined && { sessionId }),
      agent,
      chain: Promise.resolve(),
      queued: [],
      admitted: 0,
      lastUsedMs: Date.now(),
      detach: () => undefined,
    };
    // Real values serve the caller and the admission ledger, never the record.
    // Each event must match the invocation this host admitted, even when this
    // runner is used directly or mounted while persistence/delivery still waits.
    // Tokens and measured money are distinct facts, both bound to that turn.
    const live = runnerLive(agent);
    if (live === undefined) {
      throw new TypeError(
        'standingAgent: the agent was not built by agentfootprint (Agent.create(...).build()), ' +
          'so its run cannot be read live — the reply, the spend ledger and the session store ' +
          'need it.',
      );
    }
    if (live.turn !== undefined) hostedTurnOf(agent);
    const offLane = live.onRealEvent((event: AgentfootprintEvent) => {
      const turn = lane.turn;
      const runId = turn?.invocation.runId();
      if (turn === undefined || runId === undefined || event.meta?.runId !== runId) return;
      switch (event.type) {
        case 'agentfootprint.agent.turn_start':
          lane.activeRunId = (event as { meta?: { runId?: string } }).meta?.runId;
          return;
        case 'agentfootprint.stream.token': {
          const content = (event as { payload?: { content?: string } }).payload?.content;
          if (typeof content === 'string' && content.length > 0) turn.reply.emit?.(content);
          return;
        }
        case 'agentfootprint.stream.llm_end': {
          if (ledger === undefined) return;
          const key = turn.spendKey;
          if (key === undefined) return;
          const usage = (event as { payload?: { usage?: { input?: number; output?: number } } })
            .payload?.usage;
          ledger.add(key, {
            inputTokens: usage?.input ?? 0,
            outputTokens: usage?.output ?? 0,
          });
          return;
        }
        case 'agentfootprint.cost.tick': {
          if (ledger === undefined) return;
          const key = turn.spendKey;
          if (key === undefined) return;
          const usd = (event as { payload?: { estimatedUsd?: number } }).payload?.estimatedUsd;
          if (typeof usd === 'number' && Number.isFinite(usd)) ledger.add(key, { usd });
          return;
        }
        default:
          return;
      }
    });
    // Under 'exit' NOTHING is built: no observer on the agent, no barrier, no
    // per-commit work. That is what "the default is byte-identical" means here —
    // not a mode that happens to write once, but wiring that is never installed.
    const writer: DurableWriter | undefined =
      durability === 'exit'
        ? undefined
        : durableWriter({
            mode: durability,
            write: (sessionId, conversation) =>
              sessions.persist(sessionId, toEnvelope(conversation)),
          });
    const uninstallBarrier = writer?.install(agent);
    lane.writer = writer;
    lane.detach = (): void => {
      offLane();
      uninstallBarrier?.();
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
    const key = laneKeyOf(sessionId);
    const held = pool.get(key);
    if (held !== undefined) {
      held.lastUsedMs = Date.now();
      return held;
    }
    evictToFit();
    const built = makeLane(fromFactory(), key, sessionId);
    pool.set(key, built);
    return built;
  }

  /**
   * One new agent out of the factory — or a refusal naming what went wrong.
   *
   * The repeat-instance check is the load-bearing one. A factory that closes
   * over a single agent type-checks perfectly and destroys what the pool exists
   * for: one person's conversation would end up holding another person's turn
   * with nothing in the recording to say so — the failure the shared shape
   * serializes to avoid.
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
    retired.add(lane.agent);
    lane.detach();
    const sessionId = lane.sessionId;
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
      return Promise.reject(
        new ConcurrentRunError(
          sessionKey.startsWith('session:') ? sessionKey.slice('session:'.length) : '(anonymous)',
          lane.activeRunId,
        ),
      );
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

  /** The lane serving `sessionId` right now — never built, never refreshed. */
  function liveLane(sessionId: string): Lane | undefined {
    return shared ?? pool.get(laneKeyOf(sessionId));
  }

  /**
   * Whose store answers a redemption (or `artifactsForRequest`) for
   * `sessionId` — WITHOUT building a lane or evicting one (R2-12).
   *
   * Before, both doors called `laneFor`, so a caller naming session ids —
   * anybody, at a door with no verifier, where the id is the key by law —
   * built a pooled instance per id and evicted the least recently used idle
   * session to make room, closing its tool sessions as `'evicted'`. A read is
   * not a reason to take a person's instance away.
   *
   *  - **A live lane** (the shared agent, or this session's pooled instance) →
   *    its agent. The lane is refreshed and admitted by the caller.
   *  - **No live lane** (no turn yet, its instance was evicted, or the process
   *    restarted) → the READER: one instance from the factory, held OUTSIDE
   *    the pool, built on first need and shared by every lane-less session. It
   *    never counts toward `maxActiveSessions` and never evicts, so the pool is
   *    exactly what the turns made it. It answers from the factory's store,
   *    which is the only store a lane-less session's artifacts can be in — the
   *    one-shared-store shape. (With a store built per instance, an evicted
   *    instance's artifacts left with it, and the reader's not-found is the
   *    true answer.) The wire asks the store silently before it emits anything
   *    for a lane-less session (`holds`), so a flood of made-up ids costs one
   *    artifact-store read each, one reader per process, and nothing else.
   *  - **Closing** → `undefined`: the one not-found.
   *
   * Whether a ticket EXISTS is the artifact store's answer, asked under the
   * session's own scope — never the pool's, never the session store's.
   * Rejected (shipped from 9.117.0, then found false): the one not-found for
   * a lane-less session with no STORED conversation, on the premise that such
   * a session has no turn that could have minted anything. The library itself
   * falsifies it — an app-owned route files beside a conversation before its
   * first turn (`artifactsForRequest`, built for exactly that), and a tool
   * mints during a first turn that then throws, which persists nothing — and
   * the shared shape redeemed the same filing, so the answer depended on the
   * deployment's shape.
   */
  function redeemerFor(
    sessionId: string,
  ): { readonly agent: Agent; readonly lane?: Lane } | undefined {
    const live = liveLane(sessionId);
    if (live !== undefined) {
      live.lastUsedMs = Date.now();
      return { agent: live.agent, lane: live };
    }
    // Never built once the composer is closing: `close()` stops the reader it
    // can see, and one built after that would run with no owner (RS5).
    if (isClosing()) return undefined;
    reader ??= fromFactory();
    return { agent: reader };
  }
  return {
    shared,
    pool,
    retired,
    laneFor,
    serialize,
    redeemerFor,
    get reader() {
      return reader;
    },
  };
}

export type LanePool = ReturnType<typeof createLanePool>;
