/**
 * auditExport — tamper-evident audit bundle (backlog #20, compliance
 * wedge item 2; pairs with #19's `otelObservability` GenAI spans).
 *
 * Consumes the typed `agentfootprint.*` event stream and accumulates an
 * append-only, HASH-CHAINED record log: every record carries the SHA-256
 * of its own canonical serialization plus the hash of the previous
 * record. Flipping a single byte anywhere in an exported bundle makes
 * `verifyAuditBundle` name the exact record that broke — the
 * record-keeping shape EU AI Act Art. 12 asks for (events the system
 * logged, in order, demonstrably unmodified since capture).
 *
 * Pattern: Observability strategy (one purpose — chain accumulation)
 *          + pure offline verifier.
 * Role:    Outer ring (Hexagonal). Attach via
 *          `agent.enable.observability({ strategy: auditExport() })`.
 * Emits:   nothing — terminal sink.
 *
 * ## What lands in the chain
 *
 * One record per typed event, in dispatch order: decisions
 * (`agent.route_decided`, `composition.route_decided` incl. decide()
 * evidence), tool calls (`stream.tool_start/_end`), validation
 * rejections (#9), permission verdicts and halts, credential lifecycle,
 * costs, errors, skill/memory/context activity. Each new `meta.runId`
 * is anchored by a GENESIS record (`audit.genesis`) carrying the runId,
 * the agent identity, and library versions — runs chain back-to-back in
 * one log, so silently DROPPING a whole run breaks the chain too.
 *
 * High-volume content deltas (`stream.token`, `stream.thinking_delta`)
 * are excluded by default (`includeTokenEvents: true` to include).
 *
 * ## Record / bundle schema
 *
 * ```
 * AuditRecord  = { seq, timestamp, eventType, payload, meta, prevHash, hash }
 *   hash       = SHA-256 hex over canonicalJson(record minus `hash`)
 *   prevHash   = previous record's `hash` (ZERO_HASH at chain start)
 * AuditBundle  = { header, records, finalHash }
 *   header     = { format, hashAlgorithm, canonicalization, chainHead,
 *                  firstSeq, recordCount, exportedAt, library }
 * ```
 *
 * Canonicalization is `afp-cjson/1` (see `lib/canonicalJson.ts` — those
 * rules ARE the contract; the header names them so independent
 * verifiers can re-implement byte-exactly).
 *
 * ## Persistence + long runs
 *
 * Persistence is the CONSUMER's job — the bundle is plain JSON
 * (`JSON.stringify(strategy.bundle())`, store anywhere). For long runs,
 * `drain()` returns the records accumulated since the last drain while
 * keeping the chain intact ACROSS drains: each segment's
 * `header.chainHead` equals the previous segment's `finalHash`, so
 * `verifyAuditBundle([seg1, seg2, ...])` re-verifies the concatenation
 * end-to-end.
 *
 * ## PII discipline (mirrors #19's otelObservability)
 *
 * Payloads enter records through a bounding layer — by default
 * (`payloadMode: 'bounded'`) record payloads NEVER carry raw runtime
 * values that can echo PII:
 *
 *   - tool args             → `'[keys: …]'` (top-level key NAMES only)
 *   - tool results          → `'[type: …]'` (typeof only)
 *   - userPrompt / LLM content / thinking blocks / history
 *                           → `'[N chars]'` / `'[N messages]'` markers
 *   - content PREVIEWS (`contentSummary` on context/memory events,
 *     `rawContent`, `resultSummary`, `droppedSummaries`) → markers
 *     (for short content a preview IS the content; `contentHash`
 *     stays — it links identical content without echoing it)
 *   - error MESSAGE strings (`error`, `errorMessage`, `lastError`,
 *     `rawOutput`)          → `'[N chars]'` (messages can echo values)
 *   - free-form Records (`questionPayload`, `resumeInput`, risk/eval
 *     `evidence`, memory `scoreEvidence`) → `'[keys: …]'`
 *
 * Everything else is embedded as the registry payload (sanitized:
 * strings capped at 256 chars, lists at 32 items, cycles broken) —
 * those payloads are bounded by construction: identifiers, counts,
 * enums, decide() evidence (engine-bounded + redaction-aware),
 * validation issues (paths/TYPES per #9), credential events (no
 * secrets by contract).
 *
 * `payloadMode: 'verbatim'` embeds full payloads (still
 * JSON-sanitized). For Art. 12 completeness on an access-controlled
 * store that is often the point — but the bundle then carries prompts,
 * tool args/results and model output. Treat it as PII-bearing, and
 * remember the Agent sets NO footprintjs RedactionPolicy by default
 * (policies you do set redact the emit channel UPSTREAM of this
 * strategy, so redacted events arrive here already redacted).
 *
 * ## Tamper-EVIDENT, not tamper-PROOF (honest threat model)
 *
 * The chain proves INTERNAL consistency: any partial modification —
 * edit, insert, delete, reorder, drop-a-run — is detected and named.
 * It does NOT prove provenance: an adversary holding the only copy can
 * recompute every hash from the mutation onward and present a
 * self-consistent forgery. For non-repudiation, anchor `finalHash`
 * externally as part of your retention process (write-once/WORM store,
 * signed log, RFC 3161 timestamping, or simply a second party) — then
 * a whole-suffix recomputation no longer matches the anchor.
 *
 * ## Runtime requirements
 *
 * Hashing uses `node:crypto` (`createHash('sha256')`) — zero new
 * dependencies, imported lazily at first use (same gating as the
 * optional vendor SDKs in this folder, so merely importing this module
 * stays browser-safe). `auditExport` and `verifyAuditBundle` therefore
 * run anywhere `node:crypto` exists: Node ≥ 20, Bun, Deno,
 * edge runtimes with Node compat (e.g. Cloudflare `nodejs_compat`).
 * In a browser there is no SYNC SHA-256 (WebCrypto is async-only), so
 * both throw a descriptive error — verify server-side, or re-implement
 * verification from the documented contract (it is pure: recompute
 * SHA-256 over `afp-cjson/1` canonicalization and walk the chain).
 *
 * @example Capture → export → verify
 * ```ts
 * import { auditExport, verifyAuditBundle } from 'agentfootprint/observability-providers';
 *
 * const audit = auditExport({ agent: 'loan-officer' });
 * const stop = agent.enable.observability({ strategy: audit });
 * await agent.run({ message: 'assess application A-17' });
 * stop();
 *
 * const bundle = audit.bundle();            // JSON-serializable
 * await fs.writeFile('run.audit.json', JSON.stringify(bundle));
 *
 * const check = verifyAuditBundle(bundle);  // offline — no agent needed
 * // check.valid === true; tamper with one byte → { valid: false, brokenAt: <seq> }
 * ```
 */

