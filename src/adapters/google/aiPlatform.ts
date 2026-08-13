/**
 * adapters/google/aiPlatform — the one place this package builds a Vertex AI
 * REST client, names a Vertex resource, waits on a Vertex operation, or
 * describes a Vertex failure.
 *
 * Three adapters sit on top of it — `agentEngineSessions`, `memoryBankStore`
 * and (for its auth half only) `googleIdentity` — and none of them repeats any
 * of the four things above. That is the whole reason this file exists: the AWS
 * column learned, expensively, that a shim duplicated across three adapters is
 * three places for the same wire fact to go stale, and only one of them gets
 * fixed.
 *
 * ── Which client, and why THIS one ──────────────────────────────────────────
 * `@googleapis/aiplatform` — the **split, per-API** discovery package (31.0.0,
 * 27 MB) rather than the `googleapis` mega-package (174.0.1, 209 MB) that
 * carries every Google API at once for the same generated code. Both were
 * installed and measured before this was written.
 *
 * The gax/proto client (`@google-cloud/aiplatform`, 78 MB) was rejected on a
 * fact rather than on size: its Memory Bank surface is **v1beta1 only**, while
 * the REST **v1** surface is complete — `memories.purge` and `memories.rollback`
 * exist at v1 and do not exist at v1beta1. One client, at the version that has
 * everything, beats two clients at two versions.
 *
 * `@google-cloud/vertexai` is past its own announced removal date and is not
 * loaded anywhere in this package, ever.
 *
 * ── The endpoint fact that is not in anybody's design doc ───────────────────
 * The generated client defaults to `https://aiplatform.googleapis.com/` — the
 * GLOBAL host. Reasoning engines, their sessions and their memories are
 * **regional** resources. An adapter that accepts the default calls the wrong
 * host and gets a 404 that reads exactly like "your resource does not exist".
 * So {@link buildAiPlatformClient} always sets a regional `rootUrl`, derived
 * from the same `location` that composes the resource name, and the surface pin
 * asserts the default really is the global one so this comment cannot go stale
 * quietly.
 *
 * ── Secrets ─────────────────────────────────────────────────────────────────
 * {@link googleSdkFailure} is the `sdkFailure` law from the AWS identity
 * adapter, re-aimed at a Gaxios error: the SDK's own message never comes
 * through. It is not that a Vertex error always contains a secret — it is that
 * a REST client echoes the request into failure text, our requests carry
 * conversation state and access tokens, and an error message here reaches the
 * model as a tool result AND rides the event stream to every sink attached.
 * One echo publishes it to both at once.
 */

import { lazyRequire } from '../../lib/lazyRequire.js';

// ─── The slice of the SDK these adapters actually touch ──────────────

/**
 * One REST call's answer. The discovery clients wrap every response as
 * `{ data }`, and that wrapper is part of the contract an injected `_client`
 * has to honour.
 */
export interface RestResponse<T> {
  readonly data: T;
}

/** A long-running operation, as these adapters read it. */
export interface LongRunningOperation {
  readonly name?: string | null;
  readonly done?: boolean | null;
  readonly error?: { readonly code?: number | null; readonly message?: string | null } | null;
  readonly response?: Record<string, unknown> | null;
}

/** The `operations` sub-resource, which both collections carry identically. */
export interface OperationsApi {
  /**
   * Block server-side until the operation finishes or `timeout` elapses, then
   * answer whatever state it is in.
   *
   * `wait` rather than a `get` poll loop: it is the operation the service
   * publishes for exactly this, and it turns "poll every 200 ms for ten
   * seconds" into one or two round trips. It may still answer un-done, so
   * {@link awaitOperation} loops it against a deadline — a server-side wait is
   * not a promise that the work is finished, and treating it as one is how an
   * adapter reads a resource that is not there yet.
   */
  wait(params: {
    name: string;
    timeout?: string;
  }): Promise<RestResponse<LongRunningOperation> | undefined>;
}

/** A Vertex `Session`, in the fields these adapters read or write. */
export interface VertexSession {
  readonly name?: string | null;
  readonly userId?: string | null;
  readonly sessionState?: Record<string, unknown> | null;
  readonly createTime?: string | null;
  readonly updateTime?: string | null;
  readonly expireTime?: string | null;
  readonly ttl?: string | null;
}

