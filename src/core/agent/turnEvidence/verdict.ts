import { isRecord, type RecordedTurn, recordedTurn } from './source.js';
import type { TurnEvidenceSource } from './types.js';

/** A flagged value and the evidence rule that selected it, as served in the record. */
export interface TurnEvidenceItem {
  readonly value: string;
  readonly shape: string;
}

/** The evidence gate's final verdict for the requested run. */
export type TurnEvidenceVerdict =
  | { readonly status: 'clean' }
  | { readonly status: 'disabled' }
  | { readonly status: 'not-checked' }
  | {
      readonly status: 'unsupported';
      /** `null` means the verdict is visible but its list is kept out or unreadable. */
      readonly items: readonly TurnEvidenceItem[] | null;
    };

function readItems(value: unknown): readonly TurnEvidenceItem[] | null {
  if (!Array.isArray(value) || value.length === 0) return null;
  const items: TurnEvidenceItem[] = [];
  for (const item of value as readonly unknown[]) {
    if (!isRecord(item) || typeof item.value !== 'string' || typeof item.shape !== 'string') {
      return null;
    }
    items.push({ value: item.value, shape: item.shape });
  }
  return items;
}

function isIteration(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
}

/**
 * Read the verdict of a finished turn from its served events, in memory or in
 * a saved recording. Use the run ID of the answering leg. The final iteration
 * is on `turn_end`, so this read does not require a retained `llm_start`.
 * `not-checked` means the record does not establish a final verdict. Item
 * fields retain any placeholders already applied by the agent's policy.
 */
export function readTurnEvidenceVerdict(
  source: TurnEvidenceSource,
  runId: string,
): TurnEvidenceVerdict {
  const turn = recordedTurn(source, runId);
  return turn === undefined ? { status: 'not-checked' } : verdictOfRecordedTurn(turn);
}

/** Read the final evidence verdict from an already selected exact turn. */
export function verdictOfRecordedTurn(turn: RecordedTurn): TurnEvidenceVerdict {
  const terminal: unknown = turn.terminal.payload;
  const iteration = isRecord(terminal) ? terminal.iterationCount : undefined;
  if (!isIteration(iteration)) return { status: 'not-checked' };

  let sawCheck = false;
  for (let index = turn.events.length - 1; index >= 0; index--) {
    const event = turn.events[index];
    if (event?.type !== 'agentfootprint.agent.evidence_checked') continue;
    sawCheck = true;
    const payload: unknown = event.payload;
    // An unreadable row may be the final verdict. Do not fall back to a draft.
    if (!isRecord(payload) || !isIteration(payload.iteration)) return { status: 'not-checked' };
    if (payload.iteration !== iteration) continue;
    switch (payload.action) {
      case 'grounded':
        return { status: 'clean' };
      case 'flagged':
      case 'refused':
        return { status: 'unsupported', items: readItems(payload.unsupported) };
      default:
        return { status: 'not-checked' };
    }
  }
  const manifest: unknown = turn.events.find(
    (event) => event.type === 'agentfootprint.agent.run_configured',
  )?.payload;
  if (
    !sawCheck &&
    isRecord(manifest) &&
    typeof manifest.reactMode === 'string' &&
    !Object.hasOwn(manifest, 'evidenceGate')
  ) {
    return { status: 'disabled' };
  }
  return { status: 'not-checked' };
}
