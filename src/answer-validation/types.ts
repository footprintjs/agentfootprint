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
   * `ok`: the tool ran and returned. `error`: it threw, declared `failure`,
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
   * `false` when the run may have made calls this list leaves out: more than
   * `limits.maxToolCalls`, an oversized name or id, a `resumeOnError` leg
   * whose failed attempt's calls this run never observed, or a resumed
   * checkpoint written before the run kept a ledger. A rule that needs
   * the whole list should report `unreachable` then, not pass.
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

/** Opt-in contract. The callback cannot replace the accepted answer. */
export interface AnswerValidationOptions<T = unknown> {
  readonly id: string;
  readonly version: string;
  /** Enforce withholds non-passing results; observe records them. Default enforce. */
  readonly mode?: 'enforce' | 'observe';
  readonly limits?: AnswerValidationLimits;
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
  readonly status: 'passed' | 'failed' | 'unverified';
  readonly checked: number;
  readonly failed: number;
  readonly unreachable: number;
  readonly notApplicable: number;
  readonly checks: readonly AnswerCheck[];
  readonly reason?: string;
  /** SHA-256 of the exact canonical JSON content considered for delivery. */
  readonly candidateDigest?: string;
  /** Successfully resolved refs, distinct, not a count of semantic comparisons. */
  readonly resolvedRefs: readonly ArtifactRef[];
  /** The schema parser accepted and its output is a lossless canonical JSON value. */
  readonly schemaAccepted: boolean;
}

/** An enforcing host refused delivery; diagnostic metadata only, never content. */
export class AnswerValidationError extends Error {
  readonly code = 'ERR_ANSWER_VALIDATION' as const;
  readonly report: AnswerValidationReport;

  constructor(report: AnswerValidationReport) {
    super(`Answer validation '${report.validatorId}' did not pass (${report.status}).`);
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
