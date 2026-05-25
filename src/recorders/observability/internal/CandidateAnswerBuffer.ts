/**
 * @internal — not part of the public agentfootprint API. Imported only
 * by RunStepRecorder. Subject to change without notice.
 *
 * CandidateAnswerBuffer — buffers a "this leaf MIGHT be the run's
 * answer" candidate that's only confirmed on `onRunEnd`. Replaced
 * by every later leaf exit at run scope; the last one wins.
 *
 * Extracted from RunStepRecorder per Convention 1.
 *
 * Use:
 *   - On leaf EXIT at run scope: `set(frame, ts, runtimeStageId)`.
 *   - On `onRunEnd`: `flush()` returns the buffered candidate (or
 *     undefined if none), and clears the buffer.
 */

export interface CandidateAnswer<TFrame> {
  readonly frame: TFrame;
  readonly tsMs: number;
  readonly runtimeStageId: string;
}

export class CandidateAnswerBuffer<TFrame> {
  private candidate: CandidateAnswer<TFrame> | undefined;

  /** Buffer a new candidate, replacing any prior one. */
  set(frame: TFrame, tsMs: number, runtimeStageId: string): void {
    this.candidate = { frame, tsMs, runtimeStageId };
  }

  /** Return + clear the buffered candidate (or undefined if empty). */
  flush(): CandidateAnswer<TFrame> | undefined {
    const c = this.candidate;
    this.candidate = undefined;
    return c;
  }

  clear(): void {
    this.candidate = undefined;
  }
}
