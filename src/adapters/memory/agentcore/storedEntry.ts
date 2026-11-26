import type { MemoryEntry } from '../../../memory/entry/index.js';
import { describeStoredShape } from '../../../lib/storedPreview.js';
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
 * Pull the MemoryEntry out of an AgentCore event's `payload` (a single `blob`
 * document) — this adapter's ONE decode step, and therefore the only place that
 * can tell "no entry here" apart from "an entry nobody can read".
 *
 * ── Why a string is the normal case ──────────────────────────────────────────
 * Entries are written as JSON **text** (see `sdkClient.ts`'s `createEvent`), so the blob
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
export function entryFromPayload(
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
