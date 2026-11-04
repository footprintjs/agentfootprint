import type { ToolpackIndex } from './packIndex.js';
import { SCHEMA_ENUM_CAP } from './structuralLimits.js';
import { innerCommitCount } from '../subflowRecords.js';
import { displayKey } from '../bounded.js';

// ── Schema fragments ───────────────────────────────────────────────────────

function idProperty(index: ToolpackIndex, description: string): Record<string, unknown> {
  const property: Record<string, unknown> = { type: 'string', description };
  // No enum when subflows kept their own logs: the model may then hold an
  // INNER id, and it is owed the correction toward `inspect_subflow` that only
  // `execute` can give — a schema refusal would read as "no such step".
  if (
    index.orderedIds.length > 0 &&
    index.orderedIds.length <= SCHEMA_ENUM_CAP &&
    !hasMountLogs(index)
  ) {
    property.enum = index.orderedIds;
  }
  return property;
}

/** True when at least one subflow mount kept its own log in this snapshot. */
function hasMountLogs(index: ToolpackIndex): boolean {
  const results = index.subflowResults;
  return (
    results !== undefined && Object.keys(results).some((key) => innerCommitCount(results, key) > 0)
  );
}

/**
 * Key params get guidance (known keys in the description) but NO enum:
 * unlike step ids — whose universe is complete — a key OUTSIDE the commit
 * log is a legitimate question with an honest answer ("args/env/pre-run
 * values never enter the commit log ⚠"), and an enum would block that path.
 */
function keyProperty(index: ToolpackIndex, description: string): Record<string, unknown> {
  let hint = '';
  if (index.knownPaths.size > 0 && index.knownPaths.size <= SCHEMA_ENUM_CAP) {
    hint = ` Tracked keys: ${[...index.knownPaths].map(displayKey).join(', ')}.`;
  }
  return { type: 'string', description: `${description}${hint}` };
}

export { idProperty, keyProperty };
