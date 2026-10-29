/**
 * requestEvidence — the door a tool call's REQUEST attempts enter its run by.
 *
 * Pattern: a per-dispatch port (the `LLMCallHooks` precedent) + one allow-list.
 * Role:    The seam between a retry series that runs BELOW a tool — inside
 *          `mcpClient`'s transport, built before any run existed — and the run
 *          that dispatched the call. The dispatcher builds the port for each
 *          call (`requestEvidenceFor`) and puts it on the call's context under
 *          an internal symbol; the MCP tool hands it down to the series that
 *          sends its request (`mcp/requestLedger.ts`); the series files ONE
 *          record when the request ends. Nothing here retries anything.
 * Emits:   agentfootprint.tools.request_attempts
 *
 * Why a port and not a scope: a decorator constructed by the consumer before
 * any run exists can never reach a scope (`resilienceHooks` says the same of
 * the provider decorators). The call is the one thing both sides share, so the
 * port rides the call — and the identity on the event (`toolCallId`,
 * `toolName`, `iteration`, the run's ids in the meta) is stamped HERE, from the
 * dispatch, never by whatever files: a filing cannot claim another call.
 *
 * Why an internal symbol and not a public `ctx` field: this is the evidence
 * path for the library's own retry series, not a retry API. A public member
 * would invite every tool to file attempts the library cannot vouch for. The
 * symbol is enumerable, so a wrapper that copies the context (`{ ...ctx }`)
 * keeps it; a filing from anyone else still passes the allow-list below.
 *
 * The port only FILES. What cancels a call is the call's own context signal
 * (`ctx.signal`), read by the MCP tool whether or not a port rides along — a
 * cancellation must never depend on evidence being attributable.
 *
 * THE ALLOW-LIST is the whole record: numbers, the library's own words, the
 * endpoint label the app declared or else the endpoint's ORIGIN. A filing with
 * anything else in it — a field nobody listed, a word outside its set, a URL
 * with a path, an array that is not a plain one — is refused whole, never
 * trimmed into something it did not say. Values are read as DATA, through own
 * property descriptors, so no getter, `toJSON` or array subclass a filing
 * carries ever runs or reaches the record.
 */

import { isDevMode } from 'footprintjs';

import type {
  ToolRequestAttempt,
  ToolRequestEnd,
  ToolRequestError,
  ToolsRequestAttemptsPayload,
} from '../events/payloads.js';
import { typedEmit, type EmitableScope } from '../recorders/core/typedEmit.js';

/** At most this many attempts are listed per request; the rest are counted (`omitted`). */
export const MAX_REQUEST_ATTEMPT_ROWS = 100;

/** What a request's series files: the event's payload, less the identity the dispatcher stamps. */
export type RequestEvidence = Omit<
  ToolsRequestAttemptsPayload,
  'toolCallId' | 'toolName' | 'iteration'
>;

/** Where one dispatched call's request evidence goes. */
export interface RequestEvidenceSink {
  /** File the request's record. Never throws; a filing outside the allow-list is refused whole. */
  file(evidence: RequestEvidence): void;
}

/** @internal The context key the dispatcher puts a call's sink under. */
export const REQUEST_EVIDENCE: unique symbol = Symbol('agentfootprint.request-evidence');

/** What the dispatcher spreads into a call's context. */
export interface RequestEvidencePort {
  readonly [REQUEST_EVIDENCE]: RequestEvidenceSink;
}

/** The call the sink files for — the dispatch's own identity. */
export interface RequestEvidenceCall {
  readonly toolName: string;
  readonly toolCallId: string;
  readonly iteration: number;
}

/**
 * The port for one dispatch: files `agentfootprint.tools.request_attempts`
 * mid-stage through `typedEmit` (so the run's redaction rule serves it, and the
 * meta carries the real `runtimeStageId`), stamped with `call`.
 */
export function requestEvidenceFor(
  scope: EmitableScope,
  call: RequestEvidenceCall,
): RequestEvidencePort {
  const sink: RequestEvidenceSink = {
    file: (evidence) => {
      const served = servedRequestEvidence(evidence);
      if (served === undefined) {
        warnOnce(call.toolName, 'a filing outside the allow-list was refused');
        return;
      }
      try {
        typedEmit(scope, 'agentfootprint.tools.request_attempts', {
          toolCallId: call.toolCallId,
          toolName: call.toolName,
          iteration: call.iteration,
          ...served,
        });
      } catch (err) {
        // Evidence is not the work: a sink that dies must not fail the call.
        warnOnce(call.toolName, err instanceof Error ? err.message : String(err));
      }
    },
  };
  return { [REQUEST_EVIDENCE]: sink };
}

/**
 * The sink a call's context carries, or `undefined` — a context from a door with
 * no run (`mcpServe`, a direct `execute`), or one a wrapper rebuilt without it.
 * Never throws, whatever `ctx` is.
 */
