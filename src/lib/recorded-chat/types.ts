/**
 * recorded-chat types — the session-scoped turn recorder over the existing
 * context-bisect product loop (localizeContextBug + rerunWithoutSources +
 * removableSources).
 *
 * WHY THIS EXISTS: multi-turn chat on agentfootprint is a HOST convention —
 * `AgentInput` has no history field, so hosts thread the transcript into the
 * `message` string themselves. Every chat host that wanted per-turn
 * transparency then re-wrote the same correctness-critical glue and got three
 * things subtly wrong:
 *
 *   1. `agent.getLastSnapshot()` is last-run-only — a second `run()` clobbers
 *      it, so reasoning about turn K after turn K+1 ran silently attributes
 *      the wrong run.
 *   2. History is a convention — the transcript preamble must be BYTE-identical
 *      between the recorded turn and its counterfactual re-run, or the re-run
 *      ablates a subtly different scenario without failing anything.
 *   3. The `AblationRunner` duplicates turn construction — the re-run is only
 *      valid if the rebuilt turn matches the recorded one (same system, facts,
 *      preamble).
 *
 * `recordedChat({ makeAgent })` owns exactly those three: per-turn artifact
 * freezing (1), byte-exact history threading (2), and deriving the turn-K
 * runner from the SAME `makeAgent` that ran the turn (3). It COMPOSES with the
 * 7.5 surface — `reason()` calls `localizeContextBug`, `rerunTurn()` delegates
 * to `rerunWithoutSources` and returns its result UNMODIFIED (the honesty
 * tiers are not hidden). Session registries, UI joins, comparators and
 * persistence stay host-side by design (see the guide's "What stays yours").
 */

import type { RuntimeSnapshot } from 'footprintjs';
import type { Agent } from '../../core/Agent.js';
import type { MemoryIdentity } from '../../memory/identity/types.js';
import type {
  AblationSpec,
  CapturedEventLike,
  ContextBugReport,
  LocalizeContextBugOptions,
  RerunWithoutSourcesOptions,
  RerunWithoutSourcesResult,
} from '../context-bisect/index.js';

/**
 * The ONE agent factory — live turns, rerun probes, baseline probes, and
 * fork turns all go through it (the single source of truth the
 * `AblationRunner` contract already demands).
 *
 * Contract (the `AblationRunner` contract, now enforced-by-shape for live
 * turns too):
 * - Return a FRESH agent with a FRESH provider on every call — scripted
 *   mock providers are stateful (replies consume in order).
 * - Apply `specs` at CONSTRUCTION (the documented seam): filter facts /
 *   tools / memory entries with `applyAblations(specs, { ... })` before
 *   building. `specs` is ALWAYS the union of the session's persistent
 *   removals (forks carry these) and the probe's ablation specs; it is
 *   empty for a plain live turn in an unforked session.
 * - `seed` varies 0..N-1 across a probe's samples (always 0 for live
 *   turns). Thread it into any stochastic knob; ignore it when the agent
 *   is deterministic.
 */
export type MakeChatAgent = (build: {
  readonly specs: readonly AblationSpec[];
  readonly seed: number;
}) => Agent | Promise<Agent>;

/** How transcript lines and the per-turn message string are rendered. */
export interface ChatFormat {
  /** Preamble header line. Default `'Recent conversation:'`. */
  readonly header?: string;
  /** Label for user lines (`'<userLabel>: ...'`). Default `'User'`. */
  readonly userLabel?: string;
  /** Label for reply lines. Default `'Assistant'`. */
  readonly assistantLabel?: string;
}

/** One transcript entry — the structured form of a rendered line. */
export interface ChatMessage {
  readonly role: 'user' | 'assistant';
  readonly text: string;
}

export interface RecordedChatOptions {
  readonly makeAgent: MakeChatAgent;
  readonly format?: ChatFormat;
  /**
   * Transcript the session OPENS with (frozen; rendered as the seed
   * preamble of every turn). `fork()` fills this; hosts may also pass a
   * persisted transcript to rehydrate a session — authenticity of a
   * hand-supplied seed is then the host's responsibility.
   */
  readonly seed?: readonly ChatMessage[];
  /**
   * Session-persistent removals: every turn (and every probe) in this
   * session runs with these specs applied. `fork()` fills this so the
   * what-if world STAYS the what-if world.
   */
  readonly removed?: readonly AblationSpec[];
}

