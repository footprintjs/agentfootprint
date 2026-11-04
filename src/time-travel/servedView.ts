/**
 * servedView — the request an epoch was SERVED, rebuilt from what was
 * committed, plus an honest list of what the log cannot rebuild.
 *
 * Role:  Fold. `servedAt` reads a finished run's commit log and returns the
 *        model-facing request that epoch's call assembled; `receiptAt` reads
 *        the fingerprint that call left behind. Neither executes anything,
 *        records anything, or stores anything beside the log.
 * Reads: a recording, through `epochs.ts` (which log, which index) and
 *        footprintjs's `commitValueAt`.
 * Emits: N/A.
 *
 * ── THE LAW ────────────────────────────────────────────────────────────────
 *
 *     hash(servedAt(k)) === receiptAt(k).hash
 *
 * The receipt is minted at the stop, from the values about to go out. The
 * served view is rebuilt afterwards, from the values that were committed. When
 * the two agree, the record is complete: everything the model read is derivable
 * from the trace. When they disagree, something reached the model that the run
 * never wrote down — and that is a defect in the RECORD, not in the check.
 * `test/time-travel/receipt-conformance.test.ts` is where the law is
 * enforced; five real divergences were found by running it and each one was
 * closed by committing a fact or declaring a gap, never by loosening it.
 *
 * ── WHY THE REBUILD DOES NOT RE-IMPLEMENT THE ASSEMBLY ─────────────────────
 * The joined system string is a local inside the calling stage; it is never
 * committed, only its pieces are. So the rebuild has to apply the identical
 * join to the identical records — which is why the join is one exported
 * function, `composeRequest.ts` · `joinSystemPrompt`, called by the stage on
 * the way out and by this file on the way back. Same for the framework-field
 * strip and the staged-refs nudge. A second implementation of any of them would
 * make this file agree with itself and disagree with the wire.
 *
 * ── WHAT A GAP IS ──────────────────────────────────────────────────────────
 * A `ServedGap` is a fact this view cannot PROVE — because the log cannot
 * rebuild it, because the recording travelled without the base it folds
 * against, or because the fact lives past the boundary a receipt is minted at.
 * It is on the view rather than left implicit because a rebuild that quietly
 * omits a piece looks exactly like a rebuild that proved the piece was absent.
 * Naming the gap is what keeps the two apart.
 *
 * ── A GAP, NOT AN `undefined` ──────────────────────────────────────────────
 * When the rebuild cannot recover the conversation at all — a chart that
 * commits neither `history` nor `messagesInjections`, or a recording whose
 * fold base did not travel — `servedAt` still returns a view, carrying a gap,
 * rather than `undefined`.
 *
 * The alternative was tried and it is worse. Returning `undefined` withholds
 * the system prompt, the tool list and the request-only lines, all of which
 * this recording CAN prove, in order to avoid overstating one field it cannot.
 * A Lens may omit; it may not deny — and dropping four proved facts to hide
 * one hole omits more than the hole does. The gap says exactly which field is
 * unproved, in wording a renderer prints verbatim, and leaves the rest
 * standing.
 *
 * ── EVERY CHART THAT SERVES A MODEL MINTS, EXCEPT WHERE IT CANNOT SALT ─────
 * Until 9.91.0 `buildReceipt` was called from exactly one place — the agent
 * charts' `call-llm` stage (`stages/callLLM.ts`) — and the three other charts
 * that hand a model a request (`LLMCall.ts` · `callLLM`,
 * `buildMessageApiChart`, `buildAgentMessageApiChart`) left
 * `no-receipt-on-chart` on every view they produced. Two reasons were recorded
 * for that at the time. NEITHER survived.
 *
 * The first was the cache verdict: `Receipt.cache.transform` was said to have
 * no honest value on a chart that runs no cache strategy, because
 * `'unchanged'` would claim a strategy returned what it was given when none
 * ran. But an `Agent` running a pass-through strategy records exactly that
 * today — `buildReceipt` compares the request it was handed against itself —
 * and `receipt-conformance.test.ts` asserts it and calls it correct. No fourth
 * enum value was needed, and none was added.
 *
 * The second was the SALT, and it survives on exactly two of the three charts
 * and not for the reason first written down. `LLMCall` owns its executor and
 * mints a run id per run exactly as `Agent` does (a paragraph here said
 * otherwise until 9.88.0, in a sentence a renderer printed verbatim), so it
 * mints. The message-API charts are exported chart BUILDERS handed to an
 * executor the CALLER owns, and nothing in a stage's scope carries that
 * executor's run id — so their deps take one (`getRunId`), and they mint when
 * they are given one. Given none they mint NOTHING rather than salting every
 * hash with an empty string, because the salt is what makes shipping
 * fingerprints in a recording safe (`core/agent/receipt/receipt.ts`, the third law).
 *
 * So a receipt-less view is still a shape this library produces — a chart
 * builder run without a run id, a run that declined with `recordReceipt:
 * false`, a consumer's own `call-llm` stage, a recording made before 9.88.0 —
 * and the absence is DECLARED: `no-receipt-on-chart` names the fields only a
 * receipt carries and says what follows for them. The rebuild never needed the
 * receipt to work; what it loses is the WITNESS.
 *
 * ── AND THE CAUSE IS A VALUE, NOT A LIST INSIDE A SENTENCE ────────────────
 * That gap's sentence used to end with the causes that produce it. That is
 * PROSE DOING DATA'S JOB: a frozen constant cannot know what happened at the
 * site it is printed beside, so it listed the causes somebody could think of —
 * and a path it had never accounted for, the shape refusal by `readReceipt`
 * in `recordReads.ts`, made the count and verdict false without a string edit.
 * The discriminating fact moved to the one place that holds it: `readReceipt`
 * reports whether the receipt key held nothing or held something it refused,
 * and {@link ServedGap.cause} carries that answer out.
 *
 * ── AND THEN THE MECHANISM WENT TOO (9.88.0, sixth round) ─────────────────
 * Five rounds tried to write TRUE mechanism sentences, and the rate of new
 * falsehoods did not fall. The sixth round applied one question to all ten
 * printed sentences — COULD THIS BECOME FALSE WITHOUT ANYONE EDITING IT? —
 * and nine could, two of them being false the day they shipped. Exactly one
 * could not, and it is the one that makes no claim about code at all:
 * `UNGAPPED_FIELDS.gaps`, which says what its field MEANS inside the account.
 * Nothing outside that sentence can falsify it.
 *
 * So the conclusion was not to write mechanism sentences better. It was to
 * STOP WRITING THEM. A printed gap sentence may now say only: which fields it
 * covers; what they mean on this view for the person reading (unproven,
 * possibly short, absent-means-unknown, unchecked against what went out); and
 * what to do differently. It may not name a module, a function, a key, a
 * version, a chart, a strategy, an option, or any mechanism at all. If a
 * sentence needs one of those words to be understood, it is explaining WHY the
 * gap exists, which is not the printed sentence's job.
 *
 * NONE OF IT IS LOST. The mechanism is in the comment above each catalogue
 * entry, where a maintainer reads it and review catches its rot, with the
 * `file · symbol` pointers that are correct there and banned in printed prose.
 * The cause is already data. The docs may explain the mechanism at length,
 * because a doc is versioned with the code and its reader can open the file.
 * The rule is enforced by `test/helpers/gapProseClaims.ts`, which on the
 * printed surface admits no code-shaped token and no mechanism verb — close to
 * a whitelist, and a whitelist has no synonyms.
 *
 * ── AND THE SEVENTH ROUND MEASURED WHAT THE SIXTH HAD CLAIMED ─────────────
 * The sixth round said the reduction ENDED the class: a sentence with no code
 * claim in it cannot go false when the code changes. That was checked, sentence
 * by sentence, by driving a real run for each one — and it is not true. TEN of
 * the eleven reduced sentences still make a claim a code edit falsifies. The
 * one that does not is `UNGAPPED_FIELDS.gaps`, and it survives because it is
 * SELF-REFERENTIAL: it says what its field is inside the account, not anything
 * about the request. That is not a shape the other ten can copy. "May be
 * SHORT", "absent means unknown", "the list is complete and the schemas are one
 * short" are all claims about how the rebuild behaves, and the rebuild is code.
 * The reduction changed the VOCABULARY of the claims, not their CLASS.
 *
 * The same round proved what does close it, by finding a BRAND-NEW false
 * sentence in the round written to end false sentences: `no-run-log` shipped
 * "The fields below could not be fully recovered here", and on the ordinary
 * view that raises it nothing is lost at all. No rule caught that. A run
 * caught it.
 *
 * SO THE POSITION IS: a gap sentence MAY make a code claim, because a sentence
 * that makes none cannot inform. Every claim it makes is ASSERTED against a
 * real view in `test/time-travel/gap-sentences.test.ts`, which drives one
 * run per entry and checks the claim rather than the firing. The prose rule
 * STAYS — it keeps the sentences short and readable and stops the enumerations
 * coming back — but it is not what makes them true. The assertion is, and its
 * blind spot is honest and small: a claim nobody wrote an assertion for.
 */

