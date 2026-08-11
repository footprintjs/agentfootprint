/**
 * resolveTurnNumber — which turn of this conversation is about to happen?
 *
 * A memory entry's id is turn-stamped (`msg-{turn}-{index}`, `snap-{turn}`,
 * `beat-{turn}-{index}`), so the turn number is not a label: it is the KEY
 * two consecutive turns must not share. Get it wrong and every turn
 * overwrites the previous one — a conversation memory that silently holds
 * exactly one exchange no matter how large the window says it is. That is
 * the bug this function exists to make impossible (9.6.0).
 *
 * **Why the host's own counter is not enough.** A host that runs one Agent
 * instance for a whole conversation can count turns in memory. The shape
 * seen in a production field deployment cannot: it builds a FRESH agent per
 * turn (new process, new instance, same `conversationId`, same store), so
 * anything counted in a variable is back to 1 on every request. The only
 * thing that remembers how far the conversation has got is the STORE.
 *
 * **The rule** — `max(hostTurn, maxStoredTurn + 1)`:
 *   - Hosts that track the turn honestly keep their numbering (`hostTurn: 5`
 *     → turn 5; gaps preserved — an ordinal, not a count).
 *   - A host whose counter is stale still gets a fresh, ordered turn: the
 *     second turn of a conversation whose store already holds turn 1 is
 *     turn 2, never turn 1 again.
 *   - The two sources compose: whichever knows more wins, and neither can
 *     drag the conversation backwards.
 *
 * The rule is the one `writeSnapshot` has applied to causal snapshots since
 * 9.1 — this is that carve-out generalised so every memory kind shares one
 * definition of "which turn is this", resolved ONCE per run (in the Agent's
 * seed stage) rather than re-derived per write stage. Re-deriving per stage
 * is not equivalent and is why this is a shared helper: `writeMessages`
 * stamps turn N, and a scan taken after it would read N and answer N+1 — so
 * beats written later in the same turn would carry a turn number no message
 * of theirs has, and their `msg-{turn}-{index}` references would point at
 * entries that do not exist.
 *
 * Cost: one paged `list()` per store per run, on the store the memory was
 * already going to talk to. Bounded by {@link MAX_SCAN_PAGES}.
 *
 * @see ../stages/writeMessages.ts   the id format this protects
 * @see ../causal/writeSnapshot.ts   the same rule, kept as self-defense for
 *                                   hand-composed (non-Agent) pipelines
 */
import type { MemoryEntry } from '../entry/index.js';
import type { MemoryIdentity } from '../identity/index.js';
import type { MemoryStore } from '../store/index.js';

/**
 * How many pages the scan will read before it stops asking. 100 pages of
 * 1000 is 100k entries in ONE conversation's namespace — far past any real
 * transcript, and a bound rather than a hang if an adapter's cursor never
 * terminates. Stopping early can only UNDER-count, which the `+1` and the
 * host's own floor then correct upward.
 */
const MAX_SCAN_PAGES = 100;

/** Page size requested per `list()` call. */
const SCAN_PAGE_SIZE = 1000;

/** A turn is a positive integer. Anything else is not a turn. */
function turnOf(entry: MemoryEntry<unknown>): number {
  const raw = entry.source?.turn;
  if (typeof raw !== 'number' || !Number.isFinite(raw)) return 0;
  const turn = Math.floor(raw);
  return turn > 0 ? turn : 0;
}

export interface MaxStoredTurnOptions {
  /**
   * Which entries count. Default: every entry that carries
   * `source.turn`. `writeSnapshot` narrows this to its own `snap-{n}` ids
   * so that its self-defense stays stable no matter what else shares the
   * namespace.
   */
  readonly turnFor?: (entry: MemoryEntry<unknown>) => number;
}

/**
 * The highest turn already stored in this identity's namespace — 0 when the
 * conversation has never been written to.
 *
 * Only LIVE entries are seen: `store.list` drops TTL-expired ones, the same
 * as every read path, so an expired turn 4 does not hold the numbering open.
 */
export async function maxStoredTurn(
  store: MemoryStore,
  identity: MemoryIdentity,
  options: MaxStoredTurnOptions = {},
): Promise<number> {
  const read = options.turnFor ?? turnOf;
  let max = 0;
  let cursor: string | undefined;
  let seen: string | undefined;
  for (let page = 0; page < MAX_SCAN_PAGES; page++) {
    const result = await store.list(identity, {
      limit: SCAN_PAGE_SIZE,
      ...(cursor !== undefined && { cursor }),
    });
    for (const entry of result.entries) {
      const turn = read(entry as MemoryEntry<unknown>);
      if (turn > max) max = turn;
    }
    if (result.cursor === undefined) break;
    // An adapter that hands back the cursor it was given would page forever.
    if (result.cursor === seen) break;
    seen = result.cursor;
    cursor = result.cursor;
  }
  return max;
}

export interface ResolveTurnNumberOptions {
  /**
   * The durable stores this conversation is written to. Every one is
   * consulted and the highest turn wins, so two memories sharing a
   * conversation agree on which turn it is even when they keep their
   * entries in different backends.
   *
   * Duplicates (the usual case — one store, several memories) are scanned
   * once.
   */
  readonly stores: readonly MemoryStore[];

  /** The conversation namespace to scan. */
  readonly identity: MemoryIdentity;

  /**
   * What the host believes the turn is — a FLOOR, never the last word. The
   * Agent derives it from the conversation it was handed (how many user
   * turns are already in the history), which is right for a followed-up
   * conversation and stale for a fresh agent per turn. Default 1.
   */
  readonly hostTurn?: number;
}

/**
 * Resolve the turn number this run should stamp on everything it writes.
 *
 * Returns at least 1, always. A store that throws is NOT swallowed: a memory
 * whose store is unreachable is going to fail on the next read anyway, and a
 * turn number quietly guessed here is how entries overwrite each other.
 */
export async function resolveTurnNumber(options: ResolveTurnNumberOptions): Promise<number> {
  const hostTurn = normalizeHostTurn(options.hostTurn);
  const stores = Array.from(new Set(options.stores));
  let stored = 0;
  for (const store of stores) {
    const max = await maxStoredTurn(store, options.identity);
    if (max > stored) stored = max;
  }
  return Math.max(hostTurn, stored + 1);
}

/** A host turn below 1 (or not a number at all) means "I do not know" → 1. */
export function normalizeHostTurn(hostTurn: number | undefined): number {
  if (typeof hostTurn !== 'number' || !Number.isFinite(hostTurn)) return 1;
  return Math.max(1, Math.floor(hostTurn));
}
