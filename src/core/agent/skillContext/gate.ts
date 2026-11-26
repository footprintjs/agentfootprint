/**
 * The call gate `listed` needs. Every scoped skill tool is on the tool list
 * from the first request, so the list no longer says which skill is loaded;
 * the gate still does. A call to a scoped tool, served under a skill's claim,
 * while none of the skills that declare it is ACTIVE (the set the Injection
 * Engine evaluated for this iteration, which a graph's cursor activation is
 * part of — never `activeSkillId`, which only `read_skill` writes) is refused
 * with fixed words and the tool does not run. The words name the skill and the
 * next step, never the call's arguments.
 *
 * Under `declared` such a call ran off the wire, unlisted; that is the
 * behaviour change `listed` makes, and only there.
 */
import type { ActiveInjection } from '../../../injection-engine/types.js';
import type { ToolParty } from '../../../tools/toolParty.js';

/** What the model reads back for a refused early call. */
export function notLoadedRefusal(toolName: string, skillId: string | undefined): string {
  return skillId === undefined
    ? `Tool '${toolName}' did not run: the skill it belongs to was not loaded on that call.`
    : `Tool '${toolName}' did not run: it belongs to skill '${skillId}', which was not loaded ` +
        `on that call; a read_skill call with id '${skillId}' loads it.`;
}

/**
 * The refusal for this call, or `undefined` when it may run.
 *
 * @example
 *   notLoadedFor(scoped, 'share_report', { channel: 'skill', id: 'smb-triage' }, [], []);
 *   // "Tool 'share_report' did not run: it belongs to skill 'smb-triage', …"
 */
export function notLoadedFor(
  listed: ReadonlyMap<string, readonly string[]> | undefined,
  toolName: string,
  party: ToolParty | undefined,
  active: readonly ActiveInjection[] | undefined,
  hidden: readonly string[] | undefined,
): string | undefined {
  const owners = listed?.get(toolName);
  if (owners === undefined || party?.channel !== 'skill') return undefined;
  const loaded = new Set((active ?? []).filter((i) => i.flavor === 'skill').map((i) => i.id));
  if (owners.some((id) => loaded.has(id))) return undefined;
  const hiddenIds = new Set(hidden ?? []);
  return notLoadedRefusal(
    toolName,
    owners.find((id) => !hiddenIds.has(id)),
  );
}
