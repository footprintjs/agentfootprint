import type { TypedScope } from 'footprintjs';
import { RECEIPT_KEY } from '../../../../lib/conventions.js';
import { jsonBytes } from '../../../../lib/boundedJson.js';
import type { AcceptedToolSelection } from '../../../slots/commitServedTools.js';
import type { ReceiptToolSelection } from '../../receipt/omissions.js';
import type { AgentState } from '../../types.js';

/** The receipt carries only a visible name and the original decision. Executable tools,
 * party IDs and schemas remain private. A missing turn budget cannot start a new budget. */
export function recordToolSelection(
  scope: TypedScope<AgentState>,
  proof: AcceptedToolSelection,
  budget: { remainingToolOmissions?: number },
): void {
  const remaining = budget.remainingToolOmissions;
  if (remaining === undefined) return;
  const receipt = scope[RECEIPT_KEY];
  if (receipt?.basis.epoch !== proof.iteration) return;
  const absent: Array<ReceiptToolSelection['absent'][number]> = [];
  const namesByReason = new Map<string, Set<string>>();
  let bounded = false;
  for (const { kind, name } of proof.rows) {
    if (kind === 'collision') continue;
    if (name.length > 1024 || jsonBytes(name) > 1024) {
      bounded = true;
      continue;
    }
    const names = namesByReason.get(kind) ?? new Set<string>();
    if (names.has(name)) continue;
    if (absent.length === remaining) {
      bounded = true;
      break;
    }
    names.add(name);
    namesByReason.set(kind, names);
    absent.push({ name, reason: kind });
  }
  if (!bounded && absent.length === 0) return;
  scope[RECEIPT_KEY] = {
    ...receipt,
    toolSelection: { consumer: proof.consumer, absent, ...(bounded && { bounded: true }) },
  };
  budget.remainingToolOmissions = remaining - absent.length;
}
