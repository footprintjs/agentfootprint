/** One-job type contract owner; canonical exports remain with its facade. */
import type { ExternalGround } from '../../../integrity/unsupported-argument/check.js';
import type { ToolOf } from '../arguments/resolve.js';
import type { ZoneName } from '../../../time/zone.js';
/** What an armed agent hands the inputs layer's mount — closures, never scope. */
export interface InputsMountDeps {
  /** Filter refused references before input planning can consult host-supplied sources. */
  readonly findings?: true;
  /**
   * The evidence gate's revision turns the tools off (an enforcing answer
   * validation) — present only then. The layer hands Route's dispatch test
   * the run's `toolsOffAfterRevision`, so it never asks about a call Route
   * will not run.
   */
  readonly toolsOffAfterRevision?: true;
  /** The implementation that will answer a name — the shared dispatch resolver's. */
  readonly toolOfFor: (scope: object) => ToolOf;
  /**
   * A before-tool middleware chain is configured (`.toolMiddleware()`), so a
   * rewrite can supersede one of the layer's rows (the call then ran with the
   * rewrite's value). Read by the final branch's "Assumed" block
   * (`stages/prepareFinal.ts` · `prepareFinalWithLimitsAndAssumedStage`),
   * which then reads `middlewareDecisions`; absent, that key can hold no tool
   * rewrite and is never read. The mount itself does not read it.
   */
  readonly rewrites?: true;
  /**
   * DECLARED SOURCES ARE ARMED (`.findings({ argumentSources: true })` or
   * `.inputsLayer({ argumentSources: true })`) — present only then. The mount hands the layer the pieces its checks read
   * and the closures that read them; `externalGrounds` is the app's own
   * vouched-for values (`AgentOptions.externalGrounds`), an `app` source with
   * its label.
   */
  readonly sources?: {
    readonly externalGrounds?: () => readonly ExternalGround[];
    /**
     * The findings ledger is armed beside declared sources (`.findings()`) —
     * present only then: a call that declares a basis files a BASIS row in
     * ToolCalls, and that row carries the count of dropped `from` entries.
     * Absent (declared sources without the ledger), no basis row is ever
     * filed, so the count rides the call's first argument row
     * (`sourceCorpus.ts` · `declaredSourcesOf`).
     */
    readonly basisRows?: true;
    /**
     * A tool in reach may carry an arguments view — one the agent registers
     * carries one (`core/toolShownArgs.ts` · `carriesArgumentView`), or a
     * ToolProvider is wired (whatever it lists: its list is known only per
     * iteration) — present only then: no quote the model wrote is shown on a
     * row or an ask, since a quote may hold the value such a tool hides
     * (`arguments/resolve.ts` · `quotesMayShow`).
     */
    readonly argumentViews?: true;
  };
  /**
   * THE TIME LAYER IS ARMED (`.time()`) — present only then. The mount hands
   * the layer this turn's `clock` row and `time-reading` rows (`timeInputs`),
   * and the layer files one `call-window` row per call to a tool whose period
   * declares forms (`time/bind.ts`), merged into the ledger beside the
   * argument rows in the same ONE write.
   */
  readonly time?: {
    /** The app's `.time({ zone })` — the zone of a form declaring `wallZone: 'app'`. */
    readonly appZone?: ZoneName;
  };
}