import type { AgentfootprintEvent } from '../../events/registry.js';
import { canonicalJson, CANONICAL_JSON_VERSION } from '../../lib/canonicalJson.js';
import { lazyRequire } from '../../lib/lazyRequire.js';
import type { ObservabilityStrategy } from '../../strategies/types.js';

// ─── Public types ─────────────────────────────────────────────────────

/** SHA-256 of "nothing" — the `prevHash` of the first record in a
 *  chain and the `chainHead` of a chain's first segment. */
export const AUDIT_ZERO_HASH = '0'.repeat(64);

/** `eventType` of the per-run genesis record. Deliberately OUTSIDE the
 *  `agentfootprint.*` registry namespace — it is a chain-level record,
 *  not a dispatched event (#20 ships zero new typed events). */
export const AUDIT_GENESIS_EVENT_TYPE = 'audit.genesis';

/** Format identifier carried on every bundle header. */
export const AUDIT_BUNDLE_FORMAT = 'agentfootprint.audit/1';

/**
 * One link of the hash chain.
 *
 * `hash` = SHA-256 hex over `canonicalJson` of the record WITHOUT the
 * `hash` field (i.e. `{ seq, timestamp, eventType, payload, meta,
 * prevHash }` — canonical key order makes field order irrelevant).
 * Because the preimage is "everything but `hash`", ADDING a field to a
 * record is detected exactly like mutating one.
 */
