import type { MemoryEntry } from '../../../memory/entry/index.js';
import type { MemoryIdentity } from '../../../memory/identity/index.js';
import type { MemoryWriteOptionName } from '../../../memory/store/writeOptions.js';
/**
 * ListEvents.maxResults: integer 1..100 (AWS API reference, verified 2026-10-19).
 * https://docs.aws.amazon.com/bedrock-agentcore/latest/APIReference/API_ListEvents.html
 */
export const MAX_EVENT_PAGE_SIZE = 100;

/**
 * RetrieveMemoryRecords.maxResults and SearchCriteria.topK both admit 1..100.
 * https://docs.aws.amazon.com/bedrock-agentcore/latest/APIReference/API_RetrieveMemoryRecords.html
 * https://docs.aws.amazon.com/bedrock-agentcore/latest/APIReference/API_SearchCriteria.html
 */
export const MAX_RETRIEVAL_RESULTS = 100;

/** What this store honours when its client forwards CreateEvent's extraction fields. */
export const AGENTCORE_WRITE_OPTIONS: readonly MemoryWriteOptionName[] = Object.freeze([
  'extraction',
  'namespaceScope',
] as const);

/** An explicit per-entry choice; the canonical entry blob is always retained. */
export type AgentCoreEventPayloadChoice =
  | { readonly kind: 'blob' }
  | {
      readonly kind: 'conversational';
      readonly role: 'user' | 'assistant' | 'tool' | 'other';
      readonly text: string;
    };

/** Synchronous projection of detached JSON entry data, called once per actual write. */
export type AgentCoreEventPayloadSelector = (entry: MemoryEntry) => AgentCoreEventPayloadChoice;

/** One event as the adapter cares about it: AgentCore's id + the decoded entry. */
export interface AgentCoreEvent {
  /** AgentCore server-assigned event id (needed to delete it). */
  readonly eventId: string;
  /**
   * The MemoryEntry decoded from the event's blob payload.
   *
   * `null` means the event carried **no blob at all** — nothing in it ever
   * claimed to be one of this store's entries (AgentCore writes events of its
   * own into the same log), so it is skipped as an absence.
   *
   * A blob that IS present and cannot be decoded never arrives here: it raises
   * {@link UnreadableMemoryEntryError} at the decode step instead. An unreadable
   * stored memory and an absent one are different facts, and only one of them is
   * safe to answer with silence.
   */
  readonly entry: MemoryEntry | null;
}

/**
 * Minimal, entry-semantic surface the store uses. The real implementation
 * (`createAgentCoreClient`) maps these onto `CreateEvent` / `ListEvents` /
 * `DeleteEvent`; tests inject a mock via `_client`.
 */
export interface AgentCoreLikeClient {
  /**
   * `true` when {@link createEvent} forwards `extractionMode` and
   * `extractionConfig` to `CreateEvent` unchanged. The built-in client does.
   *
   * Declared, not assumed: a client written before these fields existed
   * compiles against the wider input and drops them, and a dropped
   * `extractionMode: 'SKIP'` sends a turn the caller kept out of long-term
   * memory INTO extraction. Without this, `AgentCoreStore` honours no write
   * options and refuses them by name.
   */
  readonly forwardsWriteOptions?: true;
  /**
   * Declares that a selected conversational item reaches the backend beside the
   * canonical blob. Required only for conversational choices; no downgrade to
   * blob is allowed. This contract does not prove a remote effect or extraction.
   */
  readonly forwardsEventPayload?: true;
  /** Append one entry as an event (server assigns the eventId). */
  createEvent(input: {
    memoryId: string;
    actorId: string;
    sessionId: string;
    entry: MemoryEntry;
    /** Captured owned choice; absent when the store has no eventPayload selector. */
    eventPayload?: AgentCoreEventPayloadChoice;
    /**
     * `CreateEvent`'s own field (`ExtractionMode.SKIP`): store the event in
     * short-term memory, exclude it from long-term extraction.
     */
    extractionMode?: 'SKIP';
    /**
     * `CreateEvent`'s own field: `namespaceVariables` are substituted into the
     * memory's `namespaceTemplates` during long-term extraction.
     */
    extractionConfig?: { readonly namespaceVariables: Readonly<Record<string, string>> };
  }): Promise<void>;
  /** One page of the session's events (newest-first is AgentCore's default). */
  listEvents(input: {
    memoryId: string;
    actorId: string;
    sessionId: string;
    maxResults?: number;
    nextToken?: string;
  }): Promise<{ events: readonly AgentCoreEvent[]; nextToken?: string }>;
  /** Delete one event by its AgentCore eventId. */
  deleteEvent(input: {
    memoryId: string;
    actorId: string;
    sessionId: string;
    eventId: string;
  }): Promise<void>;
  /**
   * Server-side semantic retrieval (`RetrieveMemoryRecords`). Optional: a client
   * built before this existed still satisfies the interface, and `search()`
   * feature-detects it rather than assuming.
   */
  retrieveRecords?(input: {
    memoryId: string;
    namespace: string;
    searchQuery: string;
    maxResults?: number;
    memoryStrategyId?: string;
  }): Promise<{ records: readonly AgentCoreMemoryRecord[] }>;
}

/** One record as `RetrieveMemoryRecords` returns it. */
export interface AgentCoreMemoryRecord {
  /** AgentCore's own record id. */
  readonly memoryRecordId: string;
  /** The record's text content. */
  readonly content: string;
  /** Relevance as AgentCore scored it, when it reports one. */
  readonly score?: number;
  /** Which strategy produced the record (semantic, summary, user-preference, …). */
  readonly memoryStrategyId?: string;
  /** The namespace it was found in — the first of {@link namespaces}. */
  readonly namespace?: string;
  /**
   * Every namespace the record is filed under, as `RetrieveMemoryRecords`
   * reports them (`MemoryRecordSummary.namespaces`). `search()` keeps a record
   * only when one of these is the namespace it asked for, or lies under it.
   */
  readonly namespaces?: readonly string[];
  /** When AgentCore created it (unix ms), when reported. */
  readonly createdAt?: number;
}