export function requestEvidenceOf(ctx: unknown): RequestEvidenceSink | undefined {
  if (ctx === null || typeof ctx !== 'object') return undefined;
  let port: unknown;
  try {
    port = (ctx as { readonly [REQUEST_EVIDENCE]?: unknown })[REQUEST_EVIDENCE];
  } catch {
    return undefined;
  }
  if (port === null || typeof port !== 'object') return undefined;
  let file: unknown;
  try {
    file = (port as { readonly file?: unknown }).file;
  } catch {
    return undefined;
  }
  if (typeof file !== 'function') return undefined;
  return port as RequestEvidenceSink;
}

// ─── The allow-list ──────────────────────────────────────────────────

type Words<W extends string> = { readonly [K in W]: true };

const ATTEMPT_OUTCOMES: Words<ToolRequestAttempt['outcome']> = {
  answered: true,
  refused: true,
  failed: true,
  'timed-out': true,
  cut: true,
};
/** An end may also be `cancelled`: no request was in flight. A row never is — a sent request is `cut`. */
const END_OUTCOMES: Words<ToolRequestEnd['outcome']> = { ...ATTEMPT_OUTCOMES, cancelled: true };
const REMOTE: Words<NonNullable<ToolRequestAttempt['remote']>> = { unknown: true };
const REASONS: Words<ToolRequestAttempt['reason']> = {
  retryable: true,
  answered: true,
  exhausted: true,
  'wait-limit': true,
  'no-time-left': true,
  'not-replayable': true,
  'not-retryable': true,
  cancelled: true,
};
const KINDS: Words<NonNullable<ToolRequestAttempt['kind']>> = {
  throttle: true,
  'session-busy': true,
};
const CATEGORIES: Words<NonNullable<ToolRequestAttempt['failure']>> = {
  timeout: true,
  'rate-limited': true,
  server: true,
  network: true,
  auth: true,
  permanent: true,
  unknown: true,
};
const SENTENCES: Words<ToolRequestError['message']> = {
  'The request failed before an answer arrived. Its error is not kept.': true,
  'The call ran out of time before an answer arrived.': true,
};
const DURING: Words<NonNullable<ToolRequestEnd['during']>> = { request: true, wait: true };

const ATTEMPT_FIELDS = new Set([
  'attempt',
  'outcome',
  'reason',
  'status',
  'kind',
  'failure',
  'waitMs',
  'retryAfterMs',
  'error',
  'remote',
]);
const END_FIELDS = new Set([
  'outcome',
  'reason',
  'status',
  'kind',
  'failure',
  'during',
  'error',
  'remote',
]);
const EVIDENCE_FIELDS = new Set(['endpoint', 'origin', 'attempts', 'omitted', 'end']);

/** Thrown inside the walk when a filing leaves the allow-list; caught at its root. */
class Refused extends Error {
  override readonly name = 'Refused';
}

/**
 * `raw` rebuilt from allow-listed fields — a fresh plain object — or
 * `undefined` when anything in it is outside the list.
 */
export function servedRequestEvidence(raw: unknown): RequestEvidence | undefined {
  try {
    const evidence = record(raw, EVIDENCE_FIELDS);
    const { endpoint, origin } = evidence;
    if (endpoint !== undefined && origin !== undefined) throw new Refused();
    return {
      ...(endpoint !== undefined && { endpoint: label(endpoint) }),
      ...(origin !== undefined && { origin: originOnly(origin) }),
      attempts: plainArray(evidence.attempts, MAX_REQUEST_ATTEMPT_ROWS).map(servedAttempt),
      omitted: count(evidence.omitted),
      end: servedEnd(evidence.end),
    };
  } catch {
    // `Refused`, or anything a hostile value threw while it was read: this door
    // never throws, whatever it is handed.
    return undefined;
  }
}

function servedAttempt(raw: unknown): ToolRequestAttempt {
  const row = record(raw, ATTEMPT_FIELDS);
  const attempt = count(row.attempt);
  if (attempt < 1) throw new Refused();
  return {
    attempt,
    outcome: word(ATTEMPT_OUTCOMES, row.outcome),
    reason: word(REASONS, row.reason),
    ...(row.status !== undefined && { status: status(row.status) }),
    ...(row.kind !== undefined && { kind: word(KINDS, row.kind) }),
    ...(row.failure !== undefined && { failure: word(CATEGORIES, row.failure) }),
    ...(row.waitMs !== undefined && { waitMs: duration(row.waitMs) }),
    ...(row.retryAfterMs !== undefined && { retryAfterMs: duration(row.retryAfterMs) }),
    ...(row.error !== undefined && { error: servedError(row.error) }),
    ...(row.remote !== undefined && { remote: word(REMOTE, row.remote) }),
  };
}

