/**
 * composeRequest — the two rules that turn COMMITTED pieces into the pieces a
 * provider is handed.
 *
 * Role:  Lens. Two pure functions, no scope, no events, no I/O. They are the
 *        model-facing half of request assembly that a Fold must be able to
 *        repeat: `callLLM.ts` · `buildCallLLMStage` applies them on the way
 *        out, and `servedView.ts` · `servedAt` applies the same two on the way
 *        back, over the same committed values.
 * Reads: its arguments.
 * Emits: N/A.
 *
 * WHY THIS FILE EXISTS. Both rules were written inline, and the system-prompt
 * join was written inline FIVE times (callLLM, LLMCall, two message-API
 * charts, and the tool-calls stage's self-call frame). Five copies of a rule
 * is five chances to disagree about what the model read — and the moment a
 * reader tries to rebuild a served request from the commit log, a sixth copy
 * appears in the reader. The joined string itself is never committed (only its
 * pieces are), so the rebuild rests entirely on this join being one function.
 */

import type { LLMMessage } from '../../provider-contract/types.js';
import type { ContextRole } from '../../events/types.js';

/**
 * Why a call's tool list is withheld: the out-of-budget wrap-up, or the run's
 * tools went off after the evidence revision under an enforcing answer
 * validation.
 */
export type ToolsWithheld = 'wrap-up' | 'evidence-revision';

/**
 * THE TOOLS RULE — whether a call is served its tools, read from the two
 * committed keys that decide it (`wrapUpAsked`, `toolsOffAfterRevision`).
 * `callLLM` applies it on the way out and `servedView` on the way back, so the
 * two cannot disagree about which call was served none.
 *
 * @example
 * ```ts
 * toolsWithheld(undefined, true); // 'evidence-revision'
 * toolsWithheld(undefined, undefined); // null — the call is served its tools
 * ```
 */
export function toolsWithheld(
  wrapUpAsked: unknown,
  toolsOffAfterRevision: unknown,
): ToolsWithheld | null {
  if (wrapUpAsked === true) return 'wrap-up';
  return toolsOffAfterRevision === true ? 'evidence-revision' : null;
}

/** What the system-prompt join needs from an injection record. */
export interface SystemPromptPiece {
  /** The piece's full text. Absent or empty ⇒ the piece contributes nothing. */
  readonly rawContent?: string;
}

/**
 * The separator between two system-prompt pieces. A blank line, because the
 * pieces are independent sections (a base prompt, a skill body, a retrieved
 * passage) and a model reads them as sections only when they are separated
 * like sections.
 */
export const SYSTEM_PROMPT_SEPARATOR = '\n\n';

/**
 * THE SYSTEM-PROMPT JOIN — the one rule turning committed injection records
 * into the single string a provider is handed.
 *
 * Empty pieces are dropped BEFORE joining, not after: a record with no
 * `rawContent` (a summary-only record, which is what a slot writes when the
 * content lives elsewhere) must not spend a blank line between its neighbours.
 *
 * @example
 * ```ts
 * joinSystemPrompt([{ rawContent: 'You are a bot.' }, {}, { rawContent: 'Be brief.' }]);
 * // 'You are a bot.\n\nBe brief.'
 * ```
 */
export function joinSystemPrompt(pieces: readonly SystemPromptPiece[]): string {
  return contributingPieces(pieces)
    .map((r) => r.rawContent)
    .join(SYSTEM_PROMPT_SEPARATOR);
}

/**
 * The pieces that actually reach the joined string, in order — the same
 * survivors {@link joinSystemPrompt} concatenates.
 *
 * Exported because two things need the SURVIVORS and not just the string: the
 * receipt lists one fingerprint per piece, and a rebuilt view lists the pieces
 * beside the text. Deriving that list a second time is how the list and the
 * string come to disagree about which piece was position 2.
 *
 * @example
 * ```ts
 * contributingPieces([{ rawContent: 'a' }, { rawContent: '' }, { rawContent: 'b' }]).length; // 2
 * ```
 */
export function contributingPieces<T extends SystemPromptPiece>(
  pieces: readonly T[],
): readonly (T & { readonly rawContent: string })[] {
  return pieces.filter(
    (r): r is T & { readonly rawContent: string } =>
      typeof r.rawContent === 'string' && r.rawContent.length > 0,
  );
}

