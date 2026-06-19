/**
 * removeAndRetry — the thorough finder. Removes each context piece, re-runs the
 * agent, and a piece is the cause iff its removal flips the outcome back. No
 * embedder, no heuristic: pure counterfactual. Exact, but pays one re-run per
 * piece (`checks`), and on multi-loop runs it can over-attribute (several pieces
 * each flip) — narrow with a slice first when that happens.
 *
 * Method: leave-one-out ablation (counterfactual necessity).
 */
import type { Finder, FindInput, FindResult } from './types.js';

export const removeAndRetry: Finder = {
  name: 'removeAndRetry',
  meta: {
    label: 'Removes each piece and re-runs; keeps the ones whose removal fixes the answer',
    method: 'leave-one-out ablation (counterfactual necessity)',
    paper: 'CausalArmor (Kim 2026) / ContextCite (Cohen-Wang 2024)',
  },
  async find(input: FindInput): Promise<FindResult> {
    if (!input.rerun) throw new Error('removeAndRetry needs input.rerun');
    const rerun = input.rerun;
    const results: { id: string; recovered: boolean }[] = [];
    for (const s of input.suspects) {
      const r = await rerun([s.id]);
      results.push({ id: s.id, recovered: r.recovered });
    }
    const flippers = results.filter((r) => r.recovered).map((r) => r.id);
    // flippers first (causally necessary); stable for ties
    const ranked = [...results].sort((a, b) => Number(b.recovered) - Number(a.recovered));
    const explanation = [
      `removeAndRetry: removed each of ${input.suspects.length} pieces and re-ran (${results.length} checks).`,
      flippers.length
        ? `Removing these flipped the outcome (causally necessary): ${flippers.join(', ')}.`
        : `No single removal flipped the outcome — possible over-determination (no necessary single cause).`,
      flippers.length > 1
        ? `NOTE: ${flippers.length} pieces each flip — multiple necessary causes or incidental reroutes; narrow with a slice (rankSuspects) first.`
        : '',
    ]
      .filter(Boolean)
      .join('\n');
    return {
      finder: 'removeAndRetry',
      suspects: ranked.map((r) => ({ id: r.id })),
      lead: flippers[0],
      shortlist: flippers,
      evidence: 'proven',
      granularity: 'piece',
      checks: results.length,
      explanation,
    };
  },
};
