/** Explicit, author-supplied validation of a schema-accepted JSON answer. */
import type { ArtifactRecord, ArtifactRef } from '../artifacts/types.js';
import type { Disposition } from '../integrity/disposition/types.js';

/** One named obligation. Only checked-pass/checked-fail count as checks run. */
export interface AnswerCheck {
  readonly id: string;
  readonly disposition: Disposition;
  /** Short diagnostic data, never interpreted as an instruction. */
  readonly reason?: string;
  readonly path?: string;
  /** Must have resolved through this validation's artifact capability. */
  readonly evidenceRefs?: readonly ArtifactRef[];
}

/** Why a requested artifact could not be delivered to the validator. */
export type AnswerEvidenceRefusal =
  | 'closed'
  | 'invalid-input'
  | 'no-store'
  | 'missing-or-expired'
  | 'kind-mismatch'
  | 'digest-mismatch'
  | 'max-reads'
  | 'max-bytes'
  | 'invalid-record'
  | 'store-error';

/** A resolved parcel, or an explicit absence; absence never carries payloads. */
export type AnswerEvidenceResolution =
  | { readonly ok: true; readonly record: ArtifactRecord }
  | { readonly ok: false; readonly reason: AnswerEvidenceRefusal };

/** Read-only, bounded, and pre-bound to the run's artifact scope. */
export interface AnswerEvidenceResolver {
  /** Exact kind match, as with tool wants. No listing or automatic parent walk. */
  resolve(ref: ArtifactRef, options: { readonly kind: string }): Promise<AnswerEvidenceResolution>;
}

/**
 * One tool call of THIS run, as the loop reported it on `stream.tool_end`.
 * Names and ids only: arguments and results are never in it. The call's
 * result message carries the same `callId` (`LLMMessage.toolCallId`).
 */
export interface AnswerToolCall {
  /** The tool name the model called (a registered name, or an unknown one it made up). */
  readonly name: string;
  readonly callId: string;
  /**
   * `ok`: the tool ran and returned — including a call that paused for a
   * person, whose answer on `resume()` is its result. `error`: it threw, declared `failure`,
   * `denied` or `invalid`, or could not run as written (an unknown name,
   * rejected arguments, a missing consent). `not-run`: it never ran (a
   * permission policy, an `onToolCall` link or a person declined it, or a
   * paused batch never dispatched it).
   */
  readonly outcome: 'ok' | 'error' | 'not-run';
}

/**
 * The run's tool calls in landing order, frozen and detached from state: the
 * MODEL's own calls, each closed by a `stream.tool_end` bracket. Calls a tool
 * makes from inside itself (`ctx.tools`, an agent used as a tool) are that
 * tool's work and are not listed. A paused run's calls cross to the resumed
 * leg inside its checkpoint, which the host must keep server-side (as
 * `streamHandler` does): a forged checkpoint could list calls that never ran.
 */
export interface AnswerToolCallsView {
  readonly calls: readonly AnswerToolCall[];
  /**
   * `false` when the list may disagree with what the run did: more than
   * `limits.maxToolCalls`, an oversized name or id, a call still open (its
   * `tool_start` with no `tool_end`), a tool that declared its work
   * `pending`, a reply whose calls never went out (a cut-off or wrapped-up
   * turn), a `resumeOnError` leg
   * whose failed attempt's calls this run never observed, or a resumed
   * checkpoint written before the run kept a ledger.
   *
   * Fail closed: a check that reads `toolCalls` while it is incomplete gets
   * an `unverified` report (reason `tool-calls-incomplete`) whatever it
   * returns, so enforce mode withholds the answer.
   */
  readonly complete: boolean;
}

/** Capabilities for this invocation only; retained readers close on completion. */
export interface AnswerValidationContext {
  readonly signal: AbortSignal;
  readonly artifacts: AnswerEvidenceResolver;
  /** This run's tool calls, never another run's. Empty when no tool ran. */
  readonly toolCalls: AnswerToolCallsView;
}

/** Bounds are per validation, positive safe integers, with no unbounded mode. */
export interface AnswerValidationLimits {
  /** Distinct ref+kind lookup attempts; duplicates share a cached read. Default 16. */
  readonly maxReads?: number;
  /** Total accepted/reserved artifact payload bytes. Default 4 MiB. */
  readonly maxBytes?: number;
  /** Maximum returned checks. Default 100. */
  readonly maxChecks?: number;
  /** UTF-8 bytes of input and canonical candidate, each bounded. Default 1 MiB. */
  readonly maxCandidateBytes?: number;
  /** Async deadline; cannot preempt synchronous author code. Default 5000 ms. */
  readonly timeoutMs?: number;
  /** Tool calls listed in `context.toolCalls`; past it the view is incomplete. Default 256, at most 10,000. */
  readonly maxToolCalls?: number;
}

