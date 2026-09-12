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
 * `test/lib/time-travel/receipt-conformance.test.ts` is where the law is
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
 * fingerprints in a recording safe (`receipt.ts`, the third law).
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
 * and a path it had never accounted for, the shape refusal in `readReceipt`
 * below, made the count AND the verdict false with nobody editing the string.
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
 * real view in `test/lib/time-travel/gap-sentences.test.ts`, which drives one
 * run per entry and checks the claim rather than the firing. The prose rule
 * STAYS — it keeps the sentences short and readable and stops the enumerations
 * coming back — but it is not what makes them true. The assertion is, and its
 * blind spot is honest and small: a claim nobody wrote an assertion for.
 */

import type { LLMMessage, LLMToolSchema } from '../../adapters/types.js';
import type { ContextRole, ContextSlot, ContextSource } from '../../events/types.js';
import type { InjectionRecord } from '../../recorders/core/types.js';
import {
  contributingPieces,
  joinSystemPrompt,
  messagesFromInjections,
  stripFrameworkFields,
} from '../../core/agent/composeRequest.js';
import { findStagedRefs, stagedRefsNudgeLine } from '../../core/agent/stagedRefs.js';
import { epochAt, epochLocations, readAfterCall, readAtCall, readRunConstant } from './epochs.js';
import type { EpochLocation } from './epochs.js';
import {
  FORCED_OUTPUT_TOOL_KEY,
  RECEIPT_BOUNDARY,
  RECEIPT_KEY,
  type StoredReceipt,
} from './receipt.js';

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
  /** Which library mechanism composed it — `'staged-refs-nudge'` today. */
  readonly reason: string;
}

/** The kinds of thing this view cannot prove. */
export type ServedGapKind =
  | 'cache-transform'
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
   * WHAT MAKES THEM TRUE is `test/lib/time-travel/gap-sentences.test.ts`: one
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
 * The gap catalogue. Exported because a reader that renders a served view
 * renders its gaps beside it, and a renderer should print the library's own
 * sentence rather than invent one.
 */
