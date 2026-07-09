/**
 * attributeChoice — which context UNIT best explains one tool choice
 * (the transpose of `scoreMargin`).
 *
 * `scoreMargin` fixes the context and ranks candidate tools against it —
 * so a CONSTANT part of the context (the system prompt, identical on every
 * call) is excluded, because it adds no power to tell one call apart from
 * another. But that exclusion also makes procedural picks unexplainable:
 * the agent calls `whats_here` because a RULE in the system prompt says
 * "orient first", and margin scoring can never see that rule.
 *
 * `attributeChoice` fixes the CHOSEN TOOL and ranks the context units
 * against it. Here a constant-but-load-bearing rule is exactly what we
 * want surfaced: cosine(tool, "call whats_here first") is high and
 * specific, so the answer becomes a citation — "picked because rule-1".
 * The units are tagged by channel (`'system' | 'task' | 'result' | …`) so
 * the result also reports HOW procedural vs topical the pick was.
 *
 * Pattern: pure async function, embedder-injected. No agent/runtime
 *          imports — `src/lib/influence-core/` leaf, same as `scoreMargin`.
 *
 * Honest claim (RFC-002 §2): `score` is embedding geometry between the
 * tool text and each instruction unit — a PROXY for which instruction the
 * pick ALIGNS with, never proof the model used that rule. This is Tier 1
 * (similarity); Tier 3 (counterfactual ablation of each unit) is the
 * ground truth that would validate it.
 */
import { cosineSimilarity } from '../../memory/embedding/cosine.js';
import type { ChoiceAttribution, AttributionUnit, Embedder, UnitScore } from './types.js';

export interface AttributeChoiceArgs {
  /**
   * The chosen tool being explained. `text` is what gets embedded — pass
   * name + description (the name matters: rules that NAME a tool, e.g.
   * "call report_gap", are its strongest citation).
   */
  readonly tool: { readonly name: string; readonly text: string };
  /** The context units to attribute to — the system-prompt rules, the task, … */
  readonly units: readonly AttributionUnit[];
  /** Injected embedder. Wrap in an `EmbeddingCache` so rule texts embed once. */
  readonly embedder: Embedder;
  /** Abort signal threaded to the embedder (network backends). */
  readonly signal?: AbortSignal;
}

/**
 * Embed the tool text and every unit once (deduplicated batch), rank the
 * units by cosine to the tool, and report the top unit plus the per-channel
 * share of positive similarity mass.
 *
 * Fail-loud validation: empty units or duplicate unit ids throw — those are
 * caller wiring bugs, not runtime conditions.
 */
export async function attributeChoice(args: AttributeChoiceArgs): Promise<ChoiceAttribution> {
  const { tool, units, embedder } = args;
  validate(units);

  // One deduplicated embedding pass: the tool text + each distinct unit text.
  const distinct = [...new Set([tool.text, ...units.map((u) => u.text)])];
  const vectors = embedder.embedBatch
    ? await embedder.embedBatch({
        texts: distinct,
        ...(args.signal ? { signal: args.signal } : {}),
      })
    : await sequentialEmbed(embedder, distinct, args.signal);
  const vectorByText = new Map<string, readonly number[]>();
  for (let i = 0; i < distinct.length; i++) vectorByText.set(distinct[i], vectors[i]);

  const toolVec = vectorByText.get(tool.text) as readonly number[];
  const scored: UnitScore[] = units.map((u) => ({
    id: u.id,
    channel: u.channel,
    score: cosineSimilarity(toolVec, vectorByText.get(u.text) as readonly number[]),
  }));
  // Stable sort — ties keep input order.
  scored.sort((a, b) => b.score - a.score);

  // Per-channel share of POSITIVE mass (negatives are anti-alignment, not
  // evidence FOR a channel — clamp to 0 so they neither add nor subtract).
  const positiveByChannel: Record<string, number> = {};
  let total = 0;
  for (const s of scored) {
    const w = Math.max(0, s.score);
    if (w === 0) continue;
    positiveByChannel[s.channel] = (positiveByChannel[s.channel] ?? 0) + w;
    total += w;
  }
  const byChannel: Record<string, number> = {};
  if (total > 0) for (const [ch, w] of Object.entries(positiveByChannel)) byChannel[ch] = w / total;

  return { tool: tool.name, units: scored, top: scored[0], byChannel };
}

async function sequentialEmbed(
  embedder: Embedder,
  texts: readonly string[],
  signal?: AbortSignal,
): Promise<number[][]> {
  const out: number[][] = [];
  for (const text of texts) out.push(await embedder.embed({ text, ...(signal ? { signal } : {}) }));
  return out;
}

function validate(units: readonly AttributionUnit[]): void {
  if (units.length === 0) {
    throw new Error('attributeChoice: units must be non-empty — nothing to attribute to');
  }
  const ids = new Set<string>();
  for (const u of units) {
    if (ids.has(u.id)) {
      throw new Error(`attributeChoice: duplicate unit id '${u.id}' — ids must be unique`);
    }
    ids.add(u.id);
  }
}
