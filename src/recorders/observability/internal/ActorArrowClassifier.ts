/**
 * @internal — not part of the public agentfootprint API. Imported only
 * by RunStepRecorder. Subject to change without notice.
 *
 * ActorArrowClassifier — classifies the next `llm.start` as
 * `'user→llm'` (no pending tool result) vs `'tool→llm'` (after a
 * tool result), and the next `llm.end` as `'llm→tool'` vs `'llm→user'`
 * based on the call's `toolCallCount`.
 *
 * Extracted from RunStepRecorder per Convention 1. Keeps a single
 * boolean of state — `prevLLMEndHadTools` — and consumes-then-resets
 * it on each `llm.start`.
 */

export type StartArrow = 'user→llm' | 'tool→llm';
export type EndArrow = 'llm→tool' | 'llm→user';

export class ActorArrowClassifier {
  private prevLLMEndHadTools = false;

  /** Classify the next `llm.start`. Consumes + resets the pending
   *  flag after returning. */
  classifyStart(): StartArrow {
    const arrow: StartArrow = this.prevLLMEndHadTools ? 'tool→llm' : 'user→llm';
    this.prevLLMEndHadTools = false;
    return arrow;
  }

  /** Classify an `llm.end` based on its tool-call count, and update
   *  the pending flag for the NEXT llm.start. */
  classifyEnd(toolCallCount: number): EndArrow {
    const arrow: EndArrow = toolCallCount > 0 ? 'llm→tool' : 'llm→user';
    this.prevLLMEndHadTools = toolCallCount > 0;
    return arrow;
  }

  clear(): void {
    this.prevLLMEndHadTools = false;
  }
}