/** The `sessions` collection. Every method here is pinned. */
export interface SessionsApi {
  create(params: {
    parent: string;
    sessionId?: string;
    requestBody: VertexSession;
  }): Promise<RestResponse<LongRunningOperation> | undefined>;
  get(params: { name: string }): Promise<RestResponse<VertexSession> | undefined>;
  patch(params: {
    name: string;
    updateMask?: string;
    requestBody: VertexSession;
  }): Promise<RestResponse<VertexSession> | undefined>;
  delete(params: { name: string }): Promise<RestResponse<LongRunningOperation> | undefined>;
  list(params: {
    parent: string;
    filter?: string;
    orderBy?: string;
    pageSize?: number;
    pageToken?: string;
  }): Promise<
    RestResponse<{ sessions?: VertexSession[]; nextPageToken?: string | null }> | undefined
  >;
  readonly operations: OperationsApi;
}

/** One typed metadata scalar. Memory Bank's metadata map is NOT free JSON. */
export interface VertexMemoryMetadataValue {
  readonly stringValue?: string | null;
  readonly doubleValue?: number | null;
  readonly boolValue?: boolean | null;
  readonly timestampValue?: string | null;
}

/** A Vertex `Memory`, in the fields these adapters read or write. */
export interface VertexMemory {
  readonly name?: string | null;
  readonly fact?: string | null;
  readonly scope?: Record<string, string> | null;
  readonly metadata?: Record<string, VertexMemoryMetadataValue> | null;
  readonly createTime?: string | null;
  readonly updateTime?: string | null;
  readonly expireTime?: string | null;
  readonly ttl?: string | null;
}

/** One row of a retrieval answer — and the whole ranking trap in two fields. */
export interface VertexRetrievedMemory {
  /**
   * **A DISTANCE. Smaller is closer.** The SDK's own words for this field are
   * "the distance between the query and the retrieved Memory. Smaller values
   * indicate more similar memories."
   *
   * The port's `ScoredEntry.score` is a cosine similarity, where HIGHER is
   * closer. These two facts are the silent-inversion trap this column was
   * warned about, and the type says so here so that nothing downstream can
   * copy it into a `score` field by looking only at its shape.
   *
   * Only set when similarity search was used; a simple retrieval has no
   * ranking at all and reports none.
   */
  readonly distance?: number | null;
  readonly memory?: VertexMemory;
}

/** The `memories` collection. Every method here is pinned. */
export interface MemoriesApi {
  create(params: {
    parent: string;
    memoryId?: string;
    requestBody: VertexMemory;
  }): Promise<RestResponse<LongRunningOperation> | undefined>;
  get(params: { name: string }): Promise<RestResponse<VertexMemory> | undefined>;
  patch(params: {
    name: string;
    updateMask?: string;
    requestBody: VertexMemory;
  }): Promise<RestResponse<LongRunningOperation> | undefined>;
  delete(params: { name: string }): Promise<RestResponse<LongRunningOperation> | undefined>;
  list(params: {
    parent: string;
    filter?: string;
    pageSize?: number;
    pageToken?: string;
  }): Promise<
    RestResponse<{ memories?: VertexMemory[]; nextPageToken?: string | null }> | undefined
  >;
  retrieve(params: {
    parent: string;
    requestBody: {
      scope: Record<string, string>;
      similaritySearchParams?: { searchQuery: string; topK?: number };
      simpleRetrievalParams?: { pageSize?: number; pageToken?: string };
    };
  }): Promise<
    | RestResponse<{
        retrievedMemories?: VertexRetrievedMemory[];
        nextPageToken?: string | null;
      }>
    | undefined
  >;
  readonly operations: OperationsApi;
}

/**
 * The shape both adapters call, and the shape an injected `_client` must have.
 *
 * It is the SDK's own nesting rather than a flattened convenience surface, on
 * purpose: the surface pin walks these exact property paths against the really
 * installed package, and a flattened shim would move the names being checked
 * out of the file that does the calling.
 */
export interface AiPlatformClientLike {
  readonly projects: {
    readonly locations: {
      readonly reasoningEngines: {
        readonly sessions: SessionsApi;
        readonly memories: MemoriesApi;
      };
    };
  };
}

