/**
 * Bridge memory recall into the injection-engine model.
 *
 * Each memory's READ subflow writes its formatted recall to the per-id scope key
 * `memoryInjection_<id>` (an array of `{ role, content }`). The slot composers
 * (`buildSystemPromptSlot` / `buildMessagesSlot`) only iterate `activeInjections` —
 * so on the Agent path the recall was read, formatted, and persisted but NEVER
 * composed into the prompt (a dead-end key). This turns those recalls into
 * `ActiveInjection`s so the existing composers inject them: system-role content →
 * the system slot (`inject.systemPrompt`), everything else → the messages slot
 * (`inject.messages`).
 *
 * Only the system-role half reaches the model. The messages slot is an
 * observability projection, not a wire (see `messagesSlotRefusal.ts`), so a
 * non-system recall is composed and recorded but not sent. Every formatter this
 * library ships writes `role: 'system'`, so the branch is unreachable through
 * `defineMemory()`; it can only be entered by a hand-built read subflow mounted
 * with `mountMemoryRead`. It is left as-is rather than silently re-homed into
 * the system slot, which would change what the model sees.
 *
 * ─── One injection PER CHUNK (8.8.0) ───────────────────────────────────
 *
 * A retrieval that put three passages in the prompt used to produce ONE
 * injection, so the recording could say "the recall block went in" and
 * nothing finer. Ablating a single passage was impossible; the context
 * ledger credited the block, not the passage; and `retrievalScore` /
 * `rankPosition` on `ContextInjectedPayload` — declared since 2.x — had
 * nowhere to come from, because one record cannot carry three scores.
 *
 * When the read subflow lifted a retrieval record (`retrievalEvidence_<id>`),
 * this splits the recall into one injection per admitted chunk, keyed by
 * the chunk's own id, carrying that chunk's score and rank.
 *
 * **The prompt does not change by one byte.** The formatter records the
 * exact fragment each chunk contributed (`promptFragment`), header on the
 * first and footer on the last, and `callLLM` assembles the system prompt
 * by joining every record's `rawContent` with `\n\n` — the same separator
 * the formatter joined its blocks with. Splitting and re-joining is the
 * identity function here, and a test pins it.
 *
 * Without a record (conversation memory, hand-built pipelines) the old
 * single-injection path is taken unchanged.
 */
import { memoryInjectionKey, retrievalEvidenceKey } from '../../memory/define.types.js';
import type { MemoryFlavor } from '../../memory/define.types.js';
import type { RetrievalEvidence } from '../../memory/retrieval/index.js';
import type { ContextRole, ContextSource } from '../../events/types.js';
import type { ActiveInjection } from '../../lib/injection-engine/types.js';

interface RecallMessage {
  readonly role: ContextRole;
  readonly content: string;
}

/**
 * What a memory needs to be bridged: its id, and the claim its block is
 * making. A bare string keeps the historical call shape working.
 */
export interface MemoryRecallSource {
  readonly id: string;
  /** `'rag'` composes as `source: 'rag'`; anything else as `'memory'`. */
  readonly flavor?: MemoryFlavor;
}

function normalize(source: string | MemoryRecallSource): MemoryRecallSource {
  return typeof source === 'string' ? { id: source } : source;
}

function sourceOf(flavor: MemoryFlavor | undefined): ContextSource {
  return flavor === 'rag' ? 'rag' : 'memory';
}

/** Build recall ActiveInjections from the per-id recall keys in `parent`. */
export function memoryRecallInjections(
  parent: Record<string, unknown>,
  memories: readonly (string | MemoryRecallSource)[],
): ActiveInjection[] {
  const out: ActiveInjection[] = [];
  for (const entry of memories) {
    const { id, flavor } = normalize(entry);
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

    const perChunk = chunkInjections(parent, id, flavor, systemContent);
    if (perChunk) {
      out.push(...perChunk);
      // A non-system recall alongside a retrieval record is not something
      // any shipped formatter produces; carry it on its own record rather
      // than dropping it.
      if (messages.length > 0) {
        out.push({
          id: `memory:${id}`,
          flavor: sourceOf(flavor),
          description: `recall from memory '${id}'`,
          inject: { messages },
        });
      }
      continue;
    }

    out.push({
      id: `memory:${id}`,
      flavor: sourceOf(flavor),
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
 * One injection per admitted chunk, or `undefined` when this memory left
 * no usable retrieval record.
 *
 * Refuses to split unless the fragments rebuild the recall EXACTLY. A
 * custom formatter, a hand-written `renderEntry`, or a future change to
 * how blocks are joined would silently alter the prompt otherwise — so
 * the guard is an equality check on the assembled bytes, not a version
 * flag. Failing it falls back to the single-injection path, which is
 * always correct and merely coarser.
 */
function chunkInjections(
  parent: Record<string, unknown>,
  id: string,
  flavor: MemoryFlavor | undefined,
  systemContent: string,
): ActiveInjection[] | undefined {
  const evidence = parent[retrievalEvidenceKey(id)] as RetrievalEvidence | undefined;
  const candidates = evidence?.candidates;
  if (!candidates || candidates.length === 0) return undefined;

  // In PROMPT order, not score order. The record is stored best-scoring
  // first; the message was assembled in the budget picker's order. Joining
  // the wrong one reproduces the right bytes in a sequence the model never
  // saw — which the equality check below would catch, but silently, by
  // falling back to one coarse injection for every retrieval.
  const admitted = candidates
    .filter((c) => c.admitted && c.promptFragment !== undefined && c.promptPosition !== undefined)
    .sort((a, b) => (a.promptPosition ?? 0) - (b.promptPosition ?? 0));
  if (admitted.length === 0) return undefined;

  const rebuilt = admitted.map((c) => c.promptFragment ?? '').join('\n\n');
  if (rebuilt !== systemContent) return undefined;

  const source = sourceOf(flavor);
  return admitted.map((c) => ({
    id: `memory:${id}#${c.id}`,
    flavor: source,
    description:
      c.docUri !== undefined
        ? `retrieved '${c.id}' from ${c.docUri} (rank ${c.rank}, score ${c.score.toFixed(2)})`
        : `retrieved '${c.id}' (rank ${c.rank}, score ${c.score.toFixed(2)})`,
    retrieval: {
      score: c.score,
      rank: c.rank,
      ...(evidence?.threshold !== undefined && { threshold: evidence.threshold }),
    },
    inject: { systemPrompt: c.promptFragment ?? '' },
  }));
}

/**
 * Append memory recalls to the active-injection set a slot-fork inputMapper hands to
 * the system / messages slot subflows. No-op when the agent has no memories.
 */
export function withMemoryRecall(
  activeInjections: readonly ActiveInjection[] | undefined,
  parent: Record<string, unknown>,
  memories: readonly (string | MemoryRecallSource)[],
): readonly ActiveInjection[] {
  const base = activeInjections ?? [];
  if (memories.length === 0) return base;
  const recall = memoryRecallInjections(parent, memories);
  return recall.length === 0 ? base : [...base, ...recall];
}
