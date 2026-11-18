// ─── Context Integrity (9.60.0) — detected context errors ───────────────

/**
 * One detected context error, filed as a finding: two channels asserted
 * things that cannot both be true, an argument nothing served, an offered
 * action whose inputs left scope, or a claim the record does not support.
 * (The kind `duplicate-execution` — a settled action re-executed — is named
 * in the finding type, but no check in this build files it, so this event
 * never carries it.) The payload IS the finding — uniform across seams so
 * findings are a corpus; deduplicated by identity upstream, so one defect is
 * one event however many passes re-detect it. Dev-posture canary results
 * never arrive as this event: they are counted only as `synthetic` on the
 * `agentfootprint.integrity.disposition` rows
 * ({@link IntegrityDispositionPayload}), kept apart from the real numbers.
 */
export type IntegrityContextErrorPayload = import('./dependencyTypes.js').ContextError & {
  /** The iteration the finding was filed on, when filed mid-loop. */
  readonly iteration?: number;
};

/**
 * One run's disposition accounting — one row per registered (check, seam),
 * filed ONCE at the run boundary. The rows answer the question a findings
 * stream cannot: did the checkers RUN? `checked` with zero `findings` is
 * health; a registered row with zero encounters while `workExisted` is the
 * wiring-rot signal `assertAlive` names in dev posture. Synthetic (canary)
 * counts ride each row quarantined from the real numbers.
 */
export interface IntegrityDispositionPayload {
  readonly posture: 'observe' | 'dev';
  /** Whether the run did any work a checker could have seen (≥1 LLM call). */
  readonly workExisted: boolean;
  readonly rows: readonly import('./dependencyTypes.js').CheckReport[];
}

/**
 * One argument value excused by an APP-ASSERTED external ground (9.72.0) —
 * the audit trail of the `externalGrounds` door. The choice-seam check found
 * the value in none of what the run served; the app's provider vouched for
 * it, so no finding was filed, and THIS event is the record of that excusal.
 * `source` is the app's own label ('viewer-selection'): the library records
 * what the app asserts — verifying the assertion was the app's duty at the
 * moment it yielded the entry. Fired per excused value per call, deliberately
 * NOT deduplicated the way findings are: a repeated call is a fresh choice.
 */
export interface IntegrityExternalGroundUsedPayload {
  readonly toolName: string;
  /** The provider's id for the call — what a reader joins to `tool_start`. */
  readonly toolCallId: string;
  /** Dot-path of the argument leaf the ground excused. */
  readonly path: string;
  readonly value: string;
  /** The app's label for where the verified value came from. */
  readonly source: string;
  readonly iteration: number;
}
