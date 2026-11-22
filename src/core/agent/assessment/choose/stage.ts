import { fire, type Gathered } from '../gathered.js';
import { readIntegrityRows } from '../integrityReasons.js';

/** Apply the committed choice findings and the other legacy integrity rows in recorded order. */
export function readIntegrityFindings(state: Readonly<Record<string, unknown>>, g: Gathered) {
  const integrity = readIntegrityRows(state);
  for (const { reason, at } of integrity.fired) fire(g, reason, at);
  return integrity;
}
