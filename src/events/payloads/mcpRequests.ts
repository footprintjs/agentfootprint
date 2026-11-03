// ─── tools.mcp_client — one use of an MCP client pool ────────────────────────

/**
 * One use of an `mcpClientPool` in a run — a listing (`at: 'list'`, filed by the
 * tools slot after `list(ctx)`) or a tool call (`at: 'call'`, filed by the
 * dispatch loop for that call). Ids, digests, evidence and outcomes only: never
 * an identity value, a remote session id or handle, a header value, an
 * argument, a result, a definition or a server's error text. Rides the
 * `agentfootprint.tools.` prefix: a new domain would need a new bridge and
 * wildcard (see the `tools.session_*` note above).
 */
export interface ToolsMcpClientPayload {
  /** The pool's name, which `Tool.source` also carries. */
  readonly server: string;
  readonly at: 'list' | 'call';
  /** At `'call'`. */
  readonly toolCallId?: string;
  /**
   * The tool-session digest of the conversation's key (`hashSessionKey`):
   * enough to join two rows, not enough to name anyone. Absent when the caller
   * named no identity, so there was no key.
   */
  readonly keyHash?: string;
  /** The pool's own random id for the client touched; absent when none was. */
  readonly clientId?: string;
  /** 1 = the key's first client, 2 = its first replacement, … */
  readonly generation?: number;
  /** What happened to the conversation's client. */
  readonly client:
    | 'opened'
    | 'joined'
    | 'reused'
    | 'not-needed'
    | 'refused'
    | 'expired'
    | 'handle-lost';
  /** Why the key's previous client left, when this use opened its replacement. */
  readonly previous?: 'idle' | 'evicted' | 'expired' | 'handle-lost' | 'terminated';
  /** With `'expired'` or `'handle-lost'`: what proves it. */
  readonly evidence?: 'server-404' | 'transport-forgot-handle';
  readonly refusal?:
    | 'pool-full'
    | 'principal-full'
    | 'ending-full'
    | 'init-timeout'
    | 'init-failed'
    | 'no-identity'
    | 'incomplete-identity'
    | 'identity-mismatch'
    | 'stale-tools'
    | 'binding-changed'
    | 'request-unmatched'
    | 'lease-expired'
    | 'operations-full'
    | 'closed';
  /** Opened or joined: how long the open took. */
  readonly initMs?: number;
  /** At `'list'`: a shared entry, or the conversation's own client's list. */
  readonly definitions?: 'shared' | 'listed';
  /** When shared: the entry's age. */
  readonly definitionsAgeMs?: number;
  /** At `'call'`: the call met a replacement client and was checked against its fresh list. */
  readonly revalidated?: 'kept' | 'refused';
}

// ─── tools.request_attempts — an MCP request's retry series ────────────────

/**
 * What one attempt of an MCP request came to.
 *
 *   - `'answered'` — an HTTP response arrived and no retry rule refused it. It
 *     is delivered as it came, WHATEVER its status: a 503 is `answered` with
 *     `status: 503`. A response received is not an operation that succeeded,
 *     so nothing here is called success; read `status`. Nor is it the MCP
 *     call's answer: it records the HTTP exchange. A `202 Accepted`, or a
 *     stream that closes before the call's result, is `answered`, and the
 *     JSON-RPC answer may still never come — the end's `mayHaveRun` says when
 *     the call failed that way.
 *   - `'refused'` — a response the retry policy recognises as a refusal
 *     (`kind`): HTTP 429, or AgentCore Runtime's session-busy reply. It records
 *     the response the server sent, not proof that nothing ran: a 429 says the
 *     request was rate-limited, nothing more (RFC 6585 §4). `effect` says what
 *     is known; `permission` says what allowed asking again.
 *   - `'failed'` — the request threw before an answer arrived (a dropped
 *     connection, a DNS failure). The server may have run it, so it is asked
 *     again only when the app declared that for this tool (`replay`).
 *   - `'timed-out'` — the call's deadline (`maxElapsedMs`) cut the request
 *     while it was in flight.
 *   - `'cut'` — the call was cancelled while the request was in flight: the
 *     run's or the client's signal, the MCP SDK giving it up (its own timeout),
 *     or the call settling first. The request WAS sent; the server may already
 *     have received it and run it. A cut is never a "not run".
 *
 * The last three never had a response, so they carry `remote: 'unknown'`.
 *
 * Every request the series sent is a row, or is counted in `omitted`: the rows
 * and `omitted` together are the requests the series sent. A request that was
 * never sent — the next attempt after a cancelled wait, or anything after a
 * signal that was already aborted — has no row.
 */
