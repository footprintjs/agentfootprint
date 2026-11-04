import type { RunEntry, RunOptions } from 'footprintjs';

/**
 * AF providers read the stage environment. Native deliberately keeps that
 * environment absent/empty for a caller-only signal; AF explicitly forwards
 * it here. Native still owns composition, deadlines and listener cleanup.
 * Read caller option fields and own environment getters once under admission.
 */
export function nativeEntryFor(entry: RunEntry): RunEntry {
  const source = entry.options;
  if (source === undefined) return entry;
  const signal = source.signal;
  const env = source.env;
  const snapshot = signal === undefined ? undefined : { ...env };
  const options: RunOptions = {
    signal,
    env: snapshot === undefined ? env : { ...snapshot, signal: snapshot.signal ?? signal },
    timeoutMs: source.timeoutMs,
    deadline: source.deadline,
    maxDepth: source.maxDepth,
    maxIterations: source.maxIterations,
  };
  return entry.kind === 'run'
    ? { ...entry, options: { ...options, input: entry.options?.input } }
    : { ...entry, options };
}
