/** The results dependencies of the existing tool-call stage. */
export interface ToolResultsPort {
  /**
   * The opt-in ceiling on ONE tool result, in characters (9.11.0).
   *
   * Undefined — the ordinary case — means results are never measured and never
   * replaced, which is what every release before 9.11.0 did. Set, and EVERY
   * result on EVERY dispatch path in this handler is measured against it; over
   * the cap, the result the model reads and the result
   * `agentfootprint.stream.tool_end` carries are both the marker. See
   * `../../../toolResultCap.ts` for the shape and why it is opt-in.
   */
  readonly maxToolResultChars?: number;
  /**
   * Tell the model when it has already made this exact call and already got
   * this exact answer (9.26.0). Threaded from `AgentOptions.repeatedCallNudge`,
   * and only when the operator turned it OFF — `undefined` here means the
   * default, which is on.
   *
   * Applied at the BATCH dispatch loop only, which is where a turn's repeats
   * actually happen. The pause-resume paths deliver a call a PERSON answered
   * or approved, and a note telling the model it has already done what a human
   * just authorised would be the framework arguing with the human.
   */
  readonly repeatedCallNudge?: boolean;
}
