/**
 * window/types — what each window strategy accepts, and what it writes into
 * the ledger.
 *
 * Pattern: Value objects (no behavior) + resolved-config types.
 * Role:    core/ layer. The law this whole folder exists to keep is stated
 *          once, here, because every other file implements a piece of it:
 *          **a window strategy edits the WINDOW, never the LEDGER.**
 * Emits:   N/A (types only).
 *
 * The window is `scope.history` — the array `call-llm` hands the provider.
 * The ledger is footprintjs's commit log, which is append-only: the turns a
 * strategy removes from the window were committed by `seed#0` /
 * `tool-calls#N` BEFORE the removal and stay in those bundles byte-identical
 * forever. A strategy therefore cannot destroy history even in principle; it
 * can only stop re-sending it. A summary is a CLAIM about the past, so it is
 * filed as a claim — its own recorded step, naming every `runtimeStageId` it
 * folded. A drop is an ABSENCE, and it is filed the same way: the record and
 * the eviction events name what left, by id.
 *
 * That law holds for as long as the PROCESS holds — a commit log is memory.
 * A conversation outlives its process, so the durable half of the same law
 * lives on the conversation checkpoint: `.compaction({ retain })` carries the
 * folded originals there, beside the summary that stands for them. See
 * {@link CompactionRetention} and {@link FoldedSpan}.
 */

import type { LLMMessage, LLMProvider } from '../../../adapters/types.js';

// ─────────────────────────────────────────────────────────────────
// Refusals — shared by every strategy
// ─────────────────────────────────────────────────────────────────

/**
 * Why a turn refused to leave the window. Every one of these is NAMED in the
 * commit — a removal that took less than it could have has to say why, or the
 * next person debugging an oversized window has to guess.
 *
 * The set is closed and shared: the same reason means the same thing under
 * every strategy, because every strategy resolves it through the same
 * function (`refusalFor`, bound into `WindowStrategyInput.planRemoval`).
 */
export type WindowRefusalReason =
  /** The turn holds a `role: 'system'` message. The envelope never leaves. */
  | 'system-envelope'
  /**
   * An assistant `tool_use` in this turn has no matching `tool_result` in the
   * window. Removing an unanswered question destroys the answer's referent —
   * and the referent may still arrive (a paused run resumes).
   */
  | 'unresolved-tool-call'
  /** The turn holds the tool call this run is currently paused on. */
  | 'paused-tool'
  /** The turn holds a tool call waiting on a human check-in decision. */
  | 'pending-check-in'
  /** Inside `keepRecentTurns` — the recent window is never a candidate. */
  | 'inside-keep-window'
  /**
   * The only removable candidate is a summary a previous fold wrote. Folding
   * a summary of a summary with nothing new to add spends a call to lose
   * detail. Only `summarizeOldest` can report this: a drop spends nothing.
   */
  | 'only-existing-summary'
  /** The summarizer threw. No fold this iteration; the window stays big. */
  | 'summarizer-failed'
  /**
   * The REPLACEMENT came back no smaller than the span it would replace, so
   * the removal was abandoned. Both sides are measured in chars — the same
   * unit, an exact comparison, not a token guess.
   *
   * For `summarizeOldest` the replacement is the summary message: folding
   * here would spend a call to make the window BIGGER and lose the detail as
   * well. For the drop strategies it is the authored drop notice that has to
   * take the window's head position (see `DROP_NOTICE_PREFIX`): dropping two
   * tiny turns to insert a longer notice is pure loss, so it does not happen.
   */
  | 'summary-not-smaller';

/** One named refusal, positioned so a reader can find the turn. */
export interface WindowRefusal {
  readonly reason: WindowRefusalReason;
  /** Index of the turn in this iteration's turn segmentation. */
  readonly turnIndex: number;
  /** Index of the turn's first message in the pre-removal window. */
  readonly messageIndex: number;
}

/**
 * @deprecated Renamed to {@link WindowRefusal} in 7.17 — refusals are shared
 * by every window strategy, and only one of them folds. This alias is the
 * same type and is not going away in 7.x.
 */
export type FoldRefusal = WindowRefusal;

/**
 * @deprecated Renamed to {@link WindowRefusalReason} in 7.17. Same values,
 * same meanings; kept as an alias for code written against 7.16.
 */
export type FoldRefusalReason = WindowRefusalReason;

// ─────────────────────────────────────────────────────────────────
// Records — one per visit that engaged, whatever the strategy
// ─────────────────────────────────────────────────────────────────

/**
 * What one visit to the window stage put in the ledger.
 *
 * Every strategy files one of these — including the visits that removed
 * NOTHING, which are the interesting ones. They are appended to
 * `scope.compactions`, so the run's whole window story is one array in the
 * commit log.
 *
 * (`compactions` is the key `.compaction()` shipped with in 7.16 and the key
 * every strategy still writes: it is committed state, which is public surface
 * for anyone reading a run, and renaming it for a better word would break
 * those readers for nothing. It is named for the family's first member.)
 *
 * On `windowChars*` vs tokens: the char counts are EXACT and measured here.
 * There is deliberately no `tokensAfter` — nothing can count the tokens of a
 * window that has not been sent yet, and inventing one would be exactly the
 * guess this family exists to refuse. The honest "after" is the NEXT call's
 * `stream.llm_end` usage.
 */