export const SERVED_GAPS: Readonly<Record<ServedGapKind, Omit<ServedGap, 'gap'>>> = Object.freeze({
  'cache-transform': Object.freeze({
    // MECHANISM (not printed — see the header's rule). A `CacheStrategy`'s
    // `prepareRequest` is handed the whole composed request after assembly and
    // hands one back; `buildReceipt` fingerprints the one it was GIVEN. So the
    // field list is everything a rewrite could have touched, not only the
    // `cache.*` fields that DESCRIBE the rewrite — listing those alone named
    // the report and excused nothing it reports on.
    //
    // THE RULE FOR THIS LIST is the request the strategy holds: `systemPrompt`
    // (→ `system.*`), `messages` (→ `messages.*`), `tools` and `toolChoice`
    // (→ every `tools.*` field). `tools.forced` and `tools.withheld` were
    // missing until 9.93.0 (`recorded-not-built.md`, entry 7): `callLLM.ts`
    // writes both from assembly's own decision — `deps.schemaTool?.name`,
    // `scope.wrapUpAsked` — and never from `preparedRequest`, so a strategy
    // that dropped the answer tool from `request.tools` or emptied the list
    // would leave a receipt whose `forced`/`withheld` describe a request the
    // port was not handed. `params` is the one field deliberately NOT here:
    // it is read off `preparedRequest`, past the strategy.
    //
    // RAISED WHERE A STRATEGY COULD HAVE REWRITTEN (9.93.0, entry 8). Until
    // this release `viewOf` pushed it unconditionally — including on charts
    // that run no strategy at all — because `cache.transform: 'unchanged'`
    // could not tell "a strategy returned what it was given" from "there was
    // no strategy", and inferring the second from any other committed key is
    // the absence-of-evidence reading this whole file refuses. The receipt
    // now carries the fact (`cache.strategy`, `null` when none ran), so the
    // condition is: raised when the receipt names a strategy, OR when there is
    // no receipt to say — a pre-9.93.0 receipt, a receipt-less chart, a
    // refused shape. Absent only where the record SAYS nothing stood between
    // assembly and the port.
    //
    // THE DAY-ONE FALSEHOOD THIS ENTRY SHIPPED WITH, killed in 9.88.0's sixth
    // round: the printed sentence said "only its INPUTS are on the record".
    // Three of its own fields are OUTPUTS and are on the record —
    // `cache.transform` (the verdict of comparing given against returned),
    // `cache.transformHash` (the digest of what came back when it differed)
    // and `cache.markersApplied` (the breakpoints the strategy actually
    // applied, as against the candidates in `scope.cacheMarkers`, which are
    // the inputs). A sentence describing the mechanism went false about the
    // mechanism; the sentence below describes only what the fields MEAN.
    //
    // This entry is the weakest claim on the list wherever it appears: it says
    // the rebuild stops before whatever the request met next, never that the
    // rebuild got that far. Whether it did is what the other gaps on the same
    // view say — see the qualifier on `ServedGap.fields`.
    //
    // AND BEING RAISED ON RECEIPT-LESS VIEWS IS WHY IT DOES NOT QUOTE
    // `RECEIPT_BOUNDARY` (9.88.0, seventh round). That sentence opens "A
    // receipt describes the request as this library last saw it" — and this
    // entry is still printed on views that have no receipt at all. Measured: a
    // message-API chart run with no run id carries exactly
    // `['no-receipt-on-chart', 'cache-transform']`, so the reader was told what
    // a receipt describes beside a view that has none. The boundary CLAIM is
    // not lost — the first sentence below is that claim in the vocabulary of a
    // view, and it is true whether or not a receipt exists. The quote stays on
    // `provider-defaults`, which fires only where a receipt was read.
    fields: Object.freeze([
      'cache.transform',
      'cache.transformHash',
      'cache.markersApplied',
      'cache.strategy',
      'system.hash',
      'system.chars',
      'system.pieces',
      'messages.count',
      'messages.entries',
      'messages.requestOnly',
      'tools.names',
      'tools.schemaHashes',
      'tools.forced',
      'tools.withheld',
    ]),
    why:
      'What reached the provider may differ from the fields below, and nothing on this view ' +
      'would show it. Where another gap on this view covers one of them, that gap is the ' +
      'stronger claim.',
  }),
  'forced-tool-schema': Object.freeze({
    // MECHANISM (not printed). Under a `'tool-forced'` output strategy the
    // synthetic answer tool is added at assembly from a build-time schema that
    // no stage commits, so `tools.schemaHashes` on the receipt carries a row
    // the rebuild has no counterpart for. The tool's NAME is a run constant
    // (`FORCED_OUTPUT_TOOL_KEY`, written by `stages/seed.ts`), which is why
    // `tools.names` and `tools.forced` rebuild and the schema body does not.
    fields: Object.freeze(['tools.schemaHashes']),
    why:
      'The schema body behind the forced answer tool is not on this view. Its name is, so the ' +
      'tool list is complete and the schemas beside it are one short.',
  }),
  'provider-defaults': Object.freeze({
    // MECHANISM (not printed). `buildReceipt` reads `params` off the PREPARED
    // request — the object `LLMProvider.complete` is handed, after any cache
    // strategy has had it — so it is the one part of a receipt read past the
    // strategy, and `cache-transform` deliberately does not name it. What is
    // still past the record is the vendor: an adapter or SDK can resolve a
    // final value the port never saw. `params` is also VALUE-CONDITIONAL —
    // `buildReceipt` writes no key for a dial nobody set — which is the whole
    // reason the printed sentence has to say what an absent key means.
    //
    // THE ONE ENTRY THAT QUOTES `RECEIPT_BOUNDARY`, and it is the only one that
    // honestly can: it is pushed inside `if (receipt !== undefined)`, so a view
    // carrying it always has a receipt for that sentence to be about.
    // `cache-transform` quoted it too until 9.88.0's seventh round, and
    // `cache-transform` is raised on the receipt-less views — where the reader
    // was told what a receipt describes beside a view that has none. Measured:
    // a message-API chart run with no run id carries `no-receipt-on-chart` and
    // `cache-transform`, and never this entry.
    fields: Object.freeze(['params']),
    why:
      'A dial absent below was not recorded; that is not the same as the model running ' +
      'without one. ' +
      RECEIPT_BOUNDARY,
  }),
  'no-fold-base': Object.freeze({
    // MECHANISM (not printed). Raised when `location.basis` or
    // `location.runBasis` is `'log-only'` — the recording travelled without the
    // `initialState` the fold folds against (`getSnapshot({ redact: true })`
    // hands back exactly that shape: the log travels, the base does not), so
    // every read can see only what the log itself wrote. A rebuild that
    // recovered one turn of three reports one; a system prompt it could not
    // read at all is 0 characters rather than unknown; and `EpochLocation.epoch`
    // falls back to POSITION when it cannot read the run's committed
    // `iteration`, which is how a view can call the second turn the first while
    // that turn's own receipt still says 2.
    //
    // TWO bases, so every field the rebuild reads through a fold. The epoch's
    // own log rebuilds the system prompt, the conversation, the tool schemas
    // and the wrap-up flag; the RUN's log holds the run constants the forced
    // tool name and the staged-refs nudge are composed from. Under
    // 'dynamic-grouped' those are different logs with different bases, and a
    // gap raised off only the first denied the second.
    //
    // THE RULE FOR THIS LIST is mechanical, so it does not go short again: a
    // field belongs here when the rebuild derives it from `readAtCall` or
    // `readRunConstant` — both fold over values the log itself may never have
    // written, so both read absent when the base did not travel. `readAfterCall`
    // is the THIRD reader and is deliberately NOT on the rule: the only thing
    // read through it is the receipt, which the call's own bundle commits, so it
    // is there whatever the base. Naming it made the rule read wider than the
    // mechanism and put the receipt's own fields inside a gap that cannot touch
    // them. `system.chars` and `messages.count` were missed on the first two
    // passes because they are COUNTS of things the list already named, and a
    // short rebuild makes a count wrong exactly as it makes the thing wrong.
    //
    // `epoch` — THE VIEW'S OWN NUMBER — is here for a fourth reason, in
    // `EpochLocation.epoch`'s own words: a fold that cannot read `iteration`
    // numbers the epoch by its POSITION instead. Measured on a resumed run with
    // its base and its `iteration` writes gone, the rebuild called the second
    // turn epoch 1 while that turn's own receipt still said 2. The RECEIPT's
    // `basis.epoch` is NOT here and used to be: it is minted live and rides in
    // the call's bundle, so no missing base can move it. That inversion — the
    // list naming the number a missing base cannot touch, while the number it
    // fabricates was excused as ungappable — is what 9.88.0's fourth review
    // round found.
    //
    // THE PRINTED CLAUSE STOPPED NAMING THE RECEIPT (seventh round). It read
    // "may differ from the one the receipt for this turn carries", and this
    // gap is raised on views that have no receipt to carry anything — a
    // base-less recording of a chart that minted none gets both gaps at once. The fact a reader
    // needs is about the NUMBER, not about the witness: it may be the turn's
    // place in run order rather than the count the run kept. Measured on a
    // resumed run with its base and its `iteration` writes gone, the view calls
    // the second turn the first while that turn's own receipt still says 2.
    fields: Object.freeze([
      'system.hash',
      'system.chars',
      'system.pieces',
      'messages.count',
      'messages.entries',
      'messages.requestOnly',
      'tools.schemaHashes',
      'tools.names',
      'tools.forced',
      'tools.withheld',
      'epoch',
    ]),
    why:
      'The fields below are unproven and may be SHORT: a count can be lower than what really ' +
      'went out, and a value that could not be recovered reads as empty rather than as ' +
      "unknown. The turn number below may be this turn's place in run order rather than the " +
      'number the run itself gave it.',
  }),
  'no-conversation-on-record': Object.freeze({
    // MECHANISM (not printed). `viewOf` reads the conversation from `history`
    // (the agent charts) or, failing that, from `messagesInjections` (`LLMCall`
    // and the message-API charts, which have no history at all). Neither
    // committed ⇒ `conversation` is `undefined` and `asSent` is `[]`, which is
    // indistinguishable from a call that really sent nothing — hence the gap.
    //
    // `messages.requestOnly` is on the list for a second reason: the
    // staged-refs nudge is recomposed FROM the conversation by `findStagedRefs`,
    // so a rebuild with no conversation finds no refs and reports no nudge,
    // which looks exactly like a call that had none.
    fields: Object.freeze(['messages.count', 'messages.entries', 'messages.requestOnly']),
    why:
      'The turns that went out are unknown, not empty: an empty list here is the absence of a ' +
      'record, never a record of absence. The request-only lines are unproved with them.',
  }),
  'no-receipt-on-chart': Object.freeze({
    // Exactly the fields ONLY a receipt carries — the ones no rebuild produces,
    // so with no receipt they are absent rather than short. Everything else on
    // the view is folded from committed pieces as usual; what it loses is not
    // the value but the WITNESS, and the sentence below says so, because a
    // field list cannot.
    //
    // MECHANISM (not printed). Raised when `readReceipt` returns no receipt —
    // either nothing was committed under `RECEIPT_KEY` (a recording made before
    // the receipt existed, a run with `recordReceipt: false`, a message-API
    // chart handed no run id to salt with, or a consumer's own `call-llm`
    // stage, which this library does not mint for) or something WAS committed
    // there and was refused for carrying no basis. Every chart in this library
    // that CAN salt its hashes mints since 9.91.0.
    // Which of the two is {@link ServedGap.cause}, computed at that read.
    // Everything else on the view is still folded from committed pieces; what
    // it loses is the WITNESS, not the value.
    //
    // THE DAY-ONE FALSEHOOD THIS ENTRY SHIPPED WITH, killed in 9.88.0's sixth
    // round: the printed sentence opened "No receipt was found for this epoch"
    // and closed "absent here means unrecorded". Both are false under
    // `'receipt-shape-rejected'`, where a value WAS found and WAS recorded and
    // the read refused it. The sentence asserted a cause; the cause is a field.
    // The sentence below says only what the fields mean, which is the same
    // under either cause.
    //
    // TWO CHANGES in 9.88.0's fourth review round, both of them the same test:
    // does this gap's MECHANISM cause this field's absence?
    //   • `basis.epoch` JOINED the list. It is a receipt-only field like the
    //     other three on `basis`, and with no receipt it is gone with them. It
    //     used to be named by `no-fold-base` alone, which cannot touch it.
    //   • `omittedForAttention` LEFT it. It was absent on EVERY view, receipt
    //     or not — no chart IN THIS LIBRARY supplied it — so a gap about the
    //     missing receipt was explaining an absence it does not cause, and on a
    //     view that HAS a receipt nothing explained it at all. It went to
    //     `UNGAPPED_FIELDS` with the reason that was true of it then.
    //   • …AND CAME BACK in 9.93.0, because the measurement behind that reason
    //     was incomplete: the agent chart's WINDOW STAGE drops turns for budget
    //     on every run whose strategy engages, and since 9.93.0 it hands them
    //     to the mint (`window/evictedTurns.ts`). The field is value-
    //     conditional — absent when nothing was dropped before the call — and
    //     the one thing that can lose a recorded drop is losing the receipt,
    //     which is this gap. `cache.strategy` joined for the same reason: a
    //     receipt-only fact, gone with the receipt.
    //
    // AND THE SEVENTH ROUND SCOPED THE PRINTED CLAIM TO THE LEVEL IT HOLDS AT.
    // It said the absence of these fields is "a gap in the record, never a call
    // made without them". True of each field AS A WHOLE — a receipt always
    // carries `params` and always carries a `cache.transform` verdict, so those
    // containers go missing only with the receipt. FALSE one level down, and
    // that is the level a reader reads at: measured on an agent that set no
    // dials, `receipt.params` is `{}` — an absence inside the container that IS
    // "a call made without one", and `provider-defaults` says so on the very
    // views that have a receipt. The sentence below claims nothing about what
    // is inside a field it cannot see.
    fields: Object.freeze([
      'basis.model',
      'basis.provider',
      'basis.runId',
      'basis.epoch',
      'params',
      'cache.transform',
      'cache.transformHash',
      'cache.markersApplied',
      'cache.strategy',
      'omittedForAttention',
    ]),
    why:
      'Nothing on this view has been checked against what went out. Every field below is ' +
      'missing as a whole, and an absence among them says nothing about the call — not even ' +
      'that a dial was left unset.',
  }),
  'no-run-log': Object.freeze({
    // MECHANISM (not printed). Raised on `!location.hasRunLog` — a SUBTREE
    // handed in on its own, with no run log to read. `readRunConstant` is the
    // only reader that touches that log, and everything it fetches is a
    // build-time fact `stages/seed.ts` wrote once: the forced output tool's
    // NAME (`FORCED_OUTPUT_TOOL_KEY`) and `toolWantsByName`, which
    // `findStagedRefs` composes the nudge from.
    //
    // `tools.schemaHashes` is on the list because the forced tool's NAME is the
    // run constant: losing it also loses the row the receipt hashes under that
    // name. The fix a reader has is to pass the whole recording rather than the
    // subtree, which is what the printed sentence says without naming any of
    // this.
    //
    // THE MEASURED-FALSE SENTENCE, killed in 9.88.0's seventh round. It said
    // "The fields below could not be fully recovered here" — a claim that the
    // recovery DID fail. Driven on the ordinary view that raises this gap (a
    // 'dynamic-grouped' agent with one plain tool, run log emptied), the
    // damaged rebuild is byte-identical to the intact one: same `tools.names`,
    // same `tools.schemas`, same absent `tools.forced`, same empty
    // `messages.requestOnly`. The gap fires and costs NOTHING, and the sentence
    // told the reader otherwise.
    //
    // THE REPAIR IS THE SENTENCE, NOT THE CONDITION, and the reason is that the
    // condition cannot be narrowed by anything this file can read. What the
    // missing log would have held is a forced tool's name and a `wants`
    // declaration; whether the run had either is recorded IN THAT LOG. To fire
    // the gap only where it costs something, the read would have to consult the
    // record whose absence raises it. So the gap stays unconditional — it is
    // the "you cannot tell" declaration, which is what this file is for — and
    // the sentence became the conditional it always was: the fields MAY be
    // short. Both directions are measured beside it in
    // `gap-sentences.test.ts`: emptying the run log on a forced-output run
    // takes the tool list from one name to none, on a staged-refs run it takes
    // away the request-only line, and on the plain run it takes nothing.
    fields: Object.freeze([
      'tools.names',
      'tools.forced',
      'tools.schemaHashes',
      'messages.requestOnly',
    ]),
    why:
      'The fields below may be SHORT: a name can be missing from the tool list, and a line ' +
      'that went out with the request can be missing too. An absence below is not evidence ' +
      'that there was nothing there — read the whole recording rather than a piece of it.',
  }),
});

