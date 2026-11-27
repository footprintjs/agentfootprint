import { awaitUnder, throwIfAborted } from '../lib/abort.js';
import { readPermissionDecision } from '../provider-contract/permissionDecision.js';
import type { PermissionChecker, PermissionRequest } from '../provider-contract/types.js';
import { skillTarget } from './skillTarget.js';

/** Read the same role question for a trusted skill catalog at an admission boundary. */
export async function hiddenSkillIdsFor(
  checker: PermissionChecker,
  ids: Iterable<string>,
  identity: PermissionRequest['identity'],
  signal?: AbortSignal,
): Promise<readonly string[]> {
  const hidden: string[] = [];
  for (const id of ids) {
    throwIfAborted(signal);
    let allowed = false;
    try {
      const decision = await awaitUnder(signal, () =>
        checker.check({
          capability: 'skill_read',
          actor: 'agent',
          target: skillTarget(id),
          ...(identity !== undefined && { identity: { ...identity } }),
          ...(signal !== undefined && { signal }),
        }),
      );
      allowed = readPermissionDecision(decision).kind === 'allow';
    } catch {
      // An unanswered policy cannot admit an entry. Cancellation still owns the run.
      throwIfAborted(signal);
    }
    if (!allowed) hidden.push(id);
  }
  throwIfAborted(signal);
  return hidden;
}