/** One recorded turn — everything frozen at record time. */
export interface ChatTurn {
  /** 0-based position in `turns`. */
  readonly index: number;
  readonly userMessage: string;
  /** The agent's reply (agentfootprint `AgentOutput` string). */
  readonly reply: string;
  /**
   * The EXACT message string `agent.run()` received — composed once at
   * record time. Re-runs of this turn replay these bytes verbatim; the
   * byte-exact-history guarantee lives here.
   */
  readonly message: string;
  /** Rendered transcript lines the turn opened with (frozen copy). */
  readonly transcriptBefore: readonly string[];
  /**
   * Localize-ready evidence: pass straight to
   * `localizeContextBug({ artifacts: turn.artifacts, ... })`.
   *
   * It is also a full RECORDING — `{ snapshot, events, structure }`, the
   * three fields a viewer needs — so the same frozen turn that localizes a
   * bad answer can be handed to Lens or ExplainableShell and drawn.
   */
  readonly artifacts: {
    readonly snapshot: RuntimeSnapshot;
    readonly events: readonly CapturedEventLike[];
    /**
     * The turn's build-time chart (`agent.getSpec().buildTimeStructure`),
     * captured at record time — the per-turn agent is discarded right
     * after, and a finished run cannot produce its chart afterwards.
     */
    readonly structure: unknown;
  };
  /** runtimeStageId of the turn's LAST LLM call — the default `atStep`. */
  readonly lastLlmCallId: string | undefined;
  /** The identity `send()` was given, threaded into re-runs unchanged. */
  readonly identity: MemoryIdentity | undefined;
}

export interface SendOptions {
  /** Multi-tenant memory scope, passed through to `agent.run()`. */
  readonly identity?: MemoryIdentity;
}

/** `reason(k)` options — localize passthrough minus what the turn provides. */
export interface ReasonOptions extends Omit<LocalizeContextBugOptions, 'artifacts' | 'rerun'> {
  // `embedder` stays REQUIRED (inherited). `atStep` stays optional and now
  // DEFAULTS to `turn.lastLlmCallId` (override for mid-turn analysis of
  // multi-iteration agents). The localizer's own `rerun` tier is omitted —
  // the causal loop goes through `rerunTurn`, which derives the runner from
  // `makeAgent`; a hand-rolled runner here would break the same-factory
  // guarantee.
  /** Recompute even if a memoized report exists (e.g. a new scorer). */
  readonly fresh?: boolean;
}

/** `rerunTurn(k)` options — `rerunWithoutSources` minus what the turn provides. */
export interface RerunTurnOptions
  extends Omit<RerunWithoutSourcesOptions, 'report' | 'runner' | 'originalAnswer'> {
  // Inherited and REQUIRED: `ignore`, `embedder`.
  // Inherited and optional: `samples`, `answerChanged`, `flipThreshold`,
  // `checkBaseline`.
  /**
   * The report to resolve `ignore` against. Default: the turn's memoized
   * `reason(k)` report (computed with this call's `embedder` + the default
   * scorer if none exists yet).
   */
  readonly report?: ContextBugReport;
}

export interface ForkOptions {
  /**
   * Seed the fork's last reply with this counterfactual answer. MUST be a
   * result produced by THIS session's `rerunTurn(k, ...)` for the SAME k
   * (identity-checked) — a fabricated fork would be a lie. Omitted: the
   * fork continues from the ORIGINAL reply (a plain branch, no ablation).
   */
  readonly fromRerun?: RerunWithoutSourcesResult;
}

export interface ForkOrigin {
  readonly parent: RecordedChat;
  readonly turnIndex: number;
  /** True when the fork was seeded from a re-run's counterfactual answer. */
  readonly viaRerun: boolean;
}

export interface RecordedChat {
  /** Runs one recorded turn. One send at a time — concurrent sends throw. */
  send(userMessage: string, options?: SendOptions): Promise<ChatTurn>;
  /** Turn K's frozen record. Out-of-range throws (names the valid range). */
  turn(k: number): ChatTurn;
  readonly turns: readonly ChatTurn[];
  /** The transcript the session opened with (forks / rehydration; else `[]`). */
  readonly seed: readonly ChatMessage[];
  /** The session's persistent removals (forks carry these; else `[]`). */
  readonly removed: readonly AblationSpec[];
  /** Set on sessions created by `fork()`; `undefined` otherwise. */
  readonly forkedFrom: ForkOrigin | undefined;
  /**
   * Turn K's `ContextBugReport` (agentfootprint's, unmodified) via
   * `localizeContextBug` over the frozen artifacts, `atStep` defaulted to
   * the turn's last LLM call. Memoized per turn; `fresh: true` recomputes.
   */
  reason(k: number, options: ReasonOptions): Promise<ContextBugReport>;
  /**
   * Re-run turn K without the named sources — same recorded history bytes,
   * same user message, minus the sources — delegating to
   * `rerunWithoutSources` with a runner derived from `makeAgent`. Returns
   * agentfootprint's `RerunWithoutSourcesResult` UNMODIFIED (a `verdict`
   * only when `checkBaseline: true` — the honesty tiers are not hidden).
   */
  rerunTurn(k: number, options: RerunTurnOptions): Promise<RerunWithoutSourcesResult>;
  /**
   * Branch, never rewrite: a NEW `RecordedChat` (same `makeAgent`, same
   * format) whose seed is the conversation through turn K with the reply
   * swapped for the re-run's counterfactual answer (or kept, without
   * `fromRerun`), and whose `removed` is this session's removals plus the
   * re-run's `removed` specs. The original session is never touched.
   */
  fork(k: number, options?: ForkOptions): RecordedChat;
}
