/**
 * explainChoice — a UI-ready VERDICT for one tool pick: which context
 * CHANNEL (system rules / user task / data from earlier tool results)
 * best explains it, with the exact unit text to quote.
 *
 * Thin composite over `attributeChoice` — same math, zero duplication:
 * the ranking, the top unit, and the per-channel share of positive
 * similarity mass all come from the one existing engine. What this adds
 * is presentation shape: the unit TEXT carried through (so a UI can
 * quote the citation verbatim), a per-channel top unit, and a channels
 * array sorted by share that lists EVERY channel present in the units —
 * including zero-share ones, so "the data channel contributed nothing"
 * is a visible verdict, not a missing key.
 *
 * Pattern: pure async function, embedder-injected. No agent/runtime
 *          imports — `src/lib/influence-core/` leaf, same as
 *          `attributeChoice` / `scoreMargin`.
 *
 * Honest claim (RFC-002 §2): every score and share here is embedding
 * geometry between the tool text and each unit — a PROXY for which
 * context the pick ALIGNS with, never proof the model used that unit.
 * This is Tier 1 (similarity); counterfactual ablation (Tier 3) is the
 * ground truth that would validate it.
 */
import { attributeChoice } from './attribute.js';
import type { AttributionUnit, Embedder, UnitScore } from './types.js';

export interface ExplainChoiceArgs {
  /**
   * The chosen tool being explained. `text` is what gets embedded — pass
   * name + description (the name matters: a data snippet that NAMES the
   * thing the tool acts on, e.g. "id: d42", is its strongest citation).
   */
  readonly tool: { readonly name: string; readonly text: string };
  /**
   * The context units, tagged by channel — e.g. `'system'` rules,
   * the `'task'`, `'data'` snippets from `snippetUnits`. Channels are
   * free-form strings; the verdict reports whatever labels it is given.
   */
  readonly units: readonly AttributionUnit[];
  /** Injected embedder. Wrap in an `EmbeddingCache` so rule texts embed once. */
  readonly embedder: Embedder;
  /** Abort signal threaded to the embedder (network backends). */
  readonly signal?: AbortSignal;
}

/** One channel's verdict: how much of the pick's positive similarity
 *  mass it owns, and the best unit inside it to quote. */
export interface ChannelVerdict {
  readonly channel: string;
  /**
   * 0..1 share of POSITIVE similarity mass (negatives are clamped out,
   * same as `attributeChoice.byChannel`). Shares across all channels sum
   * to ~1 — or are all 0 when no unit had positive similarity.
   */
  readonly share: number;
  /** The best-scoring unit IN this channel, text included for quoting.
   *  Omitted only when the channel has no units. */
  readonly top?: UnitScore & { readonly text: string };
}

/** The full explanation for one tool pick — `attributeChoice` reshaped
 *  for display: text carried through, channels ranked. */
export interface ChoiceExplanation {
  /** The chosen tool being explained. */
  readonly tool: string;
  /**
   * One verdict per channel present in the units, sorted by share
   * descending (ties keep first-appearance order). Zero-share channels
   * are listed too — absence of pull is part of the verdict.
   */
  readonly channels: readonly ChannelVerdict[];
  /** The overall best unit — the citation ("picked because …"). */
  readonly top: UnitScore & { readonly text: string };
  /** Every unit ranked descending (ties keep input order), text included. */
  readonly units: readonly (UnitScore & { readonly text: string })[];
}

/**
 * Run `attributeChoice` and reshape the result for a UI: join each unit's
 * text back by id, pick the best unit per channel, and rank the channels
 * by their share of positive similarity mass.
 *
 * Fail-loud validation is inherited from `attributeChoice`: empty units
 * or duplicate unit ids throw — caller wiring bugs, not runtime conditions.
 */
export async function explainChoice(args: ExplainChoiceArgs): Promise<ChoiceExplanation> {
  const attribution = await attributeChoice({
    tool: args.tool,
    units: args.units,
    embedder: args.embedder,
    ...(args.signal ? { signal: args.signal } : {}),
  });

  // Join the unit text back by id (ids are unique — attributeChoice validated).
  const textById = new Map<string, string>();
  for (const u of args.units) textById.set(u.id, u.text);
  const withText = (score: UnitScore): UnitScore & { readonly text: string } => ({
    ...score,
    text: textById.get(score.id) as string,
  });

  const ranked = attribution.units.map(withText);

  // One verdict per channel, in first-appearance order (stable tiebreak),
  // then sorted by share descending. `ranked` is already descending, so
  // the first unit seen per channel is that channel's top.
  const channelOrder: string[] = [];
  const topByChannel = new Map<string, UnitScore & { readonly text: string }>();
  for (const u of args.units) {
    if (!channelOrder.includes(u.channel)) channelOrder.push(u.channel);
  }
  for (const unit of ranked) {
    if (!topByChannel.has(unit.channel)) topByChannel.set(unit.channel, unit);
  }
  const channels: ChannelVerdict[] = channelOrder.map((channel) => {
    const top = topByChannel.get(channel);
    return {
      channel,
      share: attribution.byChannel[channel] ?? 0,
      ...(top ? { top } : {}),
    };
  });
  // Stable sort — zero-share channels sink to the end, ties keep order.
  channels.sort((a, b) => b.share - a.share);

  return {
    tool: attribution.tool,
    channels,
    top: withText(attribution.top),
    units: ranked,
  };
}