/** The slice of `@googleapis/aiplatform` this module loads. */
export interface AiPlatformSdkModule {
  readonly aiplatform?: (options: {
    version: string;
    rootUrl?: string;
    auth?: unknown;
  }) => AiPlatformClientLike;
  readonly auth?: { readonly GoogleAuth?: new (options: unknown) => unknown };
}

// ─── Connection ──────────────────────────────────────────────────────

/**
 * The API version every adapter in this column dials, **stated rather than
 * defaulted**.
 *
 * v1, not v1beta1, and that is a decision with evidence behind it: at v1 the
 * memories collection carries `purge` and `rollback`; at v1beta1 it does not.
 * The Google column's pin asserts this against the installed package on every
 * test run, because "which version does this really call" is the question that
 * made the pin exist.
 */
export const AI_PLATFORM_API_VERSION = 'v1' as const;

/** The OAuth scope every Vertex data-plane call needs. */
export const CLOUD_PLATFORM_SCOPE = 'https://www.googleapis.com/auth/cloud-platform';

/** What every adapter in this column needs to reach one reasoning engine. */
export interface AiPlatformConnection {
  /**
   * The Google Cloud project. Read from `GOOGLE_CLOUD_PROJECT` when omitted;
   * refused by name when neither is available, because a project guessed wrong
   * is a 404 that reads like a missing resource.
   */
  readonly project?: string;
  /**
   * The region, e.g. `'us-central1'`. **Load-bearing twice over:** it composes
   * the resource name AND selects the regional host. There is no default — a
   * guess here calls the wrong continent.
   */
  readonly location: string;
  /**
   * The reasoning engine these sessions or memories live under: either the
   * bare id (`'1234567890'`) or a full resource name
   * (`'projects/p/locations/l/reasoningEngines/1234567890'`), in which case
   * the project and location are read from it and need not be repeated.
   *
   * A reasoning engine resource is REQUIRED even when you deploy no code to
   * it: sessions and memories are children of it, and there is nowhere else to
   * put them. Creating one is a control-plane job this library does not do.
   */
  readonly reasoningEngine: string;
  /**
   * Credentials. Anything the discovery client accepts — a `GoogleAuth`, an
   * `OAuth2Client`, an `Impersonated`. Omit and Application Default
   * Credentials are used with the cloud-platform scope, which is the ordinary
   * path on Cloud Run, GKE, or a developer machine that has run
   * `gcloud auth application-default login`.
   */
  readonly auth?: unknown;
  /**
   * @internal Test seam — a pre-built client. Skips the SDK load entirely, so
   * a suite never needs the package installed or a credential configured.
   */
  readonly _client?: AiPlatformClientLike;
  /** @internal Test seam — the SDK module, to exercise the real construction. */
  readonly _sdk?: AiPlatformSdkModule;
}

/** A resolved engine: the parent resource name, plus the pieces it was built from. */
export interface EngineScope {
  readonly project: string;
  readonly location: string;
  readonly engineId: string;
  /** `projects/{project}/locations/{location}/reasoningEngines/{engine}` */
  readonly parent: string;
}

const ENGINE_NAME = /^projects\/([^/]+)\/locations\/([^/]+)\/reasoningEngines\/([^/]+)$/;

/**
 * Work out which reasoning engine this adapter talks to, from either spelling
 * of `reasoningEngine`.
 *
 * A full resource name wins over `project` / `location` and is CHECKED against
 * them rather than silently overriding: two spellings of one fact that could
 * disagree is the same law the builder refuses `agent` beside `agentFactory`
 * under, and a name that says `us-central1` under a config that says
 * `europe-west4` is a bug somebody should be told about, not arbitrated.
 */