export interface AuditRecord {
  /** 0-based position in the chain (monotonic across drains). */
  readonly seq: number;
  /** Wall-clock ms of the source event (`meta.wallClockMs`). */
  readonly timestamp: number;
  /** Registry event name verbatim, or {@link AUDIT_GENESIS_EVENT_TYPE}. */
  readonly eventType: string;
  /** Bounded / sanitized event payload (see module PII docs). */
  readonly payload: unknown;
  /** Sanitized event meta (runId, runtimeStageId, paths, indices). */
  readonly meta: { readonly runId: string } & Readonly<Record<string, unknown>>;
  /** `hash` of the previous record ({@link AUDIT_ZERO_HASH} at chain start). */
  readonly prevHash: string;
  /** SHA-256 hex of this record's canonical preimage. */
  readonly hash: string;
}

export interface AuditBundleHeader {
  readonly format: typeof AUDIT_BUNDLE_FORMAT;
  readonly hashAlgorithm: 'sha-256';
  readonly canonicalization: typeof CANONICAL_JSON_VERSION;
  /** `prevHash` of `records[0]` — {@link AUDIT_ZERO_HASH} for the first
   *  segment, the previous segment's `finalHash` after a `drain()`. */
  readonly chainHead: string;
  /** `seq` of `records[0]` (continues across drains). */
  readonly firstSeq: number;
  readonly recordCount: number;
  /** Wall-clock ms when `bundle()` / `drain()` produced this export. */
  readonly exportedAt: number;
  readonly library: { readonly name: 'agentfootprint'; readonly version: string };
}

/** JSON-serializable export of the chain (or one drained segment). */
export interface AuditBundle {
  readonly header: AuditBundleHeader;
  readonly records: readonly AuditRecord[];
  /** `hash` of the last record (= `chainHead` when `records` is empty).
   *  The next drained segment's `chainHead` equals this value. */
  readonly finalHash: string;
}

export interface AuditVerifyResult {
  readonly valid: boolean;
  /** Records whose hashes were recomputed and matched. */
  readonly recordsChecked: number;
  /** `seq` of the first record that fails (or the expected seq at the
   *  failure point, when the stored seq itself was tampered). */
  readonly brokenAt?: number;
  /** Human-readable cause — names the failed check. */
  readonly reason?: string;
}

export interface AuditExportOptions {
  /** Agent identity recorded in every run's genesis record (service /
   *  agent name as your compliance review knows it). */
  readonly agent?: string;
  /**
   * `'bounded'` (default) — payloads pass the PII bounding layer (see
   * module docs). `'verbatim'` — full payloads, JSON-sanitized only.
   *
   * @remarks Verbatim bundles carry prompts, tool args/results and
   * model output. Treat the store as PII-bearing; the Agent applies NO
   * RedactionPolicy by default.
   */
  readonly payloadMode?: 'bounded' | 'verbatim';
  /** Include `stream.token` / `stream.thinking_delta` events (high
   *  volume; content still bounded under `payloadMode: 'bounded'`).
   *  Default `false`. */
  readonly includeTokenEvents?: boolean;
  /** Extra version pins for the genesis record (your app, model
   *  config revision, policy bundle hash, …). */
  readonly versions?: Readonly<Record<string, string>>;
}

/** The strategy returned by {@link auditExport}. */
export interface AuditExportStrategy extends ObservabilityStrategy {
  /** Snapshot the retained records WITHOUT draining. Safe mid-run. */
  bundle(): AuditBundle;
  /** Return the records accumulated since the last drain and clear
   *  them from memory. Chain state persists — consecutive drained
   *  segments re-verify end-to-end via `verifyAuditBundle([...])`. */
  drain(): AuditBundle;
  /** Records currently retained (since last drain). */
  recordCount(): number;
}

// ─── SHA-256 via node:crypto (lazy, browser-safe to import) ──────────

type NodeCryptoModule = typeof import('node:crypto');

let cryptoModule: NodeCryptoModule | undefined;

function resolveCrypto(): NodeCryptoModule {
  if (cryptoModule) return cryptoModule;
  try {
    cryptoModule = lazyRequire<NodeCryptoModule>('node:crypto');
  } catch {
    throw new Error(
      'auditExport/verifyAuditBundle require `node:crypto` for synchronous SHA-256 ' +
        '(available in Node ≥ 20, Bun, Deno, and edge runtimes with Node compat). ' +
        'Browsers expose only async WebCrypto — capture/verify audit bundles server-side.',
    );
  }
  if (typeof cryptoModule.createHash !== 'function') {
    throw new Error('auditExport: `node:crypto` resolved but `createHash` is missing.');
  }
  return cryptoModule;
}