/**
 * The fields no gap names, and the reason each one needs none — the OTHER half
 * of the account.
 *
 * WHY IT EXISTS. `SERVED_GAPS` was hand-checked against the two shapes three
 * times in one release and came up short every time, because "is every field
 * named by a gap?" was a question a person answered by reading. It is now a
 * question a walk answers: `test/lib/time-travel/gap-catalogue-walk.test.ts`
 * enumerates every field a real `Receipt` and a real `ServedView` carry and
 * requires each one to be named by a gap OR to be a key here. A field in
 * neither fails, by name.
 *
 * So this is not an exemption list. It is the place a field goes when NO GAP'S
 * MECHANISM EXPLAINS IT, and the value is the reason in one sentence, for the
 * next person who asks why the field has no gap. Adding a key here is as
 * reviewable as adding one to a gap, and that is the point: both are a claim
 * somebody wrote down.
 *
 * TWO reasons qualified when this list was written, and one of them has since
 * emptied out:
 *
 *   • NO FOLD CAN FAIL TO PRODUCE IT — the field is read straight off the
 *     located epoch, never through a fold. `callRuntimeStageId` is this kind.
 *   • ITS ABSENCE IS UNIVERSAL AND HAS NOTHING TO DO WITH THIS RECORDING — no
 *     chart IN THIS LIBRARY supplies it, on any run, so no gap about a limit of
 *     the rebuild describes it. `omittedForAttention` WAS this kind from
 *     9.88.0's fourth review round to 9.93.0, and is not any more: the
 *     measurement it rested on ("no chart drops for attention") had missed the
 *     agent chart's window stage, which evicts turns for budget on every run
 *     whose strategy engages and now files them on the receipt. A recorded
 *     drop can be lost in exactly one way — with the receipt — so the field is
 *     named by `no-receipt-on-chart` and is not here. The kind is kept on this
 *     list because the next universally-absent field will need it, and because
 *     a reason that was true for five releases and then measured false is
 *     worth a sentence where the next person looks.
 *
 * A field a gap DOES name never belongs here, whatever else is also true of it.
 * `epoch` was a key here through three rounds, on the true-but-irrelevant
 * ground that `servedAt(k)` hands `k` back; what a base-less fold changes is
 * what that number MEANS, `servedViews()` returns the fold's number outright,
 * and `no-fold-base` names it now.
 *
 * Paths are spelled as they are on the shape that HAS the field — both keys
 * here are `ServedView` fields. Gap `fields` are spelled as `Receipt` paths —
 * see {@link ServedGap.fields} for the places the two shapes differ.
 *
 * @example
 * ```ts
 * import { SERVED_GAPS, UNGAPPED_FIELDS } from 'agentfootprint';
 *
 * // Why does nothing explain `callRuntimeStageId`? Because nothing has to.
 * UNGAPPED_FIELDS['callRuntimeStageId'];
 * Object.keys(SERVED_GAPS).length; // 7 gap kinds
 * ```
 */
