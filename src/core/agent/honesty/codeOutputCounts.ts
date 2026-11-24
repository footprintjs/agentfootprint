import { coverageInForce, runKeepsOut } from '../../../redaction/runRedaction.js';

const SOURCES = ['history', 'settledToolCalls'] as const;
const COUNT_FIELDS = ['content', 'toolOutputCounts', 'outputCounts', 'kept', 'total', 'unit'];

/** Counts are derived from output text and then copied into the occurrence record. */
export function codeOutputCountsAllowed(scope: object): boolean {
  const coverage = coverageInForce(scope);
  if (coverage.state === 'unknown') return false;
  const policy = coverage.state === 'covered' ? coverage.policy : undefined;
  return (
    !SOURCES.some((key) => runKeepsOut(scope, key) || (policy?.fields?.[key]?.length ?? 0) > 0) &&
    (policy?.patterns?.length ?? 0) === 0 &&
    !COUNT_FIELDS.some((name) => policy?.keys?.includes(name) === true)
  );
}
