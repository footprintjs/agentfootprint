/**
 * conversation — the refusals that guard a runner's per-instance state.
 *
 * Pattern: teaching refusal at a boundary (the shape `runInput` uses for a
 *          caller's message, applied to a caller's TIMING).
 * Role:    core/ layer. The native lifecycle owns execution and selected views;
 *          the domain guards keep questions and named conversation identity
 *          consistent at its public entry points.
 * Emits:   N/A — these fire before a run starts.
 *
 * ## Why these are refusals and not warnings
 *
 * Both shapes below used to SUCCEED, which is the entire problem. Two `run()`
 * calls overlapping on one Agent both resolved with plausible answers, and the
 * per-instance state afterwards belonged to whichever finished last: the
 * conversation `checkpoint()` handed back was the other run's, the snapshot
 * `getLastSnapshot()` served was the other run's, and every event carried the
 * other run's meta. That is not concurrency, it is corruption — and nothing in
 * the recording said so, because each run's own trace looked perfect.
 *
 * A message sent while a person still owes the agent an answer used to start a
 * fresh run and silently abandon the pending question. A consent gate that can
 * be walked around by sending another message is not a consent gate.
 *
 * Neither refusal is new policy. `standingAgent` has refused both since it
 * existed (it serializes runs globally and calls that "a correctness
 * requirement rather than a tuning choice", and answers a message that arrives
 * mid-question with `AwaitingDecisionError`), and `recordedChat.send` refuses
 * an overlapping turn in the same words. 9.2.0 moves the guarantee from the
 * compositions down to the primitive, so it holds however you drive it.
 *
 * The names are deliberately NOT the hosting ones. `hosting/errors.ts` already
 * owns `ConcurrentRunError` and `AwaitingDecisionError`, both of which carry a
 * `sessionId` and speak about a session; core has no sessions, and two classes
 * sharing one name across two doors is the duplicate-type hazard this codebase
 * has fixed before.
 */

/**
 * One shared native refusal class across logical runners and raw executors.
 * Migration: runnerId replaces agentId; activeRunId is absent during setup
 * before native origin exists. Match code ERR_RUN_IN_FLIGHT across formats.
 */
export { RunInFlightError } from 'footprintjs';

/**
 * Thrown when a new message is sent to an agent whose last run PAUSED to ask a
 * person something, and that question has not been answered.
 *
 * The pause is not a failure and not a stale flag — it is unfinished work with
 * a person on the other end. Answer it with `resume(checkpoint, decision)`, or
 * say plainly that it is being dropped with `abandonPause()`. Either way the
 * choice is explicit, where silently starting a fresh run was not. Only the
 * answer is recorded by the library: `resume()` runs a leg on the record, while
 * `abandonPause()` emits no pause event and writes no run record — it returns
 * the dropped question to the caller, so the app must log it if an audit needs
 * it. It does release the paused run's call- and run-scoped tool teardowns,
 * which emit `agentfootprint.tools.session_closed` / `session_close_failed` as
 * any teardown does. The paused run's record keeps its pause request with no
 * matching resume.
 */
export class PendingQuestionError extends Error {
  readonly code = 'ERR_PENDING_QUESTION' as const;
  /** The tool that asked, when the pause named one. */
  readonly toolName?: string;
  /** The id of the tool call that asked, for joining back to the trace. */
  readonly toolCallId?: string;

  constructor(
    door: string,
    pending: { toolName?: string; toolCallId?: string; question?: string },
  ) {
    const asked =
      pending.toolName !== undefined
        ? `'${pending.toolName}'${pending.toolCallId ? ` (call ${pending.toolCallId})` : ''}`
        : 'a tool';
    const quoted = pending.question !== undefined ? ` It asked: "${pending.question}"` : '';
    super(
      `${door}: this agent's last run paused to ask a person something and is still waiting. ` +
        `${asked} raised the question and nothing has answered it.${quoted} Answer it with ` +
        `agent.resume(outcome.checkpoint, decision) — that continues the paused run from where ` +
        `it stopped, with no earlier tool re-executed. If the question really is being dropped, ` +
        `await agent.abandonPause() first and then run() again: a pending question that a later ` +
        `message silently discards is a consent gate anyone can walk around.`,
    );
    this.name = 'PendingQuestionError';
    if (pending.toolName !== undefined) this.toolName = pending.toolName;
    if (pending.toolCallId !== undefined) this.toolCallId = pending.toolCallId;
  }
}

/**
 * Thrown by `resume(checkpoint, input, options)` when the run would carry two
 * identities — refused before anything runs:
 *  - `options.identity` names an identity other than the one the run's memory
 *    namespace and credentials are restored with (`scope.runIdentity`, whatever
 *    its source) — including an OWNERLESS pause (the per-run default or the
 *    session rung) resumed by a named person;
 *  - the checkpoint's own fields disagree (a session-rung marker on an
 *    identity that carries a person).
 *
 * The ownerless case is the fail-closed reading of an open owner question; a
 * later release may relax it behind an explicit opt-in, never by default.
 *
 * One run never carries two identities. The resumed run keeps the paused run's
 * memory namespace and credential identity (`scope.runIdentity`, restored from
 * the checkpoint — a resume never re-seeds), so honouring a different caller
 * would give the run one person's memory and vault and another person's
 * `ctx.identity`, `EventMeta.principal` and stored ownership. Ownership is
 * derived from the run and never moved; the same law, and the same `code`, as
 * the hosting door's `SessionOwnershipConflictError`.
 *
 * Neither identity is named in the message: an error is read by whoever
 * provoked it. Nothing has run and no state has moved when it is thrown.
 */
export class ResumeIdentityConflictError extends Error {
  readonly code = 'ERR_SESSION_OWNERSHIP_CONFLICT' as const;

