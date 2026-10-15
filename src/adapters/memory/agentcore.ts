/**
 * AgentCoreStore — AWS Bedrock **AgentCore Memory** adapter
 * (peer-dep `@aws-sdk/client-bedrock-agentcore`).
 *
 *   import { AgentCoreStore } from 'agentfootprint/memory';
 *
 *   const store = new AgentCoreStore({
 *     memoryId: 'arn:aws:bedrock-agentcore:us-west-2:...:memory/my-mem',
 *     region: 'us-west-2',
 *   });
 *
 * Pattern: Adapter (GoF) — maps the `MemoryStore` interface onto AgentCore Memory's
 *          data-plane **event** model (`CreateEvent` / `GetEvent` / `ListEvents` /
 *          `DeleteEvent`, `@aws-sdk/client-bedrock-agentcore`):
 *            MemoryIdentity.{tenant,principal}  ↔  AgentCore `actorId`
 *            MemoryIdentity.conversationId      ↔  AgentCore `sessionId`
 *            MemoryEntry                        ↔  one event whose `payload` is a single
 *                                                  `blob` document holding the entry
 *
 * **AgentCore Memory is an append-only event log, not a key-value store.** The server
 * assigns each event's `eventId` on `CreateEvent` (you cannot choose it), and there is no
 * "delete the whole session" call. This shapes the adapter:
 *
 *   • `put`  → `CreateEvent` (append; `actorId` + `eventTimestamp` are required).  O(1)
 *     Its write options become CreateEvent's own fields: `extraction: 'skip'` →
 *     `extractionMode: 'SKIP'`, `namespaceScope` → `extractionConfig.namespaceVariables`.
 *   • `list` → `ListEvents` (paginated, `includePayloads`).  ← window / episodic memory.  O(page)
 *   • `get(id)` / `delete(id)` → list-then-find by the entry id stored in the blob, since
 *     AgentCore's ids are server-assigned.  **O(events in session)** — fine for typical
 *     window sizes; if you need O(1) keyed access at scale, use RedisStore.
 *   • `forget` → `ListEvents` + `DeleteEvent` per event (no `DeleteSession` on AgentCore).
 *   • `search` → `RetrieveMemoryRecords`, **text-in**. AgentCore embeds and ranks on its
 *     own side, so it takes a natural-language query; the port's `search()` takes a
 *     vector. Pass `options.text` and this store serves the query; omit it and it refuses
 *     by name rather than ranking an empty set. See `search()` below for the whole story.
 *   • `putIfVersion` / `seen` / `feedback` → in-process emulation (AgentCore has no native
 *     CAS / dedup / feedback primitive; these don't survive process restart).
 *   • no `stream()` — AgentCore Memory has no streaming data-plane operation, and the
 *     `MemoryStore` port has no streaming method to implement. Inventing one for a single
 *     backend is how a port stops being a port.
 *
 * Role:    Outer ring. Lazy-requires the AWS SDK; zero runtime cost when another adapter is
 *          in use.  Emits: N/A (storage adapters don't emit).
 */

import type {
  ListOptions,
  ListResult,
  MemoryStore,
  PutIfVersionResult,
  ScoredEntry,
  SearchOptions,
} from '../../memory/store/types.js';
import type { MemoryEntry } from '../../memory/entry/index.js';
import type { MemoryIdentity } from '../../memory/identity/index.js';
import { IDENTITY_ABSENT, identityNamespace } from '../../memory/identity/index.js';
import { lazyRequire } from '../../lib/lazyRequire.js';
import { describeStoredShape } from '../../lib/storedPreview.js';
import {
  refuseUnhonouredWriteOptions,
  requestedWriteOptions,
  type MemoryWriteOptionName,
  type MemoryWriteOptions,
} from '../../memory/store/writeOptions.js';

/** What this store honours when its client forwards CreateEvent's extraction fields. */
const AGENTCORE_WRITE_OPTIONS: readonly MemoryWriteOptionName[] = Object.freeze([
  'extraction',
  'namespaceScope',
] as const);

/**
 * ── Namespace variables: AgentCore's domain, checked here ──
 *
 * From the AgentCore API reference, `ExtractionConfig.namespaceVariables`: at
 * most 5 entries; keys 1–32 characters matching
 * `(?!memoryStrategyId$|actorId$|sessionId$)[a-z][a-z0-9]*`; values 1–64
 * characters matching `[a-z0-9][a-z0-9-_]*`.
 *
 * Checked BEFORE the write rather than left to AgentCore, for one reason: its
 * `ValidationException` may quote the rejected value, and the value names a
 * tenant — a refusal here names the variable and the rule, never the value.
 */
const MAX_NAMESPACE_VARIABLES = 5;
/** The refusal of a scope-less write or search on a store that requires one. */
const MISSING_SCOPE = (what: 'write' | 'search'): string =>
  `AgentCoreStore: this ${what} carries no \`namespaceScope\`, and the store requires one — it ` +
  'was built with `requireNamespaceScope: true`, or it has already served scoped calls. It is ' +
  'refused rather than run under a namespace no tenant owns. Scope the memory that made it ' +
  '(`defineMemory({ namespaceScope })`).';

/**
 * Refuse, before any call, an identity this store cannot address: not an
 * object, or no `conversationId` — an absent one would encode to ONE session
 * every such identity shares.
 */
function assertAddressable(identity: MemoryIdentity): void {
  if (identity === null || typeof identity !== 'object') {
    throw new TypeError('AgentCoreStore: an identity is required — got none.');
  }
  const { conversationId, tenant, principal } = identity as {
    readonly conversationId?: unknown;
    readonly tenant?: unknown;
    readonly principal?: unknown;
  };
  if (typeof conversationId !== 'string' || conversationId === '') {
    throw new TypeError(
      'AgentCoreStore: the identity has no `conversationId`. It is refused rather than filed ' +
        'under one session every such identity would share.',
    );
  }
  for (const [name, value] of [
    ['tenant', tenant],
    ['principal', principal],
  ] as const) {
    if (value !== undefined && value !== null && typeof value !== 'string') {
      throw new TypeError(`AgentCoreStore: the identity's \`${name}\` must be a string.`);
    }
  }
}

/**
 * Refuse a search namespace that names no place: not a string, empty, or no
 * path segment at all (`''`, `'/'`) — AgentCore matches a prefix, and an empty
 * prefix is every record of the memory.
 */