import type { LLMMessage, LLMToolSchema } from '../provider-contract/types.js';
import type { ContextRole, ContextSlot, ContextSource } from '../events/types.js';
import type { StoredReceipt } from '../core/agent/receipt/receipt.js';
import { epochAt, epochLocations, recordingOf } from './epochs.js';
import { servedUnderPolicy } from '../redaction/marker.js';
import { readReceipt } from './servedView/recordReads.js';
import { viewOf } from './servedView/assembly.js';
import { SERVED_GAPS, UNGAPPED_FIELDS } from './servedView/gaps.js';
export { SERVED_GAPS, UNGAPPED_FIELDS };

/** One piece of the composed system string, in wire order. */
export interface ServedPiece {
  readonly text: string;
  readonly slot: ContextSlot;
  readonly source: ContextSource;
}

/** A line that was on the request and in no history. */
export interface ServedRequestOnly {
  readonly role: ContextRole;
  readonly text: string;
  /** Which library mechanism composed it — `'staged-refs-nudge'`, `'time-window-line'` (step T6b)
   *  or `'evidence-conclusion'` (the evidence gate's figures dial). */
  readonly reason: string;
}

/** The kinds of thing this view cannot prove. */
export type ServedGapKind =
  | 'findings-layout'
  | 'cache-transform'
  | 'thinking-replay'
  | 'forced-tool-schema'
  | 'provider-defaults'
  | 'no-fold-base'
  | 'no-conversation-on-record'
  | 'no-run-log'
  | 'no-receipt-on-chart';

