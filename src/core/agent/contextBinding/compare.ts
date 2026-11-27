/**
 * The named differences between a baseline and the request being prepared.
 * Pure: the same two inputs always give the same list, in the same order
 * (system prompt, then tools, then messages).
 */
import type { ContextChange } from '../../../events/payloads/contextChange.js';
import type { ContextBaseline, MessageEntry, PieceEntry, ToolEntry } from './composition.js';
import { boundName } from '../../../thinking/contextChange.js';
import { isSaidByPerson } from '../../../lib/saidByPerson.js';
import { skillBodyOrigin } from '../../../injection-engine/skillBodyEvidence.js';
import type { LLMMessage } from '../../../provider-contract/types.js';

/** Names on the record are bounded too: ids from the app, tool names from servers. */
const NAME = 128;

function pieceChange(piece: PieceEntry, change: ContextChange['change']): ContextChange {
  return {
    slot: 'system-prompt',
    change,
    source: piece.source,
    ...(piece.id !== undefined && { id: boundName(piece.id, NAME) }),
  };
}

/** The newest produced body in this turn owns the attribution. A later
 * window rewrite can remove delivered bytes but cannot change that origin. */
function changedSkillResults(
  added: readonly PieceEntry[],
  history: readonly LLMMessage[] | undefined,
): ReadonlySet<string> {
  const changed = new Set<string>();
  if (history === undefined) return changed;
  const open = new Set(
    added.flatMap((piece) => (piece.source === 'skill' && piece.id ? [piece.id] : [])),
  );
  for (let index = history.length - 1; index >= 0 && open.size > 0; index -= 1) {
    const message = history[index];
    if (isSaidByPerson(message)) break;
    const origin = skillBodyOrigin(message);
    if (origin === undefined || !open.delete(origin.skillId)) continue;
    if (
      origin.span === undefined &&
      (message.toolResultDisposition === 'rewritten' ||
        message.toolResultDisposition === 'withheld')
    )
      changed.add(origin.skillId);
  }
  return changed;
}

function systemChanges(
  base: ContextBaseline,
  pieces: readonly PieceEntry[],
  text: string,
  skillHistory?: readonly LLMMessage[],
): ContextChange[] {
  const now = new Map(pieces.map((p) => [p.key, p]));
  const before = new Map(base.system.map((p) => [p.key, p]));
  const changes: ContextChange[] = [];
  for (const piece of base.system) {
    const current = now.get(piece.key);
    if (current === undefined) changes.push(pieceChange(piece, 'removed'));
    else if (current.hash !== piece.hash) changes.push(pieceChange(current, 'changed'));
  }
  const added = pieces.filter((piece) => !before.has(piece.key));
  const changedResults = changedSkillResults(added, skillHistory);
  for (const piece of added) {
    const change = pieceChange(piece, 'added');
    changes.push(
      piece.source === 'skill' && piece.id !== undefined && changedResults.has(piece.id)
        ? { ...change, cause: 'read-skill-result-middleware' }
        : change,
    );
  }
  // Same pieces, different prompt: the join or the order moved.
  if (changes.length === 0 && text !== base.systemText)
    changes.push({ slot: 'system-prompt', change: 'changed' });
  return changes;
}

function toolChange(tool: ToolEntry, change: ContextChange['change']): ContextChange {
  return {
    slot: 'tools',
    change,
    tool: boundName(tool.name, NAME),
    ...(tool.party !== undefined && {
      party: {
        channel: tool.party.channel,
        ...(tool.party.id !== undefined && { id: boundName(tool.party.id, NAME) }),
      },
    }),
  };
}

function toolChanges(base: ContextBaseline, tools: readonly ToolEntry[]): ContextChange[] {
  // Compared as a name-keyed set: a reorder is not a change.
  const now = new Map(tools.map((t) => [t.name, t]));
  const before = new Map(base.tools.map((t) => [t.name, t]));
  const changes: ContextChange[] = [];
  for (const tool of base.tools) {
    const current = now.get(tool.name);
    if (current === undefined) changes.push(toolChange(tool, 'removed'));
    else if (current.hash !== tool.hash) changes.push(toolChange(current, 'changed'));
  }
  for (const tool of tools) if (!before.has(tool.name)) changes.push(toolChange(tool, 'added'));
  return changes;
}

/** The messages the reasoning was written after must open the request unchanged. */
function messageChanges(base: ContextBaseline, messages: readonly MessageEntry[]): ContextChange[] {
  const changes: ContextChange[] = [];
  base.messages.forEach((entry, position) => {
    const current = messages[position];
    if (current === undefined)
      changes.push({ slot: 'messages', change: 'removed', position, role: entry.role });
    else if (current.hash !== entry.hash)
      changes.push({ slot: 'messages', change: 'changed', position, role: current.role });
  });
  return changes;
}

export function contextChanges(
  base: ContextBaseline,
  current: {
    readonly systemText: string;
    readonly system: readonly PieceEntry[];
    readonly skillHistory?: readonly LLMMessage[];
    readonly tools: readonly ToolEntry[];
    readonly messages: readonly MessageEntry[];
  },
): ContextChange[] {
  return [
    ...systemChanges(base, current.system, current.systemText, current.skillHistory),
    ...toolChanges(base, current.tools),
    ...messageChanges(base, current.messages),
  ];
}