function assertNamespace(namespace: unknown): asserts namespace is string {
  if (typeof namespace !== 'string' || pathOf(namespace).replace(/^\//, '') === '') {
    throw new TypeError(
      'AgentCoreStore.search(): `searchNamespace` returned no namespace — an empty prefix ' +
        'matches every record of the memory, so it is refused. Return a namespace with at ' +
        'least one path segment.',
    );
  }
}

const NAMESPACE_KEY = /^(?!memoryStrategyId$|actorId$|sessionId$)[a-z][a-z0-9]{0,31}$/;
const NAMESPACE_VALUE = /^[a-z0-9][a-z0-9_-]{0,63}$/;
const NAMESPACE_VALUE_MAX = 64;

/** Refuse, by variable name and rule, a scope AgentCore would reject. */
function checkNamespaceVariables(scope: Readonly<Record<string, string>>): void {
  const keys = Object.keys(scope);
  if (keys.length > MAX_NAMESPACE_VARIABLES) {
    throw new TypeError(
      `AgentCoreStore: a namespaceScope may carry at most ${MAX_NAMESPACE_VARIABLES} variables ` +
        `(AgentCore's limit); this one has ${keys.length}.`,
    );
  }
  for (const key of keys) {
    if (!NAMESPACE_KEY.test(key)) {
      throw new TypeError(
        `AgentCoreStore: the namespace variable name ${JSON.stringify(key)} is not one ` +
          'AgentCore admits — 1–32 characters, a lowercase letter then lowercase letters or ' +
          'digits (and not memoryStrategyId / actorId / sessionId).',
      );
    }
    const value = scope[key];
    if (typeof value !== 'string' || !NAMESPACE_VALUE.test(value)) {
      throw new TypeError(
        `AgentCoreStore: the value of namespace variable ${JSON.stringify(key)} is not one ` +
          'AgentCore admits — 1–64 characters of [a-z0-9-_], starting with a letter or digit. ' +
          'It is not quoted here: it names a tenant. Map your id with ' +
          '`agentCoreNamespaceValue(...)`, which is one-to-one and fits this alphabet.',
      );
    }
  }
}

/**
 * A scope as the store uses it: read ONCE into a frozen plain copy, so the value
 * that is checked is the value that is sent — a getter, or an object the
 * caller's resolver reuses and edits, cannot change it between the two.
 */
function frozenScope(scope: Readonly<Record<string, string>>): Readonly<Record<string, string>> {
  return Object.freeze(Object.fromEntries(Object.entries(scope)));
}

/**
 * A search under a namespace scope must stay inside it — checked by RENDERING,
 * not by looking: `searchNamespace` is asked again with every value replaced
 * by a canary, and the two namespaces must agree segment for segment — each
 * canary's segment holding exactly that variable's real value, every other
 * segment the same literal. So a namespace that ignores the scope, puts a
 * variable inside a segment, or merely happens to contain a value elsewhere
 * (a tenant named like a literal segment) is refused, naming the variable and
 * never quoting its value.
 */
function assertSearchWithinScope(
  render: (namespaceScope: Readonly<Record<string, string>>) => string,
  namespace: string,
  namespaceScope: Readonly<Record<string, string>>,
): void {
  const variables = Object.keys(namespaceScope);
  const nonce = globalThis.crypto.randomUUID();
  const canaries = variables.map((_, i) => `canary${i}-${nonce}`);
  const canaryScope = Object.fromEntries(variables.map((v, i) => [v, canaries[i] as string]));
  const real = namespace.split('/');
  const probe = render(canaryScope).split('/');
  const refuse = (variable: string): never => {
    throw new TypeError(
      `AgentCoreStore.search(): the namespace searched does not hold namespace variable ` +
        `${JSON.stringify(variable)} as a path segment of its own, so it could read records ` +
        'filed under another tenant’s scope. Build `searchNamespace` from the ' +
        '`namespaceScope` it is handed, one variable per segment (e.g. ' +
        '"/tenants/{tenantid}/actors/{actorId}/facts").',
    );
  };
  const seen = new Set<string>();
  if (real.length !== probe.length) refuse(variables[0] ?? 'namespaceScope');
  probe.forEach((segment, i) => {
    const at = canaries.indexOf(segment);
    if (at === -1) {
      if (real[i] !== segment) refuse(variables[0] ?? 'namespaceScope');
      return;
    }
    const variable = variables[at] as string;
    if (real[i] !== namespaceScope[variable]) refuse(variable);
    seen.add(variable);
  });
  for (const variable of variables) if (!seen.has(variable)) refuse(variable);
}

/**
 * Does `namespace` hold `actorId` as whole path segments? (An actor id can
 * itself contain `/`, its escape.)
 */
function holdsActor(namespace: string, actorId: string): boolean {
  return `/${pathOf(namespace).replace(/^\//, '')}/`.includes(`/${actorId}/`);
}

/**
 * A caller's value — a tenant id — in the alphabet AgentCore admits for a
 * namespace variable, ONE-TO-ONE.
 *
 * The alphabet is narrow (`[a-z0-9][a-z0-9-_]*`, at most 64 characters), so the
 * easy mappings fold: lowercasing merges `Acme` with `acme`, stripping merges
 * `a.b` with `ab`, truncating merges any two long ids that share a prefix — and
 * a fold here files two tenants' derived records under one namespace. This is
 * the same law as the actor and session ids above, in this alphabet:
 *
 *   - `[a-z0-9-]` passes through; every other UTF-16 code unit becomes `_`
 *     plus its four lowercase hex digits (fixed width, so it decodes);
 *   - every value starts with `v`, so one whose first character had to be
 *     escaped still starts with a letter — and no two inputs share an output;
 *   - every value ENDS with `_z`, which cannot occur inside an encoding (an
 *     `_` there is always followed by four hex digits) — so no tenant's value
 *     is the beginning of another's (`1` and `12` would otherwise be `v1` and
 *     `v12`), and a prefix match over namespaces cannot reach a neighbour;
 *   - too long is REFUSED, never truncated.
 *
 * `agentCoreNamespaceValue('acme')` is `'vacme_z'`; `'Acme'` is `'v_0041cme_z'`.
 * Use the same mapping wherever the namespace is read back (`searchNamespace`).
 *
 * @throws {TypeError} for an empty value — an absent tenant is not a tenant
 * @throws {RangeError} when the encoding exceeds 64 characters (the value is
 *   not quoted: it names a tenant)
 */
export function agentCoreNamespaceValue(raw: string): string {
  if (typeof raw !== 'string' || raw === '') {
    throw new TypeError(
      'agentCoreNamespaceValue: needs a non-empty string — an absent tenant is not a tenant, ' +
        'and giving it a stand-in value would share that namespace with whoever is named it.',
    );
  }
  let out = 'v';
  for (let i = 0; i < raw.length; i++) {
    const ch = raw[i] as string;
    out += /[a-z0-9-]/.test(ch) ? ch : `_${raw.charCodeAt(i).toString(16).padStart(4, '0')}`;
  }
  out += '_z';
  if (out.length > NAMESPACE_VALUE_MAX) {
    throw new RangeError(
      `agentCoreNamespaceValue: this value encodes to ${out.length} characters, over AgentCore's ` +
        `${NAMESPACE_VALUE_MAX}. It is not truncated to fit — two ids truncated to one value ` +
        'share a namespace. The value is not quoted here: it names a tenant.',
    );
  }
  return out;
}

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
 * Thrown when an event carries a blob that is **present but unreadable** where a
 * `MemoryEntry` should be.
 *
 * The same law the session store inherits from `hosting/envelope`, applied to
 * this port's own shape: an unreadable stored memory and an absent one are
 * different facts, and only one of them is safe to answer with silence. A
 * memory that exists and cannot be decoded, quietly skipped, is an agent that
 * answers as if it were never told — indistinguishable from working, until
 * somebody notices the assistant has forgotten a customer's address.
 *
 * ── Why the law lives HERE and not in a shared reader ────────────────────────
 * `MemoryStore` has no envelope and no shared reading path — nothing on this
 * port corresponds to `hosting`'s `readFormat`, the single choke point every
 * session adapter reads through — so the refusal belongs at the one place raw
 * bytes become an entry: this adapter's decode step. If a `MemoryStore` reading
 * path ever grows such a choke point, the law moves there and this becomes a
 * caller of it.
 *
 * ── Why this one QUOTES NOTHING, where the session refusal quotes a prefix ───
 * Same discipline — "never the stored content" — and the same shared helper, but
 * a different answer, because the two shapes differ in where content begins. A
 * `CheckpointEnvelope` opens `{ format, data, savedAt }`, so a capped prefix is
 * metadata. A `MemoryEntry` opens `{ id, value, … }`, so its SECOND field is the
 * thing somebody asked the agent to remember, and even a short prefix would
 * print it. `storedShape` therefore reports type, length, JSON-ness and the
 * opening character and nothing else — still enough to recognise "an object
 * stringified by something that was not JSON", which is the only diagnosis this
 * message needs to support.
 */
export class UnreadableMemoryEntryError extends TypeError {
  readonly code = 'ERR_UNREADABLE_MEMORY_ENTRY' as const;
  /** AgentCore's id for the event those bytes came from. */
  readonly eventId: string;
  /** The AgentCore session (this store's conversation) it was stored under. */
  readonly sessionId: string;
  /**
   * What came back, described by SHAPE — type, length, JSON-ness, opening
   * character. Never a quote: on this port the stored bytes are the memory.
   */
  readonly storedShape: string;

  constructor(input: { eventId: string; sessionId: string; stored: unknown }) {
    const shape = describeStoredShape(input.stored);
    super(
      `[memory] AgentCoreStore: event '${input.eventId}' in session '${input.sessionId}' holds ` +
        `a STORED memory this adapter cannot read. An unreadable stored memory and an absent ` +
        `one are different facts, and only one of them is safe to answer with silence — so ` +
        `this refuses rather than handing back a shorter list that reads as "nothing was ` +
        `remembered". What the store handed back is ${shape}; none of it is quoted here, ` +
        `because on this port those bytes ARE the memory. Entries written before 7.22.1 were ` +
        `stored as objects and come back as this service's own toString() rendering, which is ` +
        `lossy and cannot be decoded: delete them, or point this store at a fresh memory ` +
        `resource.`,
    );
    this.name = 'UnreadableMemoryEntryError';
    this.eventId = input.eventId;
    this.sessionId = input.sessionId;
    this.storedShape = shape;
  }
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
  /** Append one entry as an event (server assigns the eventId). */
  createEvent(input: {
    memoryId: string;
    actorId: string;
    sessionId: string;
    entry: MemoryEntry;
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
  /** Page size for `listEvents`. Default 100. */
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
   * `minScore` / `k` from {@link SearchOptions} are applied to what comes back.
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
  /** @internal Test injection — the AWS SDK module (to exercise the real shim with a mock SDK). */
  readonly _sdk?: BedrockAgentCoreSdkModule;
}

/**
 * ── The AgentCore id encoders: the tenant boundary, in AWS's alphabet ──
 *
 * `actorId` and `sessionId` are where a `MemoryIdentity` becomes the address
 * AgentCore stores rows under, so the same law `identity/encode.ts` states
 * applies here word for word: the mapping must be **injective**, because two
 * tuples that spell one id are one scope reading and overwriting another's
 * memory — no race, no misconfiguration, just arithmetic.
 *
 * It was not. Until this fix the id was a lossy slug: every character outside
 * `[A-Za-z0-9_-]` became `-`, so `a.b`, `a/b` and `a b` were one actor; and the
 * two fields were joined with a bare `_`, so tenant `a_b` + principal `c` was
 * the same actor as tenant `a` + principal `b_c`. Both are cross-tenant.
 *
 * **Why this cannot call `encodeIdentityField`.** The shared encoder escapes to
 * `%25`/`%2F`/`%5F`, and AWS admits no `%` in either id. The constraints, read
 * from the AgentCore Memory data-plane API reference (`CreateEvent`, verified
 * 2026-08) rather than assumed, are:
 *
 *   actorId    1..255  `[a-zA-Z0-9][a-zA-Z0-9-_/]*(?::[a-zA-Z0-9-_/]+)*[a-zA-Z0-9-_/]*`
 *   sessionId  1..100  `[a-zA-Z0-9][a-zA-Z0-9-_]*`
 *
 * So the LAW is borrowed and the code is not: same three rules (escape the
 * escape, escape the separator, keep a present value off the absence marker),
 * a different alphabet. `shadowKey` below still delegates to the shared
 * encoder, because a process-local Map key has no charset to obey.
 *
 * **What is preserved byte for byte.** A field made only of `[A-Za-z0-9-]`
 * passes through untouched, and the joiner and the absence marker are the ones
 * this adapter always used — so `{ tenant: 'acme', principal: 'alice' }` is
 * still `afp-acme_alice`, and an omitted tenant is still a bare `_`. That is
 * what makes the fix deployable: an existing row written under a simple id
 * keeps its address. The ids that move are the ones that were sharing an
 * address with somebody else, and those were already broken.
 *
 * `_` is the one character a well-behaved-looking value does NOT keep: it is
 * the field joiner and the absence marker, so a value containing it must be
 * escaped or it would donate a field boundary — exactly what `/` does in the
 * shared encoder.
 */

/** AgentCore's own maxima, not a shared guess — see the note above. */
const ACTOR_ID_MAX = 255;
const SESSION_ID_MAX = 100;

/** Characters an escaped segment carries through unchanged. */
const VERBATIM_ID_CHAR = /[A-Za-z0-9-]/;

/**
 * Escape one identity field into AgentCore's alphabet, reversibly.
 *
 * Every code unit outside {@link VERBATIM_ID_CHAR} becomes `introducer` + its
 * four-digit hex — fixed width, so a decoder reading `introducer` always knows
 * exactly how much to consume, which is what makes this a left inverse and
 * therefore injective.
 *
 * The escape character escapes ITSELF for free here, and that is deliberate:
 * `identity/encode.ts` has to order its two `.replace()` passes so `%` goes
 * first (reverse them and `a%2Fb` lands on the value that produced it). A
 * single left-to-right pass over code units has no ordering to get wrong — the
 * introducer is simply not in the verbatim set, so it is escaped like any other
 * character. Do not "optimise" this back into chained replaces.
 *
 * Code UNITS, not code points: a lone surrogate is a legal JS string and would
 * be flattened to U+FFFD by a UTF-8 pass, which is a collision.
 */
function escapeIdSegment(raw: string, introducer: string): string {
  let out = '';
  for (let i = 0; i < raw.length; i++) {
    const ch = raw[i] as string;
    out += VERBATIM_ID_CHAR.test(ch)
      ? ch
      : introducer + raw.charCodeAt(i).toString(16).toUpperCase().padStart(4, '0');
  }
  return out;
}

/**
 * One half of the actor tuple. Absence has exactly one spelling — `undefined`,
 * `null` and `''` all mean "not given" — and it is {@link IDENTITY_ABSENT},
 * the same sentinel the shared encoder uses.
 *
 * A present value can never spell the sentinel, because `_` is not verbatim:
 * a tenant literally named `_` encodes to `/005F`. That is the third rule,
 * satisfied by construction rather than by a special case.
 */
function actorSegment(raw: string | undefined | null): string {
  return raw === undefined || raw === null || raw === ''
    ? IDENTITY_ABSENT
    : escapeIdSegment(raw, '/');
}

/**
 * Apply AgentCore's length ceiling — by refusing, never by truncating.
 *
 * Truncation (with or without a hash tail, which is what this adapter used to
 * do) maps infinitely many identities onto finitely many ids, so it cannot be
 * injective: it converts "your id is too long" into "your tenant occasionally
 * reads someone else's memory", silently. A caller can shorten an id; a caller
 * cannot detect a collision.
 *
 * The offending value is NOT quoted. This is the identity boundary, and an
 * error string is the one place a tenant id must never travel.
 */
function boundedId(body: string, max: number, field: 'actor' | 'session'): string {
  const id = `afp-${body}`;
  if (id.length <= max) return id;
  throw new RangeError(
    `AgentCoreStore: the ${field} id for this identity encodes to ${id.length} characters, over ` +
      `AgentCore's ${max}-character limit for ${field}Id. It is deliberately not truncated to fit — ` +
      `truncating two identities to one id is how one tenant reads another's memory, and a hash tail ` +
      `makes that unlikely rather than impossible. Shorten the ` +
      `${
        field === 'actor' ? '`tenant` / `principal`' : '`conversationId`'
      } at the call site. (Anything ` +
      `outside [A-Za-z0-9-] escapes to five characters, so punctuation and non-ASCII count for more ` +
      `than they look.) The value is not quoted here on purpose: it addresses a tenant.`,
  );
}

/**
 * AgentCore Memory-backed `MemoryStore`. Implements every method except `search()`.
 *
 * @throws when `@aws-sdk/client-bedrock-agentcore` is not installed and no `_client`/`_sdk`
 *         is supplied.
 */
export class AgentCoreStore implements MemoryStore {
  /**
   * **No.** `search()` below exists, but it is `RetrieveMemoryRecords`:
   * AgentCore embeds and ranks on its own side, over the records its
   * extraction strategies derived, and never over the vectors written
   * through `put`/`putMany`. Embeddings handed to this store are stored
   * inside the event blob and are never ranked by anything.
   *
   * Declared (8.19.0) because a method's presence could not say that.
   * `indexCorpus` used to accept this store, embed a whole corpus, pay for
   * it and report success — and the chunks were unreachable forever. The
   * corpus builders read this bit and refuse, naming this store and what to
   * use instead; nothing else changes, and `defineMemory` over AgentCore's
   * own retrieval is untouched.
   */
  readonly supportsVectorSearch = false;

  /**
   * **Words, not a vector.** `search()` is `RetrieveMemoryRecords`, whose
   * query is natural-language text: it reads {@link SearchOptions.text} and
   * refuses by name without it.
   *
   * {@link supportsVectorSearch} already said this store cannot serve back the
   * embeddings written into it — the question a corpus BUILDER asks. This
   * answers the next one down, which is what a corpus READER needs: what query
   * form does `search()` take? Declaring it is what lets `defineRAG` know,
   * before the first turn rather than after the bill, that a retriever over
   * this store needs no `Embedder` at all — embedding the question anyway is
   * spend on a vector discarded on arrival.
   *
   * Added in the same batch as the Google column's Memory Bank store, which is
   * the second adapter of this shape. Two stores that behave identically and
   * declare it differently is how a capability check quietly stops meaning
   * anything.
   */
  readonly ranksBy = 'server-text' as const;

  /**
   * **Both write options, translated to `CreateEvent`'s own fields:**
   *
   *   `extraction: 'skip'`   → `extractionMode: 'SKIP'` — the event stays in
   *                            short-term memory and is excluded from
   *                            long-term extraction.
   *   `namespaceScope`       → `extractionConfig: { namespaceVariables }` —
   *                            substituted into the memory's
   *                            `namespaceTemplates` during extraction, which
   *                            is how one tenant's derived records stay in
   *                            that tenant's namespace.
   *
   * Absent — and both refused by name — when they could not reach AgentCore:
   * an injected client that does not declare `forwardsWriteOptions`, or an
   * installed SDK too old to MODEL the two fields (its serializer would drop
   * them without a word). The variables are checked here against AgentCore's
   * documented domain before anything is sent (see `checkNamespaceVariables`).
   *
   * A getter, not a field: a wrapper built by spreading this store
   * (`{ ...store, put }`) does not copy it — and a wrapper that does not carry
   * the third argument must not carry the declaration either.
   */
  get writeOptions(): readonly MemoryWriteOptionName[] | undefined {
    return this.writeOptionsRefusal === undefined ? AGENTCORE_WRITE_OPTIONS : undefined;
  }

  private readonly client: AgentCoreLikeClient;
  private readonly memoryId: string;
  private readonly pageSize: number;
  private readonly searchNamespace: (scope: {
    actorId: string;
    sessionId: string;
    identity: MemoryIdentity;
    namespaceScope?: Readonly<Record<string, string>>;
  }) => string;
  private readonly searchStrategyId: string | undefined;
  private readonly requireNamespaceScope: boolean;
  /**
   * Set by the first write or search that carries a scope: from then on this
   * store is a SCOPED store, and a call without one is refused — a second
   * memory, a `defineRAG` or a direct call that forgot its scope never reads
   * or files across the tenants the first one kept apart.
   */
  private servedScoped = false;
  private readonly searchAcrossPrincipals: boolean;
  /** Why the write options cannot be honoured — `undefined` when they can. */
  private readonly writeOptionsRefusal: string | undefined;
  private closed = false;

  // In-process shadow state for things AgentCore doesn't surface natively.
  private readonly signatures = new Map<string, Set<string>>();
  private readonly feedbackBag = new Map<string, { sum: number; count: number }>();

  constructor(options: AgentCoreStoreOptions) {
    if (!options.memoryId) throw new Error('AgentCoreStore requires `memoryId`.');
    this.memoryId = options.memoryId;
    this.pageSize = options.pageSize ?? 100;
    this.searchNamespace =
      options.searchNamespace ??
      (({ actorId, sessionId }) => `/actors/${actorId}/sessions/${sessionId}`);
    this.searchStrategyId = options.searchStrategyId;
    this.requireNamespaceScope = options.requireNamespaceScope === true;
    this.searchAcrossPrincipals = options.searchAcrossPrincipals === true;

    const injected = options._client ?? options.client;
    this.client = injected ?? createAgentCoreClient(options.region, options._sdk);
    this.writeOptionsRefusal =
      this.client.forwardsWriteOptions === true
        ? undefined
        : injected !== undefined
        ? 'its injected client does not declare `forwardsWriteOptions: true`, so it may drop ' +
          "CreateEvent's `extractionMode` / `extractionConfig`. Declare it on the client once it " +
          'forwards both fields unchanged'
        : "the installed `@aws-sdk/client-bedrock-agentcore` does not model CreateEvent's " +
          '`extractionMode` / `extractionConfig`, and its serializer drops a field it does not ' +
          'model. Upgrade the SDK';
  }

  // MemoryIdentity → AgentCore (actorId, sessionId). The actor is the user/tenant; the
  // session is the conversation. Both are derived deterministically, id-safe and
  // INJECTIVELY — see the encoder note above `escapeIdSegment` for why that last word
  // is the whole isolation guarantee and not a tidiness claim.
  private actorId(identity: MemoryIdentity): string {
    // `_` joins the two halves and neither half can contain one (it is escaped),
    // so the join cannot move a field boundary.
    return boundedId(
      `${actorSegment(identity.tenant)}_${actorSegment(identity.principal)}`,
      ACTOR_ID_MAX,
      'actor',
    );
  }
  private sessionId(identity: MemoryIdentity): string {
    // One field, so no joiner — but `sessionId` admits no `/`, so it escapes with
    // `_` instead. `-` stays verbatim in both, which is what keeps a UUID a UUID.
    return boundedId(escapeIdSegment(identity.conversationId, '_'), SESSION_ID_MAX, 'session');
  }
  private scope(identity: MemoryIdentity) {
    assertAddressable(identity);
    return {
      memoryId: this.memoryId,
      actorId: this.actorId(identity),
      sessionId: this.sessionId(identity),
    };
  }
  // The in-process shadow maps (dedup signatures, feedback) are keyed by the
  // SHARED namespace encoder rather than a hand-rolled copy of it: a copy of
  // the tuple layout is a copy of whatever is wrong with it, and this one was
  // a copy of the version where a `/` inside a tenant donated a field boundary
  // — two different identities sharing one dedup set and one feedback bag.
  private shadowKey(identity: MemoryIdentity): string {
    assertAddressable(identity);
    return identityNamespace(identity);
  }
  private feedbackKey(identity: MemoryIdentity, id: string): string {
    return `${this.shadowKey(identity)}::${id}`;
  }

  /** Walk every event in the session (paginated). */
  private async *eachEvent(identity: MemoryIdentity): AsyncGenerator<AgentCoreEvent> {
    let nextToken: string | undefined;
    do {
      const page = await this.client.listEvents({
        ...this.scope(identity),
        maxResults: this.pageSize,
        ...(nextToken !== undefined && { nextToken }),
      });
      for (const ev of page.events) yield ev;
      nextToken = page.nextToken;
    } while (nextToken);
  }

  // ── MemoryStore implementation ──────────────────────────────────

  async get<T = unknown>(identity: MemoryIdentity, id: string): Promise<MemoryEntry<T> | null> {
    this.ensureOpen('get');
    // Append-log: an id may have several events (each update appends one). Last write wins —
    // pick the highest version (ties → last seen), independent of AgentCore's list order.
    let found: MemoryEntry<T> | null = null;
    for await (const ev of this.eachEvent(identity)) {
      if (ev.entry?.id !== id) continue;
      const entry = ev.entry as MemoryEntry<T>;
      if (found === null || (entry.version ?? 0) >= (found.version ?? 0)) found = entry;
    }
    if (found && found.ttl !== undefined && found.ttl <= Date.now()) return null;
    return found;
  }

  async put<T = unknown>(
    identity: MemoryIdentity,
    entry: MemoryEntry<T>,
    options?: MemoryWriteOptions,
  ): Promise<void> {
    this.ensureOpen('put');
    await this.createEvent(identity, entry, this.extractionFields(options));
  }

  /** One event, with the write options already turned into fields (and checked) once. */
  private async createEvent<T>(
    identity: MemoryIdentity,
    entry: MemoryEntry<T>,
    extraction: ReturnType<AgentCoreStore['extractionFields']>,
  ): Promise<void> {
    if (entry.ttl !== undefined && entry.ttl <= Date.now()) return;
    await this.client.createEvent({
      ...this.scope(identity),
      entry: entry as MemoryEntry,
      ...extraction,
    });
  }

  async putMany<T = unknown>(
    identity: MemoryIdentity,
    entries: readonly MemoryEntry<T>[],
    options?: MemoryWriteOptions,
  ): Promise<void> {
    this.ensureOpen('putMany');
    // AgentCore has no batch-write API; per-session events are conceptually ordered, so
    // sequentialize and let the SDK retry policy handle backoff. The options ride
    // every event of the batch — a batch is N writes, each asked the same thing,
    // and turned into fields ONCE, so no await between events can change them.
    if (entries.length === 0) return;
    const extraction = this.extractionFields(options);
    for (const entry of entries) await this.createEvent(identity, entry, extraction);
  }

  /**
   * Emulated optimistic concurrency. AgentCore appends unconditionally; we read-then-write
   * inside a JS critical section — adequate for single-writer-per-session deployments.
   */
  async putIfVersion<T = unknown>(
    identity: MemoryIdentity,
    entry: MemoryEntry<T>,
    expectedVersion: number,
    options?: MemoryWriteOptions,
  ): Promise<PutIfVersionResult> {
    this.ensureOpen('putIfVersion');
    // Refused BEFORE the read, so an unhonoured option never costs a list.
    const extraction = this.extractionFields(options);
    const current = await this.get<T>(identity, entry.id);
    if (current === null) {
      if (expectedVersion !== 0) return { applied: false };
    } else if (current.version !== expectedVersion) {
      return { applied: false, currentVersion: current.version };
    }
    await this.createEvent(identity, entry, extraction);
    return { applied: true };
  }

  /**
   * The namespace one search reads — rendered by `searchNamespace` and refused
   * by name when it could read beyond this identity: a wildcard, a namespace
   * that does not hold the scope segment for segment, or one that stops above
   * this identity's actor while the identity names a principal.
   */
  private namespaceFor(
    identity: MemoryIdentity,
    ids: { readonly actorId: string; readonly sessionId: string },
    given: Readonly<Record<string, string>> | undefined,
  ): string {
    // An empty scope asks for nothing — the same rule writes follow
    // (`requestedWriteOptions`) — so it is treated as no scope at all.
    const copied = given === undefined ? undefined : frozenScope(given);
    const namespaceScope =
      copied === undefined || Object.keys(copied).length === 0 ? undefined : copied;
    if (namespaceScope === undefined && (this.requireNamespaceScope || this.servedScoped)) {
      throw new TypeError(MISSING_SCOPE('search'));
    }
    if (namespaceScope !== undefined) this.servedScoped = true;
    if (namespaceScope !== undefined) checkNamespaceVariables(namespaceScope);
    const render = (scope: Readonly<Record<string, string>> | undefined): string =>
      this.searchNamespace({
        actorId: ids.actorId,
        sessionId: ids.sessionId,
        identity,
        ...(scope !== undefined && { namespaceScope: scope }),
      });
    const namespace = render(namespaceScope);
    assertNamespace(namespace);
    if (namespace.includes('*')) {
      throw new TypeError(
        'AgentCoreStore.search(): `searchNamespace` returned a namespace containing `*`. ' +
          'Results are kept only when they are filed at that namespace or under it, and a ' +
          'wildcard cannot be checked that way — so it is refused rather than matching nothing. ' +
          'Name the namespace exactly.',
      );
    }
    if (namespaceScope !== undefined) assertSearchWithinScope(render, namespace, namespaceScope);
    // The actor is required when the identity names a principal — and on EVERY
    // unscoped search: with no scope to confine it, the actor is the only thing
    // that keeps the read on this identity (a namespace template rendered with
    // no tenant collapses to a prefix every tenant shares).
    // `searchAcrossPrincipals` widens a SCOPED search to the tenant's
    // principals; with no scope there is no tenant to stay inside, so it never
    // lifts the actor requirement there.
    const actorRequired =
      namespaceScope === undefined ||
      (identity.principal !== undefined && !this.searchAcrossPrincipals);
    if (actorRequired && !holdsActor(namespace, ids.actorId)) {
      throw new TypeError(
        'AgentCoreStore.search(): the namespace searched does not hold this identity’s ' +
          '`actorId`, so it would read records AgentCore derived from every principal it ' +
          'covers. Put `{actorId}` in the strategy’s namespace template and in ' +
          '`searchNamespace` (e.g. "/tenants/{tenantid}/actors/{actorId}/facts"), or set ' +
          '`searchAcrossPrincipals: true` if the memory is shared on purpose.',
      );
    }
    return namespace;
  }

  /**
   * The write options as `CreateEvent`'s own fields — or a refusal by name for
   * any this store's client cannot carry. The ONE place the vendor-neutral
   * names become AWS's.
   */
  private extractionFields(options: MemoryWriteOptions | undefined): {
    extractionMode?: 'SKIP';
    extractionConfig?: { readonly namespaceVariables: Readonly<Record<string, string>> };
  } {
    refuseUnhonouredWriteOptions(
      'AgentCoreStore',
      this.writeOptions,
      options,
      this.writeOptionsRefusal ?? '',
    );
    const asked = requestedWriteOptions(options);
    // Copy FIRST, then decide on the copy — the same rule as a search: an empty
    // copy is no scope, whatever the caller's object reported a moment earlier.
    const given = options?.namespaceScope;
    const copied = given === undefined ? undefined : frozenScope(given);
    const scope = copied === undefined || Object.keys(copied).length === 0 ? undefined : copied;
    if (scope === undefined && (this.requireNamespaceScope || this.servedScoped)) {
      throw new TypeError(MISSING_SCOPE('write'));
    }
    if (scope !== undefined) this.servedScoped = true;
    if (scope !== undefined) checkNamespaceVariables(scope);
    return {
      ...(asked.includes('extraction') && { extractionMode: 'SKIP' as const }),
      ...(scope !== undefined && { extractionConfig: { namespaceVariables: scope } }),
    };
  }

  async list<T = unknown>(
    identity: MemoryIdentity,
    options: ListOptions = {},
  ): Promise<ListResult<T>> {
    this.ensureOpen('list');
    const page = await this.client.listEvents({
      ...this.scope(identity),
      maxResults: options.limit ?? this.pageSize,
      ...(options.cursor !== undefined && { nextToken: options.cursor }),
    });
    const out: MemoryEntry<T>[] = [];
    for (const ev of page.events) {
      const entry = ev.entry as MemoryEntry<T> | null;
      if (!entry) continue;
      if (entry.ttl !== undefined && entry.ttl <= Date.now()) continue;
      if (options.tiers && (!entry.tier || !options.tiers.includes(entry.tier))) continue;
      out.push(entry);
    }
    return page.nextToken ? { entries: out, cursor: page.nextToken } : { entries: out };
  }

  async delete(identity: MemoryIdentity, id: string): Promise<void> {
    this.ensureOpen('delete');
    for await (const ev of this.eachEvent(identity)) {
      if (ev.entry?.id === id) {
        await this.client.deleteEvent({ ...this.scope(identity), eventId: ev.eventId });
      }
    }
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

  /** GDPR "everything for this identity, gone." No DeleteSession on AgentCore → delete every event. */
  async forget(identity: MemoryIdentity): Promise<void> {
    this.ensureOpen('forget');
    const ids: string[] = [];
    for await (const ev of this.eachEvent(identity)) ids.push(ev.eventId);
    for (const eventId of ids) await this.client.deleteEvent({ ...this.scope(identity), eventId });
    const shadowKey = this.shadowKey(identity);
    this.signatures.delete(shadowKey);
    for (const key of [...this.feedbackBag.keys()]) {
      if (key.startsWith(`${shadowKey}::`)) this.feedbackBag.delete(key);
    }
  }

  /**
   * Server-side semantic retrieval over AgentCore's extracted memory records
   * (`RetrieveMemoryRecords`).
   *
   * ── Read this before you call it ─────────────────────────────────────────
   * **It takes TEXT, not the vector.** AgentCore embeds and ranks on its own
   * side, so `query` — the port's vector — is unusable here, and the query it
   * actually needs travels in `options.text`. Omit that and this method throws
   * a corrective error naming what is missing, because the alternative is
   * ranking nothing and handing back `[]`, which reads as "no matches" when it
   * really means "wrong query form". Pass both and every store can serve you:
   * local-ranking backends use the vector and ignore the text.
   *
   * **It searches a DIFFERENT population than `list()`.** `list` returns the
   * events this store wrote. This returns the records AgentCore's extraction
   * strategies derived FROM those events — summaries, semantic facts, user
   * preferences. The ids therefore belong to AgentCore, not to entries you
   * `put()`, and `store.get(entry.id)` will not find them. They arrive as
   * entries so ranking code needs no special case, with `metadata.source`
   * saying plainly where they came from, and each value is `{ content }` —
   * the record's text where every memory formatter reads it.
   *
   * Filters: `searchStrategyId` and the namespace reach AgentCore's own side;
   * `k`, `minScore` and `tiers` are applied to what comes back.
   *
   * @throws when `options.text` is absent, or when the client cannot retrieve.
   */
  async search<T = unknown>(
    identity: MemoryIdentity,
    query: readonly number[],
    options: SearchOptions = {},
  ): Promise<readonly ScoredEntry<T>[]> {
    this.ensureOpen('search');
    const text = options.text?.trim();
    if (!text) {
      throw new Error(
        'AgentCoreStore.search() needs the query as TEXT, in `options.text`.\n' +
          `  AgentCore embeds and ranks server-side (RetrieveMemoryRecords), so the ${query.length}-dimension\n` +
          '  vector this method was handed cannot be sent anywhere — and returning [] would look\n' +
          '  like "no matches" rather than "wrong query form".\n' +
          '  Fix:  store.search(identity, vector, { text: theUserQuestion })\n' +
          '  Backends that rank locally ignore `text`, so passing both is always safe.',
      );
    }
    if (!this.client.retrieveRecords) {
      throw new Error(
        'AgentCoreStore.search() requires a client that implements `retrieveRecords`.\n' +
          '  The built-in client does; a custom or older injected `client` / `_client` may not.',
      );
    }

    const scope = this.scope(identity);
    const k = options.k ?? 10;
    const namespace = this.namespaceFor(identity, scope, options.namespaceScope);
    const page = await this.client.retrieveRecords({
      memoryId: this.memoryId,
      namespace,
      searchQuery: text,
      maxResults: k,
      ...(this.searchStrategyId !== undefined && { memoryStrategyId: this.searchStrategyId }),
    });

    const scored: ScoredEntry<T>[] = [];
    for (const record of page.records) {
      // `namespace` is a PREFIX to AgentCore ("namespaces that start with the
      // provided prefix"), so `/tenants/v1` also returns `/tenants/v12`'s
      // records. Keep only what is filed AT the namespace asked for or under
      // it — and drop a record that names no namespace, which cannot be shown
      // to belong here, or that may be filed under ANOTHER actor (see
      // `filedUnder`).
      if (!filedUnder(record, namespace, scope.actorId)) continue;
      const score = record.score ?? 0;
      if (options.minScore !== undefined && score < options.minScore) continue;
      // AgentCore records carry no tier. A tier filter therefore excludes them
      // all rather than silently ignoring the filter the caller asked for.
      if (options.tiers && options.tiers.length > 0) continue;
      const createdAt = record.createdAt ?? Date.now();
      const entry: MemoryEntry<T> = {
        id: record.memoryRecordId,
        // The store's record shape, `{ content }` — never the bare string.
        // Both prompt formatters read the text off `.content` (the memory
        // flavour as a message, the rag flavour as a passage), so a bare string
        // rendered as an EMPTY block: the record was found and the model never
        // saw it. No `role`: nobody said this; AgentCore derived it.
        // Text only: a client outside the type hands back no non-string.
        value: { content: typeof record.content === 'string' ? record.content : '' } as T,
        version: 1,
        createdAt,
        updatedAt: createdAt,
        lastAccessedAt: Date.now(),
        accessCount: 0,
        metadata: {
          // Says plainly that this did not come from an event this store wrote.
          source: 'agentcore-memory-record',
          ...(record.memoryStrategyId !== undefined && {
            memoryStrategyId: record.memoryStrategyId,
          }),
          ...(record.namespace !== undefined && { namespace: record.namespace }),
        },
      };
      scored.push({ entry, score });
    }
    // AgentCore returns its own ranking; re-sort anyway so the port's
    // "descending by score" holds even if a future API version reorders.
    scored.sort((a, b) =>
      b.score !== a.score ? b.score - a.score : a.entry.id < b.entry.id ? -1 : 1,
    );
    return scored.slice(0, k);
  }

  async close(): Promise<void> {
    if (this.closed) return;
    this.closed = true;
  }

  private ensureOpen(op: string): void {
    if (this.closed) throw new Error(`AgentCoreStore.${op}() called after close().`);
  }
}

// ── Helpers ─────────────────────────────────────────────────────────

// (`fnv1a` lived here to build the hash tail of a truncated id. Truncation is
// gone — see `boundedId` — and with it the only caller.)

/** The slice of `@aws-sdk/client-bedrock-agentcore` the shim touches. */
export interface BedrockAgentCoreSdkModule {
  readonly BedrockAgentCoreClient?: new (config: { region?: string }) => {
    send(cmd: unknown): Promise<unknown>;
  };
  readonly CreateEventCommand?: new (input: unknown) => unknown;
  readonly ListEventsCommand?: new (input: unknown) => unknown;
  readonly DeleteEventCommand?: new (input: unknown) => unknown;
  readonly RetrieveMemoryRecordsCommand?: new (input: unknown) => unknown;
  /**
   * The SDK's own schema of `CreateEventInput` — read only to learn whether this
   * SDK MODELS the extraction fields (see `sdkModelsExtraction`).
   */
  readonly CreateEventInput$?: unknown;
}

/**
 * Does the installed SDK model CreateEvent's `extractionMode` and
 * `extractionConfig`? Its serializer drops a field it does not model, without a
 * word, so an older SDK would accept the write options and send neither.
 *
 * Read off the SDK's own schema of the input (`CreateEventInput$`, whose member
 * names include both in 3.1152.0); anything that cannot be read that way counts
 * as "no" — the options are then refused by name, never sent into a drop.
 */
function sdkModelsExtraction(mod: BedrockAgentCoreSdkModule): boolean {
  const schema = mod.CreateEventInput$;
  if (!Array.isArray(schema)) return false;
  const members = schema.find(
    (part): part is unknown[] => Array.isArray(part) && part.includes('memoryId'),
  );
  return (
    members !== undefined &&
    members.includes('extractionMode') &&
    members.includes('extractionConfig')
  );
}

/**
 * Pull the MemoryEntry out of an AgentCore event's `payload` (a single `blob`
 * document) — this adapter's ONE decode step, and therefore the only place that
 * can tell "no entry here" apart from "an entry nobody can read".
 *
 * ── Why a string is the normal case ──────────────────────────────────────────
 * Entries are written as JSON **text** (see `createEvent` below), so the blob
 * comes back a string and is parsed here. Objects are still accepted: a
 * caller-supplied `client` may hand back a real object, and refusing it would
 * break a seam that never had this problem.
 *
 * Three outcomes, and the middle one is the fix:
 *   • no `blob` in any part → `null`. Nothing claimed to be an entry — AgentCore
 *     writes events of its own into the same log — so it is skipped.
 *   • a blob that cannot be decoded → **throws** {@link UnreadableMemoryEntryError}.
 *     Skipping it would shorten a `list()` by one and read as "that memory was
 *     never stored", which is the silent failure this release exists to end.
 *   • a decodable blob → the entry.
 */
function entryFromPayload(
  payload: unknown,
  event: { eventId: string; sessionId: string },
): MemoryEntry | null {
  if (!Array.isArray(payload)) return null;
  for (const p of payload) {
    if (!p || typeof p !== 'object' || !('blob' in p)) continue;
    const blob = (p as { blob?: unknown }).blob;
    // A part with no blob VALUE is not an entry either — keep looking.
    if (blob === null || blob === undefined) continue;
    if (typeof blob === 'object') return blob as MemoryEntry;
    if (typeof blob === 'string') {
      try {
        const parsed: unknown = JSON.parse(blob);
        if (parsed !== null && typeof parsed === 'object') return parsed as MemoryEntry;
      } catch {
        /* fall through to the refusal, with the ORIGINAL bytes to describe */
      }
    }
    throw new UnreadableMemoryEntryError({ ...event, stored: blob });
  }
  return null;
}

/**
 * Map the entry-semantic `AgentCoreLikeClient` onto the real AgentCore SDK commands.
 * If AWS renames commands, only this function changes.
 */
function createAgentCoreClient(
  region: string | undefined,
  injected?: BedrockAgentCoreSdkModule,
): AgentCoreLikeClient {
  let mod: BedrockAgentCoreSdkModule;
  if (injected) {
    mod = injected;
  } else {
    try {
      mod = lazyRequire<BedrockAgentCoreSdkModule>('@aws-sdk/client-bedrock-agentcore');
    } catch {
      throw new Error(
        'AgentCoreStore requires the `@aws-sdk/client-bedrock-agentcore` peer dependency.\n' +
          '  Install:  npm install @aws-sdk/client-bedrock-agentcore\n' +
          '  Or pass `client` / `_client` for a pre-built or mock client.',
      );
    }
  }
  if (!mod.BedrockAgentCoreClient) {
    throw new Error(
      'AgentCoreStore: `@aws-sdk/client-bedrock-agentcore` is installed but ' +
        '`BedrockAgentCoreClient` was not found. Update the SDK.',
    );
  }
  const sdk = new mod.BedrockAgentCoreClient({ ...(region && { region }) });

  const send = async (
    Ctor: (new (i: unknown) => unknown) | undefined,
    name: string,
    input: unknown,
  ) => {
    if (!Ctor) {
      throw new Error(
        `AgentCoreStore: \`@aws-sdk/client-bedrock-agentcore\` is missing ${name}. Upgrade the SDK.`,
      );
    }
    return sdk.send(new Ctor(input));
  };

  return {
    // The two extraction fields below are forwarded as they are — but only an
    // SDK that MODELS them sends them, so the declaration follows the SDK.
    ...(sdkModelsExtraction(mod) && { forwardsWriteOptions: true as const }),
    async createEvent({ memoryId, actorId, sessionId, entry, extractionMode, extractionConfig }) {
      // The entry is stored as a single `blob` document (PayloadType.blob =
      // __DocumentType), and it goes in as JSON TEXT, not as the object.
      // Field-learned on the session store and true of every blob this service
      // holds: hand it an object and it stores its own host language's
      // `toString()` rendering — `{id=m-1, value={...}}` — and returns THAT
      // string, which is not JSON and cannot be turned back into an entry. A
      // `MemoryEntry` is defined as something a store can hold (the port's
      // stores round-trip it through JSON already), so the encoding is ours to
      // pick and the honest pick is the one whose bytes come back unchanged.
      await send(mod.CreateEventCommand, 'CreateEventCommand', {
        memoryId,
        actorId,
        sessionId,
        eventTimestamp: new Date(),
        payload: [{ blob: JSON.stringify(entry) }],
        // `CreateEventInput`'s own names (`ExtractionMode.SKIP`,
        // `ExtractionConfig.namespaceVariables`), present only when asked —
        // an event without them is extracted exactly as before.
        ...(extractionMode !== undefined && { extractionMode }),
        ...(extractionConfig !== undefined && {
          extractionConfig: { namespaceVariables: { ...extractionConfig.namespaceVariables } },
        }),
      });
    },
    async listEvents({ memoryId, actorId, sessionId, maxResults, nextToken }) {
      const r = (await send(mod.ListEventsCommand, 'ListEventsCommand', {
        memoryId,
        actorId,
        sessionId,
        includePayloads: true,
        ...(maxResults !== undefined && { maxResults }),
        ...(nextToken !== undefined && { nextToken }),
      })) as {
        events?: ReadonlyArray<{ eventId?: string; payload?: unknown }>;
        nextToken?: string;
      } | null;
      const events: AgentCoreEvent[] = (r?.events ?? []).map((ev) => {
        const eventId = ev.eventId ?? '';
        // A page containing one unreadable entry fails the READ. Returning the
        // rest would be a list that is quietly one memory short, which is the
        // shape of the failure nobody notices.
        return { eventId, entry: entryFromPayload(ev.payload, { eventId, sessionId }) };
      });
      return r?.nextToken ? { events, nextToken: r.nextToken } : { events };
    },
    async deleteEvent({ memoryId, actorId, sessionId, eventId }) {
      await send(mod.DeleteEventCommand, 'DeleteEventCommand', {
        memoryId,
        actorId,
        sessionId,
        eventId,
      });
    },
    async retrieveRecords({ memoryId, namespace, searchQuery, maxResults, memoryStrategyId }) {
      // AgentCore nests the query under `searchCriteria`; the strategy id is the
      // metadata filter that reaches its side rather than being applied after.
      const r = (await send(mod.RetrieveMemoryRecordsCommand, 'RetrieveMemoryRecordsCommand', {
        memoryId,
        namespace,
        searchCriteria: {
          searchQuery,
          ...(maxResults !== undefined && { topK: maxResults }),
          ...(memoryStrategyId !== undefined && { memoryStrategyId }),
        },
        ...(maxResults !== undefined && { maxResults }),
      })) as {
        memoryRecordSummaries?: ReadonlyArray<{
          memoryRecordId?: string;
          content?: { text?: string } | string;
          score?: number;
          memoryStrategyId?: string;
          // `MemoryRecordSummary.namespaces` is the SDK's field; `namespace`
          // is read too, for a client that answers in that shape.
          namespaces?: readonly string[];
          namespace?: string | readonly string[];
          createdAt?: string | number | Date;
        }>;
      } | null;
      const records: AgentCoreMemoryRecord[] = (r?.memoryRecordSummaries ?? []).map((s) => {
        const content = typeof s.content === 'string' ? s.content : s.content?.text ?? '';
        const namespaces = (
          Array.isArray(s.namespaces)
            ? s.namespaces
            : Array.isArray(s.namespace)
            ? s.namespace
            : typeof s.namespace === 'string'
            ? [s.namespace]
            : []
        ).filter((n): n is string => typeof n === 'string');
        const namespaceValue = namespaces[0];
        const createdAt =
          s.createdAt === undefined ? undefined : new Date(s.createdAt as string).getTime();
        return {
          memoryRecordId: s.memoryRecordId ?? '',
          content,
          ...(typeof s.score === 'number' && { score: s.score }),
          ...(s.memoryStrategyId !== undefined && { memoryStrategyId: s.memoryStrategyId }),
          ...(typeof namespaceValue === 'string' && { namespace: namespaceValue }),
          ...(namespaces.length > 0 && { namespaces }),
          ...(createdAt !== undefined && Number.isFinite(createdAt) && { createdAt }),
        };
      });
      return { records };
    },
  };
}

/** A namespace compared as a path: repeated `/` collapsed, a trailing one dropped. */
function pathOf(namespace: string): string {
  return namespace.replace(/\/{2,}/g, '/').replace(/\/$/, '');
}

/** What the start of another actor's id extending this one looks like. */
const ACTOR_ESCAPE_AHEAD = /^[0-9A-F]{4}/;

/**
 * Is `record` filed AT `asked` or under it? Compared on whole path segments —
 * repeated and trailing `/` ignored on both sides — because AgentCore's
 * `namespace` filter is a string prefix, and `/tenants/v1` must not admit
 * `/tenants/v12`.
 *
 * One more case, because an actor id can hold a `/`: its escape is `/` + four
 * hex digits (`bob@x.com` → `bob/0040x/002Ecom`), so another actor's id can
 * EXTEND this one by whole segments (`bob@x.com.au` adds `/002Eau`). When the
 * namespace asked for ends with this identity's `actorId`, a record filed under
 * a continuation that starts with four uppercase hex digits may be that other
 * actor's — and is dropped. A sub-namespace of your own that starts that way
 * is dropped too (put a literal segment after `{actorId}`), never served across
 * actors. That literal must not itself start with four uppercase hex digits,
 * or the guard cannot tell it from another actor's id.
 */
function filedUnder(record: AgentCoreMemoryRecord, asked: string, actorId: string): boolean {
  const base = pathOf(asked);
  const guardActor = base.endsWith(actorId);
  const filed = record.namespaces ?? (record.namespace !== undefined ? [record.namespace] : []);
  return filed.some((ns) => {
    const n = pathOf(ns);
    if (n === base) return true;
    if (!n.startsWith(`${base}/`)) return false;
    return !(guardActor && ACTOR_ESCAPE_AHEAD.test(n.slice(base.length + 1)));
  });
}
