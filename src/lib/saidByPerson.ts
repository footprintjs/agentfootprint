/**
 * saidByPerson — which `role: 'user'` message a PERSON wrote, and which ones
 * this library wrote in a person's voice.
 *
 * Pattern: One predicate over one message, over a registry of frames. No
 *          imports, no state, no clock.
 * Role:    Leaf. Several layers ask the same question and must not answer it
 *          differently: the window's refusal engine (`currentRequest.ts`,
 *          which will not let a strategy drop the request), the four authors
 *          of library-written user turns (`window/notice.ts`,
 *          `window/summarize.ts`, `outputEnforcement.ts`, `evidence/gate.ts`
 *          — they own the sentences and take the markers from here), and —
 *          since 9.84.0 — a rule author reading `InjectionContext.history`
 *          (`saidByPerson(ctx)`).
 * Emits:   N/A.
 *
 * ## Why this is a leaf and not a private helper
 *
 * This library writes FIVE kinds of `role: 'user'` message that nobody said:
 * a compaction frame, a drop notice, a schema-check correction, an
 * evidence-check correction, and a message an Injection delivered. The window
 * layer knew two of them and the marker; the evidence layer knew the other two
 * (`evidence/frames.ts`); neither list was reachable from the routing layer at
 * all — the skill-graph fence forbids it from importing the agent loop, and
 * rightly. So a predicate reading `history` could filter some of the classes
 * and not the rest, and would match on our own bookkeeping text.
 *
 * A drop notice NAMES TOOLS ("Tool results are among them (lookup_order) …").
 * A rule watching history for a tool name therefore fired on the notice about
 * that tool's result leaving the window — pinning a skill on exactly the long
 * sessions where the notice appears, which is the opposite of what the author
 * wrote. That is a fixable bug in one place only: the rule has to be one
 * implementation both sides import, not two that agree until they do not.
 *
 * The markers move here with it, as a LIST rather than four constants in four
 * files. A prefix is what the recognizer matches AND what the writer emits;
 * separating those is how a prefix silently stops being recognized, and a
 * sixth authored frame that lands anywhere else is a hole nobody will see
 * until a rule fires on it. Adding one means adding it to
 * {@link LIBRARY_AUTHORED_PREFIXES}, and every reader is fixed at once.
 */

/**
 * The fields authorship is decided from — structural, so both
 * `LLMMessage` (the wire shape) and `InjectionContext.history[n]` (the
 * read-only view a predicate gets) satisfy it unchanged.
 *
 * `injectedBy` is `unknown` here on purpose: this file only ever asks whether
 * the marker is PRESENT, and typing its interior would make a leaf that must
 * import nothing into a mirror that can drift.
 */
export interface AuthoredMessage {
  readonly role: string;
  readonly content: string;
  readonly injectedBy?: unknown;
}

/** Opening of the authored notice a DROP leaves behind. Stable — tests and
 *  readers match on it. Written by `buildDropNotice`. */
export const DROP_NOTICE_PREFIX = '[dropped history';

/** Opening of the authored label a FOLD leaves behind. Stable — tests and
 *  readers match on it. Written by `buildSummaryMessage`. */
export const COMPACTED_FRAME_PREFIX = '[compacted history';

/** Opening of the authored frame a failed output validation writes. Stable —
 *  tests and readers match on it. Written by `buildCorrectiveTurn`. */
export const SCHEMA_CHECK_FRAME_PREFIX = '[schema check';

/** Opening of the authored frame the evidence gate writes. Stable — tests,
 *  docs and readers match on it. Written by `buildEvidenceCorrection`. */
export const EVIDENCE_CHECK_FRAME_PREFIX = '[evidence check';

/**
 * Every opening this library puts on a `role: 'user'` message it wrote itself.
 *
 * The registry, not a convenience: this is the list a reader has to have ALL
 * of to answer "did a person say this?", and until 9.84.0 no reader had it —
 * the window held two entries, the evidence gate held the other two, and the
 * routing layer could reach neither. A new authored frame belongs here on the
 * day it is written.
 *
 * The two correction frames both QUOTE untrusted text after their label (a
 * validator's error, the model's own flagged values), which is exactly why
 * they are matched by PREFIX and never by anything further in.
 */
export const LIBRARY_AUTHORED_PREFIXES: readonly string[] = [
  DROP_NOTICE_PREFIX,
  COMPACTED_FRAME_PREFIX,
  SCHEMA_CHECK_FRAME_PREFIX,
  EVIDENCE_CHECK_FRAME_PREFIX,
];

/** True when this user-role message opens with a frame this library authored. */
export function isLibraryAuthoredFrame(msg: AuthoredMessage | undefined): boolean {
  return (
    msg !== undefined &&
    msg.role === 'user' &&
    LIBRARY_AUTHORED_PREFIXES.some((prefix) => msg.content.startsWith(prefix))
  );
}

/** True when this message is a notice a previous drop wrote. */
export function isDropNotice(msg: AuthoredMessage | undefined): boolean {
  return msg !== undefined && msg.role === 'user' && msg.content.startsWith(DROP_NOTICE_PREFIX);
}

/** True when this message is a frame a previous fold wrote. */
export function isCompactedSummary(msg: AuthoredMessage | undefined): boolean {
  return msg !== undefined && msg.role === 'user' && msg.content.startsWith(COMPACTED_FRAME_PREFIX);
}

/**
 * THE rule: true when this message is something a PERSON said.
 *
 * Deliberately narrow, and narrow in one direction: a message we are not sure
 * about is not credited to a person. The exclusions are the ways this library
 * authors a user turn — a delivery marker its own stage stamps, and the frames
 * in {@link LIBRARY_AUTHORED_PREFIXES} — never a guess at prose.
 *
 * A message from a restored conversation, a hand-built window, or a person
 * typing passes every exclusion and is theirs.
 */
export function isSaidByPerson(msg: AuthoredMessage | undefined): boolean {
  return (
    msg !== undefined &&
    msg.role === 'user' &&
    msg.injectedBy === undefined &&
    !isLibraryAuthoredFrame(msg)
  );
}
