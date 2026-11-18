import type { ReliabilityScope } from '../../../../reliability/types.js';

export interface TerminationState {
  // ── Policy halt state (v2.12) ───────────────────────────────
  /** Set when a `PermissionChecker` returns `{ result: 'halt', ... }`.
   *  `Agent.run()` reads these at the API boundary and throws a typed
   *  `PolicyHaltError` carrying the same context — the chart $break's
   *  graceful termination becomes a runtime signal callers can catch
   *  with `instanceof PolicyHaltError`. Telemetry tag from the rule. */
  policyHaltReason?: string;
  /** Content delivered to the LLM as the synthetic tool_result before
   *  termination — also surfaces on `PolicyHaltError.tellLLM` for
   *  audit / replay. */
  policyHaltTellLLM?: string;
  /** The proposed tool call that triggered the halt (NOT executed). */
  policyHaltTarget?: string;
  policyHaltArgs?: Readonly<Record<string, unknown>>;
  /** ReAct iteration the halt fired on. */
  policyHaltIteration?: number;
  /** Identifier of the PermissionChecker that returned `'halt'`. */
  policyHaltCheckerId?: string;

  // ── Reliability fail-fast state (v2.11.5) ──────────────────
  /** Set when the rules-based reliability loop takes the fail-fast path.
   *  `Agent.run()` reads these from the post-run snapshot and throws a
   *  typed `ReliabilityFailFastError`. Mirrors `policyHalt*` — because the
   *  loop stops the chart with `$break` (not a throw), durable scope is the
   *  only courier of the structured fail context across the break to the
   *  API boundary. (Telemetry ALSO fires via the `reliability.fail_fast`
   *  emit event; these scope fields are the business-logic control signal.) */
  reliabilityFailKind?: string;
  reliabilityFailPayload?: ReliabilityScope['failPayload'];
  reliabilityFailReason?: string;
  /** Originating error message/name — stringified because Error objects
   *  don't survive footprintjs's `structuredClone` of scope. */
  reliabilityFailCauseMessage?: string;
  reliabilityFailCauseName?: string;
}
