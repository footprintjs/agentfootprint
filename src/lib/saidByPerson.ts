/**
 * saidByPerson — which `role: 'user'` message a PERSON wrote, and which ones
 * this library wrote in a person's voice.
 *
 * Pattern: One predicate over one message, over a registry of frames. No
 *          imports, no state, no clock.
 * Role:    Leaf. Several layers ask the same question and must not answer it
 *          differently: the window's refusal engine (`currentRequest.ts`,
 *          which will not let a strategy drop the request), the six authors
 *          of library-written user turns (`window/notice.ts`,
 *          `window/summarize.ts`, `outputEnforcement.ts`, `evidence/gate.ts`,
 *          `stages/wrapUp.ts`, and `skillSteps.ts` for the nudge
 *          `stages/stepNudge.ts` appends — they own the sentences and take
 *          the markers from here), and — since 9.84.0 — a rule author reading
 *          `InjectionContext.history` (`saidByPerson(ctx)`).
 * Emits:   N/A.
 *
 * ## Why this is a leaf and not a private helper
 *
 * This library writes SEVEN kinds of `role: 'user'` message that nobody said:
 * a compaction frame, a drop notice, a schema-check correction, an
 * evidence-check correction, a budget wrap-up instruction, a stepped-skill
 * nudge, and a message an Injection delivered. Six of the seven are read off
 * the OPENING they carry ({@link LIBRARY_AUTHORED_PREFIXES}); the delivered
 * one carries an `injectedBy` marker instead. The window layer knew two of the
 * openings and the marker; the evidence layer knew two more
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
 * The two frames added in 9.86.0 are the same bug found again, and found by
 * counting rather than by reading: 9.84.0 registered four openings and wrote
 * "five classes" in prose, while the tree already had SEVEN producers of a
 * user-role message that reach `scope.history`. The budget wrap-up
 * (`stages/wrapUp.ts`) carried an unprefixed sentence containing "Do not
 * request tools", and the stepped-skill nudge (`stages/stepNudge.ts`) carries
 * a skill id and every unrun step's TOOL NAME — so both were credited to a
 * person, a `saidByPerson(ctx).some(m => m.content.includes(…))` rule matched
 * on them, and the window could anchor its refusal on the wrap-up frame.
 *
 * The markers live here, as a LIST rather than one constant per writing file.
 * A prefix is what the recognizer matches AND what the writer emits;
 * separating those is how a prefix silently stops being recognized, and an
 * authored frame that lands anywhere else is a hole nobody will see until a
 * rule fires on it. Adding one means adding it to
 * {@link LIBRARY_AUTHORED_PREFIXES}, and every reader is fixed at once —
 * which is why the count is no longer asserted in prose alone:
 * `test/lib/injection-engine/userTurnProducers.test.ts` WALKS the tree for
 * every `role: 'user'` construction site and fails, with the file and line, on
 * one that is neither registered here, nor a person's own turn, nor
 * wire-only.
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

/** Opening of the authored instruction the out-of-budget WRAP-UP call carries.
 *  Stable — tests and readers match on it. Written by `wrapUpStage`
 *  (`WRAP_UP_INSTRUCTION`). */
export const WRAP_UP_FRAME_PREFIX = '[budget exhausted';

/** Opening of the authored frame the stepped-skill NUDGE carries. Stable —
 *  tests and readers match on it. Written by `nudgeTeachingMessage`, appended
 *  by `buildStepNudgeStage`. */
export const STEP_NUDGE_FRAME_PREFIX = '[steps unrun';

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
 * they are matched by PREFIX and never by anything further in. The nudge is
 * the same shape for a different reason: its body is a list of a skill's own
 * step notes and tool names, which is exactly the text a rule watches for.
 *
 * The list is frozen because it is a registry, not a scratch array: a consumer
 * holds the same object this library's own readers hold, and a `push` into it
 * would change what every reader calls a person's message.
 */
export const LIBRARY_AUTHORED_PREFIXES: readonly string[] = Object.freeze([
  DROP_NOTICE_PREFIX,
  COMPACTED_FRAME_PREFIX,
  SCHEMA_CHECK_FRAME_PREFIX,
  EVIDENCE_CHECK_FRAME_PREFIX,
  WRAP_UP_FRAME_PREFIX,
  STEP_NUDGE_FRAME_PREFIX,
]);

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

// FOLD · the one owner of which role:'user' message a PERSON wrote, as opposed to the ones this library writes in a person's voice
// consumers read this and never re-derive it: core/agent/window/currentRequest.ts, injection-engine/types.ts's
// saidByPerson(ctx) (lib/injection-engine/types.ts · saidByPerson), and src/index.ts (published)
// detached: yes — a boolean over one message; the writers import the prefixes the recogniser matches on.
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
