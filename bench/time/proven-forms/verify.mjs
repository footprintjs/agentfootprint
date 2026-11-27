import { isDeepStrictEqual } from 'node:util';

// Evaluate an independently supplied manifest, including cells absent from the measured rows.
export function verify(expectedCells, results, expectedIdentity, observedIdentity) {
  const ids = new Map(expectedCells.map(cell => [cell.id, cell]));
  if (!expectedCells.length || ids.size !== expectedCells.length) throw new Error('Invalid expected manifest');
  const seen = new Map();
  let unexpected = false;
  for (const result of results) {
    if (!ids.has(result.id)) unexpected = true;
    const copies = seen.get(result.id) ?? [];
    copies.push(result);
    seen.set(result.id, copies);
  }
  const byForm = {};
  for (const [id, cell] of ids) {
    const { form, expected } = cell;
    const tally = byForm[form] ??= { expected: 0, passed: 0, missed: 0, missing: 0, duplicate: 0 };
    tally.expected++;
    const copies = seen.get(id) ?? [];
    if (!copies.length) tally.missing++;
    else if (copies.length > 1) tally.duplicate++;
    else if (copies[0].pass === true && isDeepStrictEqual(copies[0].actual, { ...expected, cutoff: expected.to })) tally.passed++;
    else tally.missed++;
  }
  for (const tally of Object.values(byForm)) {
    tally.qualifies = tally.passed === tally.expected && !unexpected && isDeepStrictEqual(expectedIdentity, observedIdentity);
  }
  return byForm;
}
