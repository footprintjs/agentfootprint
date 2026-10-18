import { armDeadline, awaitUnder, linkedController } from '../lib/abort.js';

/** Module loading spends the same deadline; a late chunk can never start a query. */
export async function loadCauseReader(
  deadline: number,
  signal?: AbortSignal,
): Promise<
  { readonly reader: typeof import('./causeReader.js') } | { readonly gap: 'cancelled' | 'timeout' }
> {
  const { controller, unlink } = linkedController(signal);
  const disarm = armDeadline(controller, deadline - performance.now(), () => undefined);
  try {
    return { reader: await awaitUnder(controller.signal, () => import('./causeReader.js')) };
  } catch (error) {
    if (signal?.aborted) return { gap: 'cancelled' as const };
    // Timers can fire a fractional millisecond before the clock reaches the deadline.
    // Record which boundary actually fired rather than reclassifying it from the clock.
    if (controller.signal.aborted) return { gap: 'timeout' as const };
    throw error;
  } finally {
    disarm();
    unlink();
  }
}