/**
 * WHAT STOOD IN THE WAY, as far as the record shows — computed at the read that
 * failed, so it is a value and not a sentence.
 *
 * It exists because the alternative was tried and it went false. A gap's `why`
 * listed the causes somebody could think of; a cause nobody had thought of was
 * added; the sentence was wrong and nobody had edited it. A frozen constant
 * cannot know what happened at the site it is printed beside. The site can.
 *
 * The set is closed AT THE SITE, which is narrower than everything that can go
 * wrong upstream and is meant to be. A recording made before the receipt
 * existed, a chart whose LLM stage mints none, and a run that declined with
 * `recordReceipt: false` all leave the SAME record — no value under the receipt
 * key — so they all land on `'no-receipt-committed'`. Claiming to tell them
 * apart there would be this field repeating the defect it was added to fix.
 *
 * - `'no-receipt-committed'` — nothing was committed under the receipt key on
 *   this epoch's call.
 * - `'receipt-shape-rejected'` — something WAS committed there and the read
 *   refused it, because it carries no basis and a value without one is not a
 *   receipt. This is the value that means DAMAGE: a recording that lost or
 *   rewrote part of its own log. The other means the run simply never minted.
 */
export type ServedGapCause = 'no-receipt-committed' | 'receipt-shape-rejected';

/** One named limit on the rebuild, with the fields it covers — a hole the log
 *  cannot fill, or a boundary the record cannot see past. */
