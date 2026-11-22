import type { ToolOutputCounts } from '../../../provider-contract/toolResultRecord.js';
import { isRecord } from './record.js';

/** An unreadable optional count leaves the call's settled status intact. */
export function readToolOutputCounts(value: unknown): ToolOutputCounts | undefined {
  if (!isRecord(value)) return undefined;
  const kept = Object.getOwnPropertyDescriptor(value, 'kept')?.value;
  const total = Object.getOwnPropertyDescriptor(value, 'total')?.value;
  const unit = Object.getOwnPropertyDescriptor(value, 'unit')?.value;
  if (typeof kept !== 'number' || !Number.isSafeInteger(kept) || kept < 0 || unit !== 'characters')
    return undefined;
  return {
    kept,
    ...(typeof total === 'number' && Number.isSafeInteger(total) && total > kept && { total }),
    unit,
  };
}