export const UNGAPPED_FIELDS: Readonly<Record<string, string>> = Object.freeze({
  // MECHANISM (not printed). Read straight off `EpochLocation.callRuntimeStageId`,
  // which `epochAt` takes from the call's own commit bundle — never through
  // `keyedFold`, so no missing base and no missing run log can touch it. An
  // epoch with no bundle is not located at all, so there is no view to carry it.
  callRuntimeStageId: 'Never absent here, so there is nothing about it for a gap to excuse.',
  // THE SENTENCE THE RULE IS MODELLED ON. It makes no claim about code at all:
  // it says what the field MEANS inside the account, and nothing outside the
  // sentence can falsify it. Every other entry in this file was reduced to
  // this shape in 9.88.0's sixth round.
  gaps:
    'The account itself rather than a fact about the request: a gap naming this list would be ' +
    'the account excusing its own absence.',
});

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
    readonly withheld?: 'wrap-up';
  };
  /** What this rebuild could NOT recover, each naming the receipt field it
   *  explains. Never empty — see {@link SERVED_GAPS}. */
  readonly gaps: readonly ServedGap[];
}

/** A gap record, assembled from the catalogue — plus, where the site that
 *  raises it established one, the cause it read. */
function gapOf(kind: ServedGapKind, cause?: ServedGapCause): ServedGap {
  return { gap: kind, ...SERVED_GAPS[kind], ...(cause !== undefined && { cause }) };
}

