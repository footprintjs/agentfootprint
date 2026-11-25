import { isPlaceholder } from '../../../redaction/marker.js';

const field = (row: object, key: string): unknown =>
  Object.getOwnPropertyDescriptor(row, key)?.value;

/** A retained omission refers to the accepted call that recorded the selection decision. */
export interface OmissionReference {
  readonly iteration: number;
  readonly series: string;
  readonly attempt: number;
  readonly wireName: string;
  readonly reason: 'top-N' | 'ledger' | 'skill-scope';
}
export type OmissionCheck = (
  reference: OmissionReference,
  callable: number,
  label?: string,
) => boolean;

/** Read only data fields of a retained selection reference. */
export function omissionReference(row: object): OmissionReference | undefined {
  const selection = field(row, 'selection');
  if (!selection || typeof selection !== 'object' || Array.isArray(selection)) return undefined;
  const iteration = field(selection, 'iteration');
  const consumer = field(selection, 'consumer');
  const reason = field(selection, 'reason');
  if (
    typeof iteration !== 'number' ||
    !Number.isSafeInteger(iteration) ||
    iteration < 1 ||
    iteration !== field(row, 'iteration') ||
    !consumer ||
    typeof consumer !== 'object' ||
    Array.isArray(consumer)
  )
    return undefined;
  const series = field(consumer, 'series');
  const attempt = field(consumer, 'attempt');
  const wireName = field(selection, 'wireName');
  if (
    typeof series === 'string' &&
    series.length > 0 &&
    !isPlaceholder(series) &&
    typeof attempt === 'number' &&
    Number.isSafeInteger(attempt) &&
    attempt > 0 &&
    typeof wireName === 'string' &&
    wireName.length > 0 &&
    wireName.length <= 1024 &&
    !isPlaceholder(wireName) &&
    (reason === 'top-N' || reason === 'ledger' || reason === 'skill-scope')
  )
    return { iteration, series, attempt, wireName, reason };
  return undefined;
}
