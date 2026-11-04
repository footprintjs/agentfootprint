import type { LLMMessage } from '../../provider-contract/types.js';
import { FINDINGS_LAYOUT, findingsContextBytes } from '../../core/agent/findings/context.js';
import {
  collapseJudged,
  findingsLedgerPiece,
  servedToolCallIds,
  type FindingsAnswerAsk,
  type FindingsServeMode,
} from '../../core/agent/findings/serve.js';
import { stripFrameworkFields } from '../../core/agent/composeRequest.js';
import type { FindingsLedger } from '../../core/agent/findings/types.js';
import { readAfterCall, type EpochLocation } from '../epochs.js';
import { readAtCall, readRunConstant } from './recordReads.js';

/**
 * The serve mode `seed` put on the record (`findingsServe`), narrowed the way
 * every run constant is: only the one non-default literal changes anything,
 * and an absent or unrecognised value is the default the wire itself falls
 * back to (`callLLM.ts · buildCallLLMStage`, `deps.findingsServe ?? …`) — so
 * an unarmed run, which never wrote the key, collapses nothing.
 */
function servedModeOf(value: unknown): FindingsServeMode {
  return value === 'ledger-only' ? 'ledger-only' : 'ledger-and-facts';
}

/**
 * The answer-turn ask `seed` put on the record (`findingsAnswerAsk`, 9.103.0),
 * narrowed the same way: only the one literal the wire ever writes appends
 * the ask, and an absent key is the default the stage itself falls back to
 * (`deps.findingsAnswerAsk ?? 'none'`) — so an armed run on the default,
 * which never wrote the key, rebuilds the piece it served.
 */
function answerAskOf(value: unknown): FindingsAnswerAsk {
  return value === 'quote-facts' ? 'quote-facts' : 'none';
}

/** Resolve the saved findings layout, legacy piece and collapsed conversation. */
export function findingsAt(
  location: EpochLocation,
  served: boolean,
  committed: readonly LLMMessage[],
  history: readonly LLMMessage[],
): readonly [
  findings: ReturnType<typeof findingsLedgerPiece>,
  asSent: readonly LLMMessage[],
  lateLayout: boolean,
  recordedBound: unknown,
  layoutUnknown: boolean,
] {
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
  return [findings, asSent, lateLayout, recordedBound, layoutUnknown];
}