export interface WindowRecord {
  /**
   * `WindowStrategy.name` of the strategy that decided — `'summarize-oldest'`,
   * `'sliding-window'`, `'token-budget'`, or your own. Narrow on it.
   */
  readonly strategy: string;
  /** ReAct iteration this visit belongs to. */
  readonly iteration: number;
  /** `runtimeStageId`s of the stages that appended the messages that left. */
  readonly removedStageIds: readonly string[];
  /** How many messages left the window. */
  readonly removedMessageCount: number;
  /** Window size in chars before / after this visit. Exact, and not tokens. */
  readonly windowCharsBefore: number;
  readonly windowCharsAfter: number;
  /** Every turn that refused to leave, named. */
  readonly refusals: readonly WindowRefusal[];
}

/**
 * What one OVER-BUDGET visit to `summarizeOldest` (what `.compaction()`
 * configures) put in the ledger.
 */
export interface CompactionRecord extends WindowRecord {
  /** Adapter-reported input tokens of the last call — what tripped the check. */
  readonly measuredTokens: number;
  /** The budget it was compared against. */
  readonly thresholdTokens: number;
  /** True when the measurement was over budget (a fold was attempted). */
  readonly overBudget: boolean;
  /**
   * @deprecated Use {@link WindowRecord.removedStageIds} — the family name for
   * the same value, published alongside it since 7.17. Both are written.
   */
  readonly foldedStageIds: readonly string[];
  /**
   * @deprecated Use {@link WindowRecord.removedMessageCount} — the family name
   * for the same value, published alongside it since 7.17. Both are written.
   */
  readonly foldedMessageCount: number;
  /** Length of the summary text the summarizer produced (0 when none). */
  readonly summaryChars: number;
  /** What the summarizer call itself cost, when it reported usage. */
  readonly summarizerTokens?: { readonly input: number; readonly output: number };
}

/** What one visit to `slidingWindow` put in the ledger. */
export interface SlidingWindowRecord extends WindowRecord {
  readonly strategy: 'sliding-window';
  /** The configured keep depth this visit measured against. */
  readonly keepRecentTurns: number;
  /** Turns in the window before / after this visit. Counted, not estimated. */
  readonly turnsBefore: number;
  readonly turnsAfter: number;
}

/** What one OVER-BUDGET visit to `tokenBudget` put in the ledger. */
export interface TokenBudgetRecord extends WindowRecord {
  readonly strategy: 'token-budget';
  /** Adapter-reported input tokens of the last call — what tripped the check. */
  readonly measuredTokens: number;
  /** The budget it was compared against. */
  readonly thresholdTokens: number;
  /** True when the measurement was over budget (a drop was attempted). */
  readonly overBudget: boolean;
  /** How many recent turns were off-limits to this visit. */
  readonly keepRecentTurns: number;
}

// ─────────────────────────────────────────────────────────────────
// Retention — what happens to the messages a fold removes
// ─────────────────────────────────────────────────────────────────

/**
 * What becomes of the messages a fold removes from the window.
 *
 * The commit log keeps them for as long as the PROCESS keeps them, and that
 * is the whole of what 8.1 offered. A standing agent outlives its process, so
 * "the folded turns are still in the commit log" stops being true the moment
 * the run ends — and the summary sitting in the restored conversation went on
 * claiming otherwise. Retention is the fix: the originals ride with the
 * CONVERSATION, which is the thing that actually survives.
 *
 * The trade is stated rather than hidden: **compaction shrinks the wire, not
 * the record.** A stored session grows as it folds. That is the right way
 * round — the model's context window is scarce and a session row is not.
 */
export type CompactionRetention =
  /**
   * The folded messages ride with the conversation checkpoint, so a restart —
   * a new process, a new machine, a deploy — can still produce them verbatim.
   * The default: originals are never destroyed unless you say so.
   */
  | 'conversation'
  /**
   * The folded messages are NOT carried forward. The span is still recorded,
   * naming what left and how much of it, because a discard is an absence and
   * this family files absences the same way it files claims. Choose it when
   * the conversation is the only thing you want to keep and the storage cost
   * of the transcript is not worth paying.
   */
  | 'discard';

/**
 * One fold, as it survives the process: the summary's fingerprint, what it
 * stands for, and — under `retain: 'conversation'` — the messages themselves.
 *
 * These accumulate on the conversation checkpoint across every turn and every
 * restart, so a standing agent that folded week one in April can still produce
 * week one in July.
 *
 * ## Joining a span to its summary
 *
 * By CONTENT FINGERPRINT, never by index: a later fold can swallow an earlier
 * summary, and every index in the window moves when it does. {@link
 * foldedSpanFor} does the join for you.
 */