/** The validator reports comparisons; the framework derives their outcome. */
export interface AnswerValidationResult {
  readonly checks: readonly AnswerCheck[];
}

/**
 * One of the agent's own answer checks, named for
 * {@link AnswerValidationOptions.agentChecks}: `'claims'` is the `.claims()`
 * contract, `'names-and-numbers'` is the `.namesAndNumbersFromEvidence()` gate.
 */
export type AgentCheckName = 'claims' | 'names-and-numbers';

/** Opt-in contract. The callback cannot replace the accepted answer. */
export interface AnswerValidationOptions<T = unknown> {
  readonly id: string;
  readonly version: string;
  /** Enforce withholds non-passing results; observe records them. Default enforce. */
  readonly mode?: 'enforce' | 'observe';
  readonly limits?: AnswerValidationLimits;
  /**
   * The agent's own answer checks that take part in this validation. Opt-in:
   * omitted, the report holds your checks alone, exactly as before.
   *
   * Why: on their own, `.claims()` and `.namesAndNumbersFromEvidence()` only
   * record what they find — a typed field that contradicts the fact a tool
   * settled, or a value no tool result carried, is filed as a finding and the
   * answer is still delivered. Listed here, each finding becomes a failed row
   * of this report, so `mode: 'enforce'` withholds that answer the way it
   * withholds one your own check failed, with draft tokens held back the same
   * way. `mode: 'observe'` records the rows and delivers.
   *
   * - `'claims'`: one row per declared `.claims()` field, id
   *   `agent:claims:<field>`, judged on the candidate this validation delivers.
   *   Values compare after one declared normalization: text in Unicode NFC,
   *   trimmed, white space collapsed; case agrees only for a word of letters,
   *   more than three of them, cased all lower, all upper or with a capital
   *   first letter, with the same letters in another case (`'Settled'` and
   *   `'settled '`, `'STRAẞE'` and `'Straße'` agree) — a rule that cannot
   *   know where case carries meaning, so `'Polish'` and `'polish'` agree
   *   too; a number and a plain decimal string by value (`42.5` and
   *   `'42.50'`); a number with a unit only with the same unit, written
   *   exactly (`MW` is not `mW`). Values that cannot be compared safely are
   *   `unreachable`, never `checked-fail`: a list or an object against a
   *   scalar, a unit against a bare number, a list with a hole in it, any
   *   other case difference (a short word or unit such as `'MW'`/`'mW'`, a
   *   mixed-case word, text with a digit, `ß` against `ss` in any casing such
   *   as `'Masse'`/`'maße'`, `'ılık'`/`'ilik'`), and a value written with a
   *   currency symbol, digit separators, a dot-grouped number (`'1.250'`), a
   *   date or a time unless written the same.
   *   The row can only WITHHOLD: it reads every reading of the fact this run
   *   made (from any tool, with no scope or age check, so any reading may be
   *   forged or stale), and one more reading never makes it more permissive.
   *   Contradicts any value this run read for the fact: `checked-fail`,
   *   whatever else was read (a found contradiction is never relabelled
   *   unverified). Agrees with them:
   *   `not-applicable` — agreement is not verification. No tool result
   *   settled the fact (a follow-up turn answering from an earlier run's read
   *   included): `not-applicable`, not checked. `unreachable`, so enforce
   *   withholds and observe delivers "not sure": readings that differ where
   *   the value contradicts none of them; a reading that settled the fact
   *   only as unknown, `null` or `'unknown'` (in any case) beside a stated
   *   value the answer does not contradict; doubt on both sides; or a value
   *   or reading that is not a well-formed `Claim`. Leaves the field out, or
   *   declines it (`null`, `'unknown'`) where the run read values:
   *   `not-applicable`. So a fact whose value changes during the run (a
   *   status polled from `'queued'` to `'done'`, a balance read before and
   *   after a write) is withheld: settle it once (leave it out of the result
   *   until final, or poll inside one tool call), model before and after as
   *   separate fields, or leave it out of `.claims()` and check it in
   *   `validate`.
   * - `'names-and-numbers'`: one row, id `agent:names-and-numbers`: the gate
   *   asked of the exact candidate this validation delivers, after any output
   *   transform (its one repair turn under `posture: 'guard'` runs earlier, on
   *   the model's draft). It judges the answer's values, never its field names
   *   (`p95LatencyMs` is not a value); short numbers below the gate's
   *   `minDigits` (default 4) are not looked up. A value no tool result carried: `checked-fail`.
   *   A value not found while the index was past its ceiling, or an answer
   *   longer than the gate reads (20,000 words and numbers; the reason says
   *   how many more were never looked up): `unreachable`.
   *   A clean pass is `not-applicable`: finding a value clears it, and never
   *   verifies the answer.
   *
   * No agent row is ever `checked-pass`: these checks can withhold an answer
   * and never verify one. `validate` stays required, and only your checks can
   * make the report `passed` — a report with no comparison of yours stays
   * `unverified`. Each listed check needs its builder call, or `build()`
   * refuses. Rows carry counts and the field names you declared, never a value
   * from the answer or a tool, nor the entity a contract names. Check ids that
   * start with `agent:` are reserved while this is set.
   *
   * @example
   * ```ts
   * Agent.create({ provider, model })
   *   .tool(readBuild) // returns describedResult({ facts: [{ entity: 'build-72', durationMs: 1250 }], … })
   *   .outputSchema(BuildReport)
   *   .claims({ durationMs: { entity: 'build-72', field: 'durationMs' } })
   *   .namesAndNumbersFromEvidence({ posture: 'guard' })
   *   .answerValidation({
   *     id: 'build-report',
   *     version: '1',
   *     agentChecks: ['claims', 'names-and-numbers'],
   *     validate: (answer) => ({
   *       checks: [{ id: 'asked-job', disposition: answer.job === 'build-72' ? 'checked-pass' : 'checked-fail' }],
   *     }),
   *   })
   *   .build();
   * // An answer that keeps durationMs: 9750 through its one repair turn now
   * // throws AnswerValidationError instead of being returned: status 'failed',
   * // rows 'agent:names-and-numbers' and 'agent:claims:durationMs'.
   * ```
   */
  readonly agentChecks?: readonly AgentCheckName[];
  validate(
    candidate: Readonly<T>,
    context: AnswerValidationContext,
  ): AnswerValidationResult | Promise<AnswerValidationResult>;
}

