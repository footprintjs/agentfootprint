/**
 * hosting/answerAccounts — the machinery behind the `answer-account` wire op:
 * one host's cache, its single-flight, and the pure step that turns a stored
 * recording into `{ account, shown }`.
 *
 * The op itself — its order, its refusals, its one door fact — lives inside
 * `standingAgent.ts · answerArtifact`, beside `head` and `get`, so its
 * ownership path cannot drift from theirs. This file owns only what that
 * branch must not re-derive per request:
 *
 *   • **The options, validated at boot.** `declarations` are the HOST's (a bad
 *     one throws when `standingAgent` is called, never per request), the
 *     ceiling and the cache size are numbers that must mean something.
 *   • **The cache key** — `(scope, ref, template-set version, declarations
 *     digest)`. The account is a pure function of the recording and the
 *     declarations, and the template-set version names the words, so a key
 *     that carries all four can never serve stale sentences: a library upgrade
 *     or a declarations change is a miss by construction.
 *   • **Single-flight** — ten concurrent clicks on one answer cause ONE store
 *     read and ONE parse. Joined waiters get the leader's outcome, failure
 *     included.
 *   • **An LRU bounded twice** — by entries (default 32) and by total
 *     serialized size ({@link ANSWER_ACCOUNT_CACHE_MAX_BYTES}). Only an
 *     account is ever cached; a failure is never an entry, so the next request
 *     tries again.
 *
 * What it deliberately does NOT own: whether the recording still exists. The
 * branch asks the store (a SILENT head) before it asks this cache — so a
 * swept or expired recording is "not available" even while its account sits
 * here (review R3-S1). A cache that answered first would serve derived record
 * data past the store's own retention.
 */

import { createHash } from 'node:crypto';

import type { ArtifactScope } from '../artifacts/types.js';
import { accountForAnswer } from '../lib/answer-account/account.js';
import { validateDeclarations } from '../lib/answer-account/declarations.js';
import { showLeaves } from '../lib/answer-account/shown.js';
import { ANSWER_ACCOUNT_TEMPLATE_SET_VERSION } from '../lib/answer-account/templates.js';
import type { AnswerAccountDeclarations } from '../lib/answer-account/types.js';
import type { Recording } from '../recorders/observability/recordRun.js';
import type { AnswerAccountWireBody } from './artifactWire.js';
import { RecordingTooLargeForAccountError } from './errors.js';

/**
 * Opt in to the `answer-account` wire op — `standingAgent({ answerAccounts })`.
 *
 * `true` opts in with every default.
 */
export interface AnswerAccountsOptions {
  /**
   * What the APP declares about its skills, tools and routing (labels, a
   * result's `rowsAt`, "the app decides entries"). Validated once, when
   * `standingAgent` is called; every line filled from it is vouched `app`.
   * Never taken from a request.
   */
  readonly declarations?: AnswerAccountDeclarations;
  /**
   * The largest recording this host will explain, in bytes (the ticket's
   * `bytes`). Default {@link DEFAULT_ANSWER_ACCOUNT_MAX_RECORDING_BYTES}
   * (16 MiB). A recording over it is refused with
   * `RecordingTooLargeForAccountError` before any of its payload is read — it
   * bounds the worst single parse on the event loop every session shares.
   */
  readonly maxRecordingBytes?: number;
  /**
   * How many accounts to keep, least recently used out first. Default
   * {@link DEFAULT_ANSWER_ACCOUNT_CACHE_ENTRIES}. `0` caches nothing (the
   * single-flight still joins concurrent requests).
   */
  readonly cacheEntries?: number;
}

/** The default recording ceiling: 16 MiB — above the field median (≈7.5 MB). */
export const DEFAULT_ANSWER_ACCOUNT_MAX_RECORDING_BYTES = 16 * 1024 * 1024;
/** The default number of cached accounts. */
export const DEFAULT_ANSWER_ACCOUNT_CACHE_ENTRIES = 32;
/** The cache's total bound, by the serialized size of what it holds: 8 MiB. */
export const ANSWER_ACCOUNT_CACHE_MAX_BYTES = 8 * 1024 * 1024;

/** A stored recording as the branch loaded it: the payload and the run it is OF. */
export interface LoadedRecording {
  readonly data: unknown;
  /** The ticket's `meta.origin.runId` — preferred over the recording's own. */
  readonly runId?: string;
}

/**
 * One host's account service.
 *
 * @internal Built by `standingAgent` from {@link AnswerAccountsOptions}.
 */
