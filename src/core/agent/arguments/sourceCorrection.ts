/** Map — omission eligibility and one settlement of already masked native rows.
 * This leaf receives the ledger writer; it never imports findings or dispatch.
 */
import type { CallOccurrenceKey } from '../../../lib/callOccurrence.js';
import { batchAddress, type BatchAddress } from './batchAddress.js';
import type { ArgumentRow } from './rows.js';
import type { BatchCall, CheckedArgument } from './resolve.js';
import type { CallSources } from './sources.js';

export interface AskedArgument {
  readonly toolCallId: string;
  readonly callOccurrenceKey?: CallOccurrenceKey;
  readonly argument: string;
}

/** Only protocol absence; checks, hints and a malformed dropped claim cannot infer it. */
export function omissionRows(
  rows: readonly ArgumentRow[],
  checked: readonly CheckedArgument[],
  calls: readonly BatchCall[],
  declared: ReadonlyMap<BatchAddress, CallSources>,
): readonly ArgumentRow[] {
  const byCall: ReadonlyMap<BatchAddress, BatchCall> = new Map(
    calls.map((call) => [batchAddress(call.id, call.callOccurrenceKey), call]),
  );
  const candidates = new Map<BatchAddress, Set<string>>();
  for (const item of checked) {
    const address = batchAddress(item.toolCallId, item.callOccurrenceKey);
    const source = declared.get(address);
    const value = byCall.get(address)?.args[item.argument];
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
    const names = candidates.get(address) ?? new Set<string>();
    names.add(item.argument);
    candidates.set(address, names);
  }
  return rows.filter((row) => includesArgument(candidates, row));
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
function namesByCall(
  rows: readonly AskedArgument[],
): ReadonlyMap<BatchAddress, ReadonlySet<string>> {
  const byCall = new Map<BatchAddress, Set<string>>();
  for (const row of rows) {
    const address = batchAddress(row.toolCallId, row.callOccurrenceKey);
    const names = byCall.get(address) ?? new Set<string>();
    names.add(row.argument);
    byCall.set(address, names);
  }
  return byCall;
}

function includesArgument(
  names: ReadonlyMap<BatchAddress, ReadonlySet<string>>,
  { toolCallId, callOccurrenceKey, argument }: AskedArgument,
): boolean {
  return names.get(batchAddress(toolCallId, callOccurrenceKey))?.has(argument) === true;
}

/** Every actual ask member must be an omission; a real human obligation takes precedence. */
export function onlyOmissions(
  rows: readonly ArgumentRow[],
  asks: readonly {
    readonly toolCallId: string;
    readonly callOccurrenceKey?: CallOccurrenceKey;
    readonly ask: readonly string[];
    readonly window?: true;
  }[],
): boolean {
  if (rows.length === 0 || asks.length === 0 || asks.some((ask) => ask.window === true))
    return false;
  const names = namesByCall(rows);
  return asks.every((ask) => {
    const argumentsForCall = names.get(batchAddress(ask.toolCallId, ask.callOccurrenceKey));
    return ask.ask.length > 0 && ask.ask.every((argument) => argumentsForCall?.has(argument));
  });
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
      ? pending.filter((row) => includesArgument(memberNames, row))
      : pending;
  if (selected.length === 0) return;
  const settledNames = namesByCall(selected);
  state.argumentSourceOmissionRows = [...(state.argumentSourceOmissionRows ?? [])].filter(
    (row) =>
      row.turn !== turn || row.iteration !== iteration || !includesArgument(settledNames, row),
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
