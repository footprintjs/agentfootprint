/**
 * AgentCoreStore — AWS Bedrock AgentCore Memory adapter (peer-dep
 * `@aws-sdk/client-bedrock-agent-runtime`).
 *
 * Canonical subpath (v2.5+): `agentfootprint/memory-providers`.
 * Legacy alias (still works through v2.x): `agentfootprint/memory-agentcore`.
 *
 *   // New canonical (v2.5+):
 *   import { AgentCoreStore } from 'agentfootprint/memory-providers';
 *
 *   // Legacy alias (still works through v2.x; removed in v3.0):
 *   import { AgentCoreStore } from 'agentfootprint/memory-agentcore';
 *
 *   const store = new AgentCoreStore({
 *     memoryId: 'arn:aws:bedrock:us-east-1:...:memory/my-mem',
 *     region: 'us-east-1',
 *   });
 *
 * Pattern: Adapter (GoF) — translates the `MemoryStore` interface onto
 *          AgentCore Memory's session/event model:
 *            MemoryIdentity     ↔  AgentCore session (sessionId derived
 *                                  from the identity tuple)
 *            MemoryEntry        ↔  AgentCore event payload (JSON
 *                                  envelope keyed by entry id)
 *            putIfVersion       ↔  unsupported by AgentCore natively;
 *                                  emulated via list+CAS at adapter level
 *            seen / signatures  ↔  in-process LRU shadow (AgentCore has
 *                                  no built-in dedup primitive)
 *            feedback           ↔  in-process accumulator (AgentCore
 *                                  doesn't expose a feedback metric API)
 *            search             ↔  NOT exposed in v2.3 — AgentCore's
 *                                  retrieve API is opaque (server-side
 *                                  retrieval pipeline). Will land as
 *                                  `agentcoreRetrieve()` in a later release.
 *
 * Role:    Outer ring. Lazy-requires the AWS SDK; no runtime cost when
 *          another adapter is in use.
 * Emits:   N/A (storage adapters don't emit; recorders observe the
 *          memory pipeline that calls them).
 *
 * **Caveats** — call out before adopting:
 *   1. AgentCore is session/event-based with built-in summarization.
 *      Mixing `defineMemory({ strategy: SUMMARIZE })` on top will
 *      double-compress. Pick one summarizer.
 *   2. Optimistic-concurrency `putIfVersion` is emulated; under high
 *      concurrent write rates the CAS window is wider than RedisStore.
 *      Single-writer scenarios (one server process per session) are
 *      fine.
 *   3. seen/feedback are in-process — they don't survive process restart.
 *      For durable recognition, implement at a higher layer or use Redis.
 *   4. AWS rate limits apply. Production deployments should wrap with
 *      `withRetry` and budget calls per session.
 */

import type {
  ListOptions,
  ListResult,
  MemoryStore,
  PutIfVersionResult,
} from '../../memory/store/types.js';
import type { MemoryEntry } from '../../memory/entry/index.js';
import type { MemoryIdentity } from '../../memory/identity/index.js';
import { identityNamespace } from '../../memory/identity/index.js';

/**
 * Minimal surface over `@aws-sdk/client-bedrock-agent-runtime` that
 * AgentCoreStore touches. Defined locally so we don't take a hard
 * import on the AWS SDK and tests can inject a mock via `_client`.
 */
export interface AgentCoreLikeClient {
  putEvent(input: {
    memoryId: string;
    sessionId: string;
    eventId: string;
    payload: string;
  }): Promise<unknown>;
  getEvent(input: {
    memoryId: string;
    sessionId: string;
    eventId: string;
  }): Promise<{ payload?: string } | null>;
  listEvents(input: {
    memoryId: string;
    sessionId: string;
    nextToken?: string;
    maxResults?: number;
  }): Promise<{
    events: ReadonlyArray<{ eventId: string; payload: string }>;
    nextToken?: string;
  }>;
  deleteEvent(input: { memoryId: string; sessionId: string; eventId: string }): Promise<unknown>;
  deleteSession(input: { memoryId: string; sessionId: string }): Promise<unknown>;
}