function sha256Hex(text: string): string {
  return resolveCrypto().createHash('sha256').update(text, 'utf8').digest('hex');
}

/** Best-effort library version for header + genesis.
 *
 *  Tries the package self-reference first (`exports["./package.json"]`
 *  — resolves from source and the CJS build), then relative paths to
 *  the root manifest (the ESM build sits under `dist/esm/`, whose
 *  type-stamp `package.json` has no `name`, which breaks Node's
 *  self-reference scope; relative specifiers resolve from
 *  `lib/lazyRequire` — `../../` from `src//dist/lib`, `../../../`
 *  from `dist/esm/lib`). The `name` guard rejects any manifest that
 *  isn't actually ours. 'unknown' where nothing resolves (bundlers). */
function libraryVersion(): string {
  for (const specifier of [
    'agentfootprint/package.json',
    '../../package.json',
    '../../../package.json',
  ]) {
    try {
      const pkg = lazyRequire<{ name?: string; version?: string }>(specifier);
      if (pkg.name === 'agentfootprint' && typeof pkg.version === 'string') return pkg.version;
    } catch {
      /* try the next candidate */
    }
  }
  return 'unknown';
}

// ─── JSON sanitization (both modes) ──────────────────────────────────

/** Caps mirror otel.ts's bounding discipline (defense-in-depth — the
 *  registry payloads are mostly bounded upstream). */
const MAX_STRING_CHARS = 256;
const MAX_LIST_ITEMS = 32;
const MAX_DEPTH = 8;

/**
 * Convert any value to a JSON-safe, size-bounded tree:
 * strings capped, arrays capped with an overflow marker, cycles
 * broken, depth capped, Date → ISO, bigint → string, non-finite →
 * null, functions/symbols/undefined dropped (objects) or null
 * (arrays). Output always canonicalizes without throwing.
 */
function sanitizeJson(value: unknown, depth = 0, seen = new Set<object>()): unknown {
  if (value === null) return null;
  switch (typeof value) {
    case 'string':
      return value.length > MAX_STRING_CHARS ? `${value.slice(0, MAX_STRING_CHARS - 1)}…` : value;
    case 'number':
      return Number.isFinite(value) ? value : null;
    case 'boolean':
      return value;
    case 'bigint':
      return String(value);
    case 'undefined':
    case 'function':
    case 'symbol':
      return undefined;
    default:
      break;
  }

  const obj = value as object;
  if (obj instanceof Date) return obj.toISOString();
  if (depth >= MAX_DEPTH) return '[truncated: depth]';
  if (seen.has(obj)) return '[circular]';
  seen.add(obj);
  try {
    if (Array.isArray(obj)) {
      const capped = obj.slice(0, MAX_LIST_ITEMS).map((item) => {
        const sanitized = sanitizeJson(item, depth + 1, seen);
        return sanitized === undefined ? null : sanitized;
      });
      if (obj.length > MAX_LIST_ITEMS) capped.push(`…+${obj.length - MAX_LIST_ITEMS} more`);
      return capped;
    }
    const out: Record<string, unknown> = {};
    for (const [key, entry] of Object.entries(obj)) {
      const sanitized = sanitizeJson(entry, depth + 1, seen);
      if (sanitized !== undefined) out[key] = sanitized;
    }
    return out;
  } finally {
    seen.delete(obj);
  }
}

// ─── Bounding layer (payloadMode: 'bounded') ─────────────────────────

/** `'[23 chars]'` — length evidence without content. */
function charsMarker(value: unknown): string {
  return typeof value === 'string' ? `[${value.length} chars]` : `[type: ${typeofOf(value)}]`;
}

/** `'[keys: a, b, c]'` — shape evidence for free-form Records. */
function keysMarker(value: unknown): string {
  if (value === null || typeof value !== 'object') return `[type: ${typeofOf(value)}]`;
  const keys = Object.keys(value as object).slice(0, MAX_LIST_ITEMS);
  return `[keys: ${keys.join(', ')}]`;
}