export type ToolRequestAttemptOutcome = 'answered' | 'refused' | 'failed' | 'timed-out' | 'cut';

/**
 * How an MCP request ended: its last attempt's outcome — or `'cancelled'`, when
 * the call was cancelled with NO request in flight: while it waited to ask
 * again, or before its first request. Nothing more was sent; every request
 * that was sent has its own row and its own outcome.
 */
export type ToolRequestOutcome = ToolRequestAttemptOutcome | 'cancelled';

/**
 * Whether the server received and ran a request, when that is not known: the
 * attempt ended without a response (`failed`, `timed-out`, `cut`), so the
 * request may have reached the server and run there, or not. The library never
 * records such a request as not run.
 */
export type ToolRequestRemote = 'unknown';

/**
 * Why the request went on after an attempt, or ended with it.
 *
 *   - `'retryable'` — another attempt follows after `waitMs`; `permission`
 *     says what allowed it. The only reason that is not an end.
 *   - `'answered'` — answered; the response is delivered.
 *   - `'exhausted'` — the request has made every attempt it may.
 *   - `'wait-limit'` — the wait would pass the call's total waiting budget
 *     (`maxWaitMs`). A stated `Retry-After` is never shortened to fit: the
 *     refusal is delivered instead.
 *   - `'no-time-left'` — the wait would pass the call's deadline; or the
 *     deadline cut a request or a wait.
 *   - `'not-replayable'` — the request's body cannot be sent twice.
 *   - `'not-retryable'` — the attempt failed without an answer, and nothing
 *     permits asking again after that failure: the app declared no repeat of
 *     this tool on it (`replay`), or it is not a kind the series repeats.
 *   - `'not-permitted'` — refused with a 429, and the policy in force does not
 *     permit asking this tool again on it. Under `'app-authorized'`, only the
 *     app's declaration does: a generic 429 does not prove the server ran
 *     nothing.
 *   - `'changes-without-key'` — the app declared this tool as making changes,
 *     and the call carries no key the server is declared to deduplicate by. It
 *     is never asked again automatically, under any policy.
 *   - `'cancelled'` — the caller's signal ended the request.
 */
export type ToolRequestReason =
  | 'retryable'
  | 'answered'
  | 'exhausted'
  | 'wait-limit'
  | 'no-time-left'
  | 'not-replayable'
  | 'not-retryable'
  | 'not-permitted'
  | 'changes-without-key'
  | 'cancelled';

/** The refusals a retry rule recognises: HTTP 429, and AgentCore Runtime's session-busy reply. */
export type ToolRequestRefusalKind = 'throttle' | 'session-busy';

/**
 * What is known about whether an attempt took effect on the server —
 * footprintjs's effect law (`AttemptEffect`), read for an MCP request:
 *
 *   - `'none'` — it ran nothing, and that is established: the request was
 *     never sent (an `end` whose `attempts` is `0`). No reply establishes it.
 *     A 429 says the request was rate-limited, and AgentCore's session-busy
 *     body is matched by its code and words — a server behind the runtime can
 *     answer with the same error after it ran the call.
 *   - `'unknown'` — anything sent that did not complete: a 429, a session-busy
 *     reply, a lost connection or a timeout after the request was sent, a cut,
 *     a 5xx, a JSON-RPC error, a tool error (one can follow a write that
 *     succeeded).
 *   - `'applied'` — the call completed: the server answered it, and not with
 *     an error. It is never proof that anything was written.
 */
export type ToolRequestEffect = 'none' | 'unknown' | 'applied';

/** The failure kinds the app may declare a tool repeatable on (`replay.tools[name].on`). */
export type ToolRequestReplayKind = 'throttle' | 'network';

