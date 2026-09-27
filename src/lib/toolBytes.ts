/**
 * toolBytes — where a tool's OWN words end in a result message.
 *
 * Pattern: One pure function. No imports, no state, no clock.
 * Role:    Leaf. The one owner of the tool-bytes boundary — the `toolChars`
 *          field of `adapters/types.ts` · `LLMMessage` (honesty layer 2).
 * Emits:   N/A.
 *
 * ## Why this is a leaf and not a helper beside its first reader
 *
 * The inputs layer appends a past-tense note to the result of a call that ran
 * on a value the LIBRARY filled ("the call ran with "2h", the value the tool's
 * rule assumes") and stamps the committed message with the length of the
 * tool's own delivered text. The model reads the whole content — it needs the
 * value to reason about what ran. Every reader that treats a result's content
 * as the TOOL's words must read through the cut, or the library's note speaks
 * for the tool:
 *
 * - the evidence index (`core/agent/evidence/evidenceIndex.ts` ·
 *   `evidenceFromHistory`) — a value only the note carries would ground an
 *   answer as if the tool had said it;
 * - the answer's standing (`core/agent/assessment/assess.ts` · `assessAnswer`)
 *   and the answer account's in-view results
 *   (`lib/answer-account/facts/inView.ts` · `readInView`) — the one emptiness
 *   reader parses the tool's bytes, and a note after a `[]` made the parse
 *   fail, so a filled call's empty result stopped reading `empty-undeclared`
 *   and its absence stopped reading `declared-absent`;
 * - the unsupported-argument seam's grounded corpus
 *   (`core/agent/stages/callLLM.ts`) and the empty-lookup seam's producer
 *   corpus (`core/agent/stages/toolCalls.ts` · `producerCorpusOf`) — a value
 *   only the note carries is not one the run served.
 *
 * These readers sit in four folders that do not import each other, so the
 * boundary lives here, once (`lib/README.md`: one owner per fact).
 *
 * Only the inputs layer's note sets the boundary. Other framework suffixes (a
 * step boundary, an effect refusal, the repeated-call note) carry names and
 * counts, not argument values, and are read as they always were.
 *
 * @example
 * ```ts
 * toolBytesOf({ content: '[]\n\n[window was not in … the call ran with "2h" …]', toolChars: 2 }); // '[]'
 * toolBytesOf({ content: '[]' });                                                                // '[]'
 * ```
 */

// FOLD · the one owner of where a tool's own words end in a result message
// consumers read this and never re-derive it: core/agent/evidence/evidenceIndex.ts · evidenceFromHistory,
// core/agent/assessment/assess.ts · turnResults, lib/answer-account/facts/inView.ts · readInView,
// core/agent/stages/callLLM.ts · groundedTextOf, core/agent/stages/toolCalls.ts · producerCorpusOf
// detached: yes — a string cut from the content (or the content as given when it is not a string).
/**
 * The tool's OWN text of a result message: `content` cut at the tool-bytes
 * boundary (`toolChars`) when the library annotated it, the whole `content`
 * otherwise. A boundary that cannot describe the content — not a whole
 * number, or past its end — is not applied, and the content is read whole, as
 * every message without one is. A content that is not a string comes back as
 * given.
 */
export function toolBytesOf<C>(message: {
  readonly content: C;
  readonly toolChars?: unknown;
}): C | string {
  const { content, toolChars: cut } = message;
  if (typeof content !== 'string') return content;
  return typeof cut === 'number' && Number.isInteger(cut) && cut >= 0 && cut <= content.length
    ? content.slice(0, cut)
    : content;
}
