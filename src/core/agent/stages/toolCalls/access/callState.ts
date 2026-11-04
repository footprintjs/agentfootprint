import type { buildCallStart } from '../execution/callStart.js';
import type { InputsDispatch } from '../contracts/inputsDispatch.js';
import type { CallResultCell, CallArguments, CallExecution } from '../contracts/callCells.js';
import type { ToolArgs } from '../../../../../tools/runChain.js';
import type { DispatchCall } from '../contracts/batchCall.js';

type CallStartFacts = ReturnType<ReturnType<typeof buildCallStart>['beginDispatchCall']>;

/** Initialize the original result, fill and execution cells at one synchronous call boundary. */
export function prepareCallState(
  tc: DispatchCall,
  findingsRefusal: CallStartFacts['findingsRefusal'],
  resolutions: ReturnType<InputsDispatch['resolutionsFor']> | undefined,
  inputs: InputsDispatch | undefined,
  args: CallStartFacts['args'],
) {
  const outcome: CallResultCell = {
    result: findingsRefusal,
    error: findingsRefusal === undefined ? undefined : true,
    /** The typed effects channel (9.19.0) — set only when the tool
     *  returned a recognized result envelope; everything else keeps
     *  today's path byte for byte. */
    toolEnvelope: undefined,
    toolStatus: findingsRefusal === undefined ? undefined : 'invalid',
  };
  // Permission gate — when a checker is configured, evaluate BEFORE
  // executing the tool. Emits `permission.check` with the decision.
  //
  // v2.12 — three terminal results:
  //   • 'allow' / 'gate_open' → tool executes normally
  //   • 'deny'                → synthetic tool_result lands; LLM continues
  //   • 'halt'                → synthetic tool_result lands; run terminates
  //                             via scope.$break + Agent.run throws
  //                             PolicyHaltError at the API boundary
  //
  // Strict ordering on halt: synthetic tool_result → halt event →
  // commit (newHistory written to scope) → $break. This guarantees
  // the audit trail is complete before the run terminates, so
  // `agent.resumeOnError(checkpoint)` sees consistent state.
  //
  // The checker receives the in-flight sequence (derived from
  // scope.history), full conversation history, current iteration,
  // identity, and abort signal — enough surface to build sequence-
  // aware policies (forbidden chains, idempotency limits, cost
  // guards) without maintaining parallel state.
  // Args as they will actually be used. The middleware chain below may
  // replace this; everything downstream (validation, the check-in
  // evidence a human approves, credentials, execute, the read_skill
  // gate) reads `callArgs`, never `tc.args`, so there is exactly one
  // answer to "what did this call really run with". Seeded from the
  // PEELED `args` (9.101.0), which is `tc.args` itself when unarmed.
  // ── THE INPUTS LAYER'S ENTRY FOR THIS CALL (honesty layer 2) ──────
  // Applied AFTER `tool_start` (which keeps the model's proposal) and
  // BEFORE the permission check, so policy judges the call that will
  // really run. A fill is a FRESH object — never an edit of `tc.args`,
  // which is the assistant message's own object when `.findings()` is
  // off. No entry (every unarmed agent) → `args` itself, by reference.
  const resolution = resolutions?.get(tc.id);
  const runArgs: ToolArgs = inputs !== undefined ? inputs.withFills(args, resolution) : args;
  const callArguments: CallArguments = {
    callArgs: runArgs,
    /** The arguments AFTER the before-tool chain and BEFORE a `wants`
     *  resolution swaps refs for artifact data — what `changedArgKeys` is
     *  judged on. Same reference as `args` unless a link rewrote (or the
     *  inputs layer filled a value — then every filled key is named). */
    chainedArgs: runArgs,
  };
  const execution: CallExecution = {
    denied: findingsRefusal !== undefined,
    /** True once `tool.execute` has been entered — see `afterMoment`. */
    executed: false,
    /** The declared argument's value handed to `execute`, read just before it ran. */
    submittedProgram: undefined,
    /** `execute` was entered and threw — a settlement the script row reads. */
    executeThrew: false,
    /** The code-run facts a code-runner tool left for this call (`takeCodeRun`). */
    ranCode: undefined,
    /** The tool's own `resultCeiling` (not the column contract) refused the result. */
    withheldOverCeiling: false,
    negativeDispatch: undefined,
    /** The tool's own `resultCeiling` refused this call's result (9.20.0)
     *  — the call ran, but it must not complete a procedure step: the
     *  refusal's own instruction is to call again. */
    ceilingRefused: false,
    haltContext: undefined,
  };
  return { outcome, resolution, runArgs, callArguments, execution };
}