export interface ServedGap {
  readonly gap: ServedGapKind;
  /**
   * The fields this gap covers, in dotted `Receipt` form. A reader that
   * renders one of them should render this gap's sentence beside it.
   *
   * TWO RELATIONS LIVE ON THIS LIST, and a consumer that treats them as one
   * will draw a wrong conclusion in one direction or the other:
   *
   * - MOST gaps mean *the rebuild cannot produce this field* — the recording
   *   does not hold what it would take. `no-fold-base`, `no-run-log`,
   *   `no-conversation-on-record`, `no-receipt-on-chart`, `forced-tool-schema`,
   *   and the `cache.*` entries of `cache-transform` are all this kind. A
   *   checker may treat these as an EXCUSE.
   * - `cache-transform`'s COMPOSITION fields (`system.*`, `messages.*`,
   *   `tools.*`) are the other kind. WHEN NO OTHER GAP ON THE SAME VIEW NAMES
   *   THE SAME FIELD, the rebuild produces them and they agree with the
   *   receipt; both describe the request handed TO the cache strategy, and the
   *   port may have got something else. That is a CAVEAT to print, not an
   *   excuse to grant — a checker that excused these would stop checking
   *   fields the record proves perfectly well.
   *
   *   The qualifier is load-bearing and was missing until 9.88.0. A view that
   *   carries `cache-transform` may also carry `no-fold-base`, and there the
   *   rebuild does NOT agree: measured on a base-less recording, the receipt
   *   said 27 system chars over 3 turns and the rebuild produced 0 over 1.
   *   Read this entry as "up to the cache strategy" and read the OTHER gaps on
   *   the view for whether the rebuild got there at all.
   *
   *   Since 9.93.0 the entry is raised only where a strategy could have
   *   rewritten anything: where the receipt names one (`cache.strategy`), or
   *   where no receipt can say. A view whose receipt says `null` — `LLMCall`,
   *   the message-API charts — does not carry it, because nothing stood
   *   between assembly and the port for the caveat to be about.
   *
   * `provider-defaults`/`params` is the caveat kind too, and is the one field
   * read past the strategy: it describes the request the port really got, and
   * only the vendor lies beyond it. Its opposite number is
   * `no-receipt-on-chart`, which is the missing kind: no receipt was minted, so
   * `params` and everything else only a receipt carries is simply absent.
   *
   * `Receipt` paths WHEREVER THE TWO SHAPES HOLD THE SAME FACT, even though the
   * thing rendered beside them is usually a {@link ServedView}, because the two
   * sides of the law are checked field by field and only one of them can name
   * the fields. Three spellings differ and a renderer has to map them:
   * `system.hash` / `system.chars` are the view's `system.text`,
   * `messages.entries` / `messages.count` are its `messages.asSent`, and
   * `tools.schemaHashes` is its `tools.schemas`. The rest — `system.pieces`,
   * `messages.requestOnly`, `tools.names`, `tools.forced`, `tools.withheld`,
   * `params`, `cache.*`, `omittedForAttention` — are spelled the same on both,
   * or exist on the receipt alone.
   *
   * THE ONE EXCEPTION is the epoch number, and it is an exception because the
   * two shapes do not hold one fact there: they hold two RECORDS of it that can
   * disagree. The view's `epoch` is what the fold produced (a position, when it
   * could not read `iteration`) and `no-fold-base` names it under that
   * spelling; the receipt's `basis.epoch` was minted live from the run's own
   * counter and `no-receipt-on-chart` names it, because losing the receipt is
   * the only thing that loses it. Translating one to the other would print
   * whichever sentence is wrong: a missing base does not touch the receipt's
   * number, and a missing receipt does not touch the view's.
   *
   * A list rather than one name because a single missing fact can leave
   * several fields unproved: losing the run log costs the forced tool's name,
   * the tool list it belongs on, and the request-only lines composed from
   * `toolWantsByName`.
   */
  readonly fields: readonly string[];
  /**
   * The gap in the words a renderer prints — WHICH FIELDS it covers, WHAT THEY
   * MEAN ON THIS VIEW, WHAT TO DO DIFFERENTLY, and nothing else.
   *
   * IT NAMES NO MECHANISM. Not a module, not a function, not a key, not a
   * version, not a chart, not a strategy, not an option — because naming one
   * makes a sentence read like a description of code a reader cannot open, and
   * because the enumerations that went false in five review rounds all arrived
   * through that door. The mechanism is in the comment above each catalogue
   * entry, and the cause is data on {@link ServedGap.cause}.
   *
   * IT STILL MAKES CLAIMS, AND THAT IS THE POINT. The rule was sold for one
   * release as ending the class of sentences a code edit can falsify. Measured
   * sentence by sentence against real runs, it does not: ten of the eleven
   * reduced sentences claim something the code decides — that a count may be
   * short, that an empty list means unknown, that a tool list is complete. Only
   * `UNGAPPED_FIELDS.gaps` is claim-free, and only because it describes the
   * account rather than the request. A sentence that claims nothing cannot
   * inform, so the claims stay.
   *
   * WHAT MAKES THEM TRUE is `test/time-travel/gap-sentences.test.ts`: one
   * real run per entry, and an assertion for each claim the sentence makes —
   * not that the gap fired, but that what it says about the view holds. The
   * checker keeps the sentences short and readable; the assertions keep them
   * true. The blind spot is a claim nobody wrote an assertion for.
   */
  readonly why: string;
  /**
   * WHY this gap fired, where the site could establish it — {@link ServedGapCause}.
   *
   * Carried by `no-receipt-on-chart`, which is the gap whose sentence used to
   * list its causes. Absent elsewhere: a gap carries a cause when the site that
   * raised it read something that told it, and supplying one anywhere else
   * would be the enumeration coming back as a field.
   */
  readonly cause?: ServedGapCause;
}

