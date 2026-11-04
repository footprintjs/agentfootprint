import { sha256Hex } from '../lib/sha256.js';
import { jsonBytes, ownData } from '../lib/boundedJson.js';

/** A bounded private label, never a renamed public tool or an authentication claim. */
export type FiniteLabel =
  | { readonly kind: 'plain'; readonly value: string }
  | { readonly kind: 'sha256'; readonly value: string };

/** JSON spelling preserves lone surrogates instead of UTF-8 replacement aliases. */
export function finiteLabel(value: string): FiniteLabel {
  return value.length <= 1024 && jsonBytes(value) <= 1024
    ? { kind: 'plain', value }
    : { kind: 'sha256', value: sha256Hex(JSON.stringify(value)) };
}

export function readFiniteLabel(value: unknown): FiniteLabel {
  const row = ownData(value, ['kind', 'value']);
  if (
    typeof row.value !== 'string' ||
    (row.kind !== 'plain' && row.kind !== 'sha256') ||
    (row.kind === 'plain' && (row.value.length > 1024 || jsonBytes(row.value) > 1024)) ||
    (row.kind === 'sha256' && !/^[0-9a-f]{64}$/.test(row.value))
  )
    throw new TypeError('Invalid finite label');
  return { kind: row.kind, value: row.value };
}

/** Structurally disjoint: a literal digest-looking label cannot become a digest. */
export const labelKey = (label: FiniteLabel): string => JSON.stringify([label.kind, label.value]);
export const keyOfLabel = (value: string): string => labelKey(finiteLabel(value));

/** Provider IDs may be empty or numeric on legacy non-asking batches. */
export function callIdLabel(value: unknown): FiniteLabel | undefined {
  if (value !== null && !['string', 'number', 'boolean', 'undefined'].includes(typeof value))
    return undefined;
  const text = typeof value === 'number' && Object.is(value, -0) ? '-0' : String(value);
  return finiteLabel(JSON.stringify([value === null ? 'null' : typeof value, text]));
}
