/**
 * strictFollowUp — auto-execute follow-ups when condition matches user message.
 *
 * When a tool's follow-up binding has `strict: true`, the framework stores it
 * as a pending follow-up. On the next user message, the condition is checked:
 *   - If matched: framework auto-executes the tool with pre-resolved params,
 *     bypassing the LLM for tool call construction. Zero ID corruption risk.
 *   - If not matched: pending follow-up is cleared, LLM proceeds normally.
 *
 * The LLM is still used to interpret the follow-up tool's result — it's only
 * bypassed for the mechanical "construct the tool call" step.
 *
 * Condition matching uses a keyword-based matcher by default. Custom matchers
 * can be provided per follow-up binding.
 */

import type { ResolvedFollowUp } from './evaluator';

// ── Condition Matcher ───────────────────────────────────────────────────

/**
 * Default keyword matcher — extracts intent keywords from the condition string
 * and checks if the user message contains any of them.
 *
 * The condition is a natural language string like "User asks why or wants details".
 * The matcher extracts content words and checks for overlap with the user message.
 *
 * @example
 * ```typescript
 * defaultMatcher('User asks why or wants details', 'Why was I denied?')
 * // → true (matches "why")
 *
 * defaultMatcher('User asks why or wants details', 'What is the weather?')
 * // → false (no keyword overlap)
 * ```
 */
export function defaultConditionMatcher(condition: string, userMessage: string): boolean {
  // Extract meaningful words from condition (skip stop words)
  const stopWords = new Set([
    'the',
    'a',
    'an',
    'is',
    'are',
    'was',
    'were',
    'be',
    'been',
    'being',
    'or',
    'and',
    'but',
    'if',
    'of',
    'at',
    'by',
    'for',
    'with',
    'to',
    'in',
    'on',
    'it',
    'its',
    'this',
    'that',
    'from',
    'as',
    'into',
    'user',
    'asks',
    'wants',
    'about',
    'more',
    'any',
    'some',
  ]);

  const conditionWords = condition
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, '')
    .split(/\s+/)
    .filter((w) => w.length > 2 && !stopWords.has(w));

  if (conditionWords.length === 0) return false;

  const messageLower = userMessage.toLowerCase();

  const messageWords = new Set(
    messageLower
      .replace(/[^a-z0-9\s]/g, '')
      .split(/\s+/)
      .filter((w) => w.length > 2),
  );

  // Check if any condition keyword appears as an exact word in the message.
  // For fuzzy/stem matching, use a custom matcher function.
  return conditionWords.some((word) => messageWords.has(word));
}

// ── Pending Follow-Up Manager ───────────────────────────────────────────

/**
 * A strict follow-up that's waiting for the next user message.
 */
export interface PendingStrictFollowUp {
  /** The resolved follow-up with concrete params. */
  readonly followUp: ResolvedFollowUp;
  /** The tool that produced the original result. */
  readonly sourceToolId: string;
  /** Custom matcher function, if provided on the binding. */
  readonly matcher?: (userMessage: string) => boolean;
}

/**
 * Manages pending strict follow-ups between agent loop iterations.
 *
 * After tool execution, if any strict follow-up fired, it's stored here.
 * Before the next LLM call, the user's message is checked against pending
 * follow-ups. If matched, the follow-up is consumed and returned for
 * auto-execution.
 *
 * @example
 * ```typescript
 * const manager = new PendingFollowUpManager();
 *
 * // After tool execution with strict follow-up
 * manager.setPending({
 *   followUp: { toolId: 'get_trace', params: { traceId: 'tr_1' }, ... },
 *   sourceToolId: 'evaluate_loan',
 * });
 *
 * // Before next LLM call — check user message
 * const matched = manager.checkAndConsume('Why was I denied?');
 * if (matched) {
 *   // Auto-execute get_trace({ traceId: 'tr_1' }) — skip LLM
 * }
 * ```
 */
export class PendingFollowUpManager {
  private pending: PendingStrictFollowUp | undefined;

  /** Store a strict follow-up for the next user message check. */
  setPending(followUp: PendingStrictFollowUp): void {
    this.pending = followUp;
  }

  /** Check if there's a pending follow-up. */
  hasPending(): boolean {
    return !!this.pending;
  }

  /** Get the pending follow-up without consuming it. */
  getPending(): PendingStrictFollowUp | undefined {
    return this.pending;
  }

  /**
   * Check user message against pending follow-up condition.
   * If matched, consumes and returns the follow-up. If not matched, clears it.
   *
   * @returns The matched follow-up for auto-execution, or undefined.
   */
  checkAndConsume(userMessage: string): PendingStrictFollowUp | undefined {
    if (!this.pending) return undefined;

    const pending = this.pending;
    this.pending = undefined; // Always consume — one-shot

    // Use custom matcher if provided, otherwise default keyword matcher
    let matched: boolean;
    try {
      matched = pending.matcher
        ? pending.matcher(userMessage)
        : defaultConditionMatcher(pending.followUp.condition, userMessage);
    } catch {
      // Broken matcher should not crash the agent — fail-safe: skip the follow-up
      return undefined;
    }

    return matched ? pending : undefined;
  }

  /** Clear any pending follow-up. */
  clear(): void {
    this.pending = undefined;
  }
}
