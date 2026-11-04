import {
  FINDINGS_LAYOUT,
  findingsContext,
  findingsContextBytes,
} from '../../core/agent/findings/context.js';
import type { LLMMessage } from '../../provider-contract/types.js';
import type { InjectionRecord } from '../../recorders/core/types.js';
import {
  contributingPieces,
  joinSystemPrompt,
  messagesFromInjections,
  stripFrameworkFields,
  toolsWithheld,
} from '../../core/agent/composeRequest.js';
import { findStagedRefs, stagedRefsNudgeLine } from '../../core/agent/stagedRefs.js';
import {
  evidenceConclusionLine,
  evidenceRecoveryPiece,
} from '../../core/agent/evidence/recovery.js';
import {
  collapseJudged,
  findingsLedgerPiece,
  servedToolCallIds,
} from '../../core/agent/findings/serve.js';
import type { FindingsLedger } from '../../core/agent/findings/types.js';
import { ontologyPiece } from '../../ontology/serve.js';
import { readAfterCall, readAtCall as foldAtCall, type EpochLocation } from '../epochs.js';
import { FORCED_OUTPUT_TOOL_KEY } from '../../core/agent/receipt/receipt.js';
import type { ServedGap, ServedPiece, ServedRequestOnly, ServedView } from '../servedView.js';
import { gapOf } from './gaps.js';
import { readAtCall, readReceipt, readRunConstant } from './recordReads.js';
import { answerAskOf, ontologyOf, servedModeOf, toolListOf, wantsMapOf } from './savedValues.js';
import { detachedList, frozenView } from './value.js';

