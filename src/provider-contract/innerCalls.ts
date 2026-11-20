/**
 * The calls a tool made through another tool (`ctx.tools.call`), carried on the
 * history message that answers the call the model made.
 *
 * Why on the history message: a permission checker's `sequence` is derived
 * from history (`security/extractSequence.ts`), and history is what a later
 * turn, a resumed run and `agent.resumeOnError` read. A sequence rule ("read a
 * secret, then post it") must see a step a composing tool took for the model as
 * it sees the model's own step, in this run and in the next one, so the inner
 * calls ride the history in its shown view. The current invocation keeps
 * the actual arguments through admission, and protected values live in
 * private working state for later checks in the run.
 *
 * Example — the model calls `compose` (`c1`), whose tool reads a secret
 * through `ctx.tools`; the result message for `c1` carries:
 *
 *   calls: [{ toolCallId: 'c1#inner-1', toolName: 'read_swatch', args: { id: 'S1' } }]
 *
 * and the next model call's checker is handed the sequence
 * `[compose, read_swatch (inner)]`.
 */

/** One inner call whose tool's function was entered, as the record shows it. */
export interface InnerCallRan {
  /** The inner call's own id: `<outer call id>#inner-<n>`. */
  readonly toolCallId: string;
  /** The tool the composing tool called. */
  readonly toolName: string;
  /**
   * The arguments it ran with, shown through the tool's own argument view
   * (a key the tool hides reads as its placeholder) — the same copy the run's
   * `innerToolCalls` row keeps. Never the composing tool's live object.
   */
  readonly args: Readonly<Record<string, unknown>>;
  /** Reference to protected policy input; `null` confirms that the shown arguments are the bound input. */
  readonly policyArgsRef?: string | null;
}

/**
 * One entry in the in-flight tool-call sequence delivered to
 * `PermissionChecker.check()` since v2.12. Lets sequence-aware
 * policies (exfil chain detection, idempotency limits, cost guards)
 * inspect what has already been dispatched: the model's calls, and each
 * call a tool made through `ctx.tools.call` right after its outer call.
 *
 * Derived from `scope.history` at check time — single source of truth,
 * survives `agent.resumeOnError(checkpoint)` correctly.
 */
export interface ToolCallEntry {
  /** Tool name dispatched. */
  readonly name: string;
  /** Bound tool arguments in permission questions. Public halt reports use the inner tool's shown view. */
  readonly args: Readonly<Record<string, unknown>> | undefined;
  /** ReAct iteration the call was dispatched on. */
  readonly iteration: number;
  /** `'local'` (`.tool(...)` / `staticTools(...)`) or the resolving `ToolProvider.id` — lets exfil rules match on origin. */
  readonly providerId?: string;
  /** `true` on a call a tool made through `ctx.tools.call` (`provider-contract/innerCalls.ts`); absent on the model's own. */
  readonly inner?: true;
}