/**
 * What allowed the next attempt — present exactly when `reason` is
 * `'retryable'`. Permission and effect are separate facts: neither is ever
 * read from the other.
 *
 *   - `by: 'declaration'` — the app's entry for this tool names the failure
 *     kind (`on`).
 *   - `by: 'adapter'` — the adapter the app chose retries this refusal as its
 *     own policy: AgentCore Runtime's session-busy reply, which AWS documents
 *     as a retryable conflict while a session starts or stops. It says what
 *     it assumes in doing so (`assumes`).
 *   - `by: 'compatibility'` — the compatibility policy, today's default: it
 *     repeats a 429 for every tool, and says what it assumes in doing so
 *     (`assumes`).
 *
 * An assumption is a policy, never evidence: the row's `effect` stays
 * `'unknown'`.
 */
export interface ToolRequestPermission {
  readonly by: 'declaration' | 'adapter' | 'compatibility';
  /** `declaration` only — the failure kind the app's entry names. */
  readonly on?: ToolRequestReplayKind;
  /** `adapter` and `compatibility` only — what the policy assumes of the refusal it repeats. */
  readonly assumes?: 'refused-before-execution';
  /**
   * The app declared this tool as making changes, so it was asked again only
   * because the server is declared to deduplicate by a key this call carries.
   * The key protects only if the server uses it.
   */
  readonly deduplicated?: true;
}

/**
 * footprintjs's failure categories (`AttemptCategory`) — the one fixed set
 * every attempt record uses, so a saved request groups with every other.
 */
export type ToolRequestFailureCategory =
  | 'timeout'
  | 'rate-limited'
  | 'server'
  | 'network'
  | 'auth'
  | 'permanent'
  | 'unknown';

/**
 * A failure as the record keeps it: a fixed sentence and a code. The thrown
 * error's own message, name and fields are NEVER kept — a network or SDK
 * error's text can carry a URL with a token in it, a host's internal name or
 * a server's reply, and none of that is the library's to store.
 */
export interface ToolRequestError {
  readonly message:
    | 'The request failed before an answer arrived. Its error is not kept.'
    | 'The call ran out of time before an answer arrived.';
  /** The failure's category — the same word as `failure`. */
  readonly code: ToolRequestFailureCategory;
}

/** One attempt of an MCP request, as its retry series recorded it. */
export interface ToolRequestAttempt {
  /** 1-based. */
  readonly attempt: number;
  readonly outcome: ToolRequestAttemptOutcome;
  readonly reason: ToolRequestReason;
  /** The response's HTTP status — present when one arrived (`answered`, `refused`). */
  readonly status?: number;
  /** Which refusal a retry rule recognised — `refused` only. */
  readonly kind?: ToolRequestRefusalKind;
  /**
   * The failure's category (footprintjs's `AttemptCategory`) — absent for
   * `answered`. Named `failure`, not `category`: that key belongs to a retired
   * contract the redaction rule no longer treats as the library's own.
   */
  readonly failure?: ToolRequestFailureCategory;
  /** The wait before the next attempt, in ms — present exactly when `reason` is `'retryable'`. */
  readonly waitMs?: number;
  /**
   * The wait the server stated in `Retry-After`, in ms — when it stated one.
   * Absent beside a `waitMs` means that wait was the library's own backoff.
   */
  readonly retryAfterMs?: number;
  /** `failed` and `timed-out` only. */
  readonly error?: ToolRequestError;
  /**
   * `'unknown'` when the attempt ended without a response (`failed`,
   * `timed-out`, `cut`): it was sent, and whether the server received and ran
   * it is not known. Absent when a response arrived: the record keeps what the
   * server answered (`status`) — for a `refused` attempt that is the server's
   * own refusal, not proof that nothing ran.
   */
  readonly remote?: ToolRequestRemote;
  /**
   * What is known about whether this attempt took effect (see
   * {@link ToolRequestEffect}). On every attempt the library files.
   */
  readonly effect?: ToolRequestEffect;
  /** What allowed the next attempt — present exactly when `reason` is `'retryable'`. */
  readonly permission?: ToolRequestPermission;
  /** How long the attempt took, in ms, from sending to its end. On every attempt the library files. */
  readonly durationMs?: number;
}

