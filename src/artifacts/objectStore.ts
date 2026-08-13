/**
 * artifacts/objectStore — the half every REMOTE OBJECT adapter shares.
 *
 * Two adapters put artifacts in somebody else's bucket. They speak different
 * SDKs and dispatch different operations, and that is exactly where a vendor
 * belongs — but the laws they follow must not fork, so the laws live here:
 *
 *   1. **The payload is the object body, and it is the CANONICAL BYTES** —
 *      the same bytes `meta.bytes` counts and a digest covers. Not a JSON
 *      envelope wrapping base64: a stored report should be downloadable with
 *      the vendor's own console and be the report. That choice is also what
 *      makes `getStream` possible at all — a body you have to parse is a body
 *      you cannot stream.
 *   2. **The meta rides as ONE object-metadata entry** ({@link ARTIFACT_META_KEY}),
 *      an ASCII-safe JSON envelope. One key, one truth: a "helpful" second
 *      copy of `kind` in a sibling field is a second thing that can disagree.
 *      ASCII because user metadata travels as an HTTP header on at least one
 *      of these services — a label with an em-dash in it must not be
 *      mangled at the transport — and JSON-with-escapes rather than base64
 *      because an operator reading the console should be able to SEE what the
 *      ticket says.
 *   3. **The metadata budget is checked at put and REFUSED by name.** Both
 *      services cap user metadata (the caps differ; each adapter states its
 *      own). A refusal that names the field to shorten beats a vendor's
 *      "MetadataTooLarge" at document 400, and beats silent truncation
 *      always.
 *   4. **Missing means null; unreadable means an error.** A 404 is the
 *      port's deliberate "no data" ambiguity — but only when the call ASKED
 *      ABOUT ONE OBJECT. A write and a listing do not ask that question, so a
 *      404 from one of them is the service saying something else entirely (the
 *      bucket does not exist, the endpoint is wrong); nobody downstream turns
 *      it into `null`, so letting it past the sanitizer hands the caller the
 *      SDK's own text — which contains the object key. That is what
 *      {@link NotFoundMeaning} makes each call site declare, and why the
 *      default is the safe one. Anything else — denied, throttled, a network
 *      failure — is NOT "no data" either, and answering `null` for it would
 *      report an empty scope over objects that exist. Each adapter maps its
 *      own SDK's missing-object shape; everything else raises through
 *      {@link objectSdkFailure}.
 *   5. **Listings order by the SERVICE's own creation time**, which comes back
 *      free on a listing, and page by offset over that sorted list. The port
 *      promises newest-first ACROSS pages; a bucket's key order is
 *      lexicographic, so a cursor that was the service's own continuation
 *      token would page in the wrong order and call it paging.
 *
 * Nothing in this file imports an SDK, names a vendor, or knows a wire
 * format. It is the part of an object adapter that can be unit-tested with
 * nothing but strings.
 */

import { isArtifactRef } from './naming.js';
import type { PayloadShape } from './payload.js';
import {
  InvalidArtifactError,
  type ArtifactListOptions,
  type ArtifactListResult,
  type ArtifactMeta,
} from './types.js';

/** The single object-metadata key that carries the ticket. */
export const ARTIFACT_META_KEY = 'af-artifact';

/** Envelope version. Bumped only for a change an older reader could not
 *  survive; a newer number is refused, never half-read. */
const META_FORMAT = 1;

interface MetaEnvelope {
  readonly v: number;
  /** How to rebuild the payload from the object's bytes. */
  readonly shape: PayloadShape;
  readonly meta: ArtifactMeta;
}

/**
 * Every non-ASCII character as a `\uXXXX` escape, so the JSON is pure ASCII
 * and survives a transport that only promises US-ASCII. `JSON.parse` reverses
 * it exactly — the escape is part of JSON, not a private encoding.
 */
function asciiJson(value: unknown): string {
  return JSON.stringify(value).replace(/[\u007f-\uffff]/g, (char) => {
    const code = char.charCodeAt(0).toString(16).padStart(4, '0');
    return `\\u${code}`;
  });
}

/**
 * Encode a ticket for the object's metadata, refusing one that will not fit.
 *
 * @param meta    the minted ticket.
 * @param shape   how the payload must be rebuilt from the body's bytes.
 * @param budget  the service's user-metadata cap, in bytes.
 * @param adapter the factory name, for the refusal.
 * @throws InvalidArtifactError when the encoded ticket exceeds the budget —
 *         naming the fields that are big enough to be the reason.
 */
