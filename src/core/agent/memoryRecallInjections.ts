/**
 * Bridge memory recall into the injection-engine model.
 *
 * Each memory's READ subflow writes its formatted recall to the per-id scope key
 * `memoryInjection_<id>` (an array of `{ role, content }`). The slot composers
 * (`buildSystemPromptSlot` / `buildMessagesSlot`) only iterate `activeInjections` —
 * so on the Agent path the recall was read, formatted, and persisted but NEVER
 * composed into the prompt (a dead-end key). This turns those recalls into
 * `'memory'`-flavored `ActiveInjection`s so the existing composers inject them:
 * system-role content → the system slot (`inject.systemPrompt`), everything else →
 * the messages slot (`inject.messages`).
 */
import { memoryInjectionKey } from '../../memory/define.types.js';
import type { ContextRole } from '../../events/types.js';
import type { ActiveInjection } from '../../lib/injection-engine/types.js';

interface RecallMessage {
  readonly role: ContextRole;
  readonly content: string;
}

/** Build `'memory'`-flavored ActiveInjections from the per-id recall keys in `parent`. */
export function memoryRecallInjections(
  parent: Record<string, unknown>,
  memoryIds: readonly string[],
): ActiveInjection[] {
  const out: ActiveInjection[] = [];
  for (const id of memoryIds) {
    const recall = parent[memoryInjectionKey(id)];
    if (!Array.isArray(recall) || recall.length === 0) continue;
    const msgs = recall as readonly RecallMessage[];
    const systemContent = msgs
      .filter((m) => m.role === 'system')
      .map((m) => m.content)
      .join('\n\n');
    const messages = msgs
      .filter((m) => m.role !== 'system')
      .map((m) => ({ role: m.role, content: m.content }));
    if (!systemContent && messages.length === 0) continue;
    out.push({
      id: `memory:${id}`,
      flavor: 'memory',
      description: `recall from memory '${id}'`,
      inject: {
        ...(systemContent ? { systemPrompt: systemContent } : {}),
        ...(messages.length > 0 ? { messages } : {}),
      },
    });
  }
  return out;
}

/**
 * Append memory recalls to the active-injection set a slot-fork inputMapper hands to
 * the system / messages slot subflows. No-op when the agent has no memories.
 */
export function withMemoryRecall(
  activeInjections: readonly ActiveInjection[] | undefined,
  parent: Record<string, unknown>,
  memoryIds: readonly string[],
): readonly ActiveInjection[] {
  const base = activeInjections ?? [];
  if (memoryIds.length === 0) return base;
  const recall = memoryRecallInjections(parent, memoryIds);
  return recall.length === 0 ? base : [...base, ...recall];
}
