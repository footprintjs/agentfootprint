/**
 * time/rows/shapes — checkpoint validation for a widened or covering fill,
 * for call drift, and for the receipt of a measured look-back.
 */
import { instantOf } from '../instant.js';
import { isTimeRange } from '../range.js';

const isCount = (value: unknown): boolean =>
  typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;

function isRangeList(value: unknown): boolean {
  return Array.isArray(value) && value.length >= 1 && value.length <= 2 && value.every(isTimeRange);
}

/**
 * A widened fill's fields: `sent` with exactly one of `differs` / `trimmedByTool`, or none of
 * the three. A fill that covers at dispatch has no `sent` yet (the `call` row holds it) and may
 * still say the tool trims.
 */
export function widenedOk(row: Readonly<Record<string, unknown>>): boolean {
  if (row.coversAtDispatch !== undefined) {
    return (
      row.coversAtDispatch === true &&
      row.sent === undefined &&
      row.differs === undefined &&
      (row.trimmedByTool === undefined || row.trimmedByTool === true)
    );
  }
  if (row.sent === undefined) return row.differs === undefined && row.trimmedByTool === undefined;
  if (!isTimeRange(row.sent)) return false;
  if (row.trimmedByTool !== undefined)
    return row.trimmedByTool === true && row.differs === undefined;
  const differs = row.differs;
  if (differs === null || typeof differs !== 'object' || Array.isArray(differs)) return false;
  const d = differs as Record<string, unknown>;
  return Object.keys(d).length === 1 && isRangeList(d.extra);
}

export function isCallDrift(value: unknown): boolean {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return false;
  const d = value as Record<string, unknown>;
  if (typeof d.byMs !== 'number' || !Number.isSafeInteger(d.byMs)) return false;
  // A covering look-back is recorded on every such call, whatever the drift: zero when the
  // clock did not move, negative when an app's `now` is ahead of the dispatch moment and the
  // window (a past range) had still ended by then.
  if (d.outcome === 'covered') {
    return Object.keys(d).length === 4 && isCount(d.form) && isTimeRange(d.sent);
  }
  if (d.byMs === 0) return false;
  if (d.outcome === 'redrawn') return Object.keys(d).length === 3 && isCount(d.form);
  return d.outcome === 'shifted' && Object.keys(d).length === 2;
}

export function isLookbackReceipt(value: unknown): boolean {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return false;
  const { receipt, inputPosition, clockNow } = value as Record<string, unknown>;
  return (
    typeof receipt === 'string' &&
    /^[a-f0-9]{64}$/.test(receipt) &&
    isCount(inputPosition) &&
    instantOf(clockNow, 'strict') !== undefined
  );
}
