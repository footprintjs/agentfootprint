import type { ToolOf } from '../arguments/resolve.js';
import type { ZoneName } from '../../../time/zone.js';
import type { TimeAskMessages } from '../../../time/ask.js';
import type { TimePolicy } from '../../../time/resolve.js';
import type { CallAsk } from '../arguments/ask.js';
import type { AskedArgument } from '../arguments/sourceCorrection.js';

/** What the dispatch stage hands the ask — closures, never scope. */
export interface ArgumentAskDeps {
  /** Already refused calls do not acquire new obligations. */
  readonly excludedCallIds?: readonly string[];
  readonly admitAnswer?: () => void;
  readonly saveParties?: () => void;
  /** Immediately before a newly raised input pause, while this batch is wholly undispatched. */
  readonly beforePause?: (asked: readonly AskedArgument[]) => void;
  /** Only after the native time/protocol owner confirms this batch has no other human obligation. */
  readonly correctOmissions?: (asks: readonly CallAsk[]) => boolean;
  /** Current native refusals, before early return or any newly raised human pause. */
  readonly refusedCalls?: (ids: readonly string[]) => void;
  readonly pendingAsk?: boolean;
  readonly settledAsk?: () => void;
  readonly refuseMalformedBatch?: () => boolean;
  readonly argumentSources?: true;
  /** The implementation that will answer a name — the shared dispatch resolver's. */
  readonly toolOf: ToolOf;
  /** The run id a stamped request id carries; absent → the turn's start time. */
  readonly runId?: () => string | undefined;
  /** The host's own context for the ask (`AgentOptions.argumentAskContext`). */
  readonly hostContext?: () => unknown;
  /**
   * Present exactly under `.time()`: an answer for a period argument is also
   * judged against the tool's declared facts at the turn's clock
   * (`arguments/ask/validation.ts` · `checkAnswer`) — `appZone` is the app's `.time({ zone })`.
   * `reader` is present exactly under `.time({ reader })`: a call that left
   * its period out while the turn's one mention was open is asked THAT
   * mention's window (the lazy word-driven ask) — `policy` re-reads the
   * mention after a zone answer, `messages` are the app's catalog overrides.
   */
  readonly time?: {
    readonly appZone?: ZoneName;
    readonly reader?: {
      readonly policy: TimePolicy;
      readonly messages?: Partial<TimeAskMessages>;
    };
  };
}
