import { RECEIPT_BOUNDARY, type StoredReceipt } from '../../core/agent/receipt/receipt.js';
import type { ServedGap, ServedGapCause, ServedGapKind } from '../servedView.js';
import type { LLMMessage } from '../../provider-contract/types.js';
import type { EpochLocation } from '../epochs.js';

type GapRead =
  | {
      readonly receipt: Pick<StoredReceipt, 'cache' | 'replayPreparations'>;
      readonly cause?: undefined;
    }
  | { readonly receipt?: undefined; readonly cause: ServedGapCause };

/**
 * The gap catalogue. Exported because a reader that renders a served view
 * renders its gaps beside it, and a renderer should print the library's own
 * sentence rather than invent one.
 */
export const SERVED_GAPS: Readonly<Record<ServedGapKind, Omit<ServedGap, 'gap'>>> = Object.freeze({
  'thinking-replay': Object.freeze({
    // The leaf reports preparation, not successful transport. Port hashes
    // remain valid; they must not be presented as the downstream wire body.
    fields: Object.freeze(['messages.entries', 'requestMeasurement']),
    why: 'Saved thinking was omitted after the request shown here was prepared. The messages and size shown are before that omission, not proof of what was sent or accepted.',
  }),
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
    // strategy has had it. Like `requestMeasurement`, it is read past the
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
    // `requestMeasurement` is also receipt-only: its counts describe the
    // initial PREPARED request, not the composition rebuilt by this view.
    // Losing the whole receipt loses that witness. An older receipt may
    // itself omit the optional field, and an attempted measurement may say
    // `unavailable`; receiptAt preserves those states, never zero counts.
    // Neither state means the receipt is missing or changes this gap's cause.
    // The same applies to replayPreparations: downstream preparation was
    // observed only when the enabled receipt carries its annotation.
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
      'requestMeasurement',
      'replayPreparations',
    ]),
    why:
      'Nothing on this view has been checked against what went out. Every field below is ' +
      'missing as a whole, and an absence among them says nothing about the call — not even ' +
      'that a dial was left unset.',
  }),
  'findings-layout': Object.freeze({
    fields: Object.freeze([
      'system.pieces',
      'system.chars',
      'messages.requestOnly',
      'messages.count',
      'messages.entries',
    ]),
    why: 'The findings context is unproven here. Its absence does not show that none was served.',
  }),
  'no-run-log': Object.freeze({
    // MECHANISM (not printed). Raised on `!location.hasRunLog` — a SUBTREE
    // handed in on its own, with no run log to read. `readRunConstant` is the
    // only reader that touches that log, and everything it fetches is a
    // build-time fact `stages/seed.ts` wrote once: the forced output tool's
    // NAME (`FORCED_OUTPUT_TOOL_KEY`), `toolWantsByName`, which
    // `findStagedRefs` composes the nudge from, and — 9.101.0 — the findings
    // ledger's serve mode (`findingsServe`), which `collapseJudged` folds
    // judged tool results under. Losing that last one costs nothing on the
    // default mode (`servedModeOf` falls back to it); under the bench-gated
    // `'ledger-only'` the rebuilt `messages.entries` would carry fact results
    // verbatim where the receipt hashed tickets — a subtree without its run
    // log, on a mode no default reaches, recorded here rather than widened
    // into `fields`.
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
 * question a walk answers: `test/time-travel/gap-catalogue-walk.test.ts`
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

/** A gap record, assembled from the catalogue — plus, where the site that
 *  raises it established one, the cause it read. */
export function gapOf(kind: ServedGapKind, cause?: ServedGapCause): ServedGap {
  return { gap: kind, ...SERVED_GAPS[kind], ...(cause !== undefined && { cause }) };
}

/** Project every gap in its original priority order, without additional record reads. */
export function gapsOf(
  location: EpochLocation,
  layoutUnknown: boolean,
  conversation: readonly LLMMessage[] | undefined,
  read: GapRead,
  forced: string | undefined,
): ServedGap[] {
  const receipt = read.receipt;
  // ── what this view cannot prove ────────────────────────────────────────
  // Order is deliberate: the two that make the WHOLE view suspect come first,
  // so a renderer that shows one gap shows the one that matters most.
  const gaps: ServedGap[] = [];
  if (layoutUnknown) gaps.push(gapOf('findings-layout'));
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
  if (receipt?.replayPreparations !== undefined) gaps.push(gapOf('thinking-replay'));
  if (forced !== undefined) gaps.push(gapOf('forced-tool-schema'));
  return gaps;
}
