import type { AccountEventEvidence } from '../recorders/observability/answerAccount/evidence.js';

export function own(value: unknown, key: string): unknown {
  return value !== null && typeof value === 'object'
    ? Object.getOwnPropertyDescriptor(value, key)?.value
    : undefined;
}

const isRoot = (path: unknown) => Array.isArray(path) && own(path, 'length') === 0;

function positionOf(row: AccountEventEvidence) {
  return own(row.event.meta, 'sourcePosition');
}

/** Validate one fresh root invocation's emit position. The caller separately
 * owns the stage identity and the order of accepted events at this prefix. */
export function rootToolPrefix(
  snapshot: unknown,
  anchor: AccountEventEvidence,
  witnesses: readonly AccountEventEvidence[],
): number | undefined {
  const position = positionOf(anchor);
  const engine = own(position, 'engineRunId');
  const prefix = own(position, 'committedThroughIdx');
  const address = own(snapshot, 'logAddress');
  if (
    typeof engine !== 'string' ||
    engine !== own(snapshot, 'runId') ||
    engine !== own(address, 'logRunId') ||
    !isRoot(own(address, 'drillPath')) ||
    typeof prefix !== 'number' ||
    !Number.isSafeInteger(prefix) ||
    prefix < -1 ||
    witnesses.some((row) => {
      const source = positionOf(row);
      return (
        own(source, 'engineRunId') !== engine ||
        own(source, 'logRunId') !== engine ||
        !isRoot(own(source, 'drillPath')) ||
        own(source, 'committedThroughIdx') !== prefix
      );
    })
  )
    return undefined;
  return prefix;
}