export function encodeArtifactMetaValue(
  meta: ArtifactMeta,
  shape: PayloadShape,
  budget: number,
  adapter: string,
): string {
  const envelope: MetaEnvelope = { v: META_FORMAT, shape, meta };
  const value = asciiJson(envelope);
  // The key travels with the value; both count against the service's cap.
  const size = ARTIFACT_META_KEY.length + value.length;
  if (size > budget) {
    const suspects: string[] = [];
    if (meta.label !== undefined && meta.label.length > 64) {
      suspects.push(`label (${meta.label.length} chars)`);
    }
    if (meta.parentRefs !== undefined && meta.parentRefs.length > 4) {
      suspects.push(`parentRefs (${meta.parentRefs.length} refs)`);
    }
    if (meta.kind.length > 64) suspects.push(`kind (${meta.kind.length} chars)`);
    throw new InvalidArtifactError(
      `${adapter}: the ticket does not fit this service's object-metadata budget ` +
        `(${size} bytes encoded, budget ${budget}). The ticket travels AS object metadata, so ` +
        `the payload size is irrelevant here — the description is what is too long` +
        (suspects.length > 0 ? `; the length is in ${suspects.join(' and ')}` : '') +
        `. Shorten the label, carry fewer parentRefs, or move the long prose into the payload ` +
        `where size is what this store is for.`,
    );
  }
  return value;
}

/**
 * Read a ticket back off an object's metadata.
 *
 * `undefined` for anything this runtime must not interpret: no entry (not
 * ours — a foreign object in a shared bucket is left alone), unparseable, a
 * newer envelope version, or a ref that is not a minted ref. Refusing to
 * interpret is the point: a half-read ticket would be a confident description
 * of the wrong thing.
 */
export function decodeArtifactMetaValue(
  value: unknown,
): { readonly meta: ArtifactMeta; readonly shape: PayloadShape } | undefined {
  if (typeof value !== 'string' || value === '') return undefined;
  let parsed: unknown;
  try {
    parsed = JSON.parse(value);
  } catch {
    return undefined;
  }
  const envelope = parsed as Partial<MetaEnvelope> | null;
  if (envelope === null || typeof envelope !== 'object') return undefined;
  if (typeof envelope.v !== 'number' || envelope.v > META_FORMAT) return undefined;
  const meta = envelope.meta;
  if (meta === undefined || !isArtifactRef((meta as ArtifactMeta).ref)) return undefined;
  const shape = envelope.shape;
  if (shape !== 'text' && shape !== 'binary' && shape !== 'json') return undefined;
  return { meta: meta as ArtifactMeta, shape };
}

/** Case-insensitive lookup in a metadata bag. At least one of these services
 *  lower-cases user-metadata keys in transit, so the key written and the key
 *  read back are not guaranteed to be the same string. */
export function readMetadataEntry(bag: Record<string, unknown> | undefined, key: string): unknown {
  if (bag === undefined || bag === null) return undefined;
  const direct = bag[key];
  if (direct !== undefined) return direct;
  const wanted = key.toLowerCase();
  for (const [name, value] of Object.entries(bag)) {
    if (name.toLowerCase() === wanted) return value;
  }
  return undefined;
}

/** Has the calendar passed this ticket? The one expiry predicate both object
 *  adapters use, so "expired" cannot mean two things. */
export function isExpiredMeta(meta: ArtifactMeta, now: number): boolean {
  return meta.expiresAt !== undefined && meta.expiresAt <= now;
}

/**
 * Re-raise a failed SDK call WITHOUT its text (the `sdkFailure` law, applied
 * to object storage).
 *
 * A cloud SDK reports transport and validation failures by echoing request
 * detail into the message: the bucket, the KEY — which here contains the
 * tenant, the principal and the conversation id — and sometimes a signed URL
 * or a header the request carried. This library then hands that string to the
 * LLM as a tool result, puts it on the commit log, and ships it to every sink
 * attached. One echo and the scope tuple is in the conversation.
 *
 * So the text does not come through. What does is the part that is both safe
 * and actionable: which operation failed, the exception's NAME, and the HTTP
 * status. The original is deliberately NOT attached as `cause` — a cause
 * travels into every serializer that walks own properties, which would undo
 * all of this in one `JSON.stringify`.
 */
export function objectSdkFailure(adapter: string, operation: string, err: unknown): Error {
  const e = err as
    | {
        name?: unknown;
        code?: unknown;
        $metadata?: { httpStatusCode?: unknown };
      }
    | null
    | undefined;
  const name = typeof e?.name === 'string' && e.name.length > 0 ? e.name : 'an unnamed failure';
  const status =
    typeof e?.$metadata?.httpStatusCode === 'number'
      ? e.$metadata.httpStatusCode
      : typeof e?.code === 'number'
      ? e.code
      : undefined;
  return new Error(
    `[artifacts] ${adapter}: ${operation} failed — ${name}` +
      (status !== undefined ? ` (HTTP ${status})` : '') +
      `.\n  The SDK's own message is withheld: object-storage errors echo the bucket and the ` +
      `object KEY, and the key carries this run's tenant/principal/conversation. Check the ` +
      `service's own logs for the full exception. This is not "no data" — a missing object ` +
      `answers null; this call did not get an answer at all.`,
  );
}

