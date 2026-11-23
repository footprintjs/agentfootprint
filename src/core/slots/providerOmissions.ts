import type { Tool } from '../../tools/tools.js';
import type { LedgerOmission } from '../../tools/ledgerListing.js';
import type { ToolClaim } from '../agent/buildToolRegistry.js';

export interface DiscoveryOmissions {
  readonly rows: readonly LedgerOmission[];
  readonly complete: boolean;
}

/** Private to one listing. Discard the collector unless discovery succeeds. */
export function providerOmissions(
  claimants: ReadonlyMap<string, readonly ToolClaim[]>,
  hiddenSkillIds: readonly string[] | undefined,
) {
  const hidden = hiddenSkillIds && new Set(hiddenSkillIds);
  const rows: LedgerOmission[] = [];
  const seen = new Map<Tool, Set<string>>();
  let complete = true;
  return {
    observe(candidate: LedgerOmission): void {
      if (!complete) return;
      // The registered ledger observed this actual tool in its incoming provider list.
      // For skill-owned names also require a visible claim on THIS implementation.
      const claims = claimants.get(candidate.name);
      if (
        claims?.some((c) => c.channel === 'skill') &&
        !claims.some(
          (c) =>
            c.tool === candidate.tool &&
            (c.channel !== 'skill' ||
              (c.id !== undefined && hidden !== undefined && !hidden.has(c.id))),
        )
      )
        return;
      const names = seen.get(candidate.tool);
      if (names?.has(candidate.name)) return;
      if (rows.length >= 1024) {
        complete = false;
        return;
      }
      if (names) names.add(candidate.name);
      else seen.set(candidate.tool, new Set([candidate.name]));
      rows.push(candidate);
    },
    result(): DiscoveryOmissions | undefined {
      return rows.length ? { rows, complete } : undefined;
    },
  };
}
