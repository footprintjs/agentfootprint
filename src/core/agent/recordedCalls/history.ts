import { copyJson, readOwnList } from '../../../lib/boundedJson.js';
import { canonicalJson } from '../../../lib/canonicalJson.js';
import { fnv1a } from '../../../lib/fnv1a.js';
import { isPersonEntry } from '../../../lib/saidByPerson.js';
import { isRecord, str } from './record.js';

interface Proposal {
  readonly index: number;
  readonly call: Readonly<Record<string, unknown>>;
}

export interface HistoryCall {
  readonly index: number;
  readonly message: Readonly<Record<string, unknown>>;
  readonly providerId?: string;
  readonly toolName?: string;
  readonly proposal?: Proposal;
}

const MAX_PROPOSALS = 1_000;

function proposalsOf(message: Readonly<Record<string, unknown>>) {
  return readOwnList(message.toolCalls, MAX_PROPOSALS)?.entries ?? [];
}

export function historyCallAt(history: readonly unknown[], index: number): HistoryCall | undefined {
  const message: unknown = Object.getOwnPropertyDescriptor(history, String(index))?.value;
  return isRecord(message) && message.role === 'tool' ? historyCall(message, index) : undefined;
}

function historyCall(message: Readonly<Record<string, unknown>>, index: number): HistoryCall {
  const providerId = str(message.toolCallId);
  const toolName = str(message.toolName);
  return {
    index,
    message,
    ...(providerId !== undefined && { providerId }),
    ...(toolName !== undefined && { toolName }),
  };
}

interface HistoryBatch {
  readonly proposals: Proposal[];
  readonly answers: HistoryCall[];
}

/** A result retains its own position. Argument provenance needs either complete
 * recorded order or a single compatible proposal and answer in its batch. */
export function readHistoryCalls(history: readonly unknown[]): readonly HistoryCall[] {
  const pending = new Map<string, HistoryBatch>();
  const batches: HistoryBatch[] = [];
  const calls: HistoryCall[] = [];
  for (let index = 0; index < history.length; index++) {
    const message: unknown = Object.getOwnPropertyDescriptor(history, String(index))?.value;
    if (!isRecord(message)) continue;
    if (isPersonEntry(message)) pending.clear();
    if (message.role === 'assistant') {
      const proposed = new Map<string, HistoryBatch>();
      for (const call of proposalsOf(message)) {
        if (!isRecord(call)) continue;
        const id = str(call.id);
        if (id === undefined) continue;
        const batch = proposed.get(id) ?? { proposals: [], answers: [] };
        batch.proposals.push({ call, index });
        proposed.set(id, batch);
      }
      for (const [id, batch] of proposed) {
        batches.push(batch);
        pending.set(id, batch);
      }
    }
    if (message.role !== 'tool') continue;
    const occurrence = historyCall(message, index);
    calls.push(occurrence);
    if (occurrence.providerId !== undefined)
      pending.get(occurrence.providerId)?.answers.push(occurrence);
  }
  const positions = new Map<number, Proposal>();
  for (const { proposals, answers } of batches) {
    const complete =
      proposals.length === answers.length &&
      proposals.every((p, index) => p.call.name === answers[index]?.toolName);
    for (const [slot, answer] of answers.entries()) {
      if (answer.toolName === undefined) continue;
      const ordered = proposals[slot];
      if (complete && ordered !== undefined) {
        positions.set(answer.index, ordered);
        continue;
      }
      const compatible = proposals.filter((p) => p.call.name === answer.toolName);
      const [unique] = compatible;
      if (
        unique !== undefined &&
        compatible.length === 1 &&
        answers.filter((a) => a.toolName === answer.toolName).length === 1
      )
        positions.set(answer.index, unique);
    }
  }
  return calls.map((call) => {
    const proposal = positions.get(call.index);
    return proposal === undefined ? call : { ...call, proposal };
  });
}

function* historyProposals(history: readonly unknown[], begins = -1): Iterable<Proposal> {
  for (let index = begins + 1; index < history.length; index++) {
    const message: unknown = Object.getOwnPropertyDescriptor(history, String(index))?.value;
    if (!isRecord(message) || message.role !== 'assistant') continue;
    for (const call of proposalsOf(message)) {
      if (isRecord(call)) yield { index, call };
    }
  }
}

export function uniqueHistoryProposal(
  history: readonly unknown[],
  id: string,
): Proposal | undefined {
  let found: Proposal | undefined;
  for (const proposal of historyProposals(history)) {
    if (proposal.call.id !== id) continue;
    if (found !== undefined) return undefined;
    found = proposal;
  }
  return found;
}

type ResolvedHistoryCall =
  | { readonly kind: 'matched'; readonly call: HistoryCall }
  | { readonly kind: 'missing' }
  | { readonly kind: 'ambiguous' };

export function resolveHistoryCall(
  calls: readonly HistoryCall[],
  id: string,
  name?: string,
): ResolvedHistoryCall {
  let match: HistoryCall | undefined;
  for (const call of calls) {
    if (call.providerId !== id) continue;
    if (name !== undefined && call.toolName !== undefined && call.toolName !== name) continue;
    if (match !== undefined) return { kind: 'ambiguous' };
    match = call;
  }
  return match === undefined ? { kind: 'missing' } : { kind: 'matched', call: match };
}