/**
 * What a "not found" from ONE call is allowed to mean.
 *
 * The distinction is not academic: it decides whether an SDK error object
 * leaves this library intact.
 *
 * • `'missing-object'` — the call named one object and asked whether it is
 *   there. Not-found is the port's deliberate "no data", so the SDK's own
 *   error travels back to the CALL SITE, which immediately converts it to
 *   `null`/`undefined`. It never leaves the adapter, so its text never reaches
 *   an event, a log, or a model.
 *
 * • `'not-an-answer'` — the call asked no such question (it wrote, or it
 *   listed). A not-found here means something the caller did not ask about is
 *   wrong — most often that the bucket itself is not there — and NOTHING
 *   downstream is waiting to convert it. It goes through
 *   {@link objectSdkFailure} like every other failure.
 *
 * This is the DEFAULT for exactly that reason: a call site that says nothing
 * gets the sanitizer. Leaking has to be typed out on purpose, next to the
 * `catch` that proves the error is caught.
 */
export type NotFoundMeaning = 'missing-object' | 'not-an-answer';

/**
 * The one gate every object adapter runs its SDK failures through.
 *
 * Returns what to throw — the sanitized error for anything the caller is not
 * standing by to interpret, the original ONLY for a genuine missing object at
 * a call site that declared it asks about one, and our own refusals verbatim
 * (an {@link InvalidArtifactError} is this library's sentence, already written
 * for a human, and re-wrapping it would replace a teaching refusal with a
 * transport complaint).
 *
 * Built once per adapter so the vendor's not-found detection is bound in one
 * place: two call sites in the same adapter cannot end up disagreeing about
 * what "missing" looks like.
 *
 * @param adapter        the factory name, for the message.
 * @param isMissingObject the adapter's own reading of its SDK's
 *                       "no such object" — the one genuinely per-vendor part.
 */
export function objectFailurePolicy(
  adapter: string,
  isMissingObject: (err: unknown) => boolean,
): (operation: string, err: unknown, meaning: NotFoundMeaning) => unknown {
  return (operation, err, meaning) => {
    if (err instanceof InvalidArtifactError) return err;
    if (meaning === 'missing-object' && isMissingObject(err)) return err;
    return objectSdkFailure(adapter, operation, err);
  };
}

/** One row of a scope listing, before the tickets are paged. */
export interface ObjectListingRow {
  readonly meta: ArtifactMeta;
  /** The service's own creation time for the object (ms). The sort key —
   *  see law 5 in the module header. */
  readonly serviceCreatedAt: number;
}

/**
 * The port's paging law over a scope's rows: newest first, offset cursor.
 *
 * Sorted by the SERVICE's creation time (falling back to the ticket's own
 * `createdAt` when a listing did not carry one), ties broken by ref so two
 * objects written in the same millisecond still page deterministically.
 */
export function pageObjectListing(
  rows: readonly ObjectListingRow[],
  options: ArtifactListOptions | undefined,
): ArtifactListResult {
  const sorted = [...rows].sort(
    (a, b) => b.serviceCreatedAt - a.serviceCreatedAt || (a.meta.ref < b.meta.ref ? -1 : 1),
  );
  const offset = decodeOffsetCursor(options?.cursor);
  const limit = Math.max(1, Math.floor(options?.limit ?? 50));
  const page = sorted.slice(offset, offset + limit);
  const nextOffset = offset + page.length;
  return {
    artifacts: page.map((row) => row.meta),
    ...(nextOffset < sorted.length && { cursor: String(nextOffset) }),
  };
}

/** The offset a cursor names. Total: a cursor this store did not mint reads
 *  as "start at the beginning" rather than as an error — a caller cannot
 *  learn anything about another scope by guessing one. */
export function decodeOffsetCursor(cursor: string | undefined): number {
  if (cursor === undefined) return 0;
  const parsed = Number(cursor);
  return Number.isFinite(parsed) && parsed >= 0 ? Math.floor(parsed) : 0;
}

/** Validate a bucket name option at construction — the same shape of refusal
 *  every adapter here gives for a missing required option. */
export function assertBucketOption(adapter: string, option: string, value: unknown): string {
  if (typeof value !== 'string' || value.trim() === '') {
    throw new TypeError(
      `[artifacts] ${adapter}({ ${option}: ${JSON.stringify(value)} }) names no bucket. ` +
        `Give it the name of a bucket that already exists — this library never creates one: ` +
        `a bucket carries region, lifecycle, encryption and access decisions that belong to ` +
        `your infrastructure, not to a call in an agent.`,
    );
  }
  return value;
}