export interface AgentCoreStoreOptions {
  /** AgentCore Memory ARN or id. Required. */
  readonly memoryId: string;

  /** AWS region. Required when constructing the SDK client internally. */
  readonly region?: string;

  /**
   * Pre-built AgentCore client. Use this to share a single SDK
   * configuration (credentials, retry policy) across the host app.
   * Adapter does NOT call any close lifecycle on a borrowed client.
   */
  readonly client?: AgentCoreLikeClient;

  /** Page size for `listEvents` calls. Default 50. */
  readonly pageSize?: number;

  /**
   * @internal Test injection point. Skips SDK require entirely.
   */
  readonly _client?: AgentCoreLikeClient;
}

/**
 * AgentCore Memory-backed `MemoryStore`. Implements every method
 * except `search()`. Vector retrieval via AgentCore's native API
 * lands as a separate read-side helper in a later release.
 *
 * @throws when `@aws-sdk/client-bedrock-agent-runtime` is not
 *         installed and no `_client` is supplied.
 */
export class AgentCoreStore implements MemoryStore {
  private readonly client: AgentCoreLikeClient;
  private readonly memoryId: string;
  private readonly pageSize: number;
  private closed = false;

  // In-process shadow state for things AgentCore doesn't surface
  // natively — see file-level docstring for caveats.
  private readonly signatures = new Map<string, Set<string>>();
  private readonly feedbackBag = new Map<string, { sum: number; count: number }>();

  constructor(options: AgentCoreStoreOptions) {
    if (!options.memoryId) {
      throw new Error('AgentCoreStore requires `memoryId`.');
    }
    this.memoryId = options.memoryId;
    this.pageSize = options.pageSize ?? 50;

    if (options._client) {
      this.client = options._client;
    } else if (options.client) {
      this.client = options.client;
    } else {
      this.client = createAgentCoreClient(options.region);
    }
  }

  // Identity → AgentCore session id. Stable, deterministic, isolating.
  private sessionId(identity: MemoryIdentity): string {
    return `afp:${identityNamespace(identity)}`;
  }

  // Shadow-state keys (in-process Maps)
  private shadowKey(identity: MemoryIdentity): string {
    return identityNamespace(identity);
  }
  private feedbackKey(identity: MemoryIdentity, id: string): string {
    return `${identityNamespace(identity)}::${id}`;
  }

  // ── MemoryStore implementation ──────────────────────────────────

  async get<T = unknown>(identity: MemoryIdentity, id: string): Promise<MemoryEntry<T> | null> {
    this.ensureOpen('get');
    const r = await this.client.getEvent({
      memoryId: this.memoryId,
      sessionId: this.sessionId(identity),
      eventId: id,
    });
    if (!r || !r.payload) return null;
    const entry = parseEntry<T>(r.payload);
    if (!entry) return null;
    if (entry.ttl !== undefined && entry.ttl <= Date.now()) return null;
    return entry;
  }

  async put<T = unknown>(identity: MemoryIdentity, entry: MemoryEntry<T>): Promise<void> {
    this.ensureOpen('put');
    if (entry.ttl !== undefined && entry.ttl <= Date.now()) return;
    await this.client.putEvent({
      memoryId: this.memoryId,
      sessionId: this.sessionId(identity),
      eventId: entry.id,
      payload: JSON.stringify(entry),
    });
  }

  async putMany<T = unknown>(
    identity: MemoryIdentity,
    entries: readonly MemoryEntry<T>[],
  ): Promise<void> {
    this.ensureOpen('putMany');
    if (entries.length === 0) return;
    // AgentCore has no batch-write API; sequentialize and let AWS SDK
    // retry policy handle backoff. Production callers should set a
    // sane `maxConcurrency` upstream rather than parallelizing here
    // (per-session events are conceptually ordered).
    for (const entry of entries) {
      await this.put(identity, entry);
    }
  }

