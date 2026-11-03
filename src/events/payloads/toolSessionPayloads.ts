// ── tools.session_* (4) — the tool-session lifecycle (9.7.0) ─────────────────
//
// A tool that holds a session (a managed code interpreter, a browser context)
// registers cleanup through `ctx.onTeardown`; these four are what that leaves
// behind. They ride the EXISTING `agentfootprint.tools.` prefix on purpose:
// `toolsRecorder` already bridges the whole prefix and `'agentfootprint.tools.*'`
// is already a wildcard arm, so a new domain would have re-opened the two-part
// trap 9.4.0 spent a release climbing out of (payloads and registry entries in
// place, no bridge and no wildcard, eight minors of silence).
//
// **`keyHash`, never the key.** The isolation key composes tenant, principal and
// the hosting `sessionId`; publishing it would put a user identifier into every
// exporter's payload. `meta.sessionId` already carries the session legitimately
// (9.4.0), so the payload carries a short, stable, non-reversible digest — enough
// to JOIN two rows, not enough to say whose they are.

/** Shared shape of the four `tools.session_*` payloads. */
interface ToolSessionPayloadBase {
  /** The tool that registered the cleanup. */
  readonly tool: string;
  /** Which scope it asked for — how long it expected to live. */
  readonly scope: 'call' | 'run' | 'session' | 'shutdown';
  /** Digest of the isolation key. SHA-256 (12 hex chars) where `node:crypto`
   *  resolves, FNV-1a in a browser bundle. NEVER the key. */
  readonly keyHash: string;
  /** The adapter holding the resource — `CodeRunner.id`, say. */
  readonly runnerId?: string;
  /** One fact the tool chose to state about what was opened (the language, the
   *  browser profile). Never user data. */
  readonly label?: string;
}

/** A tool opened something and registered its cleanup. */
export type ToolsSessionStartedPayload = ToolSessionPayloadBase;

/**
 * A later call reused the session already held under this key.
 *
 * This is the payoff being measured: `calls` is how many dispatches have shared
 * one start-up. It is also the liveness signal the idle sweep and the LRU bound
 * read, which is why a tool re-registers on every execute rather than only once.
 */
export interface ToolsSessionReusedPayload extends ToolSessionPayloadBase {
  /** How many calls have now shared this session, including this one. */
  readonly calls: number;
}

/** The cleanup ran. `reason` says which firing site ran it. */
export interface ToolsSessionClosedPayload extends ToolSessionPayloadBase {
  readonly reason: 'call-end' | 'run-end' | 'session-end' | 'shutdown' | 'idle' | 'evicted';
  /** Wall-clock from registration to close. */
  readonly durationMs: number;
}

/**
 * The cleanup threw, or outran `toolTeardownTimeoutMs`.
 *
 * Teardown never throws into the run — but it is never SILENT either, and this
 * event is the difference. A vendor `Stop` that fails leaves a live sandbox
 * somebody is still paying for; the run has no way to say so, so this does.
 * `errorClass` mirrors `credential.failed`'s 9.4.0 addition: routable without
 * parsing prose (`'ToolTeardownTimeoutError'` for the budget case).
 */
export interface ToolsSessionCloseFailedPayload extends ToolSessionPayloadBase {
  readonly reason: 'call-end' | 'run-end' | 'session-end' | 'shutdown' | 'idle' | 'evicted';
  readonly durationMs: number;
  readonly error: string;
  readonly errorClass?: string;
}
