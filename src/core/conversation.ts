/**
 * conversation — the refusals that guard a runner's per-instance state.
 *
 * Pattern: teaching refusal at a boundary (the shape `runInput` uses for a
 *          caller's message, applied to a caller's TIMING).
 * Role:    core/ layer. An `Agent` keeps the last run's executor, run context,
 *          answer and pause on ITSELF — that is what makes `checkpoint()`,
 *          `getLastSnapshot()` and `followUp()` possible at all. Those fields
 *          have exactly one owner at a time, and until 9.2.0 nothing said so.
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
 * Thrown when `run()` / `resume()` is called on a runner that is already
 * running.
 *
 * One instance answers one turn at a time. To run two turns at once, build two
 * agents — a chart is built once per instance and instances are cheap — or put
 * the turns behind `standingAgent({ onConcurrentInvoke: 'enqueue' })`, which
 * queues them.
 *
 * @example
 * ```ts
 * // Refused: both would write the same instance's last-run state.
 * await Promise.all([agent.run({ message: 'a' }), agent.run({ message: 'b' })]);
 *
 * // Fine: two instances, two sets of state.
 * await Promise.all([agentA.run({ message: 'a' }), agentB.run({ message: 'b' })]);
 * ```
 */
export class RunInFlightError extends Error {
  readonly code = 'ERR_RUN_IN_FLIGHT' as const;
  /** The runner that is busy, by its configured id. */
  readonly agentId: string;
  /** The run already in flight, so a log line can be joined to its trace. */
  readonly activeRunId: string;

  constructor(door: string, agentId: string, activeRunId: string) {
    super(
      `${door}: this agent is already running (run '${activeRunId}'). One instance answers one ` +
        `turn at a time — its last executor, run context, answer and pause all live on the ` +
        `instance, so two overlapping runs would each finish having overwritten the other's. ` +
        `Both would return a plausible answer and checkpoint() would then hand back whichever ` +
        `finished last, which is why this is refused rather than left to look like it worked. ` +
        `Await the run in flight, build a second Agent for the second turn (charts are ` +
        `built per instance and instances are cheap), or serve the agent through ` +
        `standingAgent({ onConcurrentInvoke: 'enqueue' }) to queue turns behind each other.`,
    );
    this.name = 'RunInFlightError';
    this.agentId = agentId;
    this.activeRunId = activeRunId;
  }
}

/**
 * Thrown when a new message is sent to an agent whose last run PAUSED to ask a
 * person something, and that question has not been answered.
 *
 * The pause is not a failure and not a stale flag — it is unfinished work with
 * a person on the other end. Answer it with `resume(checkpoint, decision)`, or
 * say plainly that it is being dropped with `abandonPause()`; both are visible
 * in the record, and silently starting a fresh run was not.
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
        `call agent.abandonPause() first and then run() again: a pending question that a later ` +
        `message silently discards is a consent gate anyone can walk around.`,
    );
    this.name = 'PendingQuestionError';
    if (pending.toolName !== undefined) this.toolName = pending.toolName;
    if (pending.toolCallId !== undefined) this.toolCallId = pending.toolCallId;
  }
}

/**
 * Thrown by `followUp()` when there is no conversation to follow up on.
 *
 * `followUp()` continues THIS agent's own last completed run. Before the first
 * one there is nothing to continue, and a "follow-up" that quietly became a
 * first turn would be the very confusion the door exists to remove.
 */
export class NoConversationError extends Error {
  readonly code = 'ERR_NO_CONVERSATION' as const;

  constructor(door: string, reason: 'never-run' | 'last-run-unfinished') {
    super(
      reason === 'never-run'
        ? `${door}: this agent has not completed a run, so there is no conversation to ` +
            `continue. Start it with agent.run({ message }) — the first turn is a run; every ` +
            `turn after it is a followUp(). To continue a conversation this PROCESS did not ` +
            `have (a stored one, or one from another instance), pass it explicitly: ` +
            `agent.run({ message, continueFrom: storedConversation }).`
        : `${door}: this agent's last run did not finish with an answer, so there is no ` +
            `conversation to continue yet. A failed run's conversation is carried by ` +
            `RunCheckpointError.checkpoint — catch it and pass that to ` +
            `run({ message, continueFrom }) or resumeOnError(checkpoint).`,
    );
    this.name = 'NoConversationError';
  }
}
