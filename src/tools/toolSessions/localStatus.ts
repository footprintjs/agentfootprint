import type { TeardownScope } from './contracts.js';
/** Local registrations only; absence says nothing about a remote process or handle. */
export function localResourceStatus(
  rows: Iterable<{
    readonly fired: boolean;
    readonly partition?: string;
    readonly scope: TeardownScope;
  }>,
  turn: string,
  conversation: string,
): 'retained' | 'none-known-locally' {
  for (const row of rows)
    if (
      !row.fired &&
      (row.partition === turn ||
        ((row.scope === 'session' || row.scope === 'shutdown') && row.partition === conversation))
    )
      return 'retained';
  return 'none-known-locally';
}