/** Build the candidate index once for a reader that resolves many witnesses. */
export function historyCallResolver(calls: readonly HistoryCall[]) {
  const byId = new Map<string, HistoryCall[]>();
  for (const call of calls) {
    if (call.providerId === undefined) continue;
    const group = byId.get(call.providerId) ?? [];
    group.push(call);
    byId.set(call.providerId, group);
  }
  return (id: string, name?: string): ResolvedHistoryCall =>
    resolveHistoryCall(byId.get(id) ?? [], id, name);
}

function countProposals(history: readonly unknown[], begins: number) {
  const byId = new Map<string, Map<string | undefined, number>>();
  for (const { call } of historyProposals(history, begins)) {
    const id = str(call.id);
    if (id === undefined) continue;
    const name = str(call.name);
    const names = byId.get(id) ?? new Map<string | undefined, number>();
    names.set(name, (names.get(name) ?? 0) + 1);
    byId.set(id, names);
  }
  return byId;
}

/** An argument row cannot claim the only result when several compatible
 * proposals could have written it. With no result, the proposal remains open
 * to correction. Legacy result-only records still use their retained calls. */
export function argumentHistoryCallResolver(
  calls: readonly HistoryCall[],
  history: readonly unknown[],
  begins: number,
) {
  const resolve = historyCallResolver(calls);
  let byId: ReturnType<typeof countProposals> | undefined;
  return (id: string, name?: string): ResolvedHistoryCall => {
    const result = resolve(id, name);
    if (result.kind !== 'matched') return result;
    const names = (byId ??= countProposals(history, begins)).get(id);
    if (names === undefined) return result;
    const proposals =
      name === undefined || result.call.toolName === undefined
        ? [...names.values()].reduce((total, count) => total + count, 0)
        : (names.get(name) ?? 0) + (names.get(undefined) ?? 0);
    return proposals > 1 ? { kind: 'ambiguous' } : result;
  };
}

/** An id-only witness can name a result only when the retained history has one candidate. */
export function uniqueHistoryCall(
  calls: readonly HistoryCall[],
  id: string,
): HistoryCall | undefined {
  const resolved = resolveHistoryCall(calls, id);
  return resolved.kind === 'matched' ? resolved.call : undefined;
}

/** A prior state view can lend its indices only while the same prefix survives. */
export function historyStartsWith(
  history: readonly unknown[],
  prefix: readonly unknown[],
): boolean {
  if (prefix.length > history.length) return false;
  try {
    for (let index = 0; index < prefix.length; index++) {
      const a = Object.getOwnPropertyDescriptor(prefix, String(index));
      const b = Object.getOwnPropertyDescriptor(history, String(index));
      if (a === undefined || b === undefined || !('value' in a) || !('value' in b)) return false;
      if (a.value === b.value) continue;
      if (
        canonicalJson(copyJson(a.value, Number.MAX_SAFE_INTEGER, false)) !==
        canonicalJson(copyJson(b.value, Number.MAX_SAFE_INTEGER, false))
      )
        return false;
    }
    return true;
  } catch {
    return false;
  }
}

/** Compose emits a content hash at its own position, which can differ from
 * the result's history index in a windowed request. */
export function historyCallForWitness(
  calls: readonly HistoryCall[],
  id: string,
  position: unknown,
  contentHash: unknown,
): HistoryCall | undefined {
  const unique = uniqueHistoryCall(calls, id);
  if (unique !== undefined || typeof position !== 'number' || typeof contentHash !== 'string')
    return unique;
  let match: HistoryCall | undefined;
  for (const call of calls) {
    const content = call.message.content;
    if (
      call.providerId !== id ||
      typeof content !== 'string' ||
      fnv1a(`tool:${position}:${content}`) !== contentHash
    )
      continue;
    if (match !== undefined) return undefined;
    match = call;
  }
  return match;
}

/** State rows use the producer's ID and optional name. A sparse ledger
 * does not determine an occurrence when both fields still admit several. */
export function rowsForHistoryCall(
  rows: readonly unknown[],
  calls: readonly HistoryCall[],
  call: HistoryCall,
): readonly { readonly index: number; readonly row: Readonly<Record<string, unknown>> }[] {
  const id = call.providerId;
  if (id === undefined) return [];
  return rows.flatMap((row, index) => {
    if (!isRecord(row) || row.toolCallId !== id) return [];
    const name = str(row.toolName);
    if (name !== undefined && call.toolName !== undefined && name !== call.toolName) return [];
    const resolved = resolveHistoryCall(calls, id, name);
    return resolved.kind === 'matched' && resolved.call.index === call.index
      ? [{ row, index }]
      : [];
  });
}

/** The retained tuple on a pre-dispatch row. This groups ledger decisions
 * before any result exists; it is not an address of an entered tool. */
export function unlandedCallKey(row: Readonly<Record<string, unknown>>): string {
  return JSON.stringify([
    'unlanded',
    typeof row.turn === 'number' && Number.isFinite(row.turn) ? row.turn : null,
    typeof row.iteration === 'number' && Number.isFinite(row.iteration) ? row.iteration : null,
    str(row.toolName) ?? null,
    str(row.toolCallId) ?? null,
  ]);
}
