import type { CommitBundle } from 'foottrace';
import { expect } from 'vitest';

const key = 'messagesInjections';
type Row = Readonly<Record<string, unknown>>;

function withRecency(row: Row, position: number, last: boolean): Row {
  expect(row).not.toHaveProperty('asRecency');
  expect(row.position).toBe(position);
  expect(row.recencyFromOrder).toBe(true);
  const fields = Object.entries(row).filter(([name]) => name !== 'recencyFromOrder');
  // The historical writer placed recency immediately before position.
  fields.splice(
    fields.findIndex(([name]) => name === 'position'),
    0,
    ['asRecency', last ? 'latest' : 'earlier'],
  );
  return Object.fromEntries(fields);
}

/** Recover only the old native Messages writes for comparison with frozen goldens. */
export function legacyMessageInjectionLog(
  log: readonly CommitBundle[],
  initialState?: Record<string, unknown>,
): CommitBundle[] {
  let previous = (initialState?.[key] ?? []) as readonly Row[];
  return log.map((commit) => {
    const index = commit.trace.findIndex(({ path }) => path === key);
    if (index === -1) {
      expect(commit.overwrite).not.toHaveProperty(key);
      return commit;
    }

    const entry = commit.trace[index]!;
    const added = commit.overwrite[key] as readonly Row[];
    expect(Array.isArray(added)).toBe(true);
    expect(entry.verb === 'set' || entry.verb === 'append').toBe(true);
    if (entry.verb === 'append') expect(added.length).toBeGreaterThan(0);
    const hadPrefix = entry.verb === 'append' && previous.length > 0;
    const current = entry.verb === 'append' ? [...previous, ...added] : added;
    const legacyRows = current.map((row, position) =>
      withRecency(row, position, position === current.length - 1),
    );
    previous = current;

    // Extending a nonempty list made its old last row change, so the historical
    // delta encoder had to record a whole set. A first append kept its verb.
    const trace = hadPrefix
      ? commit.trace.map((row, rowIndex) =>
          rowIndex === index ? { ...entry, verb: 'set' as const } : row,
        )
      : commit.trace;
    return { ...commit, overwrite: { ...commit.overwrite, [key]: legacyRows }, trace };
  });
}
