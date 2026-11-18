import type { Classified } from './classify.js';

/**
 * The fall-back rule over the rows' order: for each overlap day, the one
 * place its wall clock steps back (a value not after the one before it)
 * splits it into `earlier` then `later`. Any step back that is NOT inside one
 * overlap day means the rows are not in time order, and every overlap value
 * is left unplaced; so is a day with no step back or more than one.
 */
export function resolveOverlaps(
  read: readonly Classified[],
  nanos: (i: number) => number,
): Map<number, 'earlier' | 'later'> {
  const placed = new Map<number, 'earlier' | 'later'>();
  const walled: number[] = [];
  for (let i = 0; i < read.length; i++) {
    const r = read[i] as Classified;
    if ((r.kind === 'instant' && r.wall !== undefined) || r.kind === 'overlap') walled.push(i);
  }
  const wallAt = (i: number): number => (read[i] as { wall: number }).wall;
  const stepsByDay = new Map<string, number[]>();
  for (let k = 1; k < walled.length; k++) {
    const prev = walled[k - 1] as number;
    const here = walled[k] as number;
    const notAfter =
      wallAt(here) < wallAt(prev) || (wallAt(here) === wallAt(prev) && nanos(here) <= nanos(prev));
    if (!notAfter) continue;
    const a = read[prev] as Classified;
    const b = read[here] as Classified;
    if (a.kind !== 'overlap' || b.kind !== 'overlap' || a.day !== b.day) return placed;
    stepsByDay.set(a.day, [...(stepsByDay.get(a.day) ?? []), here]);
  }
  for (const [day, steps] of stepsByDay) {
    if (steps.length !== 1) continue;
    const step = steps[0] as number;
    for (let i = 0; i < read.length; i++) {
      const r = read[i] as Classified;
      if (r.kind === 'overlap' && r.day === day) placed.set(i, i < step ? 'earlier' : 'later');
    }
  }
  return placed;
}