export function resolveEngine(adapter: string, connection: AiPlatformConnection): EngineScope {
  const { reasoningEngine, location } = connection;
  if (typeof reasoningEngine !== 'string' || reasoningEngine.trim() === '') {
    throw new TypeError(
      `${adapter} requires 'reasoningEngine' — the id of the Agent Runtime resource these ` +
        `live under, or its full resource name.\n` +
        `  Sessions and memories are CHILDREN of a reasoning engine; there is nowhere else ` +
        `to put them, so one has to exist even if you deploy no code to it.\n` +
        `  Creating it is a control-plane job (gcloud / Terraform / the console) that this ` +
        `library deliberately does not do.`,
    );
  }

  const match = ENGINE_NAME.exec(reasoningEngine.trim());
  if (match) {
    const [, project, engineLocation, engineId] = match as unknown as [
      string,
      string,
      string,
      string,
    ];
    if (connection.project !== undefined && connection.project !== project) {
      throw new TypeError(
        `${adapter}: 'reasoningEngine' names project '${project}' but 'project' says ` +
          `'${connection.project}'. Two spellings of one fact that disagree are refused rather ` +
          `than arbitrated — drop one of them.`,
      );
    }
    if (location !== undefined && location !== engineLocation) {
      throw new TypeError(
        `${adapter}: 'reasoningEngine' names location '${engineLocation}' but 'location' says ` +
          `'${location}'. The location picks the regional host as well as the resource name, ` +
          `so a mismatch would call one region for a resource that lives in another. Drop one.`,
      );
    }
    return { project, location: engineLocation, engineId, parent: reasoningEngine.trim() };
  }

  const project = connection.project ?? readEnv('GOOGLE_CLOUD_PROJECT');
  if (project === undefined || project === '') {
    throw new TypeError(
      `${adapter} requires 'project' — no project was configured and GOOGLE_CLOUD_PROJECT is ` +
        `not set.\n` +
        `  Pass it, set the environment variable, or give 'reasoningEngine' as a full resource ` +
        `name ('projects/…/locations/…/reasoningEngines/…'), which carries the project with it.`,
    );
  }
  if (typeof location !== 'string' || location.trim() === '') {
    throw new TypeError(
      `${adapter} requires 'location' (e.g. 'us-central1'). There is no default, on purpose: ` +
        `it selects the REGIONAL API host as well as composing the resource name, so a guess ` +
        `does not fail — it calls a different region and answers "not found".`,
    );
  }
  const engineId = reasoningEngine.trim();
  return {
    project,
    location: location.trim(),
    engineId,
    parent: `projects/${project}/locations/${location.trim()}/reasoningEngines/${engineId}`,
  };
}

/** `process.env` without assuming `process` exists (browser bundles do not have one). */
function readEnv(name: string): string | undefined {
  return typeof process !== 'undefined' && process.env ? process.env[name] : undefined;
}

/**
 * The regional host for a location.
 *
 * See the module header: the client's own default is the global host, and
 * these resources are regional. This is the fix, in one line, applied at every
 * construction.
 */
export function regionalRootUrl(location: string): string {
  return `https://${location}-aiplatform.googleapis.com/`;
}

/**
 * Build the REST client, or refuse by name.
 *
 * An injected `_client` short-circuits everything below it, which is how every
 * test in this column runs with no package installed and no credential.
 */
export function buildAiPlatformClient(
  adapter: string,
  connection: AiPlatformConnection,
  scope: EngineScope,
): AiPlatformClientLike {
  if (connection._client) return connection._client;

  let mod: AiPlatformSdkModule;
  if (connection._sdk) {
    mod = connection._sdk;
  } else {
    try {
      mod = lazyRequire<AiPlatformSdkModule>('@googleapis/aiplatform');
    } catch {
      throw new Error(
        `${adapter} requires the \`@googleapis/aiplatform\` peer dependency.\n` +
          `  Install:  npm install @googleapis/aiplatform\n` +
          `  It is the SPLIT per-API package (~27 MB), not the \`googleapis\` mega-package ` +
          `(~209 MB) that carries every Google API for the same generated code.\n` +
          `  It is optional and loaded only when you construct this adapter, so nothing else ` +
          `in this library pays for it.`,
      );
    }
  }
  if (typeof mod.aiplatform !== 'function') {
    throw new Error(
      `${adapter}: \`@googleapis/aiplatform\` is installed but exports no \`aiplatform\` ` +
        `factory. This adapter is built against the 31.x package — update it, or pass a ` +
        `pre-built client.`,
    );
  }

  const auth = connection.auth ?? defaultAuth(adapter, mod);
  return mod.aiplatform({
    version: AI_PLATFORM_API_VERSION,
    // Never the client's global default — see the module header.
    rootUrl: regionalRootUrl(scope.location),
    auth,
  });
}

