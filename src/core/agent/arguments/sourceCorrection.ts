/** Map — omission eligibility and one settlement of already masked native rows.
 * This leaf receives the ledger writer; it never imports findings or dispatch.
 */
import type { ArgumentRow } from './rows.js';
import type { BatchCall, CheckedArgument } from './resolve.js';
import type { CallSources } from './sources.js';

export interface AskedArgument {
  readonly toolCallId: string;
  readonly argument: string;
}

/** Only protocol absence; checks, hints and a malformed dropped claim cannot infer it. */
export function omissionRows(
  rows: readonly ArgumentRow[],
  checked: readonly CheckedArgument[],
  calls: readonly BatchCall[],
  declared: ReadonlyMap<string, CallSources>,
): readonly ArgumentRow[] {
  const byCall = new Map(calls.map((call) => [call.id, call]));
  const candidates = new Map<string, Set<string>>();
  for (const item of checked) {
    const source = declared.get(item.toolCallId);
    const value = byCall.get(item.toolCallId)?.args[item.argument];
    const primitive =
      typeof value === 'string' ||
      typeof value === 'boolean' ||
      (typeof value === 'number' && Number.isFinite(value));
    if (
      item.rule !== 'ask' ||
      item.asked !== 'unverified' ||
      item.check?.claimed !== 'none' ||
      source === undefined ||
      source.declarationMalformed === true ||
      !primitive ||
      source.from.some((claim) => claim.argument === item.argument)
    )
      continue;
    const names = candidates.get(item.toolCallId) ?? new Set<string>();
    names.add(item.argument);
    candidates.set(item.toolCallId, names);
  }
  return rows.filter((row) => candidates.get(row.toolCallId)?.has(row.argument) === true);
}

export interface PendingOmissions {
  argumentSourceOmissionRows?: readonly ArgumentRow[];
}

/** Native turn+iteration, never caller text or a chosen cache key, binds the pending observations. */
export function pendingOmissions(
  state: PendingOmissions,
  turn: number,
  iteration: number,
): readonly ArgumentRow[] {
  return JSON.parse(
    JSON.stringify(
      [...(state.argumentSourceOmissionRows ?? [])].filter(
        (row) => row.turn === turn && row.iteration === iteration,
      ),
    ),
  ) as ArgumentRow[];
}

/** Index schema names separately; never concatenate possibly colliding identities. */
function namesByCall(rows: readonly AskedArgument[]): ReadonlyMap<string, ReadonlySet<string>> {
  const byCall = new Map<string, Set<string>>();
  for (const row of rows) {
    const names = byCall.get(row.toolCallId) ?? new Set<string>();
    names.add(row.argument);
    byCall.set(row.toolCallId, names);
  }
  return byCall;
}

/** Every actual ask member must be an omission; a real human obligation takes precedence. */
export function onlyOmissions(
  rows: readonly ArgumentRow[],
  asks: readonly {
    readonly toolCallId: string;
    readonly ask: readonly string[];
    readonly window?: true;
  }[],
): boolean {
  if (rows.length === 0 || asks.length === 0 || asks.some((ask) => ask.window === true))
    return false;
  const names = namesByCall(rows);
  return asks.every(
    (ask) =>
      ask.ask.length > 0 &&
      ask.ask.every((argument) => names.get(ask.toolCallId)?.has(argument) === true),
  );
}

/** Settle once through the existing writer. No append-only row is rewritten or replaced. */
export function settleOmissions(
  state: PendingOmissions,
  turn: number,
  iteration: number,
  outcome: 'correction' | 'asked' | 'preempted' | 'discard',
  write: (rows: readonly ArgumentRow[]) => void,
  members?: readonly AskedArgument[],
): void {
  const pending = pendingOmissions(state, turn, iteration);
  const memberNames = members === undefined ? undefined : namesByCall(members);
  const selected =
    memberNames !== undefined
      ? pending.filter((row) => memberNames.get(row.toolCallId)?.has(row.argument) === true)
      : pending;
  if (selected.length === 0) return;
  const settledNames = namesByCall(selected);
  state.argumentSourceOmissionRows = [...(state.argumentSourceOmissionRows ?? [])].filter(
    (row) =>
      row.turn !== turn ||
      row.iteration !== iteration ||
      settledNames.get(row.toolCallId)?.has(row.argument) !== true,
  );
  if (outcome === 'discard') return;
  const rows = selected.map((row): ArgumentRow => {
    if (outcome === 'asked') return row;
    const { asked: _asked, source: _source, ...rest } = row;
    void _asked;
    void _source;
    return {
      ...rest,
      claimed: 'none',
      ...(outcome === 'correction'
        ? { correction: 'source-declaration-required' as const }
        : { withheld: 'batch-preempted' as const }),
    };
  });
  write(rows);
}
