/**
 * llm-ledger/limits — every cap the ledger holds, in ONE frozen table.
 *
 * Pattern: one table, read by every check. A cap written as a number anywhere
 *          else in the folder is a second owner, so the builders, the entry
 *          checks and both stores read `LEDGER_LIMITS` and nothing else.
 * Role:    the closed leaf's own vocabulary. Imports nothing.
 * Emits:   N/A.
 *
 * Characters are counted as Unicode code points (what a JSON Schema
 * `maxLength` counts), bytes as UTF-8. A line is one stored entry as the file
 * store writes it (`store.ts` · `lineBytesOf`); the memory store measures the
 * same line, so both stores hold the same caps.
 */
export const LEDGER_LIMITS = Object.freeze({
  /** Entries in one session, all kinds counted. */
  maxEntries: 10_000,
  /** Bytes of one session's log: the sum of its lines. */
  maxLogBytes: 32 * 1024 * 1024,
  /** Bytes of one line. */
  maxLineBytes: 256 * 1024,

  /** A receipt's `source`: 1–128 characters, no control characters. */
  minSourceChars: 1,
  maxSourceChars: 128,
  /** A receipt's `query`. */
  maxQueryChars: 1_024,
  /** Distinct tokens one receipt or supplied entry keeps. */
  maxTokens: 2_048,
  /** A token's length. */
  minTokenChars: 4,
  maxTokenChars: 64,
  /** Bytes of the host's text read for tokens; the rest is counted, never read. */
  maxTextBytes: 1_048_576,
  /** A receipt's `ref.uri`. */
  maxRefUriChars: 512,
  /** A receipt's `externalId`. */
  maxExternalIdChars: 256,

  /** A note's `text`. */
  maxNoteChars: 2_000,
  /** A note's `values`: how many, and each one's length. */
  maxValues: 32,
  maxValueChars: 64,
  /** A note's `cites`. */
  maxCites: 32,
  /** A withdrawal's `why`. */
  maxWhyChars: 500,
  /** A submit's `claims`. */
  maxClaims: 64,
  /** Bytes of a draft (and of a delivered text). */
  maxDraftBytes: 64 * 1024,
  /** Tokens a check lists as `missing`; the rest are counted. */
  maxMissing: 32,
  /** Rules one session runs (`opened.rules`). */
  maxRules: 16,

  /** The file store's key, in bytes. */
  minKeyBytes: 32,
  /** How long an append waits for another writer's lock. */
  lockWaitMs: 2_000,
  /** A lock older than this was left by a writer that died; it is taken over. */
  lockStaleMs: 30_000,
  /** Sessions one high-water mark remembers; the least recently used is forgotten past it. */
  maxHighWaterSessions: 10_000,
} as const);

/** The cap table's type: every value a literal. */
export type LedgerLimits = typeof LEDGER_LIMITS;
