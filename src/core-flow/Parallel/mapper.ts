import type { BranchErrorRecord } from './types.js';

/**
 * Wrap a branch's `outputMapper` so a mapper throw is ATTRIBUTED to its
 * branch before footprintjs swallows it.
 *
 * footprintjs's `SubflowExecutor` catches outputMapper errors into
 * `parentContext.addError('outputMapperError', ...)` WITHOUT firing
 * `FlowRecorder.onError` — so Parallel's internal `parallel-branch-errors`
 * recorder never sees them, and the Merge stage would fall back to
 * `'unknown error'` for the missing branch id. Recording into the
 * branch-error map here (first error per branch wins, mirroring the
 * recorder's semantics) closes that attribution gap. The error is then
 * RETHROWN so footprintjs's existing bookkeeping stays untouched: the
 * `outputMapperError` debug entry is still written and the branch id is
 * still absent from `branchResults` (which is how the Merge stage detects
 * the failure).
 *
 * @internal Exported for direct unit testing — not part of the public API
 * (not re-exported from the package barrel).
 */
export function wrapBranchOutputMapper(
  branchId: string,
  errorsFor: (binding: unknown) => Map<string, BranchErrorRecord>,
  inner: (sfOutput: unknown) => Record<string, unknown>,
): (sfOutput: unknown, parent?: unknown, binding?: unknown) => Record<string, unknown> {
  return (sfOutput, _parent, binding) => {
    const branchErrors = errorsFor(binding);
    try {
      return inner(sfOutput);
    } catch (err) {
      if (!branchErrors.has(branchId)) {
        branchErrors.set(branchId, {
          message: err instanceof Error ? err.message : String(err),
          raw: err,
        });
      }
      throw err;
    }
  };
}