function typeofOf(value: unknown): string {
  return value === null ? 'null' : typeof value;
}

/**
 * Content-bearing fields per event type → bounded replacement.
 * Only fields that can echo raw runtime values appear here; everything
 * else passes through `sanitizeJson` untouched (see module docs for
 * the per-domain verbatim/summarized table).
 */
const BOUND_FIELDS: Readonly<
  Record<string, Readonly<Record<string, (value: unknown) => unknown>>>
> = {
  'agentfootprint.agent.turn_start': { userPrompt: charsMarker },
  'agentfootprint.agent.turn_end': { finalContent: charsMarker },
  'agentfootprint.agent.iteration_end': {
    history: (v) => (Array.isArray(v) ? `[${v.length} messages]` : charsMarker(v)),
  },
  'agentfootprint.agent.output_schema_validation_failed': { rawOutput: charsMarker },
  'agentfootprint.stream.llm_end': { content: charsMarker },
  'agentfootprint.stream.token': { content: charsMarker },
  'agentfootprint.stream.thinking_delta': { content: charsMarker },
  'agentfootprint.stream.thinking_end': {
    blocks: (v) => (Array.isArray(v) ? `[${v.length} blocks]` : charsMarker(v)),
  },
  'agentfootprint.stream.tool_start': { args: keysMarker },
  'agentfootprint.stream.tool_end': { result: (v) => `[type: ${typeofOf(v)}]` },
  // contentSummary is a raw-content PREVIEW (not a redacted summary) —
  // for short content it IS the content, so it is bounded like content.
  // `contentHash` stays verbatim: it links identical injections across
  // records without echoing a byte of them.
  'agentfootprint.context.injected': { rawContent: charsMarker, contentSummary: charsMarker },
  'agentfootprint.context.slot_composed': {
    droppedSummaries: (v) => (Array.isArray(v) ? `[${v.length} summaries]` : charsMarker(v)),
  },
  'agentfootprint.composition.merge_end': { resultSummary: charsMarker },
  'agentfootprint.memory.attached': { contentSummary: charsMarker },
  'agentfootprint.memory.written': { contentSummary: charsMarker },
  'agentfootprint.pause.request': { questionPayload: keysMarker },
  'agentfootprint.pause.resume': { resumeInput: keysMarker },
  'agentfootprint.risk.flagged': { evidence: keysMarker },
  'agentfootprint.eval.score': { evidence: keysMarker },
  'agentfootprint.memory.strategy_applied': { scoreEvidence: keysMarker },
};

/** Error-MESSAGE field names — bounded in EVERY event (messages can
 *  echo runtime values; mirrors #19's "stage + scope only" rule). The
 *  classifier fields (`errorName`, `errorKind`) stay verbatim. */
const ERROR_MESSAGE_FIELDS: ReadonlySet<string> = new Set(['error', 'errorMessage', 'lastError']);

function boundPayload(eventType: string, payload: unknown): unknown {
  if (payload === null || typeof payload !== 'object' || Array.isArray(payload)) {
    return sanitizeJson(payload);
  }
  const fieldRules = BOUND_FIELDS[eventType];
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(payload)) {
    const rule = fieldRules?.[key];
    if (rule !== undefined) {
      out[key] = rule(value);
      continue;
    }
    if (ERROR_MESSAGE_FIELDS.has(key) && typeof value === 'string') {
      out[key] = charsMarker(value);
      continue;
    }
    const sanitized = sanitizeJson(value);
    if (sanitized !== undefined) out[key] = sanitized;
  }
  return out;
}

// ─── Strategy factory ────────────────────────────────────────────────

/** Excluded by default — high-volume content deltas. */
const TOKEN_EVENT_TYPES: ReadonlySet<string> = new Set([
  'agentfootprint.stream.token',
  'agentfootprint.stream.thinking_delta',
]);

