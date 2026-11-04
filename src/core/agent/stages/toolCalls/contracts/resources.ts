import type { MemoryIdentity } from '../../../../../memory/identity/types.js';
import type { ComponentResources } from '../../../componentResources.js';

/** The resources dependencies of the existing tool-call stage. */
export interface ToolResourcesPort {
  /**
   * The durable-write barrier (`core/durabilityBarrier.ts`). Asked ONCE per
   * iteration, before any of this iteration's tools are dispatched: if the last
   * iteration's state is still being written to a session store, wait for it.
   *
   * This is what bounds side-effect replay. Without it, iteration N's tools run
   * while iteration N-1's write is in flight, so a crash can re-issue more than
   * one iteration's worth of tool calls on replay and "how much re-executes?"
   * has no answer. With it the answer is exactly one: the current iteration.
   *
   * Returns `undefined` when nobody installed a barrier — the ordinary case —
   * and the dispatch loop then does not await at all, so an agent without a
   * durable session composer is byte-identical in behaviour AND in timing.
   *
   * NOT a general extension point: the only installer is
   * `agentfootprint/hosting`'s session writer, through a module-private
   * WeakMap that appears on no barrel. See `core/durabilityBarrier.ts`.
   *
   * @internal
   */
  readonly awaitDurable?: () => Promise<void> | undefined;
  /**
   * The identity facts THIS run carries, for `ToolExecutionContext` (9.7.0).
   *
   * An ACCESSOR, for the same reason `awaitDurable` is one: the chart is built
   * ONCE at construction and these change per run, so a captured value would be
   * run #1's forever. Read once per dispatch loop, beside `scope.runIdentity`.
   *
   * `identity` here is the CALLER's explicit identity (`Agent.lastRunIdentity`),
   * NOT `scope.runIdentity` — the latter is always populated, defaulting to
   * `{ conversationId: '<runId>' }` (or, on a session-bound run since 9.10.0,
   * to `{ conversationId: sessionId }`), and publishing either to a tool would
   * present a synthesized conversation as one somebody named.
   *
   * @internal
   */
  /**
   * Is this stage running in the agent's OWN executor? Asked of the scope
   * (`stages/seed.ts` · `isOwnRun`): a stage in another runner's executor — a
   * composition member — retains the actual native component run facts and
   * takes only its explicit member identity from `scope.memberRun`. The
   * member link never substitutes a different executor's run context.
   * Absent → the agent's own run.
   *
   * @internal
   */
  readonly isOwnRun?: (scope: object) => boolean;
  /** Captured native leg/component liveness, never the runner selected by a later call. */
  readonly isRunRetired: () => boolean;
  readonly currentRun?: () => {
    readonly runContext?: import('../../../../../bridge/eventMeta.js').RunContext;
    readonly runId: string;
    readonly sessionId?: string;
    readonly identity?: MemoryIdentity;
  };
  /**
   * This native component's resource adapter. It persists finite references
   * before tool resource effects and borrows the existing shared tier before
   * dispatch. Live views and callbacks never cross checkpoints.
   * @internal
   */
  readonly resources?: ComponentResources;
}