/**
 * Application Default Credentials, from the SDK's own re-exported auth surface.
 *
 * Taken from `@googleapis/aiplatform` rather than by loading
 * `google-auth-library` separately: the package already carries it, and one
 * load is one version to reason about instead of two that can drift apart.
 */
function defaultAuth(adapter: string, mod: AiPlatformSdkModule): unknown {
  const GoogleAuth = mod.auth?.GoogleAuth;
  if (typeof GoogleAuth !== 'function') {
    throw new Error(
      `${adapter}: \`@googleapis/aiplatform\` exposes no \`auth.GoogleAuth\`, so Application ` +
        `Default Credentials cannot be resolved.\n` +
        `  Pass 'auth' with your own GoogleAuth / OAuth2Client, or update the package.`,
    );
  }
  return new GoogleAuth({ scopes: [CLOUD_PLATFORM_SCOPE] });
}

// ─── Long-running operations ─────────────────────────────────────────

/** How long {@link awaitOperation} keeps waiting before it refuses, by default. */
export const DEFAULT_OPERATION_TIMEOUT_MS = 30_000;

/** One server-side wait, in the duration spelling the API takes. */
const WAIT_SLICE = '10s';

/**
 * Wait for a long-running operation to finish, or refuse by name.
 *
 * ── Why any of this exists ──────────────────────────────────────────────────
 * `sessions.create`, `sessions.delete`, `memories.create`, `memories.patch`
 * and `memories.delete` **all answer with an Operation, not with the resource**
 * — verified against the installed package's own return types before a line of
 * either adapter was written. `get`, `list`, `patch`-on-a-session and
 * `retrieve` are the synchronous ones.
 *
 * That asymmetry is the trap: a `put` that returns as soon as the service
 * accepts the request, followed by a `get`, is a race that passes on a warm
 * day and fails under load — and fails by answering "no data", which is
 * indistinguishable from the truth. So every write in this column goes through
 * here and does not return until the service says `done`.
 *
 * An operation that finished with an error is raised as one. The operation's
 * own message is a Google-side description of OUR request, so it is subject to
 * the same secrecy law as everything else here: the code comes through, the
 * text does not.
 */
export async function awaitOperation(
  adapter: string,
  operations: OperationsApi,
  operation: LongRunningOperation | undefined,
  what: string,
  timeoutMs: number = DEFAULT_OPERATION_TIMEOUT_MS,
): Promise<void> {
  if (operation === undefined) return;
  // Some services answer an already-finished operation on the first call. That
  // is the common case for a small write, and it costs no round trip.
  if (operation.done === true) {
    throwIfOperationFailed(adapter, operation, what);
    return;
  }
  const name = operation.name;
  if (typeof name !== 'string' || name === '') {
    // Nothing to wait ON. Answering as though the write had landed would be
    // exactly the silent success this whole function exists to prevent.
    throw operationError(
      `${adapter}: ${what} was accepted but the service returned an operation with no name, ` +
        `so there is nothing to wait on and no way to confirm the write landed.\n` +
        `  Refusing rather than reporting a success this adapter cannot verify.`,
    );
  }

  const deadline = Date.now() + Math.max(0, timeoutMs);
  let current: LongRunningOperation = operation;
  while (current.done !== true) {
    if (Date.now() >= deadline) {
      throw operationError(
        `${adapter}: ${what} did not finish within ${timeoutMs}ms.\n` +
          `  The operation is still running on Google's side — it may yet succeed — but this ` +
          `call will not report a write it has not seen land.\n` +
          `  Raise the adapter's 'operationTimeoutMs' if your engine is routinely slower.`,
      );
    }
    const answer = await operations.wait({ name, timeout: WAIT_SLICE });
    current = answer?.data ?? {};
  }
  throwIfOperationFailed(adapter, current, what);
}

function throwIfOperationFailed(
  adapter: string,
  operation: LongRunningOperation,
  what: string,
): void {
  const error = operation.error;
  if (error === null || error === undefined) return;
  const code = typeof error.code === 'number' ? ` (code ${error.code})` : '';
  throw operationError(
    `${adapter}: ${what} failed${code}.\n` +
      `  The operation's own message is withheld: it is Google's description of OUR request, ` +
      `and this request carried conversation state. Check Cloud Logging for the full text.`,
  );
}

