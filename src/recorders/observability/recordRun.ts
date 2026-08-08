/**
 * recordRun — save a run so a viewer can show it later.
 *
 * A RECORDING is exactly three things, and each one lights a different
 * surface:
 *
 *   `events`     the typed agentfootprint stream, in the order it fired —
 *                the story, the commentary, the summary.
 *   `snapshot`   the footprintjs run snapshot — shared state, the commit
 *                log, and every attached recorder's data (narrative,
 *                metrics, boundaries).
 *   `structure`  the agent's build-time chart — THE CHART. Nothing else
 *                can draw it, and no snapshot carries it.
 *
 * Miss one and one surface goes dark. That is why this exists: every
 * integration that assembled the bundle by hand assembled a different,
 * incomplete one, and the piece most often missing was `structure` —
 * because a completed run does not leave it behind. This is also the
 * producer for the shape lens's `observeRecording()` consumes, which
 * until now nothing produced.
 *
 *   import { recordRun } from 'agentfootprint/observe';
 *
 *   const recorder = recordRun(agent);
 *   await agent.run({ message });
 *   fs.writeFileSync('run.json', JSON.stringify(recorder.toRecording()));
 *
 * …and in the viewer:
 *
 *   const { recorder, runner } = observeRecording(JSON.parse(json));  // lens
 *   <Lens recorder={recorder} runner={runner} />
 *
 * WHAT IT WIRES THAT HAND-ROLLING GETS WRONG
 * ──────────────────────────────────────────
 * The boundary recorder — the one that puts stops on the step strip —
 * needs three connections, and each missing one fails differently:
 *
 *   attach          no boundaries at all (loud: the strip is empty)
 *   subscribe       boundaries with nothing in them (quiet: no LLM or
 *                   tool detail behind any stop)
 *   getCommitCount  every boundary stamped at commit 0 (SILENT: the
 *                   events look complete, and the strip cannot be
 *                   rebuilt offline — the commit log records what
 *                   stages wrote, never when a boundary was crossed,
 *                   so nothing downstream can repair it)
 *
 * Wire it before the run or not at all — none of the three can be
 * reconstructed from a finished run.
 *
 * WHAT IT DOES NOT DO
 * ───────────────────
 * It attaches no OTHER recorders. `narrative()` and `metrics()` are the
 * consumer's choice — their data rides the snapshot when attached, and
 * each viewer says so when it isn't there (a Gantt with no timings shows
 * execution ORDER and says so; a story panel falls back to "X executed.
 * Wrote: y"). Attaching them behind the consumer's back would make every
 * recording pay for panels most runs never open.
 */

import type { Runner } from '../../core/runner.js';
import type { AgentfootprintEvent } from '../../events/registry.js';
import type { Unsubscribe } from '../../events/dispatcher.js';
import { DEFAULT_MAX_EVENTS, eventTail } from '../../events/eventTail.js';
import { boundaryRecorder, type BoundaryRecorder } from './BoundaryRecorder.js';
import { summarizeEmbeddings } from './embeddingSummary.js';

/**
 * One frozen run — everything a viewer needs, and nothing it doesn't.
 *
 * The field names are the ones `observeRecording()` reads, so a recording
 * is handed over whole: no mapping, no adapter, no per-integration shape.
 */
export interface Recording {
  /** The footprintjs run snapshot. `undefined` if nothing has run yet. */
  readonly snapshot: unknown;
  /** The typed events the run fired, in order. */
  readonly events: readonly AgentfootprintEvent[];
  /** The agent's build-time chart — the only route to a drawable graph. */
  readonly structure: unknown;
}

export interface RecordRunOptions {
  /**
   * Cap on retained events. The oldest are dropped once the cap is hit,
   * so a long-running server records a bounded tail rather than growing
   * without limit. Default 10,000 — a few hundred KB for a typical turn,
   * and far more than any single turn fires.
   *
   * A recording that dropped events says so: `droppedEvents` counts them
   * rather than leaving a consumer to wonder why its timeline starts
   * mid-run.
   */
  readonly maxEvents?: number;
  /**
   * How much of the boundary log rides the snapshot:
   *   - `'full'` (default) — every field, content included. What an
   *     offline step strip needs to show detail behind each stop.
   *   - `'lean'` — boundary structure only, no captured payloads. The
   *     strip still rebuilds; the detail panels are empty, and a
   *     consumer reading the bundle's `meta.mode` can say so.
   */
  readonly boundaryDetail?: 'full' | 'lean';
  /**
   * Keep raw embedding vectors in the recording (8.20.0). Default `false`:
   * every `embedding` / `embeddings` field — in boundary payloads, in the
   * snapshot's subflow results, in tool results riding the event stream —
   * is replaced with its `{ dims, norm }` summary when the recording is
   * frozen.
   *
   * Field measurement behind the default: one retrieval turn's recording
   * weighed 2.76 MB, ~1.1 MB of it embedding floats, because the
   * memory-read subflow's boundary output carries each retrieved entry's
   * full vector. Nothing that renders a recording reads those floats; the
   * retrieval evidence a debugger needs (score, passage, document,
   * rejected candidates) carries no vectors and is untouched. Set `true`
   * only when a consumer genuinely replays raw vectors offline.
   */
  readonly recordEmbeddings?: boolean;
}

