import type { AgentfootprintEventType } from '../../../../../events/registry.js';

/** The observation dependencies of the existing tool-call stage. */
export interface ToolObservationPort {
  /**
   * Keep this run's tool-call ledger (`AgentState.toolCallLedger`) for an
   * `answerValidation` check: name, call id and outcome per `stream.tool_end`
   * bracket, at most `maxCalls`. Threaded ONLY on an agent with
   * `answerValidation` — absent, no bracket writes anything, and the agent
   * commits exactly the keys it always did.
   */
  readonly toolCallLedger?: { readonly maxCalls: number };
  /**
   * Put one artifact fact on the record for the run it BELONGS to — the door
   * a `ctx.artifacts` fact takes when it lands after that run ended (a tool's
   * floating upload finishing during a later run). The scope channel stamps
   * whatever run is live at emit time; this stamps the run context the binding
   * captured when it was built.
   *
   * @internal
   */
  readonly emitForRun?: (
    type: AgentfootprintEventType,
    payload: Record<string, unknown>,
    runContext: import('../../../../../bridge/eventMeta.js').RunContext,
  ) => void;
}
