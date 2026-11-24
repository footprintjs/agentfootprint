import type { TypedScope } from 'footprintjs';
import { ownData, readOwnList } from '../../../lib/boundedJson.js';
import { memoryRecallOutcomesKey } from '../../../memory/define.types.js';
import type { MemoryRecallOutcome } from '../../../memory/retrieval/outcome.js';
import { appendRows, recordFindings } from '../findings/ledger.js';
import type { FindingsRow } from '../findings/types.js';
import type { AgentState } from '../types.js';

export type RecallExposure = 'present' | 'absent' | 'unknown';

export interface RecallRequestSummary {
  readonly accepted: RecallExposure | 'local';
  /** Number of uniquely attributed candidates in the accepted request, when proved. */
  readonly acceptedCount?: number;
  readonly exposure: RecallExposure;
  readonly committedProviderResponse: boolean;
}

export type RecallSourceSummary = Pick<
  MemoryRecallOutcome,
  'kind' | 'candidateCount' | 'admittedCount' | 'exclusions' | 'complete'
>;

export interface RetrievalRequestRow extends RecallRequestSummary {
  readonly kind: 'retrieval-request';
  readonly turn: number;
  readonly iteration: number;
  readonly sources?: readonly RecallSourceSummary[];
}

const MAX_RECALL_SOURCES = 64;
const REQUEST_KEYS = [
  'kind',
  'turn',
  'iteration',
  'accepted',
  'acceptedCount',
  'exposure',
  'committedProviderResponse',
  'sources',
] as const;
const SOURCE_KEYS = ['kind', 'candidateCount', 'admittedCount', 'exclusions', 'complete'] as const;
const EXCLUSION_REASONS = [
  'below-threshold',
  'decayed',
  'over-budget',
  'over-max-entries',
  'over-char-budget',
] as const;

function count(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
}

function exposure(value: unknown): value is RecallExposure {
  return value === 'present' || value === 'absent' || value === 'unknown';
}

function readSource(value: unknown): RecallSourceSummary | undefined {
  const fields = ownData(value, SOURCE_KEYS);
  const { kind, candidateCount, admittedCount, complete } = fields;
  const exclusions = ownData(fields.exclusions, EXCLUSION_REASONS);
  if (!Object.values(exclusions).every(count) || typeof complete !== 'boolean') return undefined;
  if (kind === 'timeout') {
    if (candidateCount !== undefined || admittedCount !== 0 || Object.keys(exclusions).length > 0)
      return undefined;
  } else if (
    kind !== 'ok' ||
    !count(candidateCount) ||
    (admittedCount !== undefined && (!count(admittedCount) || admittedCount > candidateCount))
  )
    return undefined;
  return { ...fields, exclusions } as unknown as RecallSourceSummary;
}

/** One closed, bounded shape for both a saved checkpoint and the assessment fold. */
export function readRetrievalRequest(value: unknown): RetrievalRequestRow | undefined {
  try {
    const row = ownData(value, REQUEST_KEYS);
    const { kind, turn, iteration, accepted, acceptedCount, committedProviderResponse } = row;
    if (
      kind !== 'retrieval-request' ||
      !count(turn) ||
      !count(iteration) ||
      iteration === 0 ||
      !(exposure(accepted) || accepted === 'local') ||
      !exposure(row.exposure) ||
      typeof committedProviderResponse !== 'boolean' ||
      (accepted === 'local' && committedProviderResponse) ||
      (acceptedCount !== undefined &&
        (!count(acceptedCount) ||
          !(
            (accepted === 'absent' && acceptedCount === 0) ||
            (accepted === 'present' && acceptedCount > 0)
          )))
    )
      return undefined;
    const request: RetrievalRequestRow = {
      kind,
      turn,
      iteration,
      accepted,
      committedProviderResponse,
      exposure: row.exposure,
    };
    const provedCount = count(acceptedCount) ? { acceptedCount } : {};
    if (row.sources === undefined) return { ...request, ...provedCount };
    const input = readOwnList(row.sources, MAX_RECALL_SOURCES);
    if (input === undefined || input.unread !== 0) return undefined;
    const sources: RecallSourceSummary[] = [];
    for (const value of input.entries) {
      const source = readSource(value);
      if (source === undefined) return undefined;
      sources.push(source);
    }
    return { ...request, ...provedCount, sources };
  } catch {
    return undefined;
  }
}

export function retrievalRequestWriter(ids: readonly string[], grouped: boolean) {
  const keys = ids.map(memoryRecallOutcomesKey);
  return (
    scope: TypedScope<AgentState>,
    iteration: number,
    request: RecallRequestSummary,
  ): void => {
    const turn = scope.turnNumber;
    if (typeof turn !== 'number' || !Number.isSafeInteger(turn)) return;
    const sources: RecallSourceSummary[] = [];
    for (const key of keys) {
      const outcomes = scope.$getValue(key) as readonly MemoryRecallOutcome[] | undefined;
      if (!Array.isArray(outcomes)) continue;
      for (const outcome of outcomes) {
        if (outcome.turnNumber !== turn || sources.length > MAX_RECALL_SOURCES) continue;
        const { kind, candidateCount, admittedCount, exclusions, complete } = outcome;
        sources.push({
          kind,
          ...(candidateCount === undefined ? {} : { candidateCount }),
          ...(admittedCount === undefined ? {} : { admittedCount }),
          exclusions: { ...exclusions },
          complete,
        });
      }
    }
    const row: RetrievalRequestRow = {
      kind: 'retrieval-request',
      turn,
      iteration,
      ...request,
      ...(sources.length <= MAX_RECALL_SOURCES && { sources }),
    };
    // In a grouped call, the outer findings ledger is a read-only input.
    // Bubble the committed row through the mount's normal findings merge.
    if (grouped) scope.retrievalRequest = row;
    else recordFindings(scope, [row]);
  };
}

export function retrievalFindingsOf(
  child: Readonly<Record<string, unknown>>,
  parent: Readonly<Record<string, unknown>>,
): { findingsLedger?: FindingsRow[] } {
  const row = child.retrievalRequest as RetrievalRequestRow | undefined;
  if (row === undefined) return {};
  const prior = (parent.findingsLedger as readonly FindingsRow[] | undefined) ?? [];
  return { findingsLedger: appendRows(prior, [row]).ledger };
}
