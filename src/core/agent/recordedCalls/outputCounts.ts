import type { ToolOutputCounts } from '../../../provider-contract/toolResultRecord.js';
import { isRecord } from './record.js';

/** An unreadable optional count leaves the call's settled status intact. */
export function readToolOutputCounts(value: unknown): ToolOutputCounts | undefined {
  if (!isRecord(value)) return undefined;
  const kept = Object.getOwnPropertyDescriptor(value, 'kept')?.value;
  const totalField = Object.getOwnPropertyDescriptor(value, 'total');
  const unit = Object.getOwnPropertyDescriptor(value, 'unit')?.value;
  if (typeof kept !== 'number' || !Number.isSafeInteger(kept) || kept < 0 || unit !== 'characters')
    return undefined;
  if (totalField === undefined) return { kept, unit };
  const total = totalField.value;
  if (typeof total !== 'number' || !Number.isSafeInteger(total) || total <= kept) return undefined;
  return { kept, total, unit };
}