export interface AnswerAccounts {
  readonly maxRecordingBytes: number;
  /** The cache key for a ref redeemed under `scope`. */
  keyFor(scope: ArtifactScope, ref: string): string;
  /** A cached answer, marked most recently used — or `undefined`. */
  cached(key: string): AnswerAccountWireBody | undefined;
  /**
   * Compute (or join the computation of) the answer for `key`. `load` runs at
   * most once per concurrent key and returns `null` when the record is not
   * available. Resolves `null` for anything that cannot be explained, and
   * rejects with `RecordingTooLargeForAccountError` when the payload in hand is
   * over the ceiling whatever its ticket said — neither is ever cached.
   */
  compute(
    key: string,
    load: () => Promise<LoadedRecording | null>,
  ): Promise<AnswerAccountWireBody | null>;
}

interface Entry {
  readonly body: AnswerAccountWireBody;
  readonly bytes: number;
}

/**
 * Build one host's service, validating the options. Throws — at boot — naming
 * the first thing wrong.
 */
export function answerAccounts(options: AnswerAccountsOptions | true): AnswerAccounts {
  const given = readOptions(options);
  const declarations = validateAtBoot(given.declarations);
  const maxRecordingBytes = given.maxRecordingBytes ?? DEFAULT_ANSWER_ACCOUNT_MAX_RECORDING_BYTES;
  const cacheEntries = given.cacheEntries ?? DEFAULT_ANSWER_ACCOUNT_CACHE_ENTRIES;
  checkCeiling(maxRecordingBytes);
  checkCacheEntries(cacheEntries);
  const suffix = `@${ANSWER_ACCOUNT_TEMPLATE_SET_VERSION}#${declarationsDigest(declarations)}`;

  /** Insertion order IS recency: a hit re-inserts. */
  const cache = new Map<string, Entry>();
  let cachedBytes = 0;
  const inFlight = new Map<string, Promise<AnswerAccountWireBody | null>>();

  function remember(key: string, body: AnswerAccountWireBody): void {
    if (cacheEntries === 0) return;
    const bytes = JSON.stringify(body).length;
    if (bytes > ANSWER_ACCOUNT_CACHE_MAX_BYTES) return;
    forget(key);
    cache.set(key, { body, bytes });
    cachedBytes += bytes;
    for (const [oldest, entry] of cache) {
      if (cache.size <= cacheEntries && cachedBytes <= ANSWER_ACCOUNT_CACHE_MAX_BYTES) break;
      cache.delete(oldest);
      cachedBytes -= entry.bytes;
    }
  }

  function forget(key: string): void {
    const held = cache.get(key);
    if (held === undefined) return;
    cache.delete(key);
    cachedBytes -= held.bytes;
  }

  return {
    maxRecordingBytes,
    keyFor(scope, ref) {
      // JSON of a fixed-order tuple: no field value can forge a separator.
      return `${JSON.stringify([
        scope.tenant ?? null,
        scope.principal ?? null,
        scope.conversationId,
        ref,
      ])}${suffix}`;
    },
    cached(key) {
      const held = cache.get(key);
      if (held === undefined) return undefined;
      cache.delete(key);
      cache.set(key, held);
      return held.body;
    },
    compute(key, load) {
      const joined = inFlight.get(key);
      if (joined !== undefined) return joined;
      const leader = (async (): Promise<AnswerAccountWireBody | null> => {
        const loaded = await load();
        if (loaded === null) return null;
        // The ceiling again, on the bytes actually in hand (the branch checked
        // the ticket's `bytes` before the read; a store may under-report).
        const bytes = payloadBytes(loaded.data);
        if (bytes !== undefined && bytes > maxRecordingBytes) {
          throw new RecordingTooLargeForAccountError(maxRecordingBytes);
        }
        const body = explainRecording(loaded, declarations);
        if (body !== null) remember(key, body);
        return body;
      })();
      inFlight.set(key, leader);
      const settle = (): void => {
        inFlight.delete(key);
      };
      leader.then(settle, settle);
      return leader;
    },
  };
}

/**
 * The pure step: a stored recording → `{ account, shown }`, frozen — or `null`
 * when the payload is not a recording this can read.
 *
 * Synchronous on purpose, and the reason for the ceiling: parse + fold +
 * show-me run on the event loop. Measured on the field recording in the af-3
 * worklog.
 */
export function explainRecording(
  loaded: LoadedRecording,
  declarations: AnswerAccountDeclarations,
): AnswerAccountWireBody | null {
  const recording = readRecording(loaded.data);
  if (recording === null) return null;
  try {
    const account = accountForAnswer(
      recording,
      declarations,
      loaded.runId !== undefined ? { runId: loaded.runId } : undefined,
    );
    const shown = showLeaves(account, recording, declarations);
    return deepFreeze({ account, shown });
  } catch {
    // `accountForAnswer` throws only on a caller error (a non-object
    // recording); anything else is caught per sentence inside it. Either way
    // this record cannot be explained, which is the one not-found.
    return null;
  }
}