/** The receipt, or the reason there is none — the shape `readReceipt` answers
 *  in. */
type ReceiptRead =
  | { readonly receipt: StoredReceipt; readonly cause?: undefined }
  | { readonly receipt?: undefined; readonly cause: ServedGapCause };

/**
 * The receipt this epoch's call committed, or WHY there is none. Shared by
 * `receiptAt` and by the rebuild, which reads exactly TWO things off a receipt
 * — the model/provider/runId basis, and whether a cache strategy stood between
 * assembly and the port — and nothing else.
 *
 * THE ONE PLACE THAT KNOWS. This function is where the difference between
 * "nothing was committed" and "something was committed and it is not a
 * receipt" exists at all: everywhere else the two are one `undefined`. It used
 * to be spent here, and the gap's printed sentence tried to make it up
 * afterwards from a list of causes — which is how a shape refusal added in this
 * release became a cause that sentence had already ruled out. So the answer
 * carries the reason out, and {@link ServedGap.cause} is where it lands.
 *
 * THE ONE PLACE THAT NARROWS, too — and what it admits is what it says it
 * admits. The check is the basis and nothing past it, so the value it hands
 * back is a {@link StoredReceipt}: every container past the basis is what the
 * MINTING release wrote, and a reader behind this narrowing reads them as
 * optional, because the type says so and the compiler holds it to that.
 * 9.93.0 read `receipt.cache.strategy` off a `Receipt` here — the minted
 * shape, which promises `cache` — and a stored receipt with a basis and no
 * `cache` made `servedAt` throw where 9.92 built a view. A reader reads the
 * receipt it is handed; a missing container is a fact about the vintage,
 * never a throw. It is also never repaired: nothing here fabricates a
 * `cache: {}` or writes to the record.
 */
