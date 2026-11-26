import type { DeclaredToolFailureRecord } from '../../../provider-contract/toolResultRecord.js';
import { MAX_RECORDED_ADVICE_CHARS } from '../../../semantics/coverage/items.js';
import { readToolFailureCategory } from './execution.js';
import { isRecord } from './record.js';

function ownValue(object: object, key: string): unknown {
  const field = Object.getOwnPropertyDescriptor(object, key);
  return field?.enumerable && 'value' in field ? field.value : undefined;
}

function advice(value: unknown): DeclaredToolFailureRecord['tryInstead'] {
  if (typeof value === 'string' && value.length <= MAX_RECORDED_ADVICE_CHARS) return value;
  return isRecord(value) && ownValue(value, 'omitted') === true ? { omitted: true } : undefined;
}

/** Validate the closed declaration vocabulary and keep only the served advice. */
export function readDeclaredToolFailure(value: unknown): DeclaredToolFailureRecord | undefined {
  if (!isRecord(value) || ownValue(value, 'origin') !== 'declared') return undefined;
  const category = readToolFailureCategory(ownValue(value, 'category'));
  if (category === undefined) return undefined;
  const notChecked = advice(ownValue(value, 'notChecked'));
  const tryInstead = advice(ownValue(value, 'tryInstead'));
  return {
    origin: 'declared',
    category,
    ...(notChecked !== undefined && { notChecked }),
    ...(tryInstead !== undefined && { tryInstead }),
  };
}

/** A declaration belongs only to the original failed return that reached history. */
export function recordedDeclaredToolFailure(
  message: object,
): DeclaredToolFailureRecord | undefined {
  const disposition = Object.getOwnPropertyDescriptor(message, 'toolResultDisposition');
  return ownValue(message, 'toolResultExecution') === 'returned' &&
    ownValue(message, 'outcome') === 'failed' &&
    (disposition === undefined || ('value' in disposition && disposition.value === undefined))
    ? readDeclaredToolFailure(ownValue(message, 'toolDeclaredFailure'))
    : undefined;
}