export function auditExport(opts: AuditExportOptions = {}): AuditExportStrategy {
  const payloadMode = opts.payloadMode ?? 'bounded';
  const includeTokenEvents = opts.includeTokenEvents === true;
  const version = libraryVersion();

  // Chain state — survives drains; one chain per strategy instance.
  let nextSeq = 0;
  let lastHash = AUDIT_ZERO_HASH;
  let segmentHead = AUDIT_ZERO_HASH;
  let segmentFirstSeq = 0;
  let retained: AuditRecord[] = [];
  const seenRunIds = new Set<string>();
  let stopped = false;

  function append(
    eventType: string,
    timestamp: number,
    payload: unknown,
    meta: AuditRecord['meta'],
  ): void {
    const preimage = { seq: nextSeq, timestamp, eventType, payload, meta, prevHash: lastHash };
    const hash = sha256Hex(canonicalJson(preimage));
    retained.push({ ...preimage, hash });
    lastHash = hash;
    nextSeq += 1;
  }

  function appendGenesis(runId: string, timestamp: number): void {
    append(
      AUDIT_GENESIS_EVENT_TYPE,
      timestamp,
      {
        runId,
        ...(opts.agent !== undefined && { agent: opts.agent }),
        library: { name: 'agentfootprint', version },
        ...(opts.versions !== undefined && { versions: sanitizeJson(opts.versions) }),
        payloadMode,
      },
      { runId },
    );
  }

  function makeBundle(): AuditBundle {
    return {
      header: {
        format: AUDIT_BUNDLE_FORMAT,
        hashAlgorithm: 'sha-256',
        canonicalization: CANONICAL_JSON_VERSION,
        chainHead: segmentHead,
        firstSeq: segmentFirstSeq,
        recordCount: retained.length,
        exportedAt: Date.now(),
        library: { name: 'agentfootprint', version },
      },
      records: [...retained],
      finalHash: lastHash,
    };
  }

  return {
    name: 'audit',
    capabilities: { events: true },

    /** Attach-time check (the `validate()` contract) — fail fast where
     *  `node:crypto` is unavailable instead of on the first event. */
    validate(): void {
      resolveCrypto();
    },

    exportEvent(event: AgentfootprintEvent): void {
      if (stopped) return;
      if (!includeTokenEvents && TOKEN_EVENT_TYPES.has(event.type)) return;

      // Real dispatcher envelopes carry meta (bridge/eventMeta.ts).
      // Hand-fed events without it are still recorded — an audit sink
      // must never silently drop — under the 'unattributed' run anchor.
      const meta = (event as unknown as { meta?: Record<string, unknown> }).meta;
      const runId = typeof meta?.runId === 'string' ? meta.runId : 'unattributed';
      const timestamp = typeof meta?.wallClockMs === 'number' ? meta.wallClockMs : Date.now();

      if (!seenRunIds.has(runId)) {
        seenRunIds.add(runId);
        appendGenesis(runId, timestamp);
      }

      // wallClockMs lives on `timestamp`; the rest of the meta rides
      // along sanitized (runtimeStageId, paths, turn/iter indices, …).
      const { wallClockMs: _lifted, ...metaRest } = meta ?? {};
      void _lifted;
      const recordMeta = {
        ...(sanitizeJson(metaRest) as Record<string, unknown>),
        runId,
      } as AuditRecord['meta'];

      const payload =
        payloadMode === 'bounded'
          ? boundPayload(event.type, event.payload)
          : sanitizeJson(event.payload);

      append(event.type, timestamp, payload, recordMeta);
    },

    flush(): void {
      // In-memory sink — nothing to flush. Export via bundle()/drain().
    },

    stop(): void {
      // Stop OBSERVING; never destroy collected evidence — consumers
      // drain/bundle after stop.
      stopped = true;
    },

    bundle(): AuditBundle {
      return makeBundle();
    },

    drain(): AuditBundle {
      const segment = makeBundle();
      segmentHead = lastHash;
      segmentFirstSeq = nextSeq;
      retained = [];
      return segment;
    },

    recordCount(): number {
      return retained.length;
    },
  };
}

// ─── Offline verification (pure — no agent, no strategy) ─────────────

/**
 * Recompute the hash chain of a bundle (or of consecutive drained
 * segments, in order) and report the exact record where integrity
 * breaks. Pure function over JSON data — runs offline, long after the
 * run, with no agent and no strategy instance.
 *
 * Checks, in order, per segment:
 *   1. header format / algorithm / canonicalization are supported
 *   2. `recordCount` matches `records.length`
 *   3. segment continuity (`chainHead`/`firstSeq` extend the previous
 *      segment's `finalHash`/seq range)
 *   4. per record: `seq` is contiguous, `prevHash` links the previous
 *      record, and SHA-256 over the canonical preimage (the record
 *      minus `hash` — so ADDED fields are caught too) matches `hash`
 *   5. `finalHash` equals the last record's hash
 */