/** Validated, detached configuration used by the runner. */
export interface ResolvedAnswerValidation {
  readonly id: string;
  readonly version: string;
  readonly mode: 'enforce' | 'observe';
  readonly limits: Required<AnswerValidationLimits>;
  /** The agent's own checks this validation lists; empty when none. Frozen. */
  readonly agentChecks: readonly AgentCheckName[];
  validate(
    candidate: unknown,
    context: AnswerValidationContext,
  ): AnswerValidationResult | Promise<AnswerValidationResult>;
}

/** Cloneable decision record. It contains no candidate or artifact payload. */
export interface AnswerValidationReport {
  readonly validatorId: string;
  readonly validatorVersion: string;
  readonly mode: 'enforce' | 'observe';
  /**
   * `passed`: at least one comparison ran, and none failed or was unreachable.
   * `failed`: a comparison found the answer wrong — even beside `unreachable`
   * rows, which `reason` then still names (`unreachable-checks`). An agent row
   * (`agentChecks`) that found a contradiction makes the report `failed` even
   * when your validator did not finish; `reason` says so (`validator-error`).
   * `unverified`: no verdict could be reached (nothing compared, a check that
   * could not run or did not finish); `reason` says why.
   */
  readonly status: 'passed' | 'failed' | 'unverified';
  readonly checked: number;
  readonly failed: number;
  readonly unreachable: number;
  readonly notApplicable: number;
  readonly checks: readonly AnswerCheck[];
  /** Why the report is `unverified`, or what a `failed` one could not reach as well. */
  readonly reason?: string;
  /** SHA-256 of the exact canonical JSON content considered for delivery. */
  readonly candidateDigest?: string;
  /** Successfully resolved refs, distinct, not a count of semantic comparisons. */
  readonly resolvedRefs: readonly ArtifactRef[];
  /** The schema parser accepted and its output is a lossless canonical JSON value. */
  readonly schemaAccepted: boolean;
}

/**
 * An enforcing validation refused delivery; diagnostic metadata only, never
 * content. Served by a hosting door, it is a refusal, not a failure: HTTP 422
 * with code `ERR_ANSWER_VALIDATION` (on a stream, the closing error frame
 * carries the same code). It withholds the answer only — tools the turn
 * already called have run, and nothing undoes them.
 */
export class AnswerValidationError extends Error {
  readonly code = 'ERR_ANSWER_VALIDATION' as const;
  readonly report: AnswerValidationReport;

  constructor(report: AnswerValidationReport) {
    super(
      `The answer was withheld: answer validation '${report.validatorId}' did not pass ` +
        `(${report.status}).`,
    );
    this.name = 'AnswerValidationError';
    this.report = Object.freeze({
      ...report,
      checks: Object.freeze(
        report.checks.map((check) =>
          Object.freeze({
            ...check,
            ...(check.evidenceRefs !== undefined && {
              evidenceRefs: Object.freeze([...check.evidenceRefs]),
            }),
          }),
        ),
      ),
      resolvedRefs: Object.freeze([...report.resolvedRefs]),
    });
  }
}