/**
 * THE SERVED VIEW: what the model was handed on one epoch, rebuilt.
 *
 * A SERVED VIEW IS A VALUE. The whole of it is frozen — the object, its four
 * sub-objects and all six containers, down to the pieces and gaps it holds —
 * so the `readonly` on every field below is a fact and not a hint. Two of those
 * containers are also COPIES (`messages.asSent`, `tools.schemas`), because
 * those alone would otherwise alias the fold's memoized answers; see
 * `detachedList`. Copy before you edit: `structuredClone`, or a spread.
 *
 * @example
 * ```ts
 * import { servedAt } from 'agentfootprint';
 *
 * const view = servedAt(agent.getSnapshot()!, 1)!;
 * view.system.text;            // the joined system prompt, as sent
 * view.messages.asSent.length; // the turns that went out
 * view.tools.names;            // including a forced answer tool
 * view.basis?.model;           // which model saw it
 * view.gaps.map((g) => g.gap); // ['cache-transform', 'provider-defaults'] on an agent
 * ```
 */
export interface ServedView {
  /**
   * WHICH TURN THIS IS, as the fold read it — the run's own committed
   * `iteration`, and its POSITION in run order when the fold could not read
   * that (`EpochLocation.epoch`). `servedAt(k)` hands `k` back either way;
   * `servedViews()` returns the fold's number outright, so a base-less
   * recording can number a turn differently from the receipt that turn minted.
   * `gaps` carries `no-fold-base` exactly when that is possible.
   */
  readonly epoch: number;
  readonly callRuntimeStageId: string;
  /**
   * WHICH MODEL SAW THIS, and through which provider — read off the receipt's
   * own `basis`, which is the only place the run records them.
   *
   * Absent when this epoch's call left no receipt for the read to find. The
   * absence is DECLARED, not left to be noticed: `gaps` then carries
   * `no-receipt-on-chart`, which names this field, and that gap's
   * {@link ServedGap.cause} carries what the read established — the receipt key
   * held nothing, or held something that is not a receipt. The sentence itself
   * does not tell those apart and used to claim it did; a frozen sentence
   * cannot, which is why the fact is a field.
   *
   * It is the one field on this view that does not come from the rebuild, and
   * it is here because a served view without it cannot answer "what did THIS
   * model read" — only "what did something read". It is deliberately not part
   * of the conformance law: there is no committed counterpart to check it
   * against.
   *
   * @example
   * ```ts
   * import { servedAt } from 'agentfootprint';
   *
   * const view = servedAt(agent.getSnapshot()!, 1)!;
   * `${view.basis?.model ?? 'unknown model'} read ${view.system.text.length} chars`;
   * ```
   */
  readonly basis?: {
    readonly model: string;
    readonly provider: string;
    /** The salt every hash on this epoch's receipt was taken with. */
    readonly runId: string;
  };
  readonly system: {
    readonly text: string;
    readonly pieces: readonly ServedPiece[];
  };
  readonly messages: {
    /** The conversation as it went out, post-strip, in wire order. FROZEN, and
     *  so are its messages: they come from a fold whose answers seed every
     *  later epoch's — see `keyedFold.ts` · `freezeDeep`. Copy to edit. */
    readonly asSent: readonly LLMMessage[];
    /** Lines composed for this request and written to no history. */
    readonly requestOnly: readonly ServedRequestOnly[];
  };
  readonly tools: {
    /** Every tool name on the request, forced answer tool included. */
    readonly names: readonly string[];
    /** The schemas the log holds. Short of `names` by the forced tool — see
     *  {@link SERVED_GAPS}. FROZEN, for the same reason `asSent` is. */
    readonly schemas: readonly LLMToolSchema[];
    /** The tool the model was forced to answer through. */
    readonly forced?: string;
    /** Why the tool list is empty when it would not otherwise be. */
    readonly withheld?: 'wrap-up' | 'evidence-revision';
  };
  /** What this rebuild could NOT recover, each naming the receipt field it
   *  explains. Never empty — see {@link SERVED_GAPS}. */
  readonly gaps: readonly ServedGap[];
}