/** A recording in progress. Keep it until the run ends, then freeze it. */
export interface RunRecorder {
  /**
   * Freeze what has happened so far into `{ snapshot, events, structure }`.
   * Call it after the run; calling it during one gives a partial
   * recording, which is legitimate for a crash report but will show a
   * timeline that stops mid-run.
   *
   * The events array is a fresh copy, so a recording taken and stored
   * does not keep growing behind the caller's back. `snapshot` and
   * `structure` are the runner's own objects, held by reference —
   * serialize to detach.
   */
  toRecording(): Recording;
  /** The boundary recorder, for richer live queries (slot rows, ranges). */
  readonly boundary: BoundaryRecorder;
  /** How many events have been captured. */
  readonly eventCount: number;
  /** Events discarded to stay under `maxEvents`. `0` on a normal turn. */
  readonly droppedEvents: number;
  /**
   * Stop recording. The events already captured stay readable, so
   * `toRecording()` after `stop()` is the normal end of a run; call it
   * when the runner outlives the recording (a server that records one
   * turn out of many).
   */
  stop(): void;
}

/**
 * Start recording a runner. Call BEFORE `run()` — a recording is
 * collected as the run happens and cannot be reconstructed after it.
 *
 * @param runner   the Agent / composition / pattern to record.
 * @param options  event cap and boundary detail level.
 *
 * @example
 * ```ts
 * const recorder = recordRun(agent);
 * await agent.run({ message: 'Weather in San Francisco?' });
 * const recording = recorder.toRecording();
 * recorder.stop();
 *
 * fs.writeFileSync('run.json', JSON.stringify(recording));
 * ```
 */
export function recordRun(runner: Runner, options: RecordRunOptions = {}): RunRecorder {
  // 1. THE TIMELINE. Subscribed before the run so nothing is missed —
  //    the dispatcher drops events with no listener rather than queuing
  //    them, so a late subscription starts mid-story. The bounded tail
  //    (cap + drop count) is the shared `eventTail` helper, so a
  //    recording and the self-explaining agent's evidence keep the same
  //    amount and report a shortfall the same way.
  const tail = eventTail(options.maxEvents ?? DEFAULT_MAX_EVENTS);
  const offEvents: Unsubscribe = runner.on('*', (event: AgentfootprintEvent) => {
    tail.push(event);
  });

  // 2. THE BOUNDARIES — all three connections, which is the whole reason
  //    to call this instead of wiring it yourself. `getCommitCount` reads
  //    through the runner on every boundary, so it reports the count at
  //    that moment rather than a number captured now (when it is 0).
  const keepEmbeddings = options.recordEmbeddings ?? false;
  const boundary = boundaryRecorder({
    getCommitCount: () => runner.getCommitCount(),
    ...(options.boundaryDetail === 'lean' ? { snapshot: 'lean' as const } : {}),
    ...(keepEmbeddings ? { recordEmbeddings: true } : {}),
  });
  const offAttach = runner.attach(boundary);
  const offTyped = boundary.subscribe(runner);

  let stopped = false;

  return {
    toRecording: (): Recording => ({
      // Read at freeze time. Before the run there is no snapshot; during
      // one it grows; after it, it is the finished run's. Unless
      // `recordEmbeddings` asked for them, raw vectors are summarised to
      // `{ dims, norm }` here — the snapshot's subflow results carry every
      // retrieved entry's full vector otherwise, which is what made a
      // single retrieval turn's recording weigh 2.76 MB in the field. The
      // summarisation is copy-on-write: parts of the snapshot without
      // embeddings are the runner's own objects, held by reference, as
      // before — serialize to detach.
      snapshot: keepEmbeddings
        ? runner.getLastSnapshot()
        : summarizeEmbeddings(runner.getLastSnapshot()),
      events: keepEmbeddings
        ? tail.snapshot().events
        : (summarizeEmbeddings(tail.snapshot().events) as readonly AgentfootprintEvent[]),
      // The one piece a run does not leave behind — it lives on the
      // chart, which is built once and never changes.
      structure: (runner.getSpec() as { buildTimeStructure?: unknown }).buildTimeStructure,
    }),
    boundary,
    get eventCount() {
      return tail.count;
    },
    get droppedEvents() {
      return tail.dropped;
    },
    stop: () => {
      // Idempotent: a consumer that stops in both a finally block and an
      // unmount handler should not detach someone else's later recorder.
      if (stopped) return;
      stopped = true;
      offEvents();
      offTyped();
      offAttach();
    },
  };
}
