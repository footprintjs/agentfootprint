import type { ToolCallsHandlerDeps } from '../contracts/handlerDeps.js';
import type { TypedScope } from 'footprintjs';
import type { AgentState } from '../../../types.js';
import { columnTypesOf, readRowset } from '../../../../../integrity/column-types/check.js';
import { servedToModel } from '../../../../../semantics/coverage/read.js';
import { fileIntegrityFindings } from '../../../integrityFindings.js';
import type { LLMMessage } from '../../../../../provider-contract/types.js';
import { producerCorpusOf } from './producerCorpus.js';
import { emptyLookupOf, readLookupResult } from '../../../../../integrity/empty-lookup/check.js';
import { readAbsence } from '../../../../../semantics/coverage/index.js';
import type { ToolIntegrityOperations } from '../contracts/operations/integrity.js';

/** Compose the existing integrity callbacks once for this handler. */
export function buildToolIntegrityOperations(
  deps: Pick<
    ToolCallsHandlerDeps,
    'columnDeclarations' | 'columnCheckMode' | 'integrityLedger' | 'emptyLookupGrounding'
  >,
): ToolIntegrityOperations {
  /**
   * THE COLUMN-TYPE CONTRACT (9.78.0) — the tool declared what its rows
   * contain, and this is where the rows are.
   *
   * Placed at the SAME execute boundaries as `refuseOverCeiling` and for the
   * same reason: `resultColumns` is the TOOL AUTHOR's contract on the tool's
   * OWN return, so it is judged the moment the handler's value lands, before
   * governance, before placement, before the cap — and a resumed call is
   * judged exactly as an inline one.
   *
   * AFTER the ceiling, deliberately. A payload the model will never read has
   * no columns worth arguing about, and judging one that was already refused
   * would file findings about rows nobody was ever served.
   *
   * `undefined` = nothing declared, nothing to refuse, or `'warn'` — the
   * caller keeps today's path byte for byte. A string is the teaching
   * refusal, which under `'enforce'` replaces the payload on every channel,
   * exactly as the ceiling's does.
   *
   * The three field failures this exists for: LUN 0 stored as an empty string
   * on 2,094 mappings; an 8 MiB disk rendered `0.0 GB`; a whole tool family
   * returning its numbers as quoted strings. This catches the first and the
   * third. It cannot catch the second — that is MEANING, and the ceiling
   * sentence in every finding says so.
   */
  const judgeColumns = (
    scope: TypedScope<AgentState>,
    call: { readonly toolName: string; readonly toolCallId: string; readonly iteration: number },
    value: unknown,
  ): string | undefined => {
    const declarations = deps.columnDeclarations;
    if (declarations === undefined) return undefined;
    const columns = declarations.get(call.toolName);
    if (columns === undefined) return undefined;
    const { findings, disposition, refusal } = columnTypesOf(
      {
        toolName: call.toolName,
        toolCallId: call.toolCallId,
        columns,
        // What the model will read (the ceiling's reasoning, above).
        reading: readRowset(servedToModel(value)),
        mode: deps.columnCheckMode ?? 'warn',
      },
      call.iteration,
    );
    // ONE encounter, TWO rows. The declaration arms both checks and a call
    // meets both at once, so both must answer for it — a shape that is not a
    // rowset is `not-applicable` to each, and a clean rowset is a
    // `checked-pass` for each. Filing one row would leave the other check
    // looking untouched, which is the rot signal, not the truth.
    const ledger = deps.integrityLedger?.current;
    for (const kind of ['column-type-mismatch', 'missing-column'] as const) {
      const kindFired = findings.some((f) => f.kind === kind);
      // A rowset this check could read, where THIS kind found nothing, is a
      // pass for THIS kind even when its sibling failed: the columns really
      // were all present, or really did all hold their declared type.
      const row =
        disposition === 'not-applicable'
          ? 'not-applicable'
          : kindFired
          ? 'checked-fail'
          : 'checked-pass';
      ledger?.note(kind, 'write', row, kindFired ? Date.now() : undefined);
    }
    // The findings ARE the record of a refusal: each one names what was
    // refused, which column, how many rows, and — through `outcomeClause` —
    // that the model read a sentence instead of the rows. Deliberately NOT
    // `tools.result_refused`: that event's whole vocabulary is a SIZE
    // (`sizeChars`, `maxChars`), and reusing it here would put a fabricated
    // ceiling on the record to describe a refusal that had nothing to do
    // with size.
    fileIntegrityFindings(scope, findings, call.iteration);
    return refusal;
  };

  /**
   * THE WRITE SEAM (9.77.0) — `empty-lookup`, at the one moment a lookup's
   * answer becomes a fact in the conversation.
   *
   * The recorded failure this exists for: a reverse-lookup tool filtered a
   * column before a pivot, so EVERY lookup returned an empty result, for
   * every identifier, always — and the agent reported, with confidence and in
   * a table, that the device was logged in nowhere. It was logged in the
   * whole time. An empty result from a broken filter is byte-identical to an
   * empty result from a genuine absence, so nothing anywhere could notice.
   *
   * What CAN be noticed is the pair: the run itself produced this identifier
   * (it came out of a result from a tool this one's author named in
   * `argumentsFrom`), and the lookup keyed on it came back empty. The finding
   * is an ADVISORY and says so — an empty answer can be perfectly true, and
   * this cannot tell which one it is looking at.
   *
   * Judged on the TOOL'S OWN answer, before the after-tool chain rewrites it
   * for the model: whether the lookup found anything is a fact about the
   * tool, not about what a governance rule then did with it. A refused,
   * placed or capped result reads as bespoke anyway — a claim ticket has no
   * rows to count.
   */
  const noticeEmptyLookup = (
    scope: TypedScope<AgentState>,
    call: { readonly toolName: string; readonly toolCallId: string; readonly iteration: number },
    args: Readonly<Record<string, unknown>>,
    result: unknown,
    history: readonly LLMMessage[],
    /** The call produced a real result to read (ran, no error, nothing refused it). */
    answered: boolean,
  ): void => {
    const grounding = deps.emptyLookupGrounding;
    if (grounding === undefined) return;
    const argumentsFrom = grounding.get(call.toolName);
    if (argumentsFrom === undefined) return;
    const ledger = deps.integrityLedger?.current;
    // A call that never ran, was denied, errored or had its payload refused
    // produced no lookup result to read. Not a pass, not a fail — the check
    // met its subject and the subject is out of scope BY RULE, which is what
    // `not-applicable` is for. Stated, never silence.
    if (!answered) {
      ledger?.note('empty-lookup', 'write', 'not-applicable');
      return;
    }
    // The producer corpus: the earlier RESULTS from a tool THIS tool declares
    // as one of its grounds — never a settled message (`producerCorpusOf`).
    const produced = producerCorpusOf(history, argumentsFrom);
    const { findings, disposition } = emptyLookupOf(
      {
        toolName: call.toolName,
        toolCallId: call.toolCallId,
        args,
        argumentsFrom,
        // `readAbsence` is the ONE owner of the `af_absent` marker; the pure
        // check is handed its verdict rather than re-deriving it, so
        // `src/integrity/` stays a leaf and the reserved word keeps one
        // spelling.
        reading: readLookupResult(result, readAbsence(result) !== undefined),
      },
      produced,
      call.iteration,
    );
    ledger?.note(
      'empty-lookup',
      'write',
      disposition,
      disposition === 'checked-fail' ? Date.now() : undefined,
    );
    fileIntegrityFindings(scope, findings, call.iteration);
  };

  return { judgeColumns, noticeEmptyLookup };
}
