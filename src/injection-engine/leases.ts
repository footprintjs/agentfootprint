/**
 * leases — the accepted transition proposal and the instruction leases a
 * tool's `require-instruction` effect grants, as scope state, and the three
 * pure functions over them (`tenantOf`, `activeLeaseIds`, `pruneLeases`).
 *
 * The effect GRAMMAR — the envelope, its two effect kinds, the delivery-lease
 * words — is `semantics/toolEffects.ts`. What a granted lease MEANS across
 * iterations is an injection concept: the injection engine's Evaluate stage
 * serves and sweeps them, and the tool-calls stage appends new grants, so the
 * carriers live here, beside their one reader.
 */

import type { InstructionDeliveryLease } from '../semantics/toolEffects.js';

// ─── The accepted-proposal + lease carriers (scope state shapes) ────────

/**
 * The transition proposal the tool-calls stage ACCEPTED this iteration —
 * validated (graph mounted, target reachable), first-accepted-wins across
 * the batch. One-shot BY DATA, not by clearing writes: it is stamped with
 * the iteration that granted it, and the Evaluate stage honors it exactly
 * once — on the following iteration — so nothing ever has to write the key
 * back to undefined (zero-cost stays zero for agents that never see one).
 */
export interface PendingToolTransition {
  readonly targetSkillId: string;
  /** The proposing tool — provenance for the record. */
  readonly toolName: string;
  readonly toolCallId?: string;
  /** The effect's own declared reason. */
  readonly reason: string;
  /** The ReAct iteration whose batch granted it (valid for iteration + 1). */
  readonly iteration: number;
}

/**
 * One granted `require-instruction` lease. Validity is COMPUTED, never
 * mutated: `'next-call'` serves exactly the Evaluate pass of
 * `iteration + 1`; `'until-skill-exit'` serves every pass while the tenant
 * that granted it (`skillId`) still holds the tenure.
 *
 * Death is PERMANENT, and the Evaluate tenure sweep is what makes it so:
 * `skillId === tenant` alone cannot tell "still holding the tenure" from
 * "re-entered the skill later" (a cyclic graph makes both real), so the
 * Evaluate stage prunes dead leases on EVERY pass — the same pass a tenure
 * ends, the leases it granted leave the record, and a cursor that comes back
 * finds nothing to resurrect. The tool-calls stage also prunes when it
 * appends a new grant (keeps mid-batch arrays tight), but the sweep is the
 * law's owner: it runs whether or not anything new was granted.
 */
export interface InstructionLease {
  readonly instructionId: string;
  readonly deliveryLease: InstructionDeliveryLease;
  /** The tenure that granted it (advanced cursor, else the activation tail);
   *  absent when no tenant existed at grant. `'until-skill-exit'` compares
   *  the CURRENT tenant against this — both-undefined still matches. */
  readonly skillId?: string;
  /** The granting tool — provenance for the record. */
  readonly toolName: string;
  readonly toolCallId?: string;
  /** The ReAct iteration whose batch granted it. */
  readonly iteration: number;
}

/** Who holds the tenure — the advanced cursor on graph agents, else the tail
 *  of `activatedInjectionIds` (the shipped `activeSkillId` notion the step
 *  pointer's re-key already uses). */
export function tenantOf(
  cursor: string | undefined,
  activatedInjectionIds: readonly string[] | undefined,
): string | undefined {
  if (cursor !== undefined) return cursor;
  const activated = activatedInjectionIds ?? [];
  return activated[activated.length - 1];
}

/**
 * The lease-served injection ids for ONE Evaluate pass — pure. `iteration`
 * is the pass being composed; `tenant` is who holds the tenure on it (the
 * ADVANCED cursor — a lease dies the same pass its tenure ends).
 *
 * `skillId === tenant` is a sound "tenure still holds" test ONLY because the
 * Evaluate tenure sweep (`pruneLeases`, every pass) removes a dead lease the
 * pass its tenure ends — so a cursor that re-enters the granting skill later
 * finds nothing to match, instead of resurrecting an ended grant.
 */
export function activeLeaseIds(
  leases: readonly InstructionLease[] | undefined,
  iteration: number,
  tenant: string | undefined,
): readonly string[] {
  if (leases === undefined || leases.length === 0) return [];
  const ids: string[] = [];
  for (const lease of leases) {
    const live =
      lease.deliveryLease === 'next-call'
        ? lease.iteration + 1 === iteration
        : lease.skillId === tenant;
    if (live && !ids.includes(lease.instructionId)) ids.push(lease.instructionId);
  }
  return ids;
}

/**
 * Drop leases that can never serve again. `iteration` is the CURRENT pass;
 * a `'next-call'` lease older than the previous iteration is spent, and an
 * `'until-skill-exit'` lease whose tenant is no longer current is dead.
 *
 * TWO call sites, one law. The Evaluate stage sweeps on EVERY pass (writing
 * the survivors under `nextInstructionLeases`, the cursor's alias round
 * trip) — that sweep is what makes death permanent: it records the death the
 * same pass the tenure ends, before any later pass could see the cursor
 * re-enter the granting skill and mistake re-entry for an unbroken tenure.
 * The tool-calls stage also prunes when it appends a new grant, so a
 * mid-batch array never carries spent leases into the commit.
 */
export function pruneLeases(
  leases: readonly InstructionLease[] | undefined,
  iteration: number,
  currentTenant: string | undefined,
): readonly InstructionLease[] {
  if (leases === undefined || leases.length === 0) return [];
  return leases.filter((lease) =>
    lease.deliveryLease === 'next-call'
      ? lease.iteration + 1 > iteration
      : lease.skillId === currentTenant,
  );
}