/** Rebuild one epoch's view from a located epoch. */
export function viewOf(location: EpochLocation, served: boolean): ServedView {
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
  const injections = (readAtCall(location, 'systemPromptInjections', served) ??
    []) as InjectionRecord[];
  const iteration = readAtCall(location, 'iteration', served) as number;
  const recovery = evidenceRecoveryPiece(
    readAtCall(location, 'evidenceRecovery', served) as Parameters<typeof evidenceRecoveryPiece>[0],
    readAtCall(location, 'evidenceRecoveryUsed', served) as boolean | undefined,
    iteration,
  );

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
  const committedHistory = readAtCall(location, 'history', served);
  const committedInjections = readAtCall(location, 'messagesInjections', served);
  const conversation: LLMMessage[] | undefined = Array.isArray(committedHistory)
    ? (committedHistory as LLMMessage[])
    : Array.isArray(committedInjections)
    ? [...messagesFromInjections(committedInjections as InjectionRecord[])]
    : undefined;
  const committed: readonly LLMMessage[] = conversation ?? [];
  const history = stripFrameworkFields(committed);

  // ── the findings ledger, served (9.101.0, step 3) ──────────────────────
  // The SAME two pure functions the stage used, over the SAME committed
  // inputs, in the SAME order (`callLLM.ts · buildCallLLMStage`): the piece
  // from the ledger at the call and the wire's tool ids (nothing else — no
  // call number, so a re-ask rebuilds the same bytes it served) — derived
  // here as the stage derived them, from the COMMITTED conversation BEFORE
  // the collapse and the strip (an id is never rewritten, so either side
  // agrees; the batch settlement's marker, 9.113.0, is still on it — a
  // settled message is no result, `findings/offer.ts` · `isResultMessage`);
  // the collapse under the mode `seed` put on the record as the run constant
  // `findingsServe` (the `forcedOutputToolName` precedent — a build-time fact
  // read from the RECORD, never from the receipt this view is checked
  // against), stripped after it, and the answer-turn ask under the run
  // constant `findingsAnswerAsk` (9.103.0), written only when the ask went
  // out. No `.findings()` ⇒ no key ⇒ all three are no-ops and the rebuild is
  // the bytes it always was; no new gap kind, `withheld` untouched.
  const ledger = readAtCall(location, 'findingsLedger', served) as FindingsLedger | undefined;
  const recordedLayout = readAfterCall(location, 'findingsLayout');
  const recordedBound = readAfterCall(location, 'findingsContextBytes');
  let layoutUnknown = recordedLayout !== undefined && recordedLayout !== FINDINGS_LAYOUT;
  let lateLayout = recordedLayout === FINDINGS_LAYOUT;
  if (lateLayout) {
    try {
      if (typeof recordedBound !== 'number') throw new Error('Missing bound');
      findingsContextBytes(recordedBound);
    } catch {
      lateLayout = false;
      layoutUnknown = true;
    }
  }
  // No discriminator means the original saved layout, never the installed version.
  const findings =
    lateLayout || layoutUnknown
      ? undefined
      : findingsLedgerPiece(
          ledger,
          servedToolCallIds(committed),
          answerAskOf(readRunConstant(location, 'findingsAnswerAsk', served)),
        );
  const collapsed = collapseJudged(
    committed,
    ledger,
    servedModeOf(readRunConstant(location, 'findingsServe', served)),
  );
  const asSent = collapsed === committed ? history : stripFrameworkFields(collapsed);

  // ── the declared ontology, served (9.106.0) ────────────────────────────
  // The SAME pure function the stage used, over the run constant `seed`
  // wrote (the `findingsServe` precedent — a build-time fact read from the
  // RECORD, never from the receipt this view is checked against). No
  // `.ontology()` ⇒ no key ⇒ no piece, and the rebuild is the bytes it
  // always was.
  const ontologyRecord = ontologyOf(readRunConstant(location, 'ontology', served));
  // The hidden skill ids the call was composed under (9.108.0) — a per-epoch
  // key the Injection Engine's mount publishes, read at the call as the stage read it.
  const hiddenAtCall = readAtCall(location, 'hiddenSkillIds', served) as
    | readonly string[]
    | undefined;
  const ontology =
    ontologyRecord === undefined
      ? undefined
      : ontologyPiece(ontologyRecord.spec, {
          ...(ontologyRecord.tools !== undefined && { tools: ontologyRecord.tools }),
          ...(hiddenAtCall !== undefined && { hiddenSkillIds: hiddenAtCall }),
        });

  // ── the system prompt, joined ──────────────────────────────────────────
  // Injections, then the recovery piece, then the ontology piece, then the
  // findings piece — the fixed order the stage joins in. Every request-only
  // piece is joined, never committed as an injection.
  const composedPieces =
    recovery === undefined && ontology === undefined && findings === undefined
      ? injections
      : [
          ...injections,
          ...(recovery === undefined ? [] : [recovery]),
          ...(ontology === undefined ? [] : [ontology]),
          ...(findings === undefined ? [] : [findings]),
        ];
  const pieces: ServedPiece[] = contributingPieces(composedPieces).map((record) => ({
    text: record.rawContent,
    slot: record.slot,
    source: record.source,
  }));

  // ── the tools ──────────────────────────────────────────────────────────
  // `dynamicToolSchemas` is the PRE-assembly list. Two rules run after it and
  // both are on the record: a withheld call (the wrap-up, or any call after
  // the evidence revision under an enforcing answer validation —
  // `composeRequest.ts` · `toolsWithheld`) is served no tool, and a
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
  const withheld = toolsWithheld(
    readAtCall(location, 'wrapUpAsked', served),
    readAtCall(location, 'toolsOffAfterRevision', served),
  );
  const dynamic =
    toolListOf(readAtCall(location, 'dynamicToolSchemas', served)) ??
    toolListOf(readAtCall(location, 'toolSchemas', served)) ??
    [];
  const registered = withheld !== null ? [] : dynamic;
  const forcedRaw = readRunConstant(location, FORCED_OUTPUT_TOOL_KEY, served);
  const forced = typeof forcedRaw === 'string' && forcedRaw.length > 0 ? forcedRaw : undefined;

  // ── the request-only lines ─────────────────────────────────────────────
  // The staged-refs nudge is a pure function of committed state: the
  // conversation, the tools really served this call, and the `wants`
  // declarations `seed` put on the record for exactly this reason.
  const requestOnly: ServedRequestOnly[] = [];
  const wants = wantsMapOf(readRunConstant(location, 'toolWantsByName', served));
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
  // The time line (step T6b) — the tools slot's committed composition, served only on the
  // iteration that composed it and never on the wrap-up call (`callLLM` · the same three tests).
  const timeLine = readAtCall(location, 'timeLine', served) as
    | { readonly iteration?: unknown; readonly text?: unknown }
    | undefined;
  if (
    withheld === null &&
    typeof timeLine?.text === 'string' &&
    timeLine.text.length > 0 &&
    timeLine.iteration === readAtCall(location, 'iteration', served)
  ) {
    requestOnly.push({ role: 'user', text: timeLine.text, reason: 'time-window-line' });
  }
  // The evidence conclusion (the figures dial) — the committed carrier's late
  // line, on the iteration its instruction is served (`callLLM` · the same test).
  const conclusion = evidenceConclusionLine(
    readAtCall(location, 'evidenceRecovery', served) as Parameters<
      typeof evidenceConclusionLine
    >[0],
    readAtCall(location, 'evidenceRecoveryUsed', served) as boolean | undefined,
    iteration,
  );
  if (conclusion !== undefined) {
    requestOnly.push({ role: 'user', text: conclusion, reason: 'evidence-conclusion' });
  }

  if (lateLayout) {
    try {
      requestOnly.push({
        role: 'user',
        text: findingsContext(
          committed,
          foldAtCall(location, 'findingsLedger') as FindingsLedger | undefined,
          recordedBound as number,
        ),
        reason: 'findings-data',
      });
    } catch {
      layoutUnknown = true;
    }
  }

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
    system: { text: joinSystemPrompt(composedPieces), pieces },
    messages: { asSent: detachedList(asSent), requestOnly },
    tools: {
      names: [...registered.map((t) => t.name), ...(forced !== undefined ? [forced] : [])],
      schemas: detachedList(registered),
      ...(forced !== undefined && { forced }),
      ...(withheld !== null && { withheld }),
    },
    gaps,
  });
}
