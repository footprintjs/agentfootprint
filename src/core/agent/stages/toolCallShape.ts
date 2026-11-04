/** Shared finite shape bounds; fresh model output refuses, stored pause data rejects. */
export const MAX_TOOL_CALLS = 1024;
export const MAX_TOOL_LABEL = 1024;
export type ToolBatchFailure =
  | 'too-many-calls'
  | 'duplicate-call-id'
  | 'invalid-call-id'
  | 'invalid-tool-name';
export function toolBatchFailure(
  calls: readonly { readonly id: string; readonly name: string }[],
): ToolBatchFailure | undefined {
  if (calls.length > MAX_TOOL_CALLS) return 'too-many-calls';
  const ids = new Set<string>();
  for (const call of calls) {
    if (typeof call.id !== 'string' || call.id.length === 0 || call.id.length > MAX_TOOL_LABEL)
      return 'invalid-call-id';
    if (ids.has(call.id)) return 'duplicate-call-id';
    ids.add(call.id);
    if (
      typeof call.name !== 'string' ||
      call.name.length === 0 ||
      call.name.length > MAX_TOOL_LABEL
    )
      return 'invalid-tool-name';
  }
  return undefined;
}