function servedEnd(raw: unknown): ToolRequestEnd {
  const end = record(raw, END_FIELDS);
  return {
    outcome: word(END_OUTCOMES, end.outcome),
    reason: word(REASONS, end.reason),
    ...(end.status !== undefined && { status: status(end.status) }),
    ...(end.kind !== undefined && { kind: word(KINDS, end.kind) }),
    ...(end.failure !== undefined && { failure: word(CATEGORIES, end.failure) }),
    ...(end.during !== undefined && { during: word(DURING, end.during) }),
    ...(end.error !== undefined && { error: servedError(end.error) }),
    ...(end.remote !== undefined && { remote: word(REMOTE, end.remote) }),
  };
}

function servedError(raw: unknown): ToolRequestError {
  const error = record(raw, new Set(['message', 'code']));
  return { message: word(SENTENCES, error.message), code: word(CATEGORIES, error.code) };
}

/**
 * A PLAIN array's elements, copied by index into a fresh array: its prototype
 * exactly `Array.prototype` (no subclass, so no `toJSON` or species of its own),
 * every index from 0 to `length - 1` an own data property (no hole, no getter),
 * and no other own key — a property riding on the array is refused, not
 * dropped. At most `max` elements.
 */
function plainArray(raw: unknown, max: number): unknown[] {
  if (!Array.isArray(raw) || Object.getPrototypeOf(raw) !== Array.prototype) throw new Refused();
  const length = Object.getOwnPropertyDescriptor(raw, 'length')?.value as unknown;
  if (typeof length !== 'number' || !Number.isSafeInteger(length) || length > max) {
    throw new Refused();
  }
  const keys = Reflect.ownKeys(raw);
  if (keys.length !== length + 1) throw new Refused();
  const out: unknown[] = [];
  for (let i = 0; i < length; i++) {
    const descriptor = Object.getOwnPropertyDescriptor(raw, String(i));
    if (descriptor === undefined || !('value' in descriptor)) throw new Refused();
    out.push(descriptor.value);
  }
  return out;
}

/** A plain object whose every own key is listed; read once, by key. */
function record(raw: unknown, fields: ReadonlySet<string>): Readonly<Record<string, unknown>> {
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) throw new Refused();
  const proto = Object.getPrototypeOf(raw) as unknown;
  if (proto !== Object.prototype && proto !== null) throw new Refused();
  const out: Record<string, unknown> = {};
  for (const key of Reflect.ownKeys(raw)) {
    if (typeof key !== 'string' || !fields.has(key)) throw new Refused();
    const descriptor = Object.getOwnPropertyDescriptor(raw, key);
    if (descriptor === undefined || !('value' in descriptor)) throw new Refused();
    out[key] = descriptor.value;
  }
  return out;
}

function word<W extends string>(words: Words<W>, value: unknown): W {
  if (typeof value === 'string' && Object.prototype.hasOwnProperty.call(words, value)) {
    return value as W;
  }
  throw new Refused();
}

/** A whole number ≥ 0. */
function count(value: unknown): number {
  if (typeof value === 'number' && Number.isSafeInteger(value) && value >= 0) return value;
  throw new Refused();
}

/** An HTTP status. */
function status(value: unknown): number {
  if (typeof value === 'number' && Number.isInteger(value) && value >= 100 && value <= 599) {
    return value;
  }
  throw new Refused();
}

/** A finite length of time in ms, ≥ 0. */
function duration(value: unknown): number {
  if (typeof value === 'number' && Number.isFinite(value) && value >= 0) return value;
  throw new Refused();
}

/** An app-declared label: 1–128 characters, none of them control characters. */
function label(value: unknown): string {
  if (typeof value !== 'string' || value.length < 1 || value.length > 128) throw new Refused();
  for (let i = 0; i < value.length; i++) {
    const code = value.charCodeAt(i);
    if (code < 0x20 || (code >= 0x7f && code <= 0x9f)) throw new Refused();
  }
  return value;
}

/** An origin and nothing more: what `new URL(it)` reads back as scheme, host and port. */
function originOnly(value: unknown): string {
  if (typeof value !== 'string' || value.length > 2048) throw new Refused();
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Refused();
  }
  if (url.host === '' || `${url.protocol}//${url.host}` !== value) throw new Refused();
  return value;
}

const warned = new Set<string>();

/** Named in dev mode, once per tool — evidence is telemetry, never the call's failure. */
function warnOnce(toolName: string, why: string): void {
  if (!isDevMode() || warned.has(toolName)) return;
  warned.add(toolName);
  // eslint-disable-next-line no-console
  console.warn(
    `[agentfootprint] tool '${toolName}': its request attempts were not recorded (${why}). ` +
      'The call itself is unaffected.',
  );
}