export function verifyAuditBundle(input: AuditBundle | readonly AuditBundle[]): AuditVerifyResult {
  const segments: readonly AuditBundle[] = Array.isArray(input)
    ? (input as readonly AuditBundle[])
    : [input as AuditBundle];
  let recordsChecked = 0;
  let expectedChainHead: string | undefined;
  let expectedFirstSeq: number | undefined;

  const fail = (reason: string, brokenAt?: number): AuditVerifyResult => ({
    valid: false,
    recordsChecked,
    ...(brokenAt !== undefined && { brokenAt }),
    reason,
  });

  if (segments.length === 0) return fail('no bundles supplied');

  for (let s = 0; s < segments.length; s++) {
    const segment = segments[s];
    const where = segments.length > 1 ? ` (segment ${s})` : '';
    if (segment === undefined || typeof segment !== 'object') {
      return fail(`bundle is not an object${where}`);
    }
    const { header, records, finalHash } = segment;
    if (header === undefined || !Array.isArray(records) || typeof finalHash !== 'string') {
      return fail(`bundle missing header/records/finalHash${where}`);
    }
    if (header.format !== AUDIT_BUNDLE_FORMAT) {
      return fail(`unsupported format '${String(header.format)}'${where}`);
    }
    if (header.hashAlgorithm !== 'sha-256') {
      return fail(`unsupported hashAlgorithm '${String(header.hashAlgorithm)}'${where}`);
    }
    if (header.canonicalization !== CANONICAL_JSON_VERSION) {
      return fail(`unsupported canonicalization '${String(header.canonicalization)}'${where}`);
    }
    if (header.recordCount !== records.length) {
      return fail(
        `recordCount ${String(header.recordCount)} does not match ${
          records.length
        } records${where}`,
      );
    }
    if (expectedChainHead !== undefined && header.chainHead !== expectedChainHead) {
      return fail(
        `segment discontinuity — chainHead does not match previous segment's finalHash${where}`,
        header.firstSeq,
      );
    }
    if (expectedFirstSeq !== undefined && header.firstSeq !== expectedFirstSeq) {
      return fail(
        `segment discontinuity — firstSeq ${String(
          header.firstSeq,
        )}, expected ${expectedFirstSeq}${where}`,
        expectedFirstSeq,
      );
    }

    let prevHash = header.chainHead;
    for (let i = 0; i < records.length; i++) {
      const record = records[i] as AuditRecord | undefined;
      const expectedSeq = header.firstSeq + i;
      if (record === null || typeof record !== 'object') {
        return fail(`record at seq ${expectedSeq} is not an object`, expectedSeq);
      }
      if (record.seq !== expectedSeq) {
        return fail(
          `sequence mismatch — record carries seq ${String(record.seq)}, expected ${expectedSeq}`,
          expectedSeq,
        );
      }
      if (record.prevHash !== prevHash) {
        return fail(
          `chain broken — prevHash does not match the preceding record's hash`,
          expectedSeq,
        );
      }
      let recomputed: string;
      try {
        const { hash: _stored, ...preimage } = record;
        void _stored;
        recomputed = sha256Hex(canonicalJson(preimage));
      } catch (err) {
        return fail(
          `record not canonicalizable (${err instanceof Error ? err.message : String(err)})`,
          expectedSeq,
        );
      }
      if (recomputed !== record.hash) {
        return fail(
          `hash mismatch — record content does not match its hash (tampered or corrupted)`,
          expectedSeq,
        );
      }
      prevHash = record.hash;
      recordsChecked += 1;
    }

    if (finalHash !== prevHash) {
      const lastSeq = header.firstSeq + records.length - 1;
      return fail(
        `finalHash does not match the last record's hash${where}`,
        records.length > 0 ? lastSeq : header.firstSeq,
      );
    }
    expectedChainHead = finalHash;
    expectedFirstSeq = header.firstSeq + records.length;
  }

  return { valid: true, recordsChecked };
}