/** How an MCP request ended. */
export interface ToolRequestEnd {
  readonly outcome: ToolRequestOutcome;
  readonly reason: ToolRequestReason;
  /** The delivered response's HTTP status — `answered` and `refused`. */
  readonly status?: number;
  /** The refusal that was delivered — `refused` only. */
  readonly kind?: ToolRequestRefusalKind;
  /** The failure's category, as on an attempt. */
  readonly failure?: ToolRequestFailureCategory;
  /**
   * Present when the request was CUT, and says what it was doing then.
   * `'request'` — its LAST attempt was in flight (`cut`, `timed-out`): that
   * attempt was sent and is the last row, or, past 100 attempts, the last one
   * counted in `omitted`; whether the server ran it is unknown. `'wait'` — it
   * was waiting to ask again, so no request was in flight and the next one was
   * never sent: a cancellation cut the wait (`cancelled`), or the deadline left
   * no time to finish it and the last refusal was delivered (`refused`,
   * `no-time-left`). Absent when nothing was cut — and when the request was
   * cancelled before its first attempt, so that nothing was sent.
   */
  readonly during?: 'request' | 'wait';
  /** `failed` and `timed-out` only. */
  readonly error?: ToolRequestError;
  /**
   * `'unknown'` when the request ended on an attempt with no response
   * (`failed`, `timed-out`, `cut`): whether the server ran that request is not
   * known.
   */
  readonly remote?: ToolRequestRemote;
  /**
   * How many requests the series sent: `attempts.length + omitted`. On every
   * end the library files.
   */
  readonly attempts?: number;
  /**
   * What is known about the series' effect as a whole. Uncertainty survives:
   * once any attempt's effect is `'unknown'`, so is the series' — a later
   * proven refusal does not resolve it, and a later success does not prove the
   * operation happened only once. `'applied'` only when the call completed and
   * no attempt's effect is unknown; `'none'` only when every attempt is proven
   * to have run nothing (or none was sent). On every end the library files.
   */
  readonly effect?: ToolRequestEffect;
  /**
   * The call failed as "may have run" (footprintjs's `UnknownEffectError`, its
   * final error — a later refusal's, or the timeout — as the `cause`): under
   * the `'app-authorized'` policy, the call genuinely lacked an answer
   * somewhere and did not complete. Lacking an answer is not an unknown
   * effect: it is an attempt that got no response at all (`remote:
   * 'unknown'`), or a request accepted over HTTP (an `answered` 2xx) whose
   * JSON-RPC answer never came. A received refusal or error IS an answer —
   * its effect unknown, delivered as the server sent it — so a call whose
   * every attempt received one has no `mayHaveRun`. Absent under
   * `'compatibility'`, where the caller sees the error it always did, and
   * for a call its caller cancelled, which ends with the caller's reason.
   */
  readonly mayHaveRun?: true;
}

/**
 * What one MCP request's retry series did: every attempt it made, why it went
 * on or stopped after each, how long it waited, and how the request ended.
 *
 * Filed by `mcpClient`'s retry series for a call the agent dispatched, ONCE per
 * request, when the call settles — so the last attempt's `effect` can say
 * whether the call completed — and at the moment of a cancellation, so a
 * run cancelled during a wait still carries it when it is saved. A call that
 * settles before its series (the MCP SDK's own timeout, say) cancels the series
 * there and then, inside the call, so it is never filed after its run, and no
 * request is sent after it. The framework stamps `toolCallId`, `toolName` and
 * `iteration` from the dispatch, so two calls, or two runs, sharing one MCP
 * connection never mix their attempts.
 *
 * ALLOW-LISTED, field by field: numbers, the library's own words, the
 * endpoint label the app declared, or else the endpoint's origin. Never the
 * URL's path, query or credentials, the call's arguments, the server's answer
 * or an error's text.
 *
 * Only a transport `mcpClient` builds runs a series that files this; with
 * retry off (`retryOnThrottle: false` on a plain transport) there is no series
 * and no event.
 */
export interface ToolsRequestAttemptsPayload {
  readonly toolCallId: string;
  readonly toolName: string;
  readonly iteration: number;
  /** The `endpointLabel` the app declared for this endpoint, when it declared one. */
  readonly endpoint?: string;
  /** Otherwise the endpoint's ORIGIN — scheme, host and port, nothing else. */
  readonly origin?: string;
  /**
   * The attempts, in order — at most 100. Every request the series sent is
   * here or counted in `omitted`, a cut one included: `attempts.length +
   * omitted` is the number of requests the series sent. A request it never
   * sent has no row.
   */
  readonly attempts: readonly ToolRequestAttempt[];
  /** Attempts made past the first 100, counted and not listed. `0` when every attempt is listed. */
  readonly omitted: number;
  readonly end: ToolRequestEnd;
}
