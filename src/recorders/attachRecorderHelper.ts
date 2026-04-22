/**
 * Shared helper for the `attachRecorder()` method that AgentRunner +
 * FlowChartRunner + ConditionalRunner + ParallelRunner + SwarmRunner
 * all expose. Same contract: idempotent on recorder id, returns detach.
 *
 * Lives here (not duplicated per runner) so any future *Runner class
 * gets the same behavior with one line of glue.
 */

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function attachRecorderToList(recorders: any[], recorder: any): () => void {
  const id = (recorder as { id?: string })?.id;
  if (typeof id === 'string') {
    const existing = recorders.findIndex((r) => (r as { id?: string }).id === id);
    if (existing >= 0) {
      recorders[existing] = recorder;
    } else {
      recorders.push(recorder);
    }
  } else {
    recorders.push(recorder);
  }
  return () => {
    const idx = recorders.indexOf(recorder);
    if (idx >= 0) recorders.splice(idx, 1);
  };
}