export interface FoldedSpan {
  /**
   * Fingerprint of the summary message this span was folded into — the join
   * key back to the message sitting in `history`.
   *
   * It is a hash of the message's full content (authored frame included), so
   * it costs no extra bytes on the wire and cannot be forged by a summary that
   * merely copies the frame's opening words: different content, different
   * fingerprint, no match.
   */
  readonly summaryFingerprint: string;
  /**
   * The run whose commit log held these messages. Diagnostic, and the honest
   * answer to "where else could I have found this?" — that log is gone with
   * the process, which is why the messages are here.
   */
  readonly runId: string;
  /** ReAct iteration the fold happened at, in that run. */
  readonly iteration: number;
  /** Wall clock of the fold. */
  readonly foldedAtMs: number;
  /** The model that wrote the summary — a claim's author is part of the claim. */
  readonly model: string;
  /** How many messages the summary stands for. Always recorded, both policies. */
  readonly messageCount: number;
  /** `runtimeStageId`s of the stages that appended those messages. */
  readonly removedStageIds: readonly string[];
  /** Which policy this fold ran under. */
  readonly retained: CompactionRetention;
  /**
   * The folded messages, verbatim and in order. Present exactly when
   * `retained` is `'conversation'`.
   *
   * Absent under `'discard'` — and absent is the honest shape there, rather
   * than an empty array that reads like "there were none".
   */
  readonly messages?: readonly LLMMessage[];
}

// ─────────────────────────────────────────────────────────────────
// Options
// ─────────────────────────────────────────────────────────────────

/**
 * What `.compaction({...})` — and `summarizeOldest({...})` — accepts.
 *
 * @example
 * ```ts
 * const agent = Agent.create({ provider: anthropic(), model: 'claude-sonnet-4-5' })
 *   .compaction({
 *     thresholdTokens: 120_000,
 *     summarizer: anthropic(),          // usually the cheap one
 *     model: 'claude-haiku-4-5',
 *     keepRecentTurns: 6,
 *   })
 *   .build();
 * ```
 */
export interface CompactionOptions {
  /**
   * Fold when the LAST call's adapter-reported input tokens exceed this.
   *
   * REQUIRED, with no default. A default budget here would be a number the
   * library invented for a window whose size only the consumer's model and
   * wallet know — and every run would silently inherit it.
   */
  readonly thresholdTokens: number;
  /**
   * How many of the most recent turns are never folded. Default 6.
   *
   * The recent turns are what the model is actually reasoning over; folding
   * them is how a compacting agent loses the thread.
   */
  readonly keepRecentTurns?: number;
  /**
   * The provider that writes the summary. Explicitly chosen — the library
   * never quietly bills your main model for compaction.
   */
  readonly summarizer: LLMProvider;
  /**
   * Model id for the summarizer call. Defaults to the agent's own model, so
   * `summarizer: anthropic()` alone works; name a cheap model to spend less.
   */
  readonly model?: string;
  /**
   * What happens to the messages a fold removes. Default `'conversation'` —
   * they ride with the conversation checkpoint and survive the process.
   *
   * Pass `'discard'` to opt out. Nothing is ever destroyed silently: the only
   * way to lose the originals is to name this.
   *
   * @example
   * ```ts
   * .compaction({
   *   thresholdTokens: 120_000,
   *   summarizer: anthropic(),
   *   retain: 'conversation',   // the default, spelled out
   * })
   * ```
   */
  readonly retain?: CompactionRetention;
}

/** Resolved form — defaults applied at build time, validated once. */
export interface ResolvedCompaction {
  readonly thresholdTokens: number;
  readonly keepRecentTurns: number;
  readonly summarizer: LLMProvider;
  readonly model: string | undefined;
  readonly retain: CompactionRetention;
}

/**
 * What `slidingWindow({...})` accepts.
 *
 * @example
 * ```ts
 * const agent = Agent.create({ provider: anthropic(), model: 'claude-sonnet-4-5' })
 *   .window(slidingWindow({ keepRecentTurns: 12 }))
 *   .build();
 * ```
 */
export interface SlidingWindowOptions {
  /**
   * How many of the most recent turns stay in the window. Everything older is
   * dropped — unless it refuses by name.
   *
   * REQUIRED, with no default. It *is* the policy: how much past this agent
   * needs is a fact about your agent, not about this library.
   */
  readonly keepRecentTurns: number;
}

/**
 * What `tokenBudget({...})` accepts.
 *
 * @example
 * ```ts
 * const agent = Agent.create({ provider: anthropic(), model: 'claude-sonnet-4-5' })
 *   .window(tokenBudget({ thresholdTokens: 120_000 }))
 *   .build();
 * ```
 */
export interface TokenBudgetOptions {
  /**
   * Drop when the LAST call's adapter-reported input tokens exceed this.
   *
   * REQUIRED, with no default — the same reason as `.compaction()`: only your
   * model and your bill know the right number.
   */
  readonly thresholdTokens: number;
  /**
   * How many of the most recent turns are never dropped. Default 6.
   */
  readonly keepRecentTurns?: number;
}