/**
 * The name every refusal from this function carries.
 *
 * It exists so a caller's `catch` can tell "the operation went wrong" — which
 * is already sanitized and already says what to do — apart from "the transport
 * went wrong", which still needs {@link googleSdkFailure} run over it. Without
 * the distinction an adapter re-wraps its own refusal and replaces a precise
 * diagnosis ("did not finish within 30000ms") with a generic one.
 */
export const OPERATION_ERROR_NAME = 'GoogleOperationError';

function operationError(message: string): Error {
  const err = new Error(message);
  err.name = OPERATION_ERROR_NAME;
  return err;
}

/**
 * Has this error already been sanitized by this module? Used by every adapter's
 * `catch` so a refusal is reported once rather than wrapped twice.
 */
export function isSanitizedGoogleError(err: unknown): boolean {
  return (
    err instanceof Error && (err.name === OPERATION_ERROR_NAME || err.name === 'GoogleApiError')
  );
}

// ─── Failures ────────────────────────────────────────────────────────

/**
 * Re-raise a failed REST call **without its text** — the `sdkFailure` law from
 * the AWS identity adapter, re-aimed at a Gaxios error.
 *
 * What comes through is the part that is both safe and actionable: which
 * operation failed and the HTTP status. What does not is the message, because
 * a REST client echoes the request into its failure text and these requests
 * carry a whole conversation's state, a user id, and an access token in the
 * headers. A thrown message here reaches the LLM as a tool result AND rides the
 * event stream to every sink attached to the agent.
 *
 * **The original is deliberately not attached as `cause`** — a cause travels
 * with the error into every serializer that walks own properties, which would
 * undo all of this in one `JSON.stringify`.
 */
export function googleSdkFailure(adapter: string, operation: string, err: unknown): Error {
  const status = httpStatusOf(err);
  const failure = new Error(
    `${adapter}: ${operation} failed` +
      (status === undefined ? '' : ` (HTTP ${status})`) +
      `.\n  The SDK's own message is withheld: this request carried session state and an ` +
      `access token, and REST clients echo request detail into failure text. Check Cloud ` +
      `Logging for the full error.`,
  );
  failure.name = 'GoogleApiError';
  return failure;
}

/**
 * The HTTP status of a failed call, wherever this client happened to put it.
 *
 * Three places rather than one because the client reports a transport failure,
 * an API error and a thrown `GaxiosError` slightly differently, and a
 * classification that only reads one of them silently stops classifying the
 * day the client is upgraded.
 */
export function httpStatusOf(err: unknown): number | undefined {
  const e = err as
    | { code?: unknown; status?: unknown; response?: { status?: unknown } }
    | null
    | undefined;
  if (e === null || typeof e !== 'object') return undefined;
  for (const candidate of [e.status, e.code, e.response?.status]) {
    if (typeof candidate === 'number' && Number.isFinite(candidate)) return candidate;
    // Gaxios sometimes reports the status as a numeric STRING.
    if (typeof candidate === 'string' && /^\d{3}$/.test(candidate)) return Number(candidate);
  }
  return undefined;
}

/** Is this the service's "no such resource"? */
export function isNotFound(err: unknown): boolean {
  return httpStatusOf(err) === 404;
}

/** Is this "a resource by that name already exists"? */
export function isAlreadyExists(err: unknown): boolean {
  return httpStatusOf(err) === 409;
}

// ─── Ids ─────────────────────────────────────────────────────────────

/** The longest a resource id may be in both collections this column writes to. */
export const MAX_RESOURCE_ID_LENGTH = 63;

/**
 * The id grammar this column really has to satisfy — the INTERSECTION of the
 * two documented rules, so one function is right for both callers and neither
 * has to remember which is stricter: `[a-z0-9-]`, first character a letter,
 * last character a letter or a digit.
 *
 * Exported so the surface pin can hold it against the installed package's own
 * words rather than against this file's memory of them.
 */
export const LEGAL_RESOURCE_ID = /^[a-z]$|^[a-z][a-z0-9-]*[a-z0-9]$/;

