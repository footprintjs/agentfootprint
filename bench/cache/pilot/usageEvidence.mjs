import { copyJson } from '../../../dist/lib/boundedJson.js';
const labels = {
  service_tier: ['standard', 'priority', 'batch'],
  inference_geo: ['global', 'us', 'not_available'],
  speed: ['standard', 'fast'],
};
/** Rejection projection only: names/types/bounded numbers, never arbitrary string
 * values, provider text, fingerprints or bodies. Refused names are omitted with
 * a count, not renamed into a path that could collide with a real field.
 */
export function usageEvidence(input) {
  const evidence = {
    fields: [],
    complete: true,
    truncated: false,
    withheldNames: 0,
    valuePolicy: 'bounded-numbers-and-declared-labels-only',
  };
  let value;
  try {
    value = copyJson(input, 8192, false);
  } catch {
    return { ...evidence, complete: false, gap: 'NON_JSON_OR_SIZE_LIMIT' };
  }
  const add = (item, path) => {
    if (evidence.fields.length >= 64 || path.length > 3) {
      evidence.complete = false;
      evidence.truncated = true;
      return;
    }
    const type = item === null ? 'null' : Array.isArray(item) ? 'array' : typeof item;
    const row = { path, type };
    if (type === 'number' && Number.isSafeInteger(item) && item >= 0 && item <= 1_000_000_000)
      row.value = item;
    if (
      type === 'string' &&
      path.length === 1 &&
      Object.hasOwn(labels, path[0]) &&
      labels[path[0]].includes(item)
    )
      row.label = item;
    if (type === 'string' && !Object.hasOwn(row, 'label')) row.gap = 'STRING_VALUE_WITHHELD';
    if (type === 'number' && !Object.hasOwn(row, 'value')) row.gap = 'NUMBER_VALUE_WITHHELD';
    if (type === 'boolean') row.gap = 'BOOLEAN_VALUE_WITHHELD';
    if (type === 'array') row.gap = 'ARRAY_CONTENTS_WITHHELD';
    if (row.gap) evidence.complete = false;
    // A conservative byte allowance keeps the complete projection below 8KiB.
    if (JSON.stringify(evidence.fields).length + JSON.stringify(row).length > 7000) {
      evidence.complete = false;
      evidence.truncated = true;
      return;
    }
    evidence.fields.push(row);
    if (type === 'object')
      for (const [key, child] of Object.entries(item)) {
        if (
          !/^[a-z][a-z0-9_]{0,63}$/.test(key) ||
          /^(?:sk_ant|api_key|authorization|password|secret)(?:_|$)/.test(key)
        ) {
          evidence.withheldNames++;
          evidence.complete = false;
          continue;
        }
        add(child, [...path, key]);
      }
  };
  if (!value || Array.isArray(value) || typeof value !== 'object')
    return { ...evidence, complete: false, gap: 'USAGE_NOT_AN_OBJECT' };
  for (const [key, child] of Object.entries(value)) {
    if (
      !/^[a-z][a-z0-9_]{0,63}$/.test(key) ||
      /^(?:sk_ant|api_key|authorization|password|secret)(?:_|$)/.test(key)
    ) {
      evidence.withheldNames++;
      evidence.complete = false;
      continue;
    }
    add(child, [key]);
  }
  return evidence;
}