/**
 * Drop the fields that exist for the library and never for the model.
 *
 * These include: `injectedBy`, the delivery marker (7.21),
 * `notDispatched`, the batch settlement's marker (9.113.0 — the model reads the
 * settled call's sentence; the marker is that fact for the library's readers),
 * `toolResultOrigin`, the findings-only producer notice origin,
 * and `toolChars`, the tool-bytes boundary on a result the inputs layer
 * annotated (honesty layer 2 — the model reads the whole content; the boundary
 * tells the library's readers where the tool's own words end), and
 * `foldedExempt`, a compaction summary's exemption lineage (the exempt corpus
 * reads it; the model reads the summary's text).
 * Messages without any pass through BY REFERENCE, so an agent that delivers,
 * settles and annotates nothing allocates nothing — and the array's length and
 * order are untouched either way, which is what keeps
 * `CacheMarker{field:'messages'}` honest.
 *
 * They are removed before the request exists rather than trusted to be
 * ignored: a consumer-authored adapter that serializes a message wholesale
 * would otherwise put library internals on someone's wire. Stripping removes a
 * FIELD, never a message, so `messages[i]` is still the message a cache
 * marker's index names.
 *
 * @example
 * ```ts
 * stripFrameworkFields([{ role: 'user', content: 'hi', injectedBy: 'memory' }]);
 * // [{ role: 'user', content: 'hi' }]
 * ```
 */
export function stripFrameworkFields(messages: readonly LLMMessage[]): readonly LLMMessage[] {
  if (!messages.some(carriesFrameworkFields)) return messages;
  return messages.map((m) => {
    if (!carriesFrameworkFields(m)) return m;
    const {
      injectedBy: _delivered,
      notDispatched: _settled,
      toolResultOrigin: _resultOrigin,
      toolChars: _toolBytes,
      foldedExempt: _lineage,
      ...composed
    } = m;
    void _delivered;
    void _settled;
    void _resultOrigin;
    void _toolBytes;
    void _lineage;
    return composed;
  });
}

/** Does this message carry a field {@link stripFrameworkFields} removes? */
function carriesFrameworkFields(message: LLMMessage): boolean {
  return (
    message.injectedBy !== undefined ||
    message.notDispatched !== undefined ||
    message.toolResultOrigin !== undefined ||
    message.toolChars !== undefined ||
    message.foldedExempt !== undefined
  );
}

/** What the messages-slot join needs from an injection record. */
export interface MessagesSlotPiece {
  /** The line's full text. Falls back to the summary when a slot recorded
   *  only that. */
  readonly rawContent?: string;
  readonly contentSummary: string;
  /** The role the line goes out as. Absent ⇒ `'user'`. */
  readonly asRole?: ContextRole;
}

/**
 * THE MESSAGES-SLOT JOIN — the one rule turning committed `messagesInjections`
 * records into the conversation a provider is handed.
 *
 * It exists for the same reason {@link joinSystemPrompt} does, and for one
 * more. `LLMCall` and the message-API charts have no `history`: the messages
 * slot IS their conversation, so this projection is not an observability
 * side-record for them — it is the committed source. A rebuild that read
 * `history` on those charts found nothing and reported an empty conversation
 * the provider never sent (`servedView.ts` · `viewOf`). One function, called on
 * the way out and on the way back, is what makes the rebuild true there.
 *
 * Empty lines are dropped, exactly as the calling stage drops them, so index
 * `i` means the same message on both sides.
 *
 * @example
 * ```ts
 * messagesFromInjections([
 *   { contentSummary: 'hi', rawContent: 'hi there', asRole: 'user' },
 *   { contentSummary: '', rawContent: '' },
 * ]);
 * // [{ role: 'user', content: 'hi there' }]
 * ```
 */
export function messagesFromInjections(
  records: readonly MessagesSlotPiece[],
): readonly LLMMessage[] {
  return records
    .map((r) => ({
      role: r.asRole ?? ('user' as ContextRole),
      content: r.rawContent ?? r.contentSummary,
    }))
    .filter((m) => m.content.length > 0);
}
