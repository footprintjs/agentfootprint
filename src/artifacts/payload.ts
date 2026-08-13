/**
 * artifacts/payload — one owner for how a payload is measured, carried and
 * digested.
 *
 * Three adapters store the same three payload shapes (string, `Uint8Array`,
 * JSON value). If each measured or serialized on its own, `bytes` on the meta
 * could disagree with what a digest was computed over, and a digest written by
 * one adapter would not verify in another. So the laws live once, here:
 *
 *   • `measure` — `bytes` is the UTF-8 length of text/JSON, the byteLength of
 *     binary. The number a consumer decides from, computed one way.
 *   • `encode/decode` — the durable adapters persist ONE envelope
 *     (`text` / `binary` base64 / `json`), so a file written by
 *     `fileArtifacts` is legible to a debugging human and identical in law to
 *     a row written by `sqliteArtifacts`.
 *   • `digest` — sha-256 over the SAME canonical bytes `measure` counts, via
 *     `globalThis.crypto.subtle` (browser + Node, zero dependencies).
 *
 * A payload JSON cannot carry (a function, a bigint, `undefined`, a cyclic
 * object) is refused BY NAME at put — storing an approximation and returning
 * it later as the real thing is the exact accepted-and-silently-wrong failure
 * a claim check exists to prevent.
 */

import { InvalidArtifactError } from './types.js';

const textEncoder = new TextEncoder();
const textDecoder = new TextDecoder();

/**
 * The canonical bytes of a payload — what `bytes` counts and what a digest
 * is computed over. Throws {@link InvalidArtifactError} for a value that
 * cannot be carried faithfully.
 */
export function canonicalPayloadBytes(data: unknown): Uint8Array {
  if (data instanceof Uint8Array) return data;
  if (typeof data === 'string') return textEncoder.encode(data);
  let serialized: string;
  try {
    serialized = JSON.stringify(data);
  } catch (err) {
    throw new InvalidArtifactError(
      `the payload cannot be JSON-serialized (${
        err instanceof Error ? err.message : String(err)
      }). ` +
        `Store a string, a Uint8Array, or a JSON-serializable value — an approximation of ` +
        `anything else would be returned later as if it were the real thing.`,
    );
  }
  if (serialized === undefined) {
    throw new InvalidArtifactError(
      `the payload serializes to nothing (undefined, a function, or a symbol). ` +
        `JSON cannot carry it, so the store will not pretend to. Store a string, a ` +
        `Uint8Array, or a JSON-serializable value.`,
    );
  }
  return textEncoder.encode(serialized);
}

/** Payload size in bytes — UTF-8 for text/JSON, byteLength for binary. */
export function measureArtifactBytes(data: unknown): number {
  return canonicalPayloadBytes(data).byteLength;
}

/** `sha-256:<hex>` over the canonical bytes. */
export async function computeArtifactDigest(data: unknown): Promise<string> {
  const bytes = canonicalPayloadBytes(data);
  // `subtle.digest` wants an ArrayBuffer-backed view; copy defensively so a
  // Uint8Array over a SharedArrayBuffer cannot reach it.
  const buffer = new Uint8Array(bytes).buffer;
  const hash = new Uint8Array(await globalThis.crypto.subtle.digest('SHA-256', buffer));
  let hex = '';
  for (const b of hash) hex += b.toString(16).padStart(2, '0');
  return `sha-256:${hex}`;
}

// ─── The durable envelope ────────────────────────────────────────────

/** How a payload rides a file or a SQL TEXT column. One shape, two adapters. */
export interface EncodedPayload {
  readonly shape: 'text' | 'binary' | 'json';
  /** `text`: the string. `binary`: base64. `json`: the JSON serialization. */
  readonly value: string;
}

/** Encode for durable storage. Validates exactly as `measure` does. */
export function encodeArtifactData(data: unknown): EncodedPayload {
  if (data instanceof Uint8Array) return { shape: 'binary', value: toBase64(data) };
  if (typeof data === 'string') return { shape: 'text', value: data };
  // canonicalPayloadBytes carries the refusal for unserializable values.
  return { shape: 'json', value: textDecoder.decode(canonicalPayloadBytes(data)) };
}

/** Decode what {@link encodeArtifactData} wrote. Total over its own output. */
export function decodeArtifactData(encoded: EncodedPayload): unknown {
  switch (encoded.shape) {
    case 'text':
      return encoded.value;
    case 'binary':
      return fromBase64(encoded.value);
    case 'json':
      return JSON.parse(encoded.value) as unknown;
  }
}

// Buffer-free base64, so the in-file law works in a browser bundle too.
function toBase64(bytes: Uint8Array): string {
  let binary = '';
  const CHUNK = 0x8000;
  for (let i = 0; i < bytes.length; i += CHUNK) {
    binary += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
  }
  return btoa(binary);
}

function fromBase64(value: string): Uint8Array {
  const binary = atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}
