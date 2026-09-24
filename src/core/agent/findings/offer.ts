/**
 * findings/offer — the ids a model may name, and the results a standing
 * resolves against.
 *
 * Pattern: pure functions over a message list and the folded ledger (the
 *          twin of `serve.ts`'s piece: same input, same bytes; no scope, no
 *          I/O).
 * Role:    core/ layer leaf, imports `ledger.ts` only. ONE owner of two sets
 *          over the served wire, both read off `servedToolCallIds`:
 *            - `undeclaredIds` — served ids with NO standing, wire order; the
 *              piece's `undeclared:` line (`serve.ts · findingsLedgerPiece`),
 *              the honest absence.
 *            - `offeredResultIds` — THE OFFER: served ids the model may still
 *              name, newest first; bound into `previous[].toolCallId`'s enum
 *              at the decoration site (`buildToolsSlot`, after `mergeWire`,
 *              through `reserved.ts · withFindingsArgument`).
 *          and ONE identity source, `knownResults` — what `ledger.ts ·
 *          standingRowsFrom` resolves a named id against. The offer and the
 *          identity source read the SAME served history, so every id the
 *          offer lists resolves: the law "the offer is what the model may
 *          COPY" holds at the row, not only at the schema. All of them ask
 *          ONE predicate, `isResultMessage`: a message the batch settlement
 *          wrote (9.113.0, `LLMMessage.notDispatched`) is served — the model
 *          reads its sentence — and is no result, so it is never offered,
 *          resolved or counted undeclared.
 *
 * WHY AN OFFER. On a hosted model the ask "by its tool_result id" produced
 * standings named by ORDINAL ("0", "1"), recorded as `unknownId` and settling
 * nothing (docs/design/2026-09-findings-ledger-real-model.md). A model does
 * not copy a long opaque id from prose; it copies an enum member. The offer
 * is the enum. It is what the model may COPY, never what the library
 * resolves: an id outside it is recorded exactly as written
 * (`ledger.ts · standingRowsFrom`, `unknownId: true`) and never mapped to a
 * position.
 *
 * WHAT THE OFFER HOLDS — the results the model can still READ. A result with
 * no standing is served verbatim; a `fact` is stood on in the piece (its
 * assertions, under every serve mode) and served verbatim under the default
 * mode; an `open` result is served verbatim and carries `settles` — what a
 * later call may do. All three stay nameable, so a standing can be REVISED:
 * `open` → `fact` when a later call settles it, `fact` → `ruled-out` when a
 * conflict resolves; the fold's last-wins law (`ledger.ts · foldLedger`) is
 * reachable through the enum. A `noise` or `ruled-out` result leaves the
 * offer: it is a ticket on the wire under every mode (`serve.ts ·
 * collapses`) and the piece carries a count or one line, never the content,
 * so there is nothing left for the model to re-judge — a wrong `ruled-out`
 * is answered by a NEW call and a standing on its result. The instruction
 * asks the model to name a result again only to change its standing, so a
 * listed fact is not an invitation to restate it; the ask promises nothing.
 *
 * Newest first because the cap (`reserved.ts · FINDINGS_OFFER_CAP`) cuts the
 * tail: the results the model saw most recently are the ones a standing is
 * most likely about, and the ones the window keeps longest. A fact the
 * window holds (`keepLedgerFacts`) stays on the wire and therefore in the
 * offer until the cap cuts it — the cost of revision, stated on the design
 * page.
 */

import type { LLMMessage } from '../../../adapters/types.js';
import { foldLedger, type PreviousResult } from './ledger.js';
import type { FindingsLedger, Standing, StandingRow } from './types.js';

/**
 * The standings after which a result leaves the offer: a ticket on the wire
 * under every serve mode, a count or one line in the piece — nothing left to
 * re-judge. Every other current standing (`fact`, `open`) and no standing at
 * all keep the id nameable.
 */
export const RETIRING_STANDINGS: readonly Standing[] = Object.freeze(['noise', 'ruled-out']);

/**
 * Is this message a tool's RESULT — the only thing a standing can be about?
 * A `role: 'tool'` message the batch settlement wrote (9.113.0,
 * `LLMMessage.notDispatched`) is not: the call never ran, so there is nothing
 * to stand on. Read off the marker, never the sentence — which is why every
 * caller hands these functions the COMMITTED conversation, not the wire,
 * where `stripFrameworkFields` has already removed the marker (ids and order
 * are the same either way).
 */
export function isResultMessage(m: LLMMessage): boolean {
  return m.role === 'tool' && m.notDispatched === undefined;
}

