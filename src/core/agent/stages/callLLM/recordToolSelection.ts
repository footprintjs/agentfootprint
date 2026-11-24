import type { TypedScope } from 'footprintjs';
import { RECEIPT_KEY } from '../../../../lib/conventions.js';
import { jsonBytes } from '../../../../lib/boundedJson.js';
import type { AcceptedToolSelection } from '../../../slots/commitServedTools.js';
import type { ReceiptToolSelection } from '../../receipt/omissions.js';
import type { AgentState } from '../../types.js';

/** The receipt carries visible names, selection decisions and collision channels. Executable tools,
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
  const shadowed: Array<NonNullable<ReceiptToolSelection['shadowed']>[number]> = [];
  const skills: string[] = [];
  const namesByReason = new Map<string, Set<string>>();
  let bounded = false;
  for (const row of proof.rows) {
    const { kind, name } = row;
    if (name.length > 1024 || jsonBytes(name) > 1024) {
      bounded = true;
      continue;
    }
    const names = namesByReason.get(kind);
    if (names?.has(name)) continue;
    if (absent.length + shadowed.length + skills.length === remaining) {
      bounded = true;
      break;
    }
    if (row.kind === 'collision') {
      // The wire merge already deduplicated by implementation. Distinct losers
      // can share the same name and channel, and each consumes one position.
      shadowed.push({ name, wonBy: row.winner.party.channel, lostBy: row.party.channel });
    } else {
      if (names) names.add(name);
      else namesByReason.set(kind, new Set([name]));
      if (row.kind === 'tree-routed') skills.push(name);
      else absent.push({ name, reason: row.kind });
    }
  }
  const retained = absent.length + shadowed.length + skills.length;
  if (!bounded && retained === 0) return;
  scope[RECEIPT_KEY] = {
    ...receipt,
    toolSelection: {
      consumer: proof.consumer,
      absent,
      ...(shadowed.length > 0 && { shadowed }),
      ...(skills.length > 0 && {
        skillCatalog: { names: skills, count: skills.length, reason: 'tree-routed' as const },
      }),
      ...(bounded && { bounded: true }),
    },
  };
  budget.remainingToolOmissions = remaining - retained;
}