  constructor(operation: 'resume' | 'followUp' | 'session' = 'resume') {
    super(
      operation === 'session'
        ? 'Agent.resume: the supplied sessionId must match the paused transport session. No state moved.'
        : operation === 'followUp'
        ? 'Agent.followUp: the supplied identity differs from the selected conversation. Use a separate instance or start an explicit new conversation. No state moved.'
        : 'Agent.resume: the supplied identity differs from the paused conversation. Resume with its original identity or start a new conversation. Neither identity is included in this message.',
    );
    this.name = 'ResumeIdentityConflictError';
  }
}

/** Why a resume could not carry its paused run's redaction — see `ResumeRedactionError`. */
export type ResumeRedactionReason = 'unreadable' | 'missing' | 'unknown-pattern';

/**
 * Thrown by `resume(checkpoint, input, options)` when the paused run's
 * redaction cannot be carried into the resumed leg — refused before anything
 * runs, so a leg its policy could not keep covered never starts:
 *  - `'unreadable'` — the checkpoint's `runRedaction` (the policy the paused
 *    run was covered by, as plain data) is not one this library wrote;
 *  - `'missing'` — the checkpoint says its run kept values out of its records
 *    (footprintjs's `redactionMarks`: the names it masked) but carries no
 *    policy. Every leg of a covered run writes its policy into its checkpoint,
 *    so this one was altered; a `redact` passed to the resume cannot stand in
 *    for the policy the run was covered by, so it is refused all the same;
 *  - `'unknown-pattern'` — the carried policy names a pattern this side does
 *    not hold. A pattern is never compiled from a checkpoint (one built to hang
 *    the matcher could come back from storage someone else controls): a
 *    carried pattern is a reference to one the agent declares, the library's
 *    vocabulary holds, or the resume names — pass the run's `redact` to
 *    `resume(checkpoint, input, { redact })` when the run was handed one.
 *
 * Every way, the resumed leg would write what the paused leg kept out into
 * every record of its own. No policy, pattern, name or value appears in the
 * message.
 */
export class ResumeRedactionError extends Error {
  readonly code = 'ERR_RESUME_REDACTION' as const;
  readonly reason: ResumeRedactionReason;

  constructor(reason: ResumeRedactionReason) {
    super(
      reason === 'unreadable'
        ? "Agent.resume: the checkpoint's redaction policy (`runRedaction`) is not one this library " +
            'wrote, so the resumed run could not keep its records covered. Resume with the checkpoint ' +
            'as it was written.'
        : reason === 'missing'
        ? 'Agent.resume: the checkpoint says its run kept values out of its records but carries no ' +
          'redaction policy — every covered run writes its policy into its checkpoint, so this one ' +
          'was altered. Resume with the checkpoint as it was written.'
        : "Agent.resume: the checkpoint's redaction policy names a pattern this agent does not " +
          'declare and the resume does not name — a pattern is never compiled from a checkpoint. ' +
          'Pass the redaction policy the run was handed: resume(checkpoint, input, { redact }).',
    );
    this.name = 'ResumeRedactionError';
    this.reason = reason;
  }
}

/**
 * Why `followUp()` found no conversation to continue.
 *
 * - `'never-run'` — no run on this agent got past input admission yet
 *   (before the first run, or when the first turn was refused).
 * - `'last-run-unfinished'` — the last run ended without an answer (it threw);
 *   its conversation rides `RunCheckpointError.checkpoint`.
 * - `'last-input-refused'` — input middleware refused the last run's message.
 *   A refusal raises `MessageDeniedError`, which carries no checkpoint: the
 *   refused attempt admitted no conversation, so the one to continue is the
 *   checkpoint taken after an earlier ACCEPTED run.
 */
export type NoConversationReason = 'never-run' | 'last-run-unfinished' | 'last-input-refused';

/**
 * Thrown by `followUp()` when there is no conversation to follow up on.
 *
 * `followUp()` continues THIS agent's own last completed run. Before the first
 * one there is nothing to continue, and a "follow-up" that quietly became a
 * first turn would be the very confusion the door exists to remove.
 * `reason` says which of those it was, so a caller can branch on it.
 */
export class NoConversationError extends Error {
  readonly code = 'ERR_NO_CONVERSATION' as const;
  readonly reason: NoConversationReason;

  constructor(door: string, reason: NoConversationReason) {
    super(noConversationSentence(door, reason));
    this.name = 'NoConversationError';
    this.reason = reason;
  }
}

function noConversationSentence(door: string, reason: NoConversationReason): string {
  switch (reason) {
    case 'never-run':
      return (
        `${door}: this agent has not completed a run, so there is no conversation to ` +
        `continue. Start it with agent.run({ message }) — the first turn is a run; every ` +
        `turn after it is a followUp(). To continue a conversation this PROCESS did not ` +
        `have (a stored one, or one from another instance), pass it explicitly: ` +
        `agent.run({ message, continueFrom: storedConversation }).`
      );
    case 'last-run-unfinished':
      return (
        `${door}: this agent's last run did not finish with an answer, so there is no ` +
        `conversation to continue yet. A failed run's conversation is carried by ` +
        `RunCheckpointError.checkpoint — catch it and pass that to ` +
        `run({ message, continueFrom }) or resumeOnError(checkpoint).`
      );
    case 'last-input-refused':
      return (
        `${door}: input middleware refused this agent's last message, so that run ` +
        `admitted no conversation to continue. Continue from your earlier accepted ` +
        `checkpoint — the one agent.checkpoint() returned after the last accepted run — ` +
        `with agent.run({ message, continueFrom: earlierCheckpoint }), or start a new ` +
        `conversation with agent.run({ message }).`
      );
  }
}
