/**
 * skillTarget — the ONE spelling of "which skill is this check about" (9.11.0).
 *
 * Pattern: a named convention with a single owner, so the producer (the agent's
 *          dispatch loop and its `read_skill` menu) and the consumers (any
 *          `PermissionChecker`, `PermissionPolicy` first among them) cannot
 *          drift about what a `PermissionRequest.target` means.
 * Role:    shared by `agentfootprint/security` and the tool-dispatch stage.
 * Emits:   N/A.
 *
 * ── Why a prefix at all ──────────────────────────────────────────────────────
 * A permission target is a plain string, and until 9.11.0 every one of them was
 * a TOOL NAME. A skill id is a different kind of subject: an agent may perfectly
 * well have a tool called `refunds` and a skill called `refunds`, and a role
 * allowlist that lists `'refunds'` must not accidentally grant both. The prefix
 * makes the two different subjects, which is what they are.
 *
 * It is deliberately not a second field on the request: a checker that has never
 * heard of skills should read `target` and see something it does not recognise,
 * rather than see a familiar-looking name and answer the wrong question.
 */

/** The prefix every skill-activation target carries. */
export const SKILL_TARGET_PREFIX = 'skill:';

/** The `PermissionRequest.target` for activating skill `id`. */
export function skillTarget(id: string): string {
  return `${SKILL_TARGET_PREFIX}${id}`;
}

/**
 * The skill id inside a target, for a checker that wants the bare id.
 *
 * Tolerates a bare id (returns it unchanged) so a policy written against either
 * spelling behaves the same — the prefix is a disambiguator, not a password.
 */
export function skillIdFromTarget(target: string): string {
  return target.startsWith(SKILL_TARGET_PREFIX) ? target.slice(SKILL_TARGET_PREFIX.length) : target;
}
