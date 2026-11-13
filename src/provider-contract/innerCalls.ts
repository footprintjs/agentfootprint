/**
 * The calls a tool made through another tool (`ctx.tools.call`), carried on the
 * history message that answers the call the model made.
 *
 * Why on the history message: a permission checker's `sequence` is derived
 * from history (`security/extractSequence.ts`), and history is what a later
 * turn, a resumed run and `agent.resumeOnError` read. A sequence rule ("read a
 * secret, then post it") must see a step a composing tool took for the model as
 * it sees the model's own step, in this run and in the next one, so the inner
 * calls ride the one record that outlives the run. Until the outer call's
 * result lands, its later inner calls' checker reads the same facts from the
 * run's `innerToolCalls` rows (`core/agent/stages/toolCalls/access/innerCallGates.ts`).
 *
 * Example — the model calls `compose` (`c1`), whose tool reads a secret
 * through `ctx.tools`; the result message for `c1` carries:
 *
 *   calls: [{ toolCallId: 'c1#inner-1', toolName: 'read_secret', args: { id: 'S1' } }]
 *
 * and the next model call's checker is handed the sequence
 * `[compose, read_secret (inner)]`.
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
}