/**
 * The `role: 'tool'` ids on a message list, in wire order, each once — a
 * settled message excluded (`isResultMessage`). A message without an id, or
 * with an empty one, contributes nothing. The collapse (`serve.ts ·
 * collapseJudged`) never changes an id, so the list is the same before and
 * after it.
 */
export function servedToolCallIds(messages: readonly LLMMessage[]): readonly string[] {
  const ids: string[] = [];
  const seen = new Set<string>();
  for (const m of messages) {
    if (!isResultMessage(m)) continue;
    const id = m.toolCallId;
    if (id === undefined || id.length === 0 || seen.has(id)) continue;
    seen.add(id);
    ids.push(id);
  }
  return ids;
}

/**
 * The served ids no standing names — each once, in the order given, whatever
 * the caller repeated. `standingOf` is `foldLedger(rows).standingOf`: a
 * standing declared on the ANSWER turn is in it like any other, so it
 * removes the id too. The piece's `undeclared:` line; NOT the offer, which
 * keeps `fact` and `open` ids (`offeredResultIds`).
 */
export function undeclaredIds(
  served: readonly string[],
  standingOf: ReadonlyMap<string, StandingRow>,
): string[] {
  const seen = new Set<string>();
  const ids: string[] = [];
  for (const id of served) {
    if (standingOf.has(id) || seen.has(id)) continue;
    seen.add(id);
    ids.push(id);
  }
  return ids;
}

/**
 * The served ids the model may still name — each once, in the order given:
 * every id whose current standing is absent or not in `RETIRING_STANDINGS`.
 * `standingOf` is `foldLedger(rows).standingOf`, so a `noise` later revised
 * to `fact` is nameable again and a `fact` later retired is not.
 */
export function nameableIds(
  served: readonly string[],
  standingOf: ReadonlyMap<string, StandingRow>,
): string[] {
  const seen = new Set<string>();
  const ids: string[] = [];
  for (const id of served) {
    if (seen.has(id)) continue;
    const current = standingOf.get(id);
    if (current !== undefined && RETIRING_STANDINGS.includes(current.standing)) continue;
    seen.add(id);
    ids.push(id);
  }
  return ids;
}

/**
 * THE OFFER: the ids of the `role: 'tool'` messages on `messages` whose
 * current standing on `rows` is absent, `fact` or `open`, NEWEST FIRST (the
 * reverse of wire order), each once. `rows` may be absent (no declaration
 * yet): every served result is then offered. Pure — safe on a deep-frozen
 * history and a spread of the committed ledger. Uncapped here; the cap and
 * its statement belong to the schema (`reserved.ts · offeredFindingsSchema`).
 */
export function offeredResultIds(
  messages: readonly LLMMessage[],
  rows: FindingsLedger | undefined,
): readonly string[] {
  const { standingOf } = foldLedger(rows ?? []);
  return nameableIds(servedToolCallIds(messages), standingOf).reverse();
}

/**
 * THE IDENTITY SOURCE a standing resolves against (`ledger.ts ·
 * standingRowsFrom`): the previous batch first (`AgentState.toolResults` —
 * what landed this iteration, `result` verbatim), then every `role: 'tool'`
 * message on the served history read as a result (`content` is the string
 * the tool-calls stage appended — a placed result's ticket included, so
 * `artifact:<ref>` still resolves), each id once, first entry winning. Run-
 * scoped by construction: the history is the offer's own universe
 * (`offeredResultIds` reads the same list), so an id copied from the offer —
 * this batch's or an earlier one's — resolves to its tool name. The batch is
 * read first because it is the stage's own record of what landed this
 * iteration (the same string under the same id the history carries, so the
 * order changes no row; it is the source the rows resolved against before
 * the history joined). An id in neither is `unknownId`, as written. A tool
 * message with no `toolName` yields a result with none: nothing is invented
 * for it. A settled message (`isResultMessage`) is no result, so a model that
 * names its id anyway files `unknownId` — the batch never holds one: a
 * settled call never joins `toolResults`.
 */
export function knownResults(
  messages: readonly LLMMessage[],
  previousBatch: readonly PreviousResult[] = [],
): readonly PreviousResult[] {
  const seen = new Set<string>();
  const out: PreviousResult[] = [];
  const add = (entry: PreviousResult) => {
    if (entry.toolCallId.length === 0 || seen.has(entry.toolCallId)) return;
    seen.add(entry.toolCallId);
    out.push(entry);
  };
  for (const r of previousBatch) add(r);
  for (const m of messages) {
    if (!isResultMessage(m) || m.toolCallId === undefined) continue;
    add({
      toolCallId: m.toolCallId,
      ...(m.toolName !== undefined && { toolName: m.toolName }),
      result: m.content,
    });
  }
  return out;
}