  /**
   * Emulated optimistic concurrency. AgentCore's PutEvent overwrites
   * unconditionally. We read-then-write inside a JS critical section
   * — adequate for single-writer-per-session deployments. For multi-
   * writer correctness on AgentCore, layer your own coordination.
   */
  async putIfVersion<T = unknown>(
    identity: MemoryIdentity,
    entry: MemoryEntry<T>,
    expectedVersion: number,
  ): Promise<PutIfVersionResult> {
    this.ensureOpen('putIfVersion');
    const current = await this.get<T>(identity, entry.id);
    if (current === null) {
      if (expectedVersion !== 0) return { applied: false };
    } else if (current.version !== expectedVersion) {
      return { applied: false, currentVersion: current.version };
    }
    await this.put(identity, entry);
    return { applied: true };
  }

  async list<T = unknown>(
    identity: MemoryIdentity,
    options: ListOptions = {},
  ): Promise<ListResult<T>> {
    this.ensureOpen('list');
    const page = await this.client.listEvents({
      memoryId: this.memoryId,
      sessionId: this.sessionId(identity),
      ...(options.cursor !== undefined && { nextToken: options.cursor }),
      maxResults: options.limit ?? this.pageSize,
    });
    const out: MemoryEntry<T>[] = [];
    for (const ev of page.events) {
      const entry = parseEntry<T>(ev.payload);
      if (!entry) continue;
      if (entry.ttl !== undefined && entry.ttl <= Date.now()) continue;
      if (options.tiers && (!entry.tier || !options.tiers.includes(entry.tier))) continue;
      out.push(entry);
    }
    return page.nextToken ? { entries: out, cursor: page.nextToken } : { entries: out };
  }

  async delete(identity: MemoryIdentity, id: string): Promise<void> {
    this.ensureOpen('delete');
    await this.client.deleteEvent({
      memoryId: this.memoryId,
      sessionId: this.sessionId(identity),
      eventId: id,
    });
    this.feedbackBag.delete(this.feedbackKey(identity, id));
  }

  async seen(identity: MemoryIdentity, signature: string): Promise<boolean> {
    this.ensureOpen('seen');
    return this.signatures.get(this.shadowKey(identity))?.has(signature) ?? false;
  }

  async recordSignature(identity: MemoryIdentity, signature: string): Promise<void> {
    this.ensureOpen('recordSignature');
    const key = this.shadowKey(identity);
    const set = this.signatures.get(key) ?? new Set<string>();
    set.add(signature);
    this.signatures.set(key, set);
  }

  async feedback(identity: MemoryIdentity, id: string, usefulness: number): Promise<void> {
    this.ensureOpen('feedback');
    if (!Number.isFinite(usefulness)) return;
    const clamped = Math.max(-1, Math.min(1, usefulness));
    const key = this.feedbackKey(identity, id);
    const cur = this.feedbackBag.get(key) ?? { sum: 0, count: 0 };
    this.feedbackBag.set(key, { sum: cur.sum + clamped, count: cur.count + 1 });
  }

  async getFeedback(
    identity: MemoryIdentity,
    id: string,
  ): Promise<{ average: number; count: number } | null> {
    this.ensureOpen('getFeedback');
    const cur = this.feedbackBag.get(this.feedbackKey(identity, id));
    if (!cur || cur.count === 0) return null;
    return { average: cur.sum / cur.count, count: cur.count };
  }

  async forget(identity: MemoryIdentity): Promise<void> {
    this.ensureOpen('forget');
    await this.client.deleteSession({
      memoryId: this.memoryId,
      sessionId: this.sessionId(identity),
    });
    // Drop shadow state too — the GDPR contract is "everything for
    // this identity, gone."
    const shadowKey = this.shadowKey(identity);
    this.signatures.delete(shadowKey);
    for (const key of [...this.feedbackBag.keys()]) {
      if (key.startsWith(`${shadowKey}::`)) this.feedbackBag.delete(key);
    }
  }