/**
 * Rebuild what the model was SERVED on epoch `k`, from the run's committed
 * pieces alone.
 *
 * Works on a live snapshot and on a recording read back from JSON, in both
 * chart shapes, on a run whose conversation lives in `messagesInjections`
 * rather than `history` (`LLMCall`, the message-API charts), on a resumed run
 * (every read folds from the checkpoint the run was seeded with), on a
 * redacted run (the pieces are read exactly as the run committed them — a
 * redacted piece rebuilds to its redacted bytes, which is what the record says
 * a reader is allowed to see) and on a recording made before the receipt
 * existed.
 *
 * It returns `undefined` for ONE reason only: the run has no such epoch.
 * Anything it cannot prove about an epoch that DOES exist comes back as a
 * named entry in `gaps`, never as a missing view and never as a confident
 * empty one.
 *
 * @param source a runner (`Agent`, `LLMCall`) or a snapshot. Where no receipt
 *   was minted — a message-API chart handed no run id, a run that declined with
 *   `recordReceipt: false`, a chart of the caller's own — the rebuild is
 *   complete but UNCHECKED: `basis` is absent and `gaps` carries
 *   `no-receipt-on-chart` saying so.
 * @param epoch  the iteration number, 1-based — the run's own count.
 *
 * @example
 * ```ts
 * import { receiptAt, receiptHash, servedAt } from 'agentfootprint';
 *
 * const snapshot = agent.getSnapshot()!;
 * const view = servedAt(snapshot, 1)!;
 * const receipt = receiptAt(snapshot, 1)!;
 * receiptHash(receipt.basis.runId, view.system.text) === receipt.system.hash; // true
 * ```
 */
export function servedAt(source: unknown, epoch: number): ServedView | undefined {
  const recording = recordingOf(source);
  const location = epochAt(recording, epoch);
  return location === undefined ? undefined : viewOf(location, servedUnderPolicy(recording));
}

/**
 * Every epoch's served view, in run order — `servedAt` for a whole run, with
 * one pass over the recording instead of one per epoch.
 *
 * @example
 * ```ts
 * servedViews(agent.getSnapshot()!).map((v) => v.tools.names.length); // [3, 3, 0]
 * ```
 */
export function servedViews(source: unknown): ServedView[] {
  const recording = recordingOf(source);
  const served = servedUnderPolicy(recording);
  return epochLocations(recording).map((location) => viewOf(location, served));
}

/**
 * The receipt epoch `k`'s call left behind, or `undefined`.
 *
 * What comes back is a {@link StoredReceipt}: the receipt AS STORED, written
 * by the release that minted it. A recording is older than the reader that
 * opens it, so a container a later release added (`cache.strategy`, 9.93.0)
 * may be absent — and it is handed back absent, not repaired, because the
 * narrowing checks the basis and promises nothing past it. A reader reads the
 * receipt it is handed; a missing container is a fact about the vintage,
 * never a throw.
 *
 * `undefined` means one of two things on the record, and the same epoch's
 * `servedAt(...)` view carries which: its `no-receipt-on-chart` gap has a
 * {@link ServedGapCause}. Either nothing was committed under the receipt key —
 * a recording made before the receipt existed, a chart whose LLM stage mints
 * none, a run with `recordReceipt: false`, all of which leave that same record
 * — or something WAS committed there and `readReceipt` refused it, because it
 * is not a non-null object with a number at `basis.epoch`, and handing back a
 * half-object a caller reads `.basis.runId` off is worse than saying no.
 *
 * It also returns `undefined` when the run has no epoch `k` at all, which is
 * the answer `epochAt` gives and is not a fact about receipts; ask
 * `servedAt(source, k)` if you need to tell a missing epoch from a missing
 * receipt, because that one returns `undefined` for the missing epoch only.
 *
 * `servedAt` still rebuilds the view of an epoch that exists in every one of
 * these cases, which is what makes an old recording readable instead of
 * unreadable.
 *
 * The receipt comes back DEEP-FROZEN and is the same object every caller gets
 * for this epoch: it is a value folded out of the log, and a fold's answers are
 * detached (`keyedFold.ts` · `freezeDeep`). Copy it if you need to edit one.
 *
 * @example
 * ```ts
 * import { receiptAt } from 'agentfootprint';
 *
 * receiptAt(agent.getSnapshot()!, 3)?.tools.withheld; // 'wrap-up' on a wrap-up call
 * ```
 */
export function receiptAt(source: unknown, epoch: number): StoredReceipt | undefined {
  const location = epochAt(source, epoch);
  return location === undefined ? undefined : readReceipt(location).receipt;
}