/**
 * Turn caller data into a resource id the service will accept — and never into
 * a DIFFERENT caller's id.
 *
 * ── The grammar, quoted rather than guessed ─────────────────────────────────
 * This function used to state that "Vertex resource ids accept `[A-Za-z0-9_-]`".
 * That is a Google-wide habit and it is not what either collection this column
 * writes to documents. From the installed package (`@googleapis/aiplatform`
 * 31.0.0, `build/v1.d.ts`), verbatim:
 *
 *   `memoryId`  — "This value may be up to 63 characters, and valid characters
 *                 are `[a-z0-9-]`. The first character must be a letter, and
 *                 the last character must be a letter or number."
 *   `sessionId` — "This value may be up to 63 characters, and valid characters
 *                 are `[a-z0-9-]`. The first and last characters must be a
 *                 letter or number."
 *
 * So UPPERCASE and `_` are illegal in both, and a leading digit is illegal for
 * a memory. Under the old grammar a UUID entry id (leading digit) and a ULID
 * session id (uppercase Crockford base32) — two of the most ordinary id shapes
 * there are — went to the wire unchanged, to be refused by Google with a 400
 * whose text {@link googleSdkFailure} then withholds. A grammar error the
 * adapter could have caught locally, delivered as a censored 400, is the one
 * place the secrecy law and the teaching-refusal law collide; the fix is to not
 * send it. The surface pin reads those two sentences out of the installed
 * `.d.ts` and checks them against {@link LEGAL_RESOURCE_ID}, so this cannot
 * drift back to a guess.
 *
 * ── Why a hash and not just a fold ──────────────────────────────────────────
 * Lowercasing and substituting are LOSSY: `Alice` folds onto `alice`, `a_b`
 * onto `a-b`. Two ids that folded together would be ONE row, which is the same
 * silent overwrite this column's addressing law exists to prevent. So the
 * readable fast path is taken only when the caller's id already is a legal id
 * byte for byte; anything the fold touched — or that overruns 63 characters —
 * is carried by a {@link fingerprint} of the ORIGINAL, which keeps distinct
 * inputs distinct.
 */
export function safeResourceId(raw: string, max = MAX_RESOURCE_ID_LENGTH): string {
  const slug = raw.toLowerCase().replace(/[^a-z0-9-]/g, '-');
  if (slug === raw && slug.length <= max && LEGAL_RESOURCE_ID.test(slug)) return slug;
  const suffix = fingerprint(raw);
  const room = max - suffix.length - 1;
  if (room < 2) {
    // Returning something longer than `max` would be a silently invalid id —
    // refused rather than sent, since only a caller of this function can fix it.
    throw new RangeError(
      `safeResourceId: max of ${max} leaves no room for the fingerprint that keeps two ` +
        `folded ids apart. The smallest workable bound is ${suffix.length + 3}.`,
    );
  }
  // `id-` rather than the bare slug: the first character must be a LETTER, and
  // the fold cannot promise one. The fingerprint is base36, so the last
  // character is a letter or a digit by construction — which also makes this
  // function IDEMPOTENT: its own output is a legal id and comes back unchanged.
  // `agentEngineSessions.listByUser` relies on that, since it hands composed
  // resource ids back to callers who feed them to `hydrate`.
  const head = `id-${slug}`.slice(0, room).replace(/-+$/, '');
  return `${head}-${suffix}`;
}

/**
 * A stable fingerprint of a string, in `[0-9a-z-]`.
 *
 * TWO FNV-1a lanes rather than one, because of what this hash is now asked to
 * carry: it is the only thing keeping two ids apart once the fold has run them
 * together, and it is half of how `memoryBankStore` addresses one identity's
 * memories apart from another's. A single 32-bit lane collides at around one
 * chance in a hundred across ten thousand ids, which is too often for either
 * job; two lanes cost one more multiply per character and make it negligible.
 *
 * It is a fingerprint, not a security boundary — a colliding address is still
 * refused by the scope check that runs before every read and every overwrite.
 */
export function fingerprint(value: string): string {
  let a = 0x811c9dc5;
  let b = 0x01000193;
  for (let i = 0; i < value.length; i++) {
    const code = value.charCodeAt(i);
    a = Math.imul(a ^ code, 0x01000193);
    b = Math.imul(b ^ code, 0x85ebca6b);
  }
  return `${(a >>> 0).toString(36)}-${(b >>> 0).toString(36)}`;
}