/** The payload as a recording object — text (how recordings are minted), bytes, or an object. */
function readRecording(data: unknown): Recording | null {
  let value: unknown = data;
  try {
    if (typeof data === 'string') value = JSON.parse(data);
    else if (data instanceof Uint8Array) value = JSON.parse(new TextDecoder().decode(data));
  } catch {
    return null;
  }
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Recording)
    : null;
}

/**
 * @internal Exported for its test.
 *
 * Freeze what the cache hands out. The same object is served to every reader
 * of that answer; a host that edited one reply would otherwise edit the next.
 */
export function deepFreeze<T>(value: T, seen: WeakSet<object> = new WeakSet()): T {
  if (typeof value !== 'object' || value === null || seen.has(value)) return value;
  seen.add(value);
  // Recurse even into an object that is ALREADY frozen: a shallow freeze
  // (a library value, a future constant) would otherwise leave mutable
  // children in the shared cache. The `seen` set ends a cycle.
  for (const child of Object.values(value as Record<string, unknown>)) deepFreeze(child, seen);
  return Object.isFrozen(value) ? value : Object.freeze(value);
}

/**
 * The payload's REAL size in bytes, never the ticket's word for it — a custom
 * store that under-reports `meta.bytes` must not walk a huge payload into
 * `JSON.parse`. `undefined` for an already-parsed object (nothing left to
 * parse; the store paid that cost).
 */
function payloadBytes(data: unknown): number | undefined {
  if (typeof data === 'string') return Buffer.byteLength(data, 'utf8');
  if (data instanceof Uint8Array) return data.byteLength;
  return undefined;
}

/** The declarations' CONTENT, independent of key order — the cache key's last part. */
function declarationsDigest(declarations: AnswerAccountDeclarations): string {
  return createHash('sha256').update(canonical(declarations)).digest('hex').slice(0, 16);
}

function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (typeof value === 'object' && value !== null) {
    const entries = Object.keys(value)
      .sort()
      .filter((key) => (value as Record<string, unknown>)[key] !== undefined)
      .map((key) => `${JSON.stringify(key)}:${canonical((value as Record<string, unknown>)[key])}`);
    return `{${entries.join(',')}}`;
  }
  return JSON.stringify(value) ?? 'null';
}

const OPTION_KEYS: ReadonlySet<string> = new Set([
  'declarations',
  'maxRecordingBytes',
  'cacheEntries',
]);

function readOptions(options: AnswerAccountsOptions | true): AnswerAccountsOptions {
  if (options === true) return {};
  if (typeof options !== 'object' || options === null || Array.isArray(options)) {
    throw new Error(
      `[hosting] standingAgent was given answerAccounts: ${String(options)}. Pass true to ` +
        `serve the 'answer-account' op with every default, or an object — ` +
        `{ declarations?, maxRecordingBytes?, cacheEntries? } — or drop the option.`,
    );
  }
  for (const key of Object.keys(options)) {
    if (!OPTION_KEYS.has(key)) {
      throw new Error(
        `[hosting] standingAgent's answerAccounts has an unknown key "${key}". It takes ` +
          `declarations, maxRecordingBytes and cacheEntries.`,
      );
    }
  }
  return options;
}

function validateAtBoot(
  declarations: AnswerAccountDeclarations | undefined,
): AnswerAccountDeclarations {
  try {
    return validateDeclarations(declarations);
  } catch (err) {
    throw new Error(
      `[hosting] standingAgent's answerAccounts.declarations were refused — ` +
        `${err instanceof Error ? err.message : String(err)}. They are the host's, checked ` +
        `once here so no request ever meets a bad one.`,
    );
  }
}

function checkCeiling(bytes: number): void {
  if (!Number.isInteger(bytes) || bytes <= 0) {
    throw new Error(
      `[hosting] standingAgent was given answerAccounts.maxRecordingBytes: ${String(bytes)}. ` +
        `It is the largest recording this host will explain, so it has to be a positive ` +
        `whole number of bytes — a ceiling of zero refuses everything, and an infinite ` +
        `one bounds nothing. Drop it for the default ` +
        `(${DEFAULT_ANSWER_ACCOUNT_MAX_RECORDING_BYTES} bytes).`,
    );
  }
}

function checkCacheEntries(entries: number): void {
  if (!Number.isInteger(entries) || entries < 0) {
    throw new Error(
      `[hosting] standingAgent was given answerAccounts.cacheEntries: ${String(entries)}. ` +
        `It is how many accounts to keep, so it has to be a whole number, 0 or more ` +
        `(0 keeps none). Drop it for the default (${DEFAULT_ANSWER_ACCOUNT_CACHE_ENTRIES}).`,
    );
  }
}