function readReceipt(location: EpochLocation): ReceiptRead {
  const value = readAfterCall(location, RECEIPT_KEY);
  // Nothing under the key: the run never minted one here. The record does not
  // say which of the ways that happens applied, and neither does this.
  if (value === undefined) return { cause: 'no-receipt-committed' };
  // Something IS under the key. A value without a basis is not a receipt —
  // refuse it rather than hand back a half-shape a caller would read
  // `.basis.runId` off — and REPORT the refusal, because a log that holds a
  // non-receipt under the receipt key is damaged, which is a different fact
  // about the recording from a run that never minted.
  const candidate = value as Partial<StoredReceipt>;
  if (value === null || typeof value !== 'object' || typeof candidate.basis?.epoch !== 'number') {
    return { cause: 'receipt-shape-rejected' };
  }
  return { receipt: value as StoredReceipt };
}

/** A committed tool list, or `undefined` when the key held no array — which is
 *  what makes it a FALLBACK CHAIN and not a merge: the first key that holds a
 *  list is the list this call served, and an empty array is an answer. */
function toolListOf(value: unknown): LLMToolSchema[] | undefined {
  return Array.isArray(value) ? (value as LLMToolSchema[]) : undefined;
}

/** `toolWantsByName` back as the map `findStagedRefs` takes. It is committed
 *  as a plain record because a `Map` does not survive the scope's write path
 *  (an object write is JSON-round-tripped, and a `Map` round-trips to `{}`). */
function wantsMapOf(value: unknown): ReadonlyMap<string, readonly string[]> | undefined {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return undefined;
  const map = new Map<string, readonly string[]>();
  for (const [name, kinds] of Object.entries(value as Record<string, unknown>)) {
    if (Array.isArray(kinds) && kinds.every((k) => typeof k === 'string')) {
      map.set(name, kinds as readonly string[]);
    }
  }
  return map.size > 0 ? map : undefined;
}

/**
 * The BOUNDARY half of the fold law: a container that leaves this file is this
 * file's own.
 *
 * `keyedFold` deep-freezes its answers, so nothing a consumer does to a view
 * can reach a later epoch. This is the second, cheaper guarantee on top of it:
 * the two arrays a view would otherwise ALIAS straight out of the fold — the
 * conversation and the tool schemas — are copied, so `ServedView` is a value in
 * its own right and not a window onto the fold's cache. Elements are the fold's
 * frozen objects; the container is ours.
 *
 * Every other array on a view is built in `viewOf` from scratch and aliases
 * nothing, so it needs the COPY half of this and not the freeze — but it is
 * frozen anyway, by {@link frozenView}, because the type says `readonly`
 * throughout and a claim that is true of two containers out of six is a claim
 * a reader cannot use.
 */
