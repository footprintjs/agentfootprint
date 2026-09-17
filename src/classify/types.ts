/**
 * classify/types — the PORT for a calibrated classifier.
 *
 * Pattern: port + adapters (the `LLMProvider` precedent). A classifier is
 *          not a model that generates text: handed a STATE and a set of
 *          typed QUESTIONS it scores the declared candidates from one
 *          reading and answers each question with a distribution, a
 *          confidence, or a probability — the "scored choice" of
 *          docs/design/2026-09-scored-choice.md, opened 2026-09-17.
 * Role:    zero-import leaf. `src/lib/injection-engine/classifierScorer.ts`
 *          (a pure-core file behind `agentfootprint/skill-graph`) types its
 *          port against this file, so nothing here may import anything.
 *
 * LAWS.
 * - A score is data only when the provider produced it. Nothing in this
 *   folder infers a probability, defaults a choice or renormalises a
 *   distribution — `probabilities` is the wire's own object, whatever it sums
 *   to (the real probe summed to 1.0; a provider that rounds may not).
 * - Cost is data: every result carries `latencyMs` measured around the
 *   call, and `usage` when the provider reported it, so a bench or a lens
 *   reads the cost of a judgment off the record instead of estimating it.
 * - A failure is a `ClassifierError` with the provider's status when there
 *   was one — never a guessed answer.
 */

// ─── Questions ─────────────────────────────────────────────────────────

/** Pick ONE of the declared options; `criteria` describes each option by id. */
export interface ClassifyChoiceQuestion {
  readonly type: 'choice';
  readonly instructions: string;
  /** `{ optionId: what that option means }` — the candidates, declared before the call. */
  readonly criteria: Readonly<Record<string, string>>;
}

/** A yes/no proposition, answered as a probability of `true` ("noul"). */
export interface ClassifyNoulQuestion {
  readonly type: 'noul';
  readonly instructions: string;
  /** Optional wording for each pole. */
  readonly criteria?: { readonly true: string; readonly false: string };
}

/** A position on an ordered scale; `criteria` names the rungs low to high. */
export interface ClassifyScoreQuestion {
  readonly type: 'score';
  readonly instructions: string;
  readonly criteria: readonly string[];
}

export type ClassifyQuestion =
  | ClassifyChoiceQuestion
  | ClassifyNoulQuestion
  | ClassifyScoreQuestion;

/** One call: the state to read, and the questions to answer about it. */
export interface ClassifyRequest {
  /** A string, an object or an array — serialised as given; never model text the library wrote. */
  readonly state: unknown;
  readonly questions: Readonly<Record<string, ClassifyQuestion>>;
}

// ─── Answers ───────────────────────────────────────────────────────────

/** The answer to a `choice` question: the pick and the WHOLE distribution behind it. */
export interface ClassifyChoiceAnswer {
  readonly type: 'choice';
  readonly choice: string;
  readonly confidence: number;
  /** Per option id, as the provider gave it — never renormalised. */
  readonly probabilities: Readonly<Record<string, number>>;
}

/** The answer to a `noul` question: the probability the proposition holds. */
export interface ClassifyNoulAnswer {
  readonly type: 'noul';
  readonly noul: number;
}

/** The answer to a `score` question: the rung, its confidence and the distribution over rungs. */
export interface ClassifyScoreAnswer {
  readonly type: 'score';
  readonly score: number;
  readonly confidence: number;
  readonly probabilities: Readonly<Record<string, number>>;
  /** The provider's own legend for the rungs, when it sends one. */
  readonly legend?: Readonly<Record<string, string>>;
}

export type ClassifyAnswer = ClassifyChoiceAnswer | ClassifyNoulAnswer | ClassifyScoreAnswer;

/** What one call answered, and what it cost. */
export interface ClassifyResult {
  /** The provider's model string for THIS answer (`jev-1.13.0`), not the alias requested. */
  readonly model: string;
  readonly answers: Readonly<Record<string, ClassifyAnswer>>;
  /** Present when the provider reported it. */
  readonly usage?: { readonly inputTokens: number; readonly outputTokens: number };
  /** Wall-clock milliseconds around the call, measured by the adapter. */
  readonly latencyMs: number;
}

// ─── The port ──────────────────────────────────────────────────────────

/** A calibrated classifier — one method, honoured by every adapter and the mock. */
export interface Classifier {
  /** Short, stable name (`'typesafe'`, `'mock'`) — what a record row names as the judge. */
  readonly name: string;
  classify(request: ClassifyRequest, signal?: AbortSignal): Promise<ClassifyResult>;
}

/**
 * A classifier call that produced no answer. `status` is the provider's HTTP
 * status when there was one; `retryable` says whether the adapter judged it
 * a transient (rate limit, overload) — an adapter has already retried those
 * up to its `maxRetries` before this reaches a caller. The message carries
 * the provider's error text, never a key.
 */
export class ClassifierError extends Error {
  readonly status?: number;
  readonly retryable: boolean;
  constructor(message: string, options: { status?: number; retryable?: boolean } = {}) {
    super(message);
    this.name = 'ClassifierError';
    if (options.status !== undefined) this.status = options.status;
    this.retryable = options.retryable ?? false;
  }
}
