import type { ToolExecutionContext } from '../../../tools/tools.js';
import { untilAborted } from '../../../lib/abort.js';

/** A deadline ends waiting; an accepted artifact write may still finish without authority. */
export async function withSourceEvidenceDeadline<T, C extends Pick<ToolExecutionContext, 'signal'>>(
  context: C,
  timeoutMs: number,
  work: (context: C) => Promise<T>,
): Promise<T> {
  const controller = new AbortController();
  const abort = () => controller.abort(context.signal?.reason);
  if (context.signal?.aborted) abort();
  else context.signal?.addEventListener('abort', abort, { once: true });
  const timer = setTimeout(
    () => controller.abort(new Error('Source evidence operation timed out.')),
    timeoutMs,
  );
  try {
    const operation = Promise.resolve().then(() => work({ ...context, signal: controller.signal }));
    return await untilAborted(operation, controller.signal);
  } finally {
    clearTimeout(timer);
    context.signal?.removeEventListener('abort', abort);
  }
}
