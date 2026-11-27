import type { FlowchartCheckpoint } from 'footprintjs';

export function pausedStateOf(
  checkpoint: FlowchartCheckpoint,
): Record<string, unknown> | undefined {
  const path = checkpoint.subflowPath;
  if (!Array.isArray(path) || path.length === 0) return objectOrUndefined(checkpoint.sharedState);
  const innermost = path[path.length - 1];
  return typeof innermost === 'string'
    ? objectOrUndefined(checkpoint.subflowStates?.[innermost])
    : undefined;
}

function objectOrUndefined(value: unknown): Record<string, unknown> | undefined {
  return typeof value === 'object' && value !== null
    ? (value as Record<string, unknown>)
    : undefined;
}
