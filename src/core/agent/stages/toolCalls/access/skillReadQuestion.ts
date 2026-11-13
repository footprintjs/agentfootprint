import { checkerGoverns, type PermissionChecker } from '../../../../../provider-contract/types.js';
import { skillTarget } from '../../../../../security/skillTarget.js';
import { atMountedCursor } from '../helpers/mountedCursor.js';
import type { buildCapabilityQuestion } from './capabilityQuestion.js';

/** What the skill-read question needs to know about the call and the run. */
export interface SkillReadFacts {
  /** The call's tool name — only `read_skill` is asked. */
  readonly toolName: string;
  /** The arguments that will run (after any rewrite and the schema check). */
  readonly args: Readonly<Record<string, unknown>>;
  /** The skill the cursor stands on — read only when the question is asked (a scope read is recorded). */
  readonly currentSkillId: () => unknown;
  /** The parked skills (`contracts/operations/catalog.ts` · `parkedNow`) — read only when asked. */
  readonly parked: () => ReadonlySet<string> | undefined;
}

/**
 * ── Skill-activation gate (9.11.0) ─────────────────────────────────────
 * `read_skill` activating a skill the policy hides for this role. The menu
 * the model reads was already filtered (the Tools slot asks the same checker
 * the same question), so this is the second half of one rule rather than a
 * second rule: a model that guessed a hidden id, or remembered one from an
 * earlier turn, reads the policy's own message.
 *
 * ONE owner for the model's call (`execution/dispatchCall.ts`) and a call one
 * tool makes through another (`innerCallGates.ts`): a composing tool that
 * calls `read_skill` with a hidden id is asked the same question, and a
 * `surfaceMode: 'tool-only'` skill's body never reaches the model through it.
 *
 * Ordered by both callers AFTER the schema check, so the id judged is the one
 * that will actually run — a middleware may have rewritten it — and BEFORE
 * check-in, credentials and execute, so a refused skill's body is never even
 * computed (`surfaceMode: 'tool-only'` returns it from `execute`). Off
 * entirely unless the checker declares it governs `'skill_read'`.
 *
 * ── A SELF-CALL AT A MOUNTED CURSOR EXERCISES NO CAPABILITY ─────────────
 * (9.86.0.) A MOUNTED cursor's own skill is already served: its body is in
 * that call's system prompt and its tools are on that call's wire. Asking to
 * read it activates nothing, moves nothing, and reveals nothing the request
 * did not already carry — so there is no capability here for a policy to
 * grant or deny, and denying it told the model its current skill was "not
 * available in this context" while it was standing in it. The gate's
 * self-call arm answers instead.
 *
 * A PARKED cursor is the one case where the same id is not a no-op, and the
 * skip is scoped to exclude it (9.86.0 fix pass): parking suppressed the map's
 * contribution, so the dispatch gate reads that call as a RE-ENGAGEMENT and
 * serves the body and tools again on the next pass. That moves something, so
 * the policy keeps the question. `atMountedCursor` is where that rule lives.
 * Every OTHER id still goes through the policy, unchanged.
 *
 * Example: a checker governing `skill_read` that denies `skill:secret` is
 * asked `askCapability('skill_read', 'skill:secret', …)` for
 * `read_skill({ id: 'secret' })`, from the model or from a composing tool.
 */
export async function askSkillRead(
  askCapability: ReturnType<typeof buildCapabilityQuestion>,
  permissionChecker: PermissionChecker | undefined,
  facts: SkillReadFacts,
): Promise<void> {
  if (facts.toolName !== 'read_skill' || !checkerGoverns(permissionChecker, 'skill_read')) return;
  const requestedSkillId = (facts.args as { id?: unknown }).id;
  if (typeof requestedSkillId !== 'string' || requestedSkillId.length === 0) return;
  const cursor = facts.currentSkillId();
  const stay = atMountedCursor({
    ...(typeof cursor === 'string' && { cursor }),
    target: requestedSkillId,
    parked: facts.parked(),
  });
  if (stay) return;
  await askCapability(
    'skill_read',
    skillTarget(requestedSkillId),
    `Skill '${requestedSkillId}' is not available in this context.`,
  );
}