function detachedList<T>(items: readonly T[]): readonly T[] {
  return Object.freeze([...items]);
}

/**
 * A `ServedView` is a VALUE — all of it, not the two containers that happened
 * to need copying.
 *
 * Freezing the whole view costs a handful of `Object.freeze` calls per epoch
 * over containers that are already the right size to hand a person: a few
 * system pieces, at most one request-only line, a tool list, the gaps. It buys
 * one sentence a reader can rely on instead of a rule about which two arrays
 * are safe. `messages.asSent` and `tools.schemas` are already frozen by
 * {@link detachedList} — their ELEMENTS are the fold's own frozen objects and
 * this function does not walk into them, because they are not ours to freeze
 * twice.
 *
 * What this is NOT: protection against a shared reference. Nothing on a view
 * except those two arrays is shared with anything — every other container is
 * built here per call. The freeze makes the type's promise exact; the copy in
 * `detachedList` is what makes the fold safe.
 */
function frozenView(view: ServedView): ServedView {
  for (const piece of view.system.pieces) Object.freeze(piece);
  Object.freeze(view.system.pieces);
  for (const line of view.messages.requestOnly) Object.freeze(line);
  Object.freeze(view.messages.requestOnly);
  Object.freeze(view.tools.names);
  for (const gap of view.gaps) Object.freeze(gap);
  Object.freeze(view.gaps);
  if (view.basis !== undefined) Object.freeze(view.basis);
  Object.freeze(view.system);
  Object.freeze(view.messages);
  Object.freeze(view.tools);
  return Object.freeze(view);
}