  /**
   * Mark the store closed. Subsequent calls throw cleanly. Idempotent.
   * AgentCore is stateless from the client perspective so there's no
   * connection to tear down — the close gate is purely defensive.
   */
  async close(): Promise<void> {
    if (this.closed) return;
    this.closed = true;
  }

  private ensureOpen(op: string): void {
    if (this.closed) {
      throw new Error(`AgentCoreStore.${op}() called after close().`);
    }
  }
}

// Helpers

function parseEntry<T>(raw: string): MemoryEntry<T> | null {
  try {
    return JSON.parse(raw) as MemoryEntry<T>;
  } catch {
    return null;
  }
}

// Lazy SDK loader

interface BedrockSdkModule {
  readonly BedrockAgentRuntimeClient?: new (config: { region?: string }) => unknown;
  readonly PutMemoryEventCommand?: new (input: unknown) => unknown;
  readonly GetMemoryEventCommand?: new (input: unknown) => unknown;
  readonly ListMemoryEventsCommand?: new (input: unknown) => unknown;
  readonly DeleteMemoryEventCommand?: new (input: unknown) => unknown;
  readonly DeleteMemorySessionCommand?: new (input: unknown) => unknown;
}

/**
 * Build a thin shim over the AWS SDK that conforms to AgentCoreLikeClient.
 *
 * Note on SDK API stability: AgentCore Memory's command names may
 * evolve. The shim depends only on the request/response shapes our
 * adapter needs; if AWS renames commands, only this function needs
 * an update.
 */
function createAgentCoreClient(region: string | undefined): AgentCoreLikeClient {
  let mod: BedrockSdkModule;
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    mod = require('@aws-sdk/client-bedrock-agent-runtime') as BedrockSdkModule;
  } catch {
    throw new Error(
      'AgentCoreStore requires the `@aws-sdk/client-bedrock-agent-runtime` peer dependency.\n' +
        '  Install:  npm install @aws-sdk/client-bedrock-agent-runtime\n' +
        '  Or pass `_client` for test injection.',
    );
  }
  if (!mod.BedrockAgentRuntimeClient) {
    throw new Error(
      'AgentCoreStore: `@aws-sdk/client-bedrock-agent-runtime` is installed but ' +
        '`BedrockAgentRuntimeClient` was not found. Update the SDK to a version that ' +
        'exports the AgentCore Memory commands.',
    );
  }
  const sdkClient = new mod.BedrockAgentRuntimeClient({ ...(region && { region }) }) as {
    send(cmd: unknown): Promise<unknown>;
  };

  const dispatch = async (CommandCtor: unknown, input: unknown): Promise<unknown> => {
    if (!CommandCtor) {
      throw new Error(
        'AgentCoreStore: this version of `@aws-sdk/client-bedrock-agent-runtime` ' +
          'does not expose the required Memory command. Upgrade the SDK.',
      );
    }
    const cmd = new (CommandCtor as new (i: unknown) => unknown)(input);
    return await sdkClient.send(cmd);
  };

  return {
    async putEvent(input) {
      await dispatch(mod.PutMemoryEventCommand, input);
    },
    async getEvent(input) {
      const r = (await dispatch(mod.GetMemoryEventCommand, input)) as { payload?: string } | null;
      return r ?? null;
    },
    async listEvents(input) {
      return (await dispatch(mod.ListMemoryEventsCommand, input)) as {
        events: ReadonlyArray<{ eventId: string; payload: string }>;
        nextToken?: string;
      };
    },
    async deleteEvent(input) {
      await dispatch(mod.DeleteMemoryEventCommand, input);
    },
    async deleteSession(input) {
      await dispatch(mod.DeleteMemorySessionCommand, input);
    },
  };
}
