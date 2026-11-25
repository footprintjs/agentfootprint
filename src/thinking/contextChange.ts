/**
 * The named refusal a bound model's tool turn gets when its context changed
 * under its signed reasoning (`ContextChangedError`), and the one sentence
 * that names each change.
 *
 * Raised by the agent BEFORE the request is sent, so the adapter's own guard
 * (`UnsafeThinkingReplayError`, `prefix-changed`) is never the first thing a
 * caller reads. The message names the slot and the injection or tool by its
 * id — never a value the request carried.
 */
import type { ContextChange } from '../events/payloads/contextChange.js';

export type { ContextChange } from '../events/payloads/contextChange.js';

const PARTY: Record<string, string> = {
  skill: 'skill',
  provider: 'tool provider',
};

function partyLabel(party: ContextChange['party']): string | undefined {
  if (party === undefined) return undefined;
  if (party.channel === 'registry') return "the agent's own tools";
  if (party.channel === 'framework') return 'the library';
  const kind = PARTY[party.channel] ?? party.channel;
  return party.id === undefined ? kind : `${kind} '${party.id}'`;
}

/** One change in plain words: `skill 'smb-triage' was added to the system prompt`. */
export function describeContextChange(change: ContextChange): string {
  if (change.slot === 'system-prompt') {
    const piece =
      change.source === undefined
        ? 'a system prompt piece'
        : change.id === undefined
        ? `the ${change.source} piece`
        : `${change.source} '${change.id}'`;
    if (change.change === 'added') return `${piece} was added to the system prompt`;
    if (change.change === 'removed') return `${piece} was removed from the system prompt`;
    return change.source === undefined
      ? 'the system prompt changed'
      : `${piece} changed in the system prompt`;
  }
  if (change.slot === 'tools') {
    const by = partyLabel(change.party);
    const from = by === undefined ? '' : ` (from ${by})`;
    if (change.change === 'added') return `tool '${change.tool}' was added${from}`;
    if (change.change === 'removed') return `tool '${change.tool}' was removed${from}`;
    return `tool '${change.tool}' changed its description or schema${from}`;
  }
  const where = `message ${change.position ?? '?'}${
    change.role === undefined ? '' : ` (${change.role})`
  }`;
  return change.change === 'removed' ? `${where} was left out` : `${where} changed`;
}

/**
 * A tool turn on a model that binds its reasoning to the context it was
 * written under changed that context, so the request was not sent.
 *
 * The API would refuse the replayed reasoning (or drop it); the agent refuses
 * first and says which change did it. `changes` names each one (slot, id,
 * tool), never a value. Not retryable: the same turn fails the same way.
 *
 * @example
 * ```ts
 * try {
 *   await agent.run({ message });
 * } catch (error) {
 *   if (error instanceof ContextChangedError) console.log(error.changes);
 * }
 * ```
 */
export class ContextChangedError extends Error {
  readonly code = 'CONTEXT_CHANGED_IN_TURN';
  readonly retryable = false;
  readonly changes: readonly ContextChange[];
  constructor(
    readonly provider: string,
    readonly model: string,
    /** Position of the signed reasoning's message in the request. */
    readonly messageIndex: number,
    changes: readonly ContextChange[],
    /** Changes beyond the named ones, counted. */
    readonly omittedChanges = 0,
  ) {
    const named = changes.map(describeContextChange).join('; ');
    const more = omittedChanges > 0 ? `; and ${omittedChanges} more` : '';
    super(
      `Refused before sending: ${model} binds its reasoning to the context it was written ` +
        `under, and this tool turn changed that context: ${named}${more}. ` +
        'Keep the system prompt, tool list and earlier messages fixed until the turn ends.',
    );
    this.name = 'ContextChangedError';
    this.changes = Object.freeze(changes.map((c) => Object.freeze({ ...c })));
  }
}