export interface AgentCoreStoreOptions {
  /** AgentCore Memory ARN or id. Required. */
  readonly memoryId: string;
  /** AWS region. Required when constructing the SDK client internally. */
  readonly region?: string;
  /** Pre-built AgentCore client (shares one SDK config across the host app). */
  readonly client?: AgentCoreLikeClient;
  /**
   * Explicit per-entry projection, evaluated once after expiry and CAS checks.
   * Omission or `blob` preserves the existing blob-only body. A conversational
   * choice adds one role/text item in the same event, keeping the entry blob.
   * The callback receives detached JSON data and must return a plain synchronous
   * data choice. Text must contain 1–100,000 Unicode scalars and at most 100,000
   * UTF-8 bytes; the generated mixed body has a 10,000,000-byte library ceiling.
   * Oversized or malformed choices are refused, never truncated or downgraded.
   *
   * An acknowledgement proves event acceptance, not completed extraction.
   * Entry delete/forget delete source events; entry TTL is a local visibility
   * rule. Derived records have separate retention and can remain searchable.
   * `extraction: 'skip'` affects this write, not previous records or extraction.
   * One adapter invocation does not limit the SDK's existing wire retry policy.
   */
  readonly eventPayload?: AgentCoreEventPayloadSelector;
  /** Page size for session scans and default `list()` calls: integer 1..100. Default 100. */
  readonly pageSize?: number;
  /**
   * Where `search()` looks. AgentCore organises extracted memory records into
   * namespaces configured on the Memory resource's strategies (commonly
   * something like `/strategies/{strategyId}/actors/{actorId}`).
   *
   * A function, because the namespace usually contains the actor: it is handed
   * the resolved AgentCore ids for the identity being searched, the identity
   * itself, and — when the memory binds one (`writeOptions.namespaceScope`) —
   * the SAME namespace scope its writes are filed under, resolved for this
   * identity. Build the namespace from that scope
   * (`({ namespaceScope }) => '/tenants/' + namespaceScope?.tenantid + '/facts'`):
   * a search given a scope is refused unless every one of its values is a
   * path segment of the namespace, so a read cannot leave the tenant its
   * writes were filed under. Default: `/actors/{actorId}/sessions/{sessionId}`
   * — the session's own records.
   */
  readonly searchNamespace?: (scope: {
    readonly actorId: string;
    readonly sessionId: string;
    readonly identity: MemoryIdentity;
    readonly namespaceScope?: Readonly<Record<string, string>>;
  }) => string;
  /**
   * Restrict `search()` to one extraction strategy (semantic, summary,
   * user-preference…). Omit to search across all of them.
   *
   * This is the metadata filter that reaches AgentCore's own side; `tiers` /
   * `minScore` / `k` from `SearchOptions` are applied to what comes back.
   */
  readonly searchStrategyId?: string;
  /**
   * Refuse, by name, every write and search that carries no `namespaceScope`.
   *
   * Set it on a store whose every memory is scoped — a multi-tenant
   * deployment. A memory, a `defineRAG` or a direct call that forgot its scope
   * is then refused, instead of filing or reading under a namespace no tenant
   * owns (a template with an empty variable). Default `false`.
   */
  readonly requireNamespaceScope?: boolean;
  /**
   * Let a search read the records derived from EVERY principal of a tenant.
   *
   * Off by default: a search for an identity that names a principal is refused
   * unless its namespace holds that identity's `actorId` as path segments —
   * a namespace that stops at the tenant serves one person's extracted facts,
   * preferences and summaries to another. Set it only when the memory's
   * strategies file per tenant ON PURPOSE (knowledge the whole tenant shares).
   * It applies to SCOPED searches only: a search with no scope has no tenant to
   * stay inside, so it must always hold the actor.
   */
  readonly searchAcrossPrincipals?: boolean;
  /** @internal Test injection — skips the SDK require entirely. */
  readonly _client?: AgentCoreLikeClient;
  /**
   * Statically imported `@aws-sdk/client-bedrock-agentcore` module. Bypasses the
   * lazy loader for bundled hosts; the adapter still owns command construction.
   * A scripted module also exercises the real mapping without AWS calls.
   */
  readonly sdk?: BedrockAgentCoreSdkModule;
}

/**
 * The slice of `@aws-sdk/client-bedrock-agentcore` the shim touches.
 * Command inputs are SDK-owned: `never` keeps their specific constructor
 * signatures assignable without importing the optional peer's types. The
 * adapter alone supplies each command's wire input at its internal boundary.
 */
export interface BedrockAgentCoreSdkModule {
  readonly BedrockAgentCoreClient?: new (config: { region?: string }) => {
    send(cmd: unknown): Promise<unknown>;
  };
  readonly CreateEventCommand?: new (input: never) => unknown;
  readonly ListEventsCommand?: new (input: never) => unknown;
  readonly DeleteEventCommand?: new (input: never) => unknown;
  readonly RetrieveMemoryRecordsCommand?: new (input: never) => unknown;
  /**
   * The SDK's own schema of `CreateEventInput` — read only to learn whether this
   * SDK MODELS the extraction fields (see `sdkModelsExtraction`).
   */
  readonly CreateEventInput$?: unknown;
  /** Static SDK union/structure schemas used to verify conversational serialization. */
  readonly PayloadType$?: unknown;
  readonly Conversational$?: unknown;
  readonly Content$?: unknown;
}
