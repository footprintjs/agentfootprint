import type { LedgerOmission, ObserveSelection } from '../../tools/selectionListing.js';
import type { Tool } from '../../tools/tools.js';
import type { ToolClaim } from '../agent/buildToolRegistry.js';

interface SkillOmission {
  readonly kind: 'skill-scope';
  readonly skillId: string;
  /** The name this skill registered for this implementation. */
  readonly name: string;
  readonly tool: Tool;
}

export const MAX_SELECTION_ROWS = 1024;

type Omission = LedgerOmission | SkillOmission;

export interface DiscoveryOmissions {
  readonly rows: readonly Omission[];
  readonly complete: boolean;
}

/** Private to one listing. Discard the collector unless discovery succeeds. */
export function providerOmissions(
  claimants: ReadonlyMap<string, readonly ToolClaim[]>,
  hiddenSkillIds: readonly string[] | undefined,
) {
  const hidden = hiddenSkillIds && new Set(hiddenSkillIds);
  const rows: Omission[] = [];
  const seen = new Map<string | undefined, Map<Tool, Set<string>>>();
  let complete = true;

  function retain(row: Omission) {
    const scope = row.kind === 'skill-scope' ? row.skillId : undefined;
    const tools = seen.get(scope) ?? new Map<Tool, Set<string>>();
    const names = tools.get(row.tool);
    if (names?.has(row.name)) return;
    if (rows.length >= MAX_SELECTION_ROWS) {
      complete = false;
      return;
    }
    if (names) names.add(row.name);
    else tools.set(row.tool, new Set([row.name]));
    seen.set(scope, tools);
    rows.push(row);
  }

  const observe: ObserveSelection = (decision) => {
    if (!complete) return;
    if (decision.kind === 'skill-scope') {
      if (!hidden || hidden.has(decision.skillId) || !decision.tools.length) return;
      // The provider did not inspect its inactive tools. Use only an unambiguous
      // build-time claim for the exact reference and skill. Never call a schema getter here.
      const declared = new Map<Tool, string | null>();
      for (const [name, claims] of claimants) {
        for (const claim of claims) {
          if (claim.channel !== 'skill' || claim.id !== decision.skillId) continue;
          if (declared.has(claim.tool) && declared.get(claim.tool) !== name)
            declared.set(claim.tool, null);
          else declared.set(claim.tool, name);
        }
      }
      if (!declared.size) return;
      for (const tool of decision.tools) {
        const name = declared.get(tool);
        if (typeof name === 'string')
          retain({ kind: 'skill-scope', skillId: decision.skillId, name, tool });
        if (!complete) break;
      }
      return;
    }
    // The registered ledger observed this actual tool in its incoming provider list.
    // For skill-owned names also require a visible claim on THIS implementation.
    if (!visibleToolClaim(claimants.get(decision.name), decision.tool, hidden)) return;
    retain(decision);
  };

  return {
    observe,
    result(): DiscoveryOmissions | undefined {
      return rows.length ? { rows, complete } : undefined;
    },
  };
}

/** A skill-owned name requires a visible claim on the actual implementation. */
export function visibleToolClaim(
  claims: readonly ToolClaim[] | undefined,
  tool: Tool,
  hidden: ReadonlySet<string> | undefined,
): boolean {
  return (
    !claims?.some((claim) => claim.channel === 'skill') ||
    claims.some(
      (claim) =>
        claim.tool === tool &&
        (claim.channel !== 'skill' ||
          (claim.id !== undefined && hidden !== undefined && !hidden.has(claim.id))),
    )
  );
}