/** Rebuild one epoch's view from a located epoch. */
function viewOf(location: EpochLocation): ServedView {
  // The receipt is read for exactly two things — WHICH model saw this, through
  // WHICH provider, salted with WHICH run id; and whether a cache strategy
  // stood between assembly and the port. Every other field below is rebuilt
  // from committed pieces and never from the record it is checked against; a
  // rebuild that read its own answer sheet would prove nothing. Both reads go
  // through `readReceipt`'s narrowing and its type: a stored receipt carries
  // what its vintage wrote, and nothing below dereferences a container the
  // narrowing did not check.
  const read = readReceipt(location);
  const receipt = read.receipt;
  // ── the system prompt ──────────────────────────────────────────────────
  // The pieces are committed; the joined string never is. Same function the
  // stage used, over the records as the stage read them.
  const injections = (readAtCall(location, 'systemPromptInjections') ?? []) as InjectionRecord[];
  const pieces: ServedPiece[] = contributingPieces(injections).map((record) => ({
    text: record.rawContent,
    slot: record.slot,
    source: record.source,
  }));

  // ── the conversation ───────────────────────────────────────────────────
  // Read BEFORE the call's own bundle: the call appends the assistant turn to
  // `history`, so the committed value at the call already includes the answer.
  //
  // TWO committed sources, because there are two kinds of chart and they do
  // not agree on where the conversation lives. The agent charts keep it in
  // `history` and treat `messagesInjections` as an observability projection.
  // `LLMCall` and the message-API charts have NO history at all: the messages
  // slot IS the conversation, composed by `messagesFromInjections` — the same
  // function called here. Reading only `history` on those charts found nothing
  // and reported an empty conversation the provider never sent.
  //
  // Neither present ⇒ the turns are UNKNOWN, and the gap below says so rather
  // than letting `[]` pass for a proof.
  const committedHistory = readAtCall(location, 'history');
  const committedInjections = readAtCall(location, 'messagesInjections');
  const conversation: LLMMessage[] | undefined = Array.isArray(committedHistory)
    ? (committedHistory as LLMMessage[])
    : Array.isArray(committedInjections)
    ? [...messagesFromInjections(committedInjections as InjectionRecord[])]
    : undefined;
  const asSent = stripFrameworkFields(conversation ?? []);

  // ── the tools ──────────────────────────────────────────────────────────
  // `dynamicToolSchemas` is the PRE-assembly list. Two rules run after it and
  // both are on the record: the wrap-up call withholds every tool, and a
  // 'tool-forced' strategy adds one.
  //
  // TWO committed sources, for the same reason the conversation above has two
  // and with the same ordering rule (9.91.0). The agent charts map the tools
  // slot's output onto `dynamicToolSchemas` at the mount boundary; the
  // message-API charts carry it out under the slot's own name. Reading only
  // the first reported an EMPTY tool list on a chart that served three — a
  // Lens DENYING, about a fact the log holds perfectly well. The agent key is
  // read first and the fallback is reached only when it holds no array, so no
  // agent recording changes.
  const withheld = readAtCall(location, 'wrapUpAsked') === true;
  const dynamic =
    toolListOf(readAtCall(location, 'dynamicToolSchemas')) ??
    toolListOf(readAtCall(location, 'toolSchemas')) ??
    [];
  const registered = withheld ? [] : dynamic;
  const forcedRaw = readRunConstant(location, FORCED_OUTPUT_TOOL_KEY);
  const forced = typeof forcedRaw === 'string' && forcedRaw.length > 0 ? forcedRaw : undefined;

  // ── the request-only lines ─────────────────────────────────────────────
  // The staged-refs nudge is a pure function of committed state: the
  // conversation, the tools really served this call, and the `wants`
  // declarations `seed` put on the record for exactly this reason.
  const requestOnly: ServedRequestOnly[] = [];
  const wants = wantsMapOf(readRunConstant(location, 'toolWantsByName'));
  if (wants !== undefined) {
    const match = findStagedRefs(asSent, wants, new Set(registered.map((t) => t.name)));
    if (match !== undefined) {
      requestOnly.push({
        role: 'user',
        text: stagedRefsNudgeLine(match),
        reason: 'staged-refs-nudge',
      });
    }
  }

  // ── what this view cannot prove ────────────────────────────────────────
  // Order is deliberate: the two that make the WHOLE view suspect come first,
  // so a renderer that shows one gap shows the one that matters most.
  const gaps: ServedGap[] = [];
  // BOTH bases, because there are two folds above and either can be baseless.
  // Under 'dynamic-grouped' the epoch's pieces come from the turn's own inner
  // log (`location.basis`) and every run constant — the forced tool's name, the
  // `wants` the nudge is composed from — comes from the RUN log
  // (`location.runBasis`). Raising the gap off the first alone let a grouped
  // recording that travelled without its RUN base read every constant as absent
  // and declare NOTHING: a Lens denying rather than omitting, which is the law
  // this whole file is built on.
  if (location.basis === 'log-only' || location.runBasis === 'log-only') {
    gaps.push(gapOf('no-fold-base'));
  }
  if (conversation === undefined) gaps.push(gapOf('no-conversation-on-record'));
  if (!location.hasRunLog) gaps.push(gapOf('no-run-log'));
  // No receipt ⇒ nothing checks the rebuild, and the receipt-only fields are
  // absent. Mutually exclusive with `provider-defaults` below, which is the
  // caveat that applies when a receipt DID record the dials.
  //
  // The CAUSE rides along, from the one read that can tell "nothing was
  // committed" from "something was, and it is not a receipt". The gap's
  // sentence says neither — see {@link ServedGap.cause}.
  if (read.receipt === undefined) gaps.push(gapOf('no-receipt-on-chart', read.cause));
  // A rewrite is possible only where a strategy stood between assembly and
  // the port. The receipt says whether one did (`cache.strategy`, 9.93.0);
  // with no receipt, or a receipt minted before the field — or the whole
  // `cache` container — existed, the record cannot rule one out and the gap
  // stays — the "you cannot tell" declaration, never an inference from
  // absence. Only a receipt that SAYS `null` lifts it. The optional chain is
  // the vintage law, not defensiveness: `StoredReceipt` declares both
  // containers optional, so this is the one spelling that compiles.
  if (receipt?.cache?.strategy !== null) {
    gaps.push(gapOf('cache-transform'));
  }
  if (receipt !== undefined) gaps.push(gapOf('provider-defaults'));
  if (forced !== undefined) gaps.push(gapOf('forced-tool-schema'));

  return frozenView({
    epoch: location.epoch,
    callRuntimeStageId: location.callRuntimeStageId,
    ...(receipt !== undefined && {
      basis: {
        model: receipt.basis.model,
        provider: receipt.basis.provider,
        runId: receipt.basis.runId,
      },
    }),
    system: { text: joinSystemPrompt(injections), pieces },
    messages: { asSent: detachedList(asSent), requestOnly },
    tools: {
      names: [...registered.map((t) => t.name), ...(forced !== undefined ? [forced] : [])],
      schemas: detachedList(registered),
      ...(forced !== undefined && { forced }),
      ...(withheld && { withheld: 'wrap-up' as const }),
    },
    gaps,
  });
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
  const location = epochAt(source, epoch);
  return location === undefined ? undefined : viewOf(location);
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
  return epochLocations(source).map(viewOf);
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
