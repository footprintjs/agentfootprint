/**
 * inputCeiling — how long a piece of text may be before the embedder stops
 * reading it, and what to say when one was longer.
 *
 * Pattern: one resolver + one message, shared by every door that embeds a
 *          corpus (`indexCorpus`, `indexFolder`, `indexDocuments`), so the
 *          arithmetic cannot drift between them.
 * Role:    memory/embedding layer — it sits beside the port whose field it
 *          reads.
 * Emits:   N/A.
 *
 * ── Why the number is resolved rather than fixed ────────────────────────────
 * An indexer's own default ceiling is a guess about a backend it has never
 * met, so it has to be the SMALLEST ceiling any embedder might have — 2,000
 * characters, the measured `localEmbedder` cliff. That default was safe and
 * wrong at the same time: safe for the on-device model it was measured on,
 * wrong by a factor of sixteen for a hosted model with an 8k-token window, and
 * silently wrong for anyone who raised their splitter's `maxChars` to a value
 * their embedder could read perfectly well. Measured in a production run: 6 of
 * 26 chunks clipped, with an embedder that would have read every one of them
 * whole.
 *
 * So the ceiling is resolved from three sources, most-specific first:
 *
 *   1. the caller's explicit `maxChunkChars` — they are allowed to know better
 *      than either of the below, and stating a number is how they say so;
 *   2. the embedder's declared `maxInputChars` — the number lives where the
 *      knowledge is;
 *   3. {@link DEFAULT_MAX_CHUNK_CHARS} — an embedder that declares nothing
 *      gets exactly the behaviour it had before this field existed.
 *
 * ── Why the message, and not just a number in a report ──────────────────────
 * A clipped chunk is stored WHOLE as the passage and indexed by its opening.
 * Retrieval then cannot find text that is plainly visible in the block the
 * model is later shown — which reads as "the corpus does not mention that",
 * not as a failure. The report has carried the list since 8.10.0 and nobody
 * reads a report that says everything went fine, so the count also gets said
 * out loud, once per run.
 */
import type { Embedder } from './types.js';

/**
 * The ceiling used when nothing better is known: the measured `localEmbedder`
 * cliff (512 wordpiece tokens ≈ 1,800–2,000 characters of English).
 *
 * It is the floor of the shipped range, deliberately — a ceiling that is too
 * LOW only over-reports, and a ceiling that is too HIGH clips in silence.
 */
export const DEFAULT_MAX_CHUNK_CHARS = 2000;

/** Where the ceiling in effect came from — the thing a message has to name. */
export type ChunkCeilingSource = 'explicit' | 'embedder' | 'default';

/** The ceiling in effect for one indexing call, and where it came from. */
export interface ChunkCeiling {
  /** Longest chunk, in characters, that this embedder reads whole. */
  readonly chars: number;
  readonly source: ChunkCeilingSource;
}

/**
 * Resolve the ceiling for one indexing call.
 *
 * A non-positive or non-finite value is treated as absent at BOTH levels: it
 * cannot describe a real ceiling, and honouring it would mark every chunk in
 * the corpus as truncated (or none of them) on the strength of a typo.
 */
export function resolveChunkCeiling(
  explicit: number | undefined,
  embedder: Pick<Embedder, 'maxInputChars'> | undefined,
): ChunkCeiling {
  if (isUsable(explicit)) return { chars: Math.floor(explicit), source: 'explicit' };
  const declared = embedder?.maxInputChars;
  if (isUsable(declared)) return { chars: Math.floor(declared), source: 'embedder' };
  return { chars: DEFAULT_MAX_CHUNK_CHARS, source: 'default' };
}

function isUsable(value: number | undefined): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0;
}

/**
 * The one sentence a run says out loud when something was clipped.
 *
 * It names the count (so the size of the hole is known), the ceiling AND where
 * it came from (so the reader knows which knob is theirs to turn), and the two
 * fixes — because "your index is silently incomplete" is useless without
 * "here is the line to change".
 */
export function truncationWarning(args: {
  /** The door that did the work, named as the caller wrote it. */
  readonly caller: string;
  /** How many pieces were longer than the ceiling. */
  readonly count: number;
  /** How many pieces there were in total. */
  readonly total: number;
  /** What the pieces are called at this door — 'chunk' or 'document'. */
  readonly noun: string;
  readonly ceiling: ChunkCeiling;
  /** The embedder's id, when it has one — which embedder's ceiling this is. */
  readonly embedderId?: string | undefined;
  /**
   * Where the affected ids can be read back, when the door hands back
   * something that carries them. Omitted at a door that returns only a count,
   * rather than pointing at a report that does not exist.
   */
  readonly idsIn?: string | undefined;
  /**
   * The "make the pieces smaller" half of the fix, in the caller's own terms —
   * a door that splits for you names its splitter; one that does not says how
   * to cut before calling it. Advice you cannot act on at the door you are
   * standing at is not advice.
   */
  readonly resplitHint?: string | undefined;
}): string {
  const { caller, count, total, noun, ceiling } = args;
  const who = args.embedderId ? `'${args.embedderId}'` : 'the embedder';
  const provenance =
    ceiling.source === 'explicit'
      ? `the maxChunkChars you passed`
      : ceiling.source === 'embedder'
      ? `${who}'s declared maxInputChars`
      : `the default — ${who} declares no maxInputChars`;
  return (
    `${caller}: ${count} of ${total} ${noun}(s) are longer than the ${ceiling.chars}-character ` +
    `input ceiling in effect (${provenance}), so they were embedded CLIPPED.\n` +
    `  The vector represents only the opening of each one, while the FULL text is stored and ` +
    `served as the passage — so retrieval cannot find wording that is plainly visible in the ` +
    `block the model is shown. Nothing throws and nothing scores zero; the corpus is quietly ` +
    `partially indexed.\n` +
    `  Fix:  ${args.resplitHint ?? "re-split smaller (lower the splitter's maxChars)"}, or raise ` +
    `maxChunkChars if ${who} really reads more than ${ceiling.chars} characters.` +
    (args.idsIn ? `\n  The affected ids are in ${args.idsIn}.` : '')
  );
}
