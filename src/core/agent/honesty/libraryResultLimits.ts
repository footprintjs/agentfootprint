import { MAX_ENTERED_TOOL_CALLS } from './enteredToolCalls.js';
import type { TypedScope } from 'footprintjs';
import type { ArtifactMeta } from '../../../artifacts/types.js';
import { artifactRefsInText, isArtifactRef } from '../../../artifacts/naming.js';
import {
  callOccurrenceField,
  readCallOccurrenceKey,
  storedCallOccurrenceField,
  type CallOccurrenceKey,
} from '../../../lib/callOccurrence.js';
import type { AgentState } from '../types.js';
import type { ToolResultCut } from '../toolResultCap.js';

/** One action the framework itself took on a tool's result. No result text is retained. */
export type LibraryResultLimitFact =
  | ({ readonly kind: 'result-cut' } & ToolResultCut)
  | { readonly kind: 'placed-unread'; readonly ref: string }
  | {
      readonly kind: 'times-without-zone';
      readonly naiveCount: number;
      readonly ref: string;
      /** The exact native ticket remained visible after the framework capped the result. */
      readonly nativeRefInCut?: true;
    };

interface LimitCall {
  readonly toolName: string;
  readonly toolCallId: string;
  readonly callOccurrenceKey?: CallOccurrenceKey;
}

export type LibraryResultLimit = LimitCall & { readonly turn: number } & LibraryResultLimitFact;

type TimeLimit = Extract<LibraryResultLimitFact, { readonly kind: 'times-without-zone' }>;

/** Metadata stays private to the executing call until its result passes governance. */
export interface PendingDatasetLimits {
  unzonedDatasets?: TimeLimit[];
  moreUnzonedDatasets?: true;
}

export function captureDatasetLimit(
  pending: PendingDatasetLimits,
  ref: string,
  naiveCount: number,
): void {
  if (!isArtifactRef(ref) || !count(naiveCount) || naiveCount === 0) return;
  const rows = (pending.unzonedDatasets ??= []);
  if (rows.length === MAX_ENTERED_TOOL_CALLS) pending.moreUnzonedDatasets = true;
  else rows.push({ kind: 'times-without-zone', ref, naiveCount });
}

export function recordServedLimits(
  scope: TypedScope<AgentState>,
  call: LimitCall,
  eligible: boolean,
  disposition: 'withheld' | 'rewritten' | undefined,
  cut: ToolResultCut | undefined,
  pending?: PendingDatasetLimits,
  servedText?: string,
): void {
  if (!eligible || disposition === 'withheld') return;
  const minted = disposition === 'rewritten' ? undefined : pending?.unzonedDatasets;
  if (cut === undefined && minted === undefined) return;
  const facts: LibraryResultLimitFact[] = cut ? [{ kind: 'result-cut', ...cut }] : [];
  // A tool can also mint scratch datasets. Only the delivered ref links the public result to
  // its count. Scan the already serialized result once and retain only our bounded mint set.
  if (minted !== undefined && servedText !== undefined) {
    const candidates = new Map(minted.map((fact) => [fact.ref, fact]));
    const matched = new Set<string>();
    let incomplete = false;
    for (const ref of artifactRefsInText(servedText)) {
      const fact = candidates.get(ref);
      if (fact !== undefined) {
        if (!matched.has(ref)) facts.push(cut ? { ...fact, nativeRefInCut: true } : fact);
        matched.add(ref);
        if (matched.size === candidates.size && !pending?.moreUnzonedDatasets) break;
      } else if (pending?.moreUnzonedDatasets) {
        incomplete = true;
      }
    }
    if (incomplete && scope.libraryResultLimitsIncomplete !== true)
      scope.libraryResultLimitsIncomplete = true;
  }
  if (facts.length) appendLimits(scope, call, facts);
}

/** Detached admission at the replay and checkpoint boundaries. Never read a tool payload. */
export function copyLibraryResultLimit(value: unknown): LibraryResultLimit | undefined {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return undefined;
  const read = (key: string): unknown => Object.getOwnPropertyDescriptor(value, key)?.value;
  const turn = read('turn');
  const toolName = read('toolName');
  const toolCallId = read('toolCallId');
  if (
    !count(turn) ||
    typeof toolName !== 'string' ||
    typeof toolCallId !== 'string' ||
    readCallOccurrenceKey(value) === null
  )
    return undefined;
  const call = { turn, toolName, toolCallId, ...storedCallOccurrenceField(value) };
  const kind = read('kind');
  if (kind === 'result-cut') {
    const maxChars = read('maxChars');
    const keptChars = read('keptChars');
    const totalChars = read('totalChars');
    if (
      !count(maxChars) ||
      maxChars === 0 ||
      !count(keptChars) ||
      !count(totalChars) ||
      keptChars > maxChars ||
      totalChars <= maxChars
    )
      return undefined;
    return { ...call, kind, maxChars, keptChars, totalChars };
  }
  const ref = read('ref');
  if (!isArtifactRef(ref)) return undefined;
  if (kind === 'placed-unread') return { ...call, kind, ref };
  const naiveCount = read('naiveCount');
  return kind === 'times-without-zone' && count(naiveCount) && naiveCount > 0
    ? {
        ...call,
        kind,
        naiveCount,
        ref,
        ...(read('nativeRefInCut') === true && { nativeRefInCut: true }),
      }
    : undefined;
}

function count(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
}

export function recordLibraryResultLimit(
  scope: TypedScope<AgentState>,
  call: LimitCall,
  fact: LibraryResultLimitFact,
): void {
  appendLimits(scope, call, [fact]);
}

function appendLimits(
  scope: TypedScope<AgentState>,
  call: LimitCall,
  facts: readonly LibraryResultLimitFact[],
): void {
  const prior = scope.libraryResultLimits ?? [];
  const room = Math.max(0, MAX_ENTERED_TOOL_CALLS - prior.length);
  if (facts.length > room && scope.libraryResultLimitsIncomplete !== true)
    scope.libraryResultLimitsIncomplete = true;
  if (room === 0) return;
  const turn = scope.turnNumber;
  const added = facts.slice(0, room).map(
    (fact): LibraryResultLimit => ({
      turn,
      toolName: call.toolName,
      toolCallId: call.toolCallId,
      ...callOccurrenceField(call.callOccurrenceKey),
      ...fact,
    }),
  );
  scope.libraryResultLimits = [...prior, ...added];
}

/** Only a content read in this turn settles a pending placement; metadata and refusals leave it alone. */
export function markPlacedResultRead(scope: TypedScope<AgentState>, ref: string): void {
  if (!('libraryResultLimits' in scope)) return;
  const limits = scope.libraryResultLimits;
  if (limits === undefined || limits.length === 0) return;
  const turn = scope.turnNumber;
  const pending = (row: LibraryResultLimit) =>
    row.kind === 'placed-unread' && row.turn === turn && row.ref === ref;
  if (limits.some(pending)) scope.libraryResultLimits = limits.filter((row) => !pending(row));
}

/** `wants` may resolve before a credential or approval gate. Its data reaches a tool only at entry. */
export function markWantedResultsRead(
  scope: TypedScope<AgentState>,
  wanted: Readonly<Record<string, ArtifactMeta>> | undefined,
): void {
  if (wanted === undefined) return;
  for (const meta of Object.values(wanted)) markPlacedResultRead(scope, meta.ref);
}
