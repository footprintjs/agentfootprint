import type { Standing } from '../../../../core/agent/findings/types.js';
import type { OtelSpanLike } from '../types.js';

// Per-turn state — same pattern as xrayObservability. Events for
// multiple in-flight turns interleave correctly because we key by
// the run anchor (`meta.runId`).
export interface TurnState {
  readonly stack: Array<{ name: string; span: OtelSpanLike }>;
  readonly sampled: boolean;
  /** The root (turn) span — kept aside so llm_start can back-fill
   *  `gen_ai.provider.name` / `gen_ai.request.model` onto the
   *  `invoke_agent` span (conditionally-required semconv attrs we
   *  don't know yet at turn_start). */
  root?: OtelSpanLike;
  rootEnriched?: boolean;
  /** toolCallId → live tool span. tool_end carries ONLY toolCallId
   *  at runtime (`ToolEndPayload`), and parallel tool calls
   *  interleave — LIFO stack popping would close the wrong span. */
  readonly toolSpans: Map<string, OtelSpanLike>;
  /** toolCallId → tool name, from `tool_start` (`tool_end` carries no name). */
  readonly toolNames: Map<string, string>;
  /** `gen_ai.conversation.id` as this adapter writes it (the digest, or the
   *  raw id under `conversationId: 'raw'`) — absent for a run that is not
   *  session-bound. Stamped on every GenAI span of the turn. */
  readonly conversationId?: string;
  /** SHA-256 of the session id, whatever form is exported — what a score's
   *  own session is compared against before it may be parented here. */
  readonly sessionDigest?: string;
  /** Findings standing rows seen this turn, per standing. Created on the
   *  first row, so a turn with none puts no count keys on the root. */
  standingCounts?: Map<Standing, number>;
  /** Standing span EVENTS written this turn, and the rows past the cap. */
  standingEvents: number;
  standingOmitted: number;
  /** toolCallId → the call's tool name and its proposal, SERIALIZED at
   *  `tool_start` (never the live object: the engine hands that same object
   *  to the tool, which may write into it) — kept only under
   *  `captureToolContent`, for the `tool_end` that exports the arguments. */
  readonly proposedArgs: Map<
    string,
    { readonly toolName: string; readonly text?: string; readonly chars: number }
  >;
}
interface ClosedTurn {
  /** The ended root; absent for a turn sampling dropped. */
  readonly root?: OtelSpanLike;
  readonly sessionDigest?: string;
}

/** A run this adapter holds — open, or closed within the window. */
interface HeldRun {
  readonly runId: string;
  readonly live?: TurnState;
  /** Absent when sampling dropped the run. */
  readonly root?: OtelSpanLike;
  readonly sessionDigest?: string;
}

export const MAX_CLOSED_TURNS = 32;

export function createTurnStore() {
  const activeTurns = new Map<string, TurnState>();

  /**
   * Tool names this strategy has seen RUN — a `tool_end` without `error` or
   * `notExecuted` — so a held tool, by construction. What a `tryInsteadTool`
   * suggestion is recognized against. Bounded; names only.
   */
  const ranTools = new Set<string>();
  /**
   * Tool names that filed a `tools.code_run` — a code runner. Its arguments
   * ARE the generated program, which "must not reach an exporter"
   * (`events/payloads.ts` · `ToolsCodeRunPayload`): under
   * `captureToolContent` its calls export no arguments. `code_run` fires after
   * the tool ran and BEFORE its `tool_end`, so the first call is covered too;
   * a call that failed exports no content at all.
   */
  const codeRunners = new Set<string>();
  const MAX_TOOL_NAMES = 1024;
  function remember(set: Set<string>, name: string): void {
    if (set.size >= MAX_TOOL_NAMES && !set.has(name)) return;
    set.add(name);
  }

  /**
   * Turns that have CLOSED (turn_end / error.fatal), by run id — so a late
   * event can still find its run. Two events arrive late by construction: the
   * checker accounting (`integrity.disposition`, filed in the run door's
   * `finally`, after turn_end) and an evaluation scored after the run. A real
   * SDK drops span events on an ENDED span, so a late event gets its own
   * short child span. An unsampled turn is remembered too (no span), so its
   * late events are dropped with it rather than exported loose.
   *
   * Bounded — the last {@link MAX_CLOSED_TURNS} — and cleared by `stop()`.
   * The window is per strategy, and one strategy usually serves the whole
   * process: in a busy server a late event for a run 32 turns back finds it
   * forgotten. A forgotten run's id is still remembered (a string, in
   * {@link forgottenRuns}), so "forgotten" is told apart from "never traced"
   * and reported, never dropped in silence. Each held root keeps its span
   * object (and, under `captureContent`, the task text on it) on the heap
   * until it leaves the window.
   */
  const MAX_FORGOTTEN_RUNS = 1024;
  const closedTurns = new Map<string, ClosedTurn>();
  /** run id → whether it was sampled, for runs that left the window. */
  const forgottenRuns = new Map<string, boolean>();
  function rememberClosed(runId: string, t: TurnState): void {
    closedTurns.delete(runId);
    closedTurns.set(runId, {
      ...(t.root !== undefined && { root: t.root }),
      ...(t.sessionDigest !== undefined && { sessionDigest: t.sessionDigest }),
    });
    while (closedTurns.size > MAX_CLOSED_TURNS) {
      const [oldest] = closedTurns.entries();
      if (oldest === undefined) break;
      closedTurns.delete(oldest[0]);
      forgottenRuns.set(oldest[0], oldest[1].root !== undefined);
    }
    while (forgottenRuns.size > MAX_FORGOTTEN_RUNS) {
      const [oldest] = forgottenRuns.keys();
      if (oldest === undefined) break;
      forgottenRuns.delete(oldest);
    }
  }

  /** The root of a traced turn, open or recently closed — `undefined` for an
   *  unsampled turn or a run this adapter never traced (or has forgotten). */
  function rootOf(runId: string): OtelSpanLike | undefined {
    const live = activeTurns.get(runId);
    if (live !== undefined) return live.root;
    return closedTurns.get(runId)?.root;
  }
  function heldRun(runId: string): HeldRun | undefined {
    const live = activeTurns.get(runId);
    if (live !== undefined)
      return {
        runId,
        live,
        ...(live.root !== undefined && { root: live.root }),
        ...(live.sessionDigest !== undefined && { sessionDigest: live.sessionDigest }),
      };
    const closed = closedTurns.get(runId);
    return closed === undefined ? undefined : { runId, ...closed };
  }
  /** Single-active-turn resolution for FlowRecorder evidence (which has
   *  no dispatcher runId to join on). One agent = one turn in flight is
   *  the norm; with >1 concurrent turn we can't attribute the decision
   *  safely, so we skip rather than risk cross-run contamination. */
  function soleActiveTurn(): TurnState | undefined {
    if (activeTurns.size !== 1) return undefined;
    const [t] = activeTurns.values();
    return t;
  }

  return { activeTurns, ranTools, codeRunners, closedTurns, forgottenRuns, remember, rememberClosed, rootOf, heldRun, soleActiveTurn };
}

export type TurnStore = ReturnType<typeof createTurnStore>;
